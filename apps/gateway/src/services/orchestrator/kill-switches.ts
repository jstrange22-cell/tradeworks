/**
 * Multi-level kill switches — capital protection layer.
 *
 * Three independently-tracked levels, evaluated periodically by the exit
 * monitor and gated at every signal entry point:
 *
 *   1. STRATEGY    — 5 consecutive losses on a strategy → pause for 24h.
 *                    Bandit weight collapses to floor while paused.
 *   2. PORTFOLIO   — daily DD ≥ 3% OR weekly DD ≥ 6% → pause ALL new entries.
 *                    Auto-deactivates next 9 AM ET unless user extends.
 *   3. MASTER      — human-fired panic button. Flattens all open positions
 *                    via the exits monitor + blocks all new entries. Manual
 *                    reset only.
 *
 * Persistence: `apps/gateway/data/kill-switch-state.json` (atomic write).
 * Loaded at first call (lazy) and surviving restarts unchanged.
 *
 * Hot-path entry gate is `isTradingAllowed(strategy)` — synchronous, never
 * throws, always reflects the latest cached state. The webhook calls it
 * before any agent gating; the exits monitor calls `checkAndActivateAuto()`
 * once per tick.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../lib/logger.js';
import { emitAppEvent } from '../../lib/events-bus.js';
import { getPool } from '../memory/db.js';
import { getBanditWeight } from './bandit-runner.js';
import {
  DEFAULT_THRESHOLDS,
  type KillSwitchPersistedFile,
  type KillSwitchState,
  type KillSwitchStatus,
  type KillSwitchThresholds,
} from './kill-switch-types.js';

// ── Config ─────────────────────────────────────────────────────────────

const STARTING_CAPITAL = Number(process.env['KILL_SWITCH_STARTING_CAPITAL'] ?? 10_000);

const thresholds: KillSwitchThresholds = { ...DEFAULT_THRESHOLDS };

// Last N outcomes pulled per strategy when computing consecutive-loss runs.
const LOSS_RUN_LOOKBACK = 10;

// ── Module state (cached, persisted to disk) ───────────────────────────

interface InternalState {
  master: KillSwitchState;
  portfolio: KillSwitchState;
  strategies: Record<string, KillSwitchState>;
}

let cachedState: InternalState | null = null;
let stateLoaded = false;

function defaultState(): InternalState {
  return {
    master: { active: false },
    portfolio: { active: false },
    strategies: {},
  };
}

// ── Path resolution ────────────────────────────────────────────────────

function stateFilePath(): string {
  // src/services/orchestrator/kill-switches.ts → apps/gateway/data/kill-switch-state.json
  const here = dirname(fileURLToPath(import.meta.url));
  const orchestrator = here;
  const services = dirname(orchestrator);
  const srcOrDist = dirname(services);
  const gatewayRoot = dirname(srcOrDist);
  return resolve(gatewayRoot, 'data', 'kill-switch-state.json');
}

// ── Persistence ────────────────────────────────────────────────────────

function loadStateFromDisk(): InternalState {
  const path = stateFilePath();
  if (!existsSync(path)) {
    return defaultState();
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<KillSwitchPersistedFile>;
    if (!parsed || parsed.schemaVersion !== 1) {
      logger.warn(
        { schemaVersion: parsed?.schemaVersion },
        '[KillSwitch] state file schemaVersion mismatch — starting fresh',
      );
      return defaultState();
    }
    return {
      master: parsed.master ?? { active: false },
      portfolio: parsed.portfolio ?? { active: false },
      strategies: parsed.strategies ?? {},
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, path },
      '[KillSwitch] state file corrupted — starting with all switches OFF',
    );
    return defaultState();
  }
}

function ensureLoaded(): InternalState {
  if (cachedState && stateLoaded) return cachedState;
  cachedState = loadStateFromDisk();
  stateLoaded = true;
  return cachedState;
}

function persist(state: InternalState): void {
  cachedState = state;
  const path = stateFilePath();
  const dir = dirname(path);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file: KillSwitchPersistedFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      master: state.master,
      portfolio: state.portfolio,
      strategies: state.strategies,
    };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, path },
      '[KillSwitch] failed to persist state',
    );
  }
}

/**
 * Emit a `kill-switch-changed` SSE event with the full current status. The
 * dashboard's KillSwitchButton subscribes to this and refreshes its status
 * query so the panel reflects activations within ~100ms.
 *
 * Synchronous metric compute is fine — the live numbers come from the
 * memory DB which is already async-cached. We swallow errors so a transient
 * DB blip never breaks a kill-switch action.
 */
