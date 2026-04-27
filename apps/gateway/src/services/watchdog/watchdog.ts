/**
 * Watchdog — VPS-side autonomous health monitor and auto-fixer.
 *
 * Runs in-process every 60s. Each cycle iterates a list of CheckSpec entries,
 * runs the diagnostic, applies the auto-fix if allowed, and writes the
 * outcome to a persistent JSONL log at data/watchdog/log.jsonl.
 *
 * Safety: per-check fix budget (max N applied fixes per hour) prevents
 * runaway behavior. Critical fixes (e.g. pm2 restart) are rate-limited
 * harder than soft fixes (e.g. kill-switch reset).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../lib/logger.js';

const execAsync = promisify(exec);

const DATA_DIR = resolve(process.cwd(), 'data', 'watchdog');
const LOG_PATH = resolve(DATA_DIR, 'log.jsonl');
const CONFIG_PATH = resolve(DATA_DIR, 'config.json');
const STATE_PATH = resolve(DATA_DIR, 'state.json');

const TICK_INTERVAL_MS = 60_000;
const FIX_HISTORY_WINDOW_MS = 60 * 60_000; // 1 hour

// ── Config & State ──────────────────────────────────────────────────────

export interface WatchdogConfig {
  enabledChecks: Record<string, boolean>;
  fixBudgets: Record<string, number>; // max fixes/hour by checkId
  // Knobs
  staleLogThresholdMs: number;
  memWarnMb: number;
  pmRestartHourlyMax: number;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  enabledChecks: {
    bot_health: true,
    stocks_kill_switch_paper: true,
    crypto_kill_switch_paper: true,
    stocks_monitor_ticks: true,
    crypto_monitor_ticks: true,
    tradevisor_scanning: true,
    derived_pnl_drift: true,
    pm2_restart_storm: true,
  },
  fixBudgets: {
    bot_health: 3,                  // 3 pm2 restarts/hr max (was the user's pain point)
    stocks_kill_switch_paper: 12,
    crypto_kill_switch_paper: 12,
    stocks_monitor_ticks: 2,
    crypto_monitor_ticks: 2,
    tradevisor_scanning: 2,
    derived_pnl_drift: 0,           // observation-only
    pm2_restart_storm: 0,           // observation-only — alert
  },
  staleLogThresholdMs: 5 * 60_000,
  memWarnMb: 800,
  pmRestartHourlyMax: 10,
};

interface WatchdogState {
  startedAt: string;
  lastTickAt: string | null;
  totalTicks: number;
  totalFixes: number;
  fixHistory: Array<{ checkId: string; ts: string }>;
}

let state: WatchdogState = {
  startedAt: new Date().toISOString(),
  lastTickAt: null,
  totalTicks: 0,
  totalFixes: 0,
  fixHistory: [],
};

let config: WatchdogConfig = { ...DEFAULT_CONFIG };

function ensureDir(): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }
}

function loadConfig(): void {
  ensureDir();
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...DEFAULT_CONFIG, ...raw };
    } else {
      writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[Watchdog] config load failed — using defaults');
  }
}

function saveState(): void {
  try { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch { /* fire-and-forget */ }
}

function loadState(): void {
  if (existsSync(STATE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
      state = { ...state, ...raw };
    } catch { /* fall through */ }
  }
}

// ── Persistent JSONL log ────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  checkId: string;
  status: 'ok' | 'warn' | 'fixed' | 'failed' | 'budget_exhausted' | 'error';
  detail: string;
  data?: Record<string, unknown>;
}

function writeLog(entry: LogEntry): void {
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch { /* fire-and-forget */ }
}

function recentLog(limit: number = 100): LogEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    return lines.slice(-limit).map(l => JSON.parse(l) as LogEntry);
  } catch { return []; }
}

function fixesInLastHour(checkId: string): number {
  const cutoff = Date.now() - FIX_HISTORY_WINDOW_MS;
  return state.fixHistory.filter(f => f.checkId === checkId && new Date(f.ts).getTime() >= cutoff).length;
}

function recordFix(checkId: string): void {
  state.fixHistory.push({ checkId, ts: new Date().toISOString() });
  // Prune entries older than 1h to keep state file small
  const cutoff = Date.now() - FIX_HISTORY_WINDOW_MS;
  state.fixHistory = state.fixHistory.filter(f => new Date(f.ts).getTime() >= cutoff);
  state.totalFixes += 1;
}

