/**
 * Crypto kill switches — mirror of stock kill-switches.ts with crypto-adapted
 * thresholds. Trips on daily loss -3% of starting, max DD 15% from peak,
 * or 7 consecutive losses. Persists to data/dex/kill-switch.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { logger } from '../../lib/logger.js';

const STATE_PATH = resolve(process.cwd(), 'data', 'dex', 'kill-switch.json');

const DAILY_LOSS_PCT = 0.03;       // 3%
const MAX_DD_PCT = 0.15;            // 15%
const CONSEC_LOSS_COUNT = 7;

const DAILY_COOLDOWN_MS = 24 * 60 * 60_000;
const CONSEC_COOLDOWN_MS = 4 * 60 * 60_000;

export interface CryptoKillSwitchState {
  tripped: boolean;
  reason: string | null;
  trippedAt: string | null;
  resumeAt: string | null;
  peakValueUsd: number;
}

interface ClosedTradeLite {
  pnlUsd: number;
  closedAt: string;
}

interface EvalContext {
  paperCashUsd: number;
  positionsValueUsd: number;
  closedTrades: ClosedTradeLite[];
  startingCapital: number;
}

let cached: CryptoKillSwitchState | null = null;

function defaultState(): CryptoKillSwitchState {
  return {
    tripped: false,
    reason: null,
    trippedAt: null,
    resumeAt: null,
    peakValueUsd: 0,
  };
}

function loadState(): CryptoKillSwitchState {
  if (cached) return cached;
  try {
    if (existsSync(STATE_PATH)) {
      const raw = readFileSync(STATE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<CryptoKillSwitchState>;
      cached = { ...defaultState(), ...parsed };
      return cached;
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[CryptoKillSwitch] load failed — using default');
  }
  cached = defaultState();
  return cached;
}

function saveState(state: CryptoKillSwitchState): void {
  cached = state;
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[CryptoKillSwitch] save failed');
  }
}

export function getCryptoKillSwitchState(): CryptoKillSwitchState {
  return { ...loadState() };
}

export function resetCryptoKillSwitch(): void {
  const prev = loadState();
  const next: CryptoKillSwitchState = {
    ...defaultState(),
    peakValueUsd: prev.peakValueUsd,
  };
  saveState(next);
  logger.info('[CryptoKillSwitch] manually reset');
}

/**
 * Evaluate all triggers and return the current state. Auto-resumes tripped
 * states when their resumeAt has passed. Always updates peakValueUsd.
 */
export function checkCryptoKillSwitches(ctx: EvalContext): CryptoKillSwitchState {
  const state = loadState();
  const now = Date.now();

  // Auto-resume
  if (state.tripped && state.resumeAt) {
    const resume = new Date(state.resumeAt).getTime();
    if (resume <= now) {
      logger.info({ prevReason: state.reason }, '[CryptoKillSwitch] auto-resumed');
      state.tripped = false;
      state.reason = null;
      state.trippedAt = null;
      state.resumeAt = null;
      saveState(state);
    }
  }

  // Track peak value
  const totalValue = ctx.paperCashUsd + ctx.positionsValueUsd;
  const nextPeak = Math.max(state.peakValueUsd, totalValue, ctx.startingCapital);
  if (nextPeak !== state.peakValueUsd) {
    state.peakValueUsd = nextPeak;
    saveState(state);
  }

  // Already tripped and not yet resumed — return current state without re-evaluating
  if (state.tripped) return { ...state };

  // Trigger 1 — daily loss
  const dayCutoff = now - DAILY_COOLDOWN_MS;
  const dailyPnl = ctx.closedTrades
    .filter(t => new Date(t.closedAt).getTime() >= dayCutoff)
    .reduce((s, t) => s + t.pnlUsd, 0);
  if (dailyPnl < 0 && Math.abs(dailyPnl) > ctx.startingCapital * DAILY_LOSS_PCT) {
    state.tripped = true;
    state.reason = `daily_loss:${dailyPnl.toFixed(2)}`;
    state.trippedAt = new Date().toISOString();
    state.resumeAt = new Date(now + DAILY_COOLDOWN_MS).toISOString();
    saveState(state);
    logger.warn({ dailyPnl }, '[CryptoKillSwitch] TRIPPED — daily loss exceeded');
    return { ...state };
  }

  // Trigger 2 — max drawdown
  if (state.peakValueUsd > 0) {
    const dd = (state.peakValueUsd - totalValue) / state.peakValueUsd;
    if (dd > MAX_DD_PCT) {
      state.tripped = true;
      state.reason = `max_dd:${(dd * 100).toFixed(1)}%`;
      state.trippedAt = new Date().toISOString();
      state.resumeAt = null; // indefinite — manual reset required
      saveState(state);
      logger.warn({ dd, totalValue, peak: state.peakValueUsd }, '[CryptoKillSwitch] TRIPPED — max drawdown exceeded');
      return { ...state };
    }
  }

  // Trigger 3 — consecutive losses
  const sorted = [...ctx.closedTrades].sort((a, b) =>
    new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
  );
  let consec = 0;
  for (const t of sorted) {
    if (t.pnlUsd <= 0) consec += 1;
    else break;
    if (consec >= CONSEC_LOSS_COUNT) break;
  }
  if (consec >= CONSEC_LOSS_COUNT) {
    state.tripped = true;
    state.reason = `consec_losses:${consec}`;
    state.trippedAt = new Date().toISOString();
    state.resumeAt = new Date(now + CONSEC_COOLDOWN_MS).toISOString();
    saveState(state);
    logger.warn({ consec }, '[CryptoKillSwitch] TRIPPED — consecutive losses');
    return { ...state };
  }

  return { ...state };
}