async function emitStatusChanged(): Promise<void> {
  try {
    const status = await getKillSwitchStatus();
    emitAppEvent('kill-switch-changed', { status });
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[KillSwitch] emitStatusChanged failed (non-fatal)',
    );
  }
}

// ── Auto-expiry sweep ──────────────────────────────────────────────────

function nowMs(): number {
  return Date.now();
}

function maybeExpire(state: InternalState): InternalState {
  let dirty = false;
  const now = nowMs();

  if (state.master.active && state.master.expiresAt) {
    if (new Date(state.master.expiresAt).getTime() <= now) {
      logger.info({ prevReason: state.master.reason }, '[KillSwitch] master auto-expired');
      state.master = { active: false };
      dirty = true;
    }
  }

  if (state.portfolio.active && state.portfolio.expiresAt) {
    if (new Date(state.portfolio.expiresAt).getTime() <= now) {
      logger.info({ prevReason: state.portfolio.reason }, '[KillSwitch] portfolio auto-expired');
      state.portfolio = { active: false };
      dirty = true;
    }
  }

  for (const [strat, st] of Object.entries(state.strategies)) {
    if (st.active && st.expiresAt && new Date(st.expiresAt).getTime() <= now) {
      logger.info({ strategy: strat, prevReason: st.reason }, '[KillSwitch] strategy auto-expired');
      state.strategies[strat] = { active: false };
      dirty = true;
    }
  }

  if (dirty) persist(state);
  return state;
}

// ── Public hot-path API ────────────────────────────────────────────────

/**
 * Synchronous trading-permission check. Called from webhook handlers and
 * any signal-entry code path. Never throws; returns `{ allowed: false, reason }`
 * if any kill switch is active for the given strategy.
 *
 * Order of precedence: master > portfolio > strategy.
 */
export function isTradingAllowed(strategy: string): { allowed: boolean; reason?: string } {
  const state = maybeExpire(ensureLoaded());

  if (state.master.active) {
    return { allowed: false, reason: `master kill: ${state.master.reason}` };
  }
  if (state.portfolio.active) {
    return { allowed: false, reason: `portfolio paused: ${state.portfolio.reason}` };
  }
  const stratState = state.strategies[strategy];
  if (stratState?.active) {
    return { allowed: false, reason: `strategy paused: ${stratState.reason}` };
  }
  return { allowed: true };
}

// ── Status ─────────────────────────────────────────────────────────────

/**
 * Compose the full system status. Includes live metrics so the dashboard can
 * render the rule thresholds. Never throws — degrades to zeroed metrics if
 * the memory DB is unavailable.
 */
export async function getKillSwitchStatus(): Promise<KillSwitchStatus> {
  const state = maybeExpire(ensureLoaded());
  const metrics = await computeMetrics();
  return {
    master: { ...state.master },
    portfolio: { ...state.portfolio },
    strategies: { ...state.strategies },
    metrics,
  };
}

// ── Auto-activation ────────────────────────────────────────────────────

/**
 * Run all auto-activation rules against the current realized PnL +
 * recent-trade history. Idempotent — re-firing the same rule on an already-active
 * switch is a no-op.
 *
 * Called once per exit-monitor tick (≈60s).
 */
export async function checkAndActivateAuto(): Promise<KillSwitchStatus> {
  const state = maybeExpire(ensureLoaded());
  const metrics = await computeMetrics();

  // Strategy-level: 5 consecutive losses → pause.
  for (const [strategy, lossRun] of Object.entries(metrics.consecutiveLossesByStrategy)) {
    if (lossRun >= thresholds.consecutiveLossLimit && !state.strategies[strategy]?.active) {
      await pauseStrategy(
        strategy,
        thresholds.strategyPauseHours,
        `${thresholds.consecutiveLossLimit} consecutive losses`,
      );
    }
  }

  // Portfolio-level: daily DD or weekly DD breach.
  if (!state.portfolio.active) {
    if (metrics.dailyPnlPct <= thresholds.dailyDdLimitPct) {
      await pausePortfolio(
        `daily DD ${(metrics.dailyPnlPct * 100).toFixed(2)}% ≤ ${(thresholds.dailyDdLimitPct * 100).toFixed(0)}%`,
        nextNineAmEt(),
      );
    } else if (metrics.weeklyPnlPct <= thresholds.weeklyDdLimitPct) {
      await pausePortfolio(
        `weekly DD ${(metrics.weeklyPnlPct * 100).toFixed(2)}% ≤ ${(thresholds.weeklyDdLimitPct * 100).toFixed(0)}%`,
        nextNineAmEt(),
      );
    }
  }

  return getKillSwitchStatus();
}

