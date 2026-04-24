/**
 * Kill Switches + SPY Regime Multiplier
 *
 * Phase 5 risk management. Three circuit breakers evaluated before every
 * equity/option entry:
 *
 *   1. Daily loss cap:
 *        Today's realised P&L < -3% of account → trip for 24h.
 *   2. Max drawdown cap:
 *        Peak-to-current drawdown > 15% → trip indefinitely (manual reset).
 *   3. Consecutive-loss cap:
 *        Last 5 closed trades all losses → trip for 4h.
 *
 * A lightweight SPY regime multiplier scales position size:
 *   - SPY above 50MA AND 200MA  → 1.0 (normal)
 *   - SPY above 50MA, below 200 → 0.7 (cautious)
 *   - SPY below 50MA            → 0.5 (defensive)
 *
 * State is persisted to data/stocks/kill-switch.json so a restart does not
 * reset an active trip.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../../lib/logger.js';
import type {
  PaperLedgerState,
  EquityClosedTrade,
  OptionClosedTrade,
} from './stock-models.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface KillSwitchState {
  tripped: boolean;
  reason: string | null;
  trippedAt: string | null;
  /** null = indefinite (manual reset), ISO timestamp = auto-resume point. */
  resumeAt: string | null;
}

// ── Persistence ────────────────────────────────────────────────────────

const DATA_DIR = path.resolve('data/stocks');
const KILL_SWITCH_FILE = path.join(DATA_DIR, 'kill-switch.json');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* exists */
}

const DEFAULT_STATE: KillSwitchState = {
  tripped: false,
  reason: null,
  trippedAt: null,
  resumeAt: null,
};

let cachedState: KillSwitchState | null = null;

function loadState(): KillSwitchState {
  if (cachedState) return cachedState;
  try {
    if (fs.existsSync(KILL_SWITCH_FILE)) {
      const raw = JSON.parse(
        fs.readFileSync(KILL_SWITCH_FILE, 'utf-8'),
      ) as Partial<KillSwitchState>;
      cachedState = {
        tripped: Boolean(raw.tripped),
        reason: typeof raw.reason === 'string' ? raw.reason : null,
        trippedAt: typeof raw.trippedAt === 'string' ? raw.trippedAt : null,
        resumeAt: typeof raw.resumeAt === 'string' ? raw.resumeAt : null,
      };
      return cachedState;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[KillSwitch] Failed to load state — starting fresh',
    );
  }
  cachedState = { ...DEFAULT_STATE };
  return cachedState;
}