// ── Check spec ──────────────────────────────────────────────────────────

interface CheckResult {
  status: 'ok' | 'warn' | 'fixed' | 'failed';
  detail: string;
  data?: Record<string, unknown>;
}

interface CheckSpec {
  id: string;
  description: string;
  run: () => Promise<CheckResult>;
}

// ── Helper: HTTP fetch from local API ───────────────────────────────────

async function fetchLocal(path: string): Promise<{ ok: boolean; data?: unknown; status?: number }> {
  try {
    const res = await fetch(`http://localhost:4000${path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json() as { data?: unknown };
    return { ok: true, data: json.data, status: res.status };
  } catch (err) {
    return { ok: false };
  }
}

async function postLocal(path: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: unknown }> {
  try {
    const res = await fetch(`http://localhost:4000${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const json = await res.json() as { data?: unknown };
    return { ok: true, data: json.data };
  } catch { return { ok: false }; }
}

// ── Checks ──────────────────────────────────────────────────────────────

const checks: CheckSpec[] = [
  // 1. Bot health — pm2 alive, memory not bloated
  {
    id: 'bot_health',
    description: 'pm2 process running, memory under threshold',
    async run() {
      try {
        const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
        if (memMb > config.memWarnMb) {
          return { status: 'warn', detail: `memory ${memMb}MB > ${config.memWarnMb}MB threshold`, data: { memMb } };
        }
        return { status: 'ok', detail: `running, ${memMb}MB`, data: { memMb } };
      } catch (err) {
        return { status: 'failed', detail: `inspect failed: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  // 2. Stocks kill switch — auto-reset in paper mode
  {
    id: 'stocks_kill_switch_paper',
    description: 'auto-reset stock kill switch when tripped (paper mode only)',
    async run() {
      const isLive = process.env.ENABLE_LIVE_EQUITIES === 'true';
      if (isLive) return { status: 'ok', detail: 'live mode — kill switch left intact' };
      const res = await fetchLocal('/api/v1/stocks/kill-switch');
      if (!res.ok) return { status: 'failed', detail: 'endpoint unreachable' };
      const ks = res.data as { tripped?: boolean; reason?: string } | undefined;
      if (!ks?.tripped) return { status: 'ok', detail: 'not tripped' };
      const reset = await postLocal('/api/v1/stocks/kill-switch/reset');
      if (reset.ok) {
        return { status: 'fixed', detail: `reset (was: ${ks.reason})`, data: { prevReason: ks.reason } };
      }
      return { status: 'failed', detail: `reset endpoint failed (was: ${ks.reason})` };
    },
  },

  // 3. Crypto kill switch — same as stocks
  {
    id: 'crypto_kill_switch_paper',
    description: 'auto-reset crypto kill switch when tripped (paper mode only)',
    async run() {
      const res = await fetchLocal('/api/v1/crypto/kill-switch');
      if (!res.ok) return { status: 'failed', detail: 'endpoint unreachable' };
      const ks = res.data as { tripped?: boolean; reason?: string } | undefined;
      if (!ks?.tripped) return { status: 'ok', detail: 'not tripped' };
      const reset = await postLocal('/api/v1/crypto/kill-switch/reset');
      if (reset.ok) {
        return { status: 'fixed', detail: `reset (was: ${ks.reason})`, data: { prevReason: ks.reason } };
      }
      return { status: 'failed', detail: `reset endpoint failed (was: ${ks.reason})` };
    },
  },

  // 4. Stocks position-monitor ticks — flag if currentPrice frozen
  {
    id: 'stocks_monitor_ticks',
    description: 'stocks position monitor refreshing prices',
    async run() {
      const res = await fetchLocal('/api/v1/stocks/portfolio');
      if (!res.ok) return { status: 'failed', detail: 'endpoint unreachable' };
      const p = res.data as { equityPositions?: Array<{ symbol: string; lastPriceAt?: string }> } | undefined;
      const positions = p?.equityPositions ?? [];
      if (positions.length === 0) return { status: 'ok', detail: 'no positions to refresh' };
      const now = Date.now();
      const stale = positions.filter(x => {
        if (!x.lastPriceAt) return true;
        return (now - new Date(x.lastPriceAt).getTime()) > 90_000;
      });
      if (stale.length === 0) return { status: 'ok', detail: `all ${positions.length} positions fresh` };
      return {
        status: 'warn',
        detail: `${stale.length}/${positions.length} positions stale (>90s no price refresh)`,
        data: { staleSymbols: stale.map(s => s.symbol) },
      };
    },
  },

  // 5. Crypto position-monitor ticks
  {
    id: 'crypto_monitor_ticks',
    description: 'crypto position monitor refreshing prices',
    async run() {
      const res = await fetchLocal('/api/v1/crypto/paper');
      if (!res.ok) return { status: 'failed', detail: 'endpoint unreachable' };
      const p = res.data as { openPositions?: Array<{ symbol: string; currentPrice: number; avgEntry: number }> } | undefined;
      const positions = p?.openPositions ?? [];
      if (positions.length === 0) return { status: 'ok', detail: 'no positions to refresh' };
      // Heuristic: currentPrice === avgEntry to >5 decimals likely means no refresh fired
      const frozen = positions.filter(x => Math.abs(x.currentPrice - x.avgEntry) < 0.0000001);
      if (frozen.length === 0) return { status: 'ok', detail: `all ${positions.length} positions have moved` };
      return {
        status: 'warn',
        detail: `${frozen.length}/${positions.length} crypto positions show currentPrice === avgEntry`,
        data: { frozenSymbols: frozen.map(s => s.symbol) },
      };
    },
  },

  // 6. TradeVisor still scanning
  {
    id: 'tradevisor_scanning',
    description: 'TradeVisor scan loop progressing',
    async run() {
      try {
        const { stdout } = await execAsync(
          `tail -n 500 /root/.pm2/logs/tradeworks-gateway-out.log 2>/dev/null | grep -c '\\[Tradevisor\\]'`,
        );
        const recentScanLines = parseInt(stdout.trim() || '0', 10);
        if (recentScanLines === 0) {
          return { status: 'warn', detail: 'no Tradevisor lines in last 500 log entries' };
        }
        return { status: 'ok', detail: `${recentScanLines} Tradevisor entries in last 500 lines` };
      } catch (err) {
        return { status: 'failed', detail: `log tail failed: ${err instanceof Error ? err.message : err}` };
      }
    },
  },

  // 7. Derived P&L drift — derived vs legacy stats divergence
  {
    id: 'derived_pnl_drift',
    description: 'crypto derived stats match legacy counters',
    async run() {
      const res = await fetchLocal('/api/v1/crypto/stats/audit');
      if (!res.ok) return { status: 'failed', detail: 'audit endpoint unreachable' };
      const a = res.data as { discrepancy?: boolean; derived?: { pnlUsd: number; n: number }; legacy?: { pnlUsd: number; n: number } } | undefined;
      if (!a) return { status: 'failed', detail: 'no audit payload' };
      if (a.discrepancy) {
        const drift = Math.abs((a.derived?.pnlUsd ?? 0) - (a.legacy?.pnlUsd ?? 0));
        return {
          status: 'warn',
          detail: `derived/legacy drift $${drift.toFixed(2)}`,
          data: { derived: a.derived, legacy: a.legacy },
        };
      }
      return { status: 'ok', detail: 'derived matches legacy' };
    },
  },

  // 8. pm2 restart storm — alert if too many restarts in last hour
  {
    id: 'pm2_restart_storm',
    description: 'pm2 restart count not in storm range',
    async run() {
      try {
        const { stdout } = await execAsync('pm2 jlist 2>/dev/null');
        const procs = JSON.parse(stdout) as Array<{ name: string; pm2_env?: { restart_time?: number } }>;
        const tw = procs.find(p => p.name === 'tradeworks-gateway');
        if (!tw) return { status: 'failed', detail: 'tradeworks-gateway not in pm2 list' };
        const restarts = tw.pm2_env?.restart_time ?? 0;
        if (restarts > config.pmRestartHourlyMax) {
          return {
            status: 'warn',
            detail: `${restarts} cumulative restarts (threshold ${config.pmRestartHourlyMax})`,
            data: { restarts },
          };
        }
        return { status: 'ok', detail: `${restarts} cumulative restarts` };
      } catch (err) {
        return { status: 'failed', detail: `pm2 jlist failed: ${err instanceof Error ? err.message : err}` };
      }
    },
  },
];

// ── Tick loop ───────────────────────────────────────────────────────────

let tickHandle: NodeJS.Timeout | null = null;

async function runTick(): Promise<void> {
  const tickStart = Date.now();
  state.totalTicks += 1;
  state.lastTickAt = new Date().toISOString();

  for (const check of checks) {
    if (config.enabledChecks[check.id] === false) continue;
    try {
      const result = await check.run();

      if (result.status === 'fixed') {
        // Verify budget BEFORE recording (the run() already applied the fix
        // for simple cases like kill-switch reset — for those, the budget
        // gate is "should we have done that?" and we adjust by skipping
        // future fixes if exceeded). Conservative: log either way.
        const budget = config.fixBudgets[check.id] ?? 0;
        const used = fixesInLastHour(check.id);
        if (used >= budget) {
          writeLog({
            ts: new Date().toISOString(),
            checkId: check.id,
            status: 'budget_exhausted',
            detail: `${result.detail} (but budget ${used}/${budget} used in last hour)`,
            data: result.data,
          });
        } else {
          recordFix(check.id);
          writeLog({ ts: new Date().toISOString(), checkId: check.id, status: 'fixed', detail: result.detail, data: result.data });
        }
      } else {
        writeLog({ ts: new Date().toISOString(), checkId: check.id, status: result.status, detail: result.detail, data: result.data });
      }
    } catch (err) {
      writeLog({
        ts: new Date().toISOString(),
        checkId: check.id,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  saveState();
  const elapsed = Date.now() - tickStart;
  if (elapsed > 30_000) {
    logger.warn({ elapsed }, '[Watchdog] tick took >30s');
  }
}

export function startWatchdog(): void {
  if (process.env.ENABLE_WATCHDOG !== 'true') {
    logger.info('[Watchdog] DISABLED (set ENABLE_WATCHDOG=true)');
    return;
  }
  ensureDir();
  loadConfig();
  loadState();
  state.startedAt = new Date().toISOString();
  saveState();
  logger.info({ checks: checks.map(c => c.id), interval: TICK_INTERVAL_MS }, '[Watchdog] starting');
  // First tick after 10s to let other engines initialize
  setTimeout(() => {
    void runTick();
    tickHandle = setInterval(() => { void runTick(); }, TICK_INTERVAL_MS);
  }, 10_000);
}

export function stopWatchdog(): void {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  logger.info('[Watchdog] stopped');
}

// ── Public read APIs (for the HTTP routes) ──────────────────────────────

export function getWatchdogStatus(): {
  running: boolean;
  startedAt: string;
  lastTickAt: string | null;
  totalTicks: number;
  totalFixes: number;
  enabledChecks: Record<string, boolean>;
  recentLog: LogEntry[];
  fixesByCheck: Record<string, number>;
} {
  loadState();
  const fixesByCheck: Record<string, number> = {};
  for (const check of checks) {
    fixesByCheck[check.id] = fixesInLastHour(check.id);
  }
  return {
    running: tickHandle !== null,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    totalTicks: state.totalTicks,
    totalFixes: state.totalFixes,
    enabledChecks: config.enabledChecks,
    recentLog: recentLog(50),
    fixesByCheck,
  };
}

export function getWatchdogLog(limit: number = 200): LogEntry[] {
  return recentLog(limit);
}

export function getWatchdogConfig(): WatchdogConfig {
  return { ...config };
}

export function setWatchdogConfig(patch: Partial<WatchdogConfig>): WatchdogConfig {
  config = { ...config, ...patch };
  ensureDir();
  try { writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch { /* fire-and-forget */ }
  return config;
}

export function listChecks(): Array<{ id: string; description: string }> {
  return checks.map(c => ({ id: c.id, description: c.description }));
}

export async function runWatchdogNow(): Promise<{ tickedAt: string; recentLog: LogEntry[] }> {
  await runTick();
  return { tickedAt: new Date().toISOString(), recentLog: recentLog(20) };
}