// ── Mutating actions ───────────────────────────────────────────────────

/**
 * Master kill: flatten all open positions immediately + block new entries.
 * Idempotent (re-firing logs info and does NOT re-flatten).
 */
export async function activateMasterKill(reason: string): Promise<void> {
  const state = ensureLoaded();
  if (state.master.active) {
    logger.info({ reason, existingReason: state.master.reason }, '[KillSwitch] master already active — no-op');
    return;
  }

  const now = new Date().toISOString();
  state.master = {
    active: true,
    level: 'master',
    reason: reason || 'manual master kill',
    activatedAt: now,
    // No expiresAt — manual reset only.
  };
  persist(state);
  logger.warn({ reason: state.master.reason, activatedAt: now }, '[KillSwitch] MASTER KILL ACTIVATED');
  void emitStatusChanged();

  // Trigger forced-flatten of all open positions via the exits monitor.
  // Lazy import to avoid a circular import (exits/monitor → orchestrator).
  try {
    const { forceFlattenAll } = await import('../exits/monitor.js');
    if (typeof forceFlattenAll === 'function') {
      await forceFlattenAll(`master_kill: ${reason}`);
    } else {
      logger.warn('[KillSwitch] exits monitor has no forceFlattenAll — flatten skipped');
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[KillSwitch] forceFlattenAll failed — positions may still be open',
    );
  }

  // Notification webhook (Telegram TODO; for now the warn-level log above is
  // the trail. Add a Telegram dispatch here once that integration exists.)
}

export async function deactivateMaster(): Promise<void> {
  const state = ensureLoaded();
  if (!state.master.active) {
    logger.info('[KillSwitch] master already inactive — no-op');
    return;
  }
  state.master = { active: false };
  persist(state);
  logger.info('[KillSwitch] master deactivated');
  void emitStatusChanged();
}

/**
 * Pause a single strategy for `hours`. Sets bandit override to floor (0)
 * for the same duration so the allocator stops routing risk to it.
 */
export async function pauseStrategy(
  strategy: string,
  hours: number,
  reason: string,
): Promise<void> {
  const state = ensureLoaded();
  if (state.strategies[strategy]?.active) {
    logger.info(
      { strategy, reason, existing: state.strategies[strategy] },
      '[KillSwitch] strategy already paused — extending if longer',
    );
    // Idempotent: only extend, don't shorten.
    const existing = state.strategies[strategy] as Extract<KillSwitchState, { active: true }>;
    const proposedExpiry = Date.now() + hours * 3_600_000;
    const currentExpiry = existing.expiresAt ? new Date(existing.expiresAt).getTime() : Infinity;
    if (proposedExpiry > currentExpiry) {
      state.strategies[strategy] = {
        ...existing,
        expiresAt: new Date(proposedExpiry).toISOString(),
        reason,
      };
      persist(state);
    }
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 3_600_000);
  state.strategies[strategy] = {
    active: true,
    level: 'strategy',
    reason,
    activatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  persist(state);
  logger.warn(
    { strategy, hours, reason, expiresAt: expiresAt.toISOString() },
    `[KillSwitch] strategy "${strategy}" PAUSED for ${hours}h — ${reason}`,
  );
  void emitStatusChanged();

  // Drop bandit weight to floor for the pause duration. setTempOverride is a
  // 24h TTL — fine for the default; longer pauses simply re-trigger on next
  // recompute. Lazy import to avoid bandit-runner ↔ kill-switches cycles.
  try {
    const { setTempOverride } = await import('./bandit-runner.js');
    setTempOverride(strategy, 0);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, strategy },
      '[KillSwitch] bandit override failed (non-fatal)',
    );
  }
}