function saveState(state: KillSwitchState): void {
  cachedState = state;
  try {
    fs.writeFileSync(KILL_SWITCH_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[KillSwitch] Failed to persist state',
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export function getKillSwitchState(): KillSwitchState {
  return { ...loadState() };
}

export function resetKillSwitch(): KillSwitchState {
  const next: KillSwitchState = { ...DEFAULT_STATE };
  saveState(next);
  logger.info('[KillSwitch] Manually reset');
  return { ...next };
}

// ── Trip Constants ─────────────────────────────────────────────────────

const DAILY_LOSS_PCT = 0.03;            // -3% of account
const DAILY_RESUME_MS = 24 * 60 * 60_000;
const MAX_DRAWDOWN_PCT = 0.15;          // -15% peak-to-current
const CONSEC_LOSS_COUNT = 5;
const CONSEC_RESUME_MS = 4 * 60 * 60_000;

// Starting capital assumption for drawdown calc; matches DEFAULT_PAPER_LEDGER.
const STARTING_CAPITAL = 10_000;

// ── Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate kill switches against the current ledger. Returns the new state
 * after trip/auto-resume logic. Callers use `{ tripped }` to gate trades.
 */
export function checkKillSwitches(ledger: PaperLedgerState): KillSwitchState {
  const state = loadState();

  // Auto-resume if resumeAt elapsed.
  if (state.tripped && state.resumeAt) {
    const resumeMs = new Date(state.resumeAt).getTime();
    if (Date.now() >= resumeMs) {
      logger.info(
        { prevReason: state.reason },
        '[KillSwitch] Auto-resume — cooldown elapsed',
      );
      const next = { ...DEFAULT_STATE };
      saveState(next);
      return evaluateFresh(ledger);
    }
  }

  // If already tripped and no resume time (indefinite), stay tripped until reset.
  if (state.tripped) {
    return { ...state };
  }

  return evaluateFresh(ledger);
}

function evaluateFresh(ledger: PaperLedgerState): KillSwitchState {
  // ── Daily loss cap ─────────────────────────────────────────────────
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todaysClosedPnl = sumClosedPnlForDate(ledger, todayStr);
  const account = accountValue(ledger);
  const dailyLossThreshold = -account * DAILY_LOSS_PCT;

  if (todaysClosedPnl <= dailyLossThreshold && account > 0) {
    const next: KillSwitchState = {
      tripped: true,
      reason: `daily_loss: $${todaysClosedPnl.toFixed(2)} ≤ $${dailyLossThreshold.toFixed(2)}`,
      trippedAt: now.toISOString(),
      resumeAt: new Date(Date.now() + DAILY_RESUME_MS).toISOString(),
    };
    saveState(next);
    logger.warn(next, '[KillSwitch] TRIPPED — daily loss');
    return { ...next };
  }

  // ── Max drawdown cap ──────────────────────────────────────────────
  // Approximate peak as the starting capital (or highest closed-P&L cumulative
  // ever seen). For a clean paper account, this effectively caps total loss
  // at -15% from the $10K starting point. Once there is a live ledger with
  // real history, replace with a proper peak tracker.
  const drawdownPct = (STARTING_CAPITAL - account) / STARTING_CAPITAL;
  if (drawdownPct >= MAX_DRAWDOWN_PCT && account > 0) {
    const next: KillSwitchState = {
      tripped: true,
      reason: `max_drawdown: ${(drawdownPct * 100).toFixed(2)}% >= ${(MAX_DRAWDOWN_PCT * 100).toFixed(0)}%`,
      trippedAt: now.toISOString(),
      resumeAt: null, // indefinite — manual reset required
    };
    saveState(next);
    logger.warn(next, '[KillSwitch] TRIPPED — max drawdown (manual reset required)');
    return { ...next };
  }

  // ── Consecutive losses ────────────────────────────────────────────
  const recentTrades = lastClosedTrades(ledger, CONSEC_LOSS_COUNT);
  if (
    recentTrades.length >= CONSEC_LOSS_COUNT &&
    recentTrades.every(t => (t.pnlUsd ?? 0) < 0)
  ) {
    const next: KillSwitchState = {
      tripped: true,
      reason: `consecutive_losses: ${CONSEC_LOSS_COUNT} in a row`,
      trippedAt: now.toISOString(),
      resumeAt: new Date(Date.now() + CONSEC_RESUME_MS).toISOString(),
    };
    saveState(next);
    logger.warn(next, '[KillSwitch] TRIPPED — consecutive losses');
    return { ...next };
  }

  // Not tripped.
  const fresh = { ...DEFAULT_STATE };
  if (cachedState?.tripped) {
    saveState(fresh);
  } else {
    cachedState = fresh;
  }
  return { ...fresh };
}

// ── Helpers ────────────────────────────────────────────────────────────

function accountValue(ledger: PaperLedgerState): number {
  const equityValue = ledger.equityPositions.reduce(
    (sum, p) => sum + p.shares * (p.currentPrice || p.entryPrice),
    0,
  );
  const optionValue = ledger.optionPositions.reduce(
    (sum, p) => sum + p.contracts * (p.currentMid || p.entryMid) * 100,
    0,
  );
  return ledger.paperCashUsd + equityValue + optionValue;
}

function sumClosedPnlForDate(
  ledger: PaperLedgerState,
  isoDate: string,
): number {
  let sum = 0;
  for (const t of ledger.equityClosed) {
    if (t.exitAt?.startsWith(isoDate)) sum += t.pnlUsd ?? 0;
  }
  for (const t of ledger.optionClosed) {
    if (t.exitAt?.startsWith(isoDate)) sum += t.pnlUsd ?? 0;
  }
  return sum;
}

type AnyClosedTrade =
  | (EquityClosedTrade & { _kind: 'equity' })
  | (OptionClosedTrade & { _kind: 'option' });

function lastClosedTrades(
  ledger: PaperLedgerState,
  n: number,
): AnyClosedTrade[] {
  const combined: AnyClosedTrade[] = [
    ...ledger.equityClosed.map(t => ({ ...t, _kind: 'equity' as const })),
    ...ledger.optionClosed.map(t => ({ ...t, _kind: 'option' as const })),
  ];
  combined.sort((a, b) => {
    const ta = new Date(a.exitAt ?? 0).getTime();
    const tb = new Date(b.exitAt ?? 0).getTime();
    return tb - ta;
  });
  return combined.slice(0, n);
}

// ── Regime Multiplier ──────────────────────────────────────────────────

let regimeCache: { at: number; mult: number } | null = null;
const REGIME_CACHE_MS = 60 * 60_000; // 1 hour

/**
 * SPY-based position-size multiplier.
 *
 *   SPY above 50MA AND 200MA  → 1.0 (normal risk)
 *   SPY above 50MA, below 200 → 0.7 (cautious)
 *   SPY below 50MA            → 0.5 (defensive)
 *
 * Result is cached for 1 hour to avoid refetching on every trade.
 * Falls back to 1.0 on any failure so we don't freeze trading on data hiccups.
 */
export async function getRegimeMultiplier(): Promise<number> {
  if (regimeCache && Date.now() - regimeCache.at < REGIME_CACHE_MS) {
    return regimeCache.mult;
  }

  try {
    const { getBars } = await import('../stocks/alpaca-client.js');
    const start = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const resp = await getBars({
      symbols: ['SPY'],
      timeframe: '1Day',
      start,
      limit: 250,
    });
    const bars = resp.bars['SPY'];
    if (!bars || bars.length < 200) {
      logger.warn(
        { returned: bars?.length ?? 0 },
        '[Regime] SPY bars insufficient for 200MA — defaulting mult=1.0',
      );
      regimeCache = { at: Date.now(), mult: 1.0 };
      return 1.0;
    }

    const closes = bars.map(b => b.c);
    const ma50 = avg(closes.slice(-50));
    const ma200 = avg(closes.slice(-200));
    const last = closes[closes.length - 1];

    let mult = 1.0;
    if (last < ma50) mult = 0.5;
    else if (last < ma200) mult = 0.7;

    logger.info(
      { last, ma50, ma200, mult },
      `[Regime] SPY last=${last.toFixed(2)} 50MA=${ma50.toFixed(2)} 200MA=${ma200.toFixed(2)} → mult=${mult}`,
    );

    regimeCache = { at: Date.now(), mult };
    return mult;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[Regime] getRegimeMultiplier failed — defaulting to 1.0',
    );
    regimeCache = { at: Date.now(), mult: 1.0 };
    return 1.0;
  }
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}