export async function resumeStrategy(strategy: string): Promise<void> {
  const state = ensureLoaded();
  const existing = state.strategies[strategy];
  if (!existing || !existing.active) {
    logger.info({ strategy }, '[KillSwitch] strategy not paused — no-op');
    return;
  }
  state.strategies[strategy] = { active: false };
  persist(state);
  logger.info({ strategy }, `[KillSwitch] strategy "${strategy}" resumed`);
  void emitStatusChanged();

  // Clear bandit override so the recompute can place real weight.
  try {
    const { clearTempOverrides } = await import('./bandit-runner.js');
    // clearTempOverrides() clears all overrides — accepted: a paused strategy
    // is uncommon and a fresh recompute is cheap. If we ever need per-key clear,
    // add a clearTempOverride(strategy) accessor to bandit-runner.
    clearTempOverrides();
  } catch { /* non-fatal */ }
}

/**
 * Pause the entire portfolio. Optional `expiresAt` for auto-deactivation.
 * Default is no expiry (manual reset).
 */
export async function pausePortfolio(reason: string, expiresAtIso?: string): Promise<void> {
  const state = ensureLoaded();
  if (state.portfolio.active) {
    logger.info({ reason, existing: state.portfolio.reason }, '[KillSwitch] portfolio already paused — no-op');
    return;
  }

  const now = new Date().toISOString();
  state.portfolio = {
    active: true,
    level: 'portfolio',
    reason,
    activatedAt: now,
    ...(expiresAtIso ? { expiresAt: expiresAtIso } : {}),
  };
  persist(state);
  logger.warn(
    { reason, activatedAt: now, expiresAt: expiresAtIso ?? null },
    `[KillSwitch] PORTFOLIO PAUSED — ${reason}`,
  );
  void emitStatusChanged();
}

export async function resumePortfolio(): Promise<void> {
  const state = ensureLoaded();
  if (!state.portfolio.active) {
    logger.info('[KillSwitch] portfolio not paused — no-op');
    return;
  }
  state.portfolio = { active: false };
  persist(state);
  logger.info('[KillSwitch] portfolio resumed');
  void emitStatusChanged();
}

// ── Test-only helpers ──────────────────────────────────────────────────

/**
 * Reset the in-memory cache so the next access reloads from disk. Test-only.
 * Production callers should not need this — the module is naturally singleton.
 */
export function __resetKillSwitchCacheForTests(): void {
  cachedState = null;
  stateLoaded = false;
}

/**
 * Replace thresholds for tests. Returns a restore function.
 */
export function __setThresholdsForTests(
  patch: Partial<KillSwitchThresholds>,
): () => void {
  const original = { ...thresholds };
  Object.assign(thresholds, patch);
  return () => Object.assign(thresholds, original);
}

// ── Metrics ────────────────────────────────────────────────────────────

interface ComputedMetrics {
  dailyPnlPct: number;
  weeklyPnlPct: number;
  monthlyPnlPct: number;
  consecutiveLossesByStrategy: Record<string, number>;
}

/**
 * Pull realized PnL from the memory DB and compute the rolling-window
 * percentages. If the DB isn't configured / reachable, returns zeroed metrics
 * so kill switches never auto-trip on missing data.
 */
async function computeMetrics(): Promise<ComputedMetrics> {
  const pool = getPool();
  if (!pool) {
    return {
      dailyPnlPct: 0,
      weeklyPnlPct: 0,
      monthlyPnlPct: 0,
      consecutiveLossesByStrategy: {},
    };
  }

  try {
    // Realized PnL by window (UTC day windows are fine; user-facing dashboard
    // converts to ET. Auto-deactivation uses ET separately via nextNineAmEt()).
    const pnlRes = await pool.query<{
      daily_pnl: string | number | null;
      weekly_pnl: string | number | null;
      monthly_pnl: string | number | null;
    }>(`
      SELECT
        COALESCE(SUM(realized_pnl_usd) FILTER (
          WHERE closed_at >= NOW() - INTERVAL '1 day'
        ), 0) AS daily_pnl,
        COALESCE(SUM(realized_pnl_usd) FILTER (
          WHERE closed_at >= NOW() - INTERVAL '7 days'
        ), 0) AS weekly_pnl,
        COALESCE(SUM(realized_pnl_usd) FILTER (
          WHERE closed_at >= NOW() - INTERVAL '30 days'
        ), 0) AS monthly_pnl
      FROM trade_outcomes
    `);
    const pnlRow = pnlRes.rows[0] ?? {
      daily_pnl: 0, weekly_pnl: 0, monthly_pnl: 0,
    };

    const dailyPnl = numberish(pnlRow.daily_pnl);
    const weeklyPnl = numberish(pnlRow.weekly_pnl);
    const monthlyPnl = numberish(pnlRow.monthly_pnl);

    const denom = STARTING_CAPITAL > 0 ? STARTING_CAPITAL : 10_000;

    // Consecutive losses per strategy — last LOSS_RUN_LOOKBACK closed trades.
    // We use a window function so a single round-trip covers every strategy.
    const lossRes = await pool.query<{
      strategy: string;
      realized_pnl_usd: string | number;
      rn: string | number;
    }>(`
      WITH ranked AS (
        SELECT
          d.strategy,
          o.realized_pnl_usd,
          ROW_NUMBER() OVER (PARTITION BY d.strategy ORDER BY o.closed_at DESC) AS rn
        FROM trade_outcomes o
        JOIN decisions d ON d.id = o.decision_id
        WHERE d.strategy IS NOT NULL
      )
      SELECT strategy, realized_pnl_usd, rn
      FROM ranked
      WHERE rn <= $1
      ORDER BY strategy, rn ASC
    `, [LOSS_RUN_LOOKBACK]);

    const consecutiveLossesByStrategy: Record<string, number> = {};
    let currentStrategy: string | null = null;
    let runLength = 0;
    let runBroken = false;
    for (const r of lossRes.rows) {
      const strat = r.strategy;
      if (strat !== currentStrategy) {
        if (currentStrategy !== null) {
          consecutiveLossesByStrategy[currentStrategy] = runLength;
        }
        currentStrategy = strat;
        runLength = 0;
        runBroken = false;
      }
      const pnl = numberish(r.realized_pnl_usd);
      if (runBroken) continue;
      if (pnl < 0) runLength += 1;
      else runBroken = true;
    }
    if (currentStrategy !== null) {
      consecutiveLossesByStrategy[currentStrategy] = runLength;
    }

    return {
      dailyPnlPct: dailyPnl / denom,
      weeklyPnlPct: weeklyPnl / denom,
      monthlyPnlPct: monthlyPnl / denom,
      consecutiveLossesByStrategy,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[KillSwitch] computeMetrics failed — returning zeroes (no auto-trip)',
    );
    return {
      dailyPnlPct: 0,
      weeklyPnlPct: 0,
      monthlyPnlPct: 0,
      consecutiveLossesByStrategy: {},
    };
  }
}

function numberish(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? parseFloat(v) : v;
}

// ── Time helpers ───────────────────────────────────────────────────────

/**
 * ISO timestamp at the next 9:00 AM ET. Used to schedule auto-deactivation
 * of an auto-tripped portfolio pause. ET = UTC-5 (EST) or UTC-4 (EDT).
 */
function nextNineAmEt(): string {
  const now = new Date();
  const offsetHours = isUSDaylightSavings(now) ? -4 : -5;
  const targetUtcHour = 9 - offsetHours; // 9 ET → 13 UTC (EDT) or 14 UTC (EST)
  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    targetUtcHour,
    0, 0, 0,
  ));
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

function isUSDaylightSavings(d: Date): boolean {
  const year = d.getUTCFullYear();
  const marchStart = new Date(Date.UTC(year, 2, 1));
  const dstStart = new Date(Date.UTC(
    year, 2, 1 + ((7 - marchStart.getUTCDay()) % 7) + 7, 7, 0, 0,
  ));
  const novStart = new Date(Date.UTC(year, 10, 1));
  const dstEnd = new Date(Date.UTC(
    year, 10, 1 + ((7 - novStart.getUTCDay()) % 7), 6, 0, 0,
  ));
  return d.getTime() >= dstStart.getTime() && d.getTime() < dstEnd.getTime();
}

// ── Re-exports for convenience ─────────────────────────────────────────

// Re-export so callers can `import { getBanditWeight } from '../orchestrator/kill-switches.js'`
// if they want the gate + weight check in a single module. Optional —
// most callers will pull from `orchestrator/index.js` instead.
export { getBanditWeight };
