/**
 * Unified exit monitor (Phase D5).
 *
 * Single 60-second tick loop that:
 *   1. Pulls every open position (equity / option / CEX) via adapters.
 *   2. Fetches current bars per symbol (cached 5s upstream).
 *   3. Updates highSinceEntry / lowSinceEntry per position (persisted to
 *      data/exit-tracker.json so a gateway restart doesn't reset trails).
 *   4. Runs the rules engine per-position; first triggered rule wins.
 *   5. Calls into the existing close helpers (closeEquityPosition,
 *      closeOptionPosition, recordCEXTrade) to actually fire the exit.
 *      Outcome attribution then flows through `triggerExit` as before.
 *
 * The legacy stock-agent position-monitor is LEFT IN PLACE as
 * defense-in-depth: it runs on a 30-second interval applying its own,
 * smaller rule set (5%/3%/+25%/-50%/IV-crush). Both monitors evaluate the
 * same ledger; if either one fires a close first, the other is a no-op
 * because closeEquityPosition/closeOptionPosition return early when the
 * position has already been removed from the ledger. Once the legacy
 * monitor is retired (Phase D6), this file becomes the single source.
 *
 * The triggerExit() interface introduced by C1 is preserved unchanged so
 * existing callers (stock-agent.ts, crypto-agent.ts) keep working — this
 * file extends, not replaces.
 */
import { logger } from '../../lib/logger.js';
import type { ExitReason } from '../memory/types.js';
import { writeOutcomeFromTrade } from './outcome-writer.js';
import { loadAllOpenPositions } from './position-adapters.js';
import { fetchBarsFor } from './price-fetcher.js';
import { buildRuleStack, evaluateExitRules, type EngineEvaluation } from './rules-engine.js';
import {
  clearTrackerState,
  getTrackerState,
  pruneStale,
  updateTrackerState,
} from './tracker-store.js';
import type {
  ExitBar,
  ExitDecision,
  OpenPosition,
  PositionTrackerState,
  StrategyExitConfig,
  StrategyExitConfigMap,
  StrategyTag,
} from './types.js';
import { DEFAULT_STRATEGY_EXIT_CONFIG } from './types.js';

// ── Original C1 trigger surface (preserved) ────────────────────────────

/** Asset class the closing position belongs to. */
export type ExitAssetClass = 'equity' | 'option' | 'crypto-cex' | 'crypto-dex';

/**
 * Everything the exit-attribution writer needs from a closing position. Each
 * caller (stock-agent, position-monitor, crypto-agent) fills this in once and
 * the monitor handles the math + memory write.
 */
export interface ExitTrigger {
  decisionId: string | null | undefined;
  assetClass: ExitAssetClass;
  symbol: string;
  side?: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  fees?: number;
  stopPrice?: number | null;
  openedAt: string | Date;
  closedAt?: string | Date;
  reason: ExitReason | string;
  notes?: string | null;
}

/**
 * One-line API for close handlers. Returns void — never throws — so the
 * existing close logic stays uninterrupted regardless of memory state.
 */
export async function triggerExit(input: ExitTrigger): Promise<void> {
  await writeOutcomeFromTrade({
    decisionId: input.decisionId,
    side: input.side ?? 'long',
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    qty: input.qty,
    fees: input.fees ?? 0,
    stopPrice: input.stopPrice ?? null,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    exitReason: input.reason,
    notes: input.notes ?? null,
  });
}

// ── Master-kill forced flatten (preserved from previous version) ───────

/**
 * Flatten ALL open positions immediately — invoked by `activateMasterKill()`
 * in the kill-switch module. Asset coverage:
 *
 *   - equity (paper ledger)   → closeEquityPosition at currentPrice
 *   - options (paper ledger)  → closeOptionPosition at currentMid
 *   - crypto-cex (FreqTrade)  → POST /api/v1/forceexit with tradeid='all'
 *   - crypto-dex / sniper     → SHELVED 2026-05-04 (no live positions)
 *
 * Best-effort: per-asset failures log a warn and the others continue.
 * Returns the number of position-close attempts dispatched (success or fail).
 */
export async function forceFlattenAll(reason: string): Promise<number> {
  let dispatched = 0;
  logger.warn({ reason }, '[ExitsMonitor] forceFlattenAll triggered');

  // ── Equity + options (TradeVisor paper ledger) ──────────────────────
  try {
    const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
    const { closeEquityPosition, closeOptionPosition } = await import('../stock-intelligence/stock-agent.js');
    const ledger = loadPaperLedger();

    for (const pos of [...ledger.equityPositions]) {
      try {
        const exitPrice = pos.currentPrice && pos.currentPrice > 0 ? pos.currentPrice : pos.entryPrice;
        await closeEquityPosition(pos, exitPrice, 'manual');
        dispatched += 1;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, symbol: pos.symbol },
          '[ExitsMonitor] forceFlattenAll: equity close failed',
        );
      }
    }
    for (const pos of [...ledger.optionPositions]) {
      try {
        const exitMid = pos.currentMid && pos.currentMid > 0 ? pos.currentMid : pos.entryMid;
        await closeOptionPosition(pos, exitMid, 'manual');
        dispatched += 1;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, symbol: pos.symbol },
          '[ExitsMonitor] forceFlattenAll: option close failed',
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[ExitsMonitor] forceFlattenAll: stock paper ledger module unavailable',
    );
  }

  // ── FreqTrade (crypto CEX) ─────────────────────────────────────────
  if (process.env['ENABLE_FREQTRADE_BRIDGE'] === 'true') {
    try {
      const apiUrl = process.env['FREQTRADE_API_URL'] ?? 'http://localhost:8090';
      const username = process.env['FREQTRADE_USERNAME'] ?? 'tradeworks';
      const password = process.env['FREQTRADE_PASSWORD'];
      if (password) {
        const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        const res = await fetch(`${apiUrl}/api/v1/forceexit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth },
          body: JSON.stringify({ tradeid: 'all' }),
          signal: AbortSignal.timeout(8_000),
        });
        const body = await res.text();
        logger.warn(
          { status: res.status, body: body.slice(0, 200) },
          '[ExitsMonitor] forceFlattenAll: FreqTrade /forceexit all dispatched',
        );
        dispatched += 1;
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        '[ExitsMonitor] forceFlattenAll: FreqTrade close failed',
      );
    }
  }

  return dispatched;
}

// ── Monitor configuration ──────────────────────────────────────────────

const TICK_INTERVAL_MS = 60_000;
const MAX_OPEN_POSITIONS = 50;

interface MonitorState {
  running: boolean;
  intervalHandle: ReturnType<typeof setInterval> | null;
  lastTickAt: string | null;
  lastTickDurationMs: number;
  lastTickError: string | null;
  ticksTotal: number;
  exitsTotal: number;
  lastEvaluations: PositionEvaluation[];
}

const state: MonitorState = {
  running: false,
  intervalHandle: null,
  lastTickAt: null,
  lastTickDurationMs: 0,
  lastTickError: null,
  ticksTotal: 0,
  exitsTotal: 0,
  lastEvaluations: [],
};

/**
 * Per-position evaluation snapshot exposed to the routes layer for
 * /api/v1/exits/positions. Keeps just enough to build a useful dashboard
 * without leaking private rule internals.
 */
export interface PositionEvaluation {
  trackerId: string;
  symbol: string;
  assetClass: ExitAssetClass;
  strategy: StrategyTag;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  stopPrice: number;
  bar: ExitBar | null;
  highSinceEntry: number;
  lowSinceEntry: number;
  ladderPartialDone: boolean;
  triggered: EngineEvaluation['triggeredBy'];
  decision: ExitDecision;
  /** Whether the exit was actually fired (after the dispatcher accepted it). */
  fired: boolean;
}

// Per-strategy config, mutable so a future API can reload from disk.
let activeConfig: StrategyExitConfigMap = { ...DEFAULT_STRATEGY_EXIT_CONFIG };

// Cache of compiled rule stacks per strategy. Built lazily.
const stackCache = new Map<StrategyTag, ReturnType<typeof buildRuleStack>>();

function getStack(strategy: StrategyTag): ReturnType<typeof buildRuleStack> {
  let cached = stackCache.get(strategy);
  if (!cached) {
    const cfg = getStrategyConfig(strategy);
    cached = buildRuleStack(strategy, cfg);
    stackCache.set(strategy, cached);
  }
  return cached;
}

function getStrategyConfig(strategy: StrategyTag): StrategyExitConfig {
  return activeConfig[strategy] ?? activeConfig.unknown;
}

/**
 * Replace the per-strategy config map (e.g. from data/exit-rules.json on
 * boot) and bust the rule-stack cache so the new values take effect on
 * the next tick.
 */
export function setStrategyExitConfig(cfg: StrategyExitConfigMap): void {
  activeConfig = cfg;
  stackCache.clear();
}

export function getStrategyExitConfig(): StrategyExitConfigMap {
  return activeConfig;
}

// ── Lifecycle ──────────────────────────────────────────────────────────

export function startExitMonitor(): void {
  if (process.env.ENABLE_EXIT_MONITOR === 'false') {
    logger.info('[ExitMonitor] disabled via ENABLE_EXIT_MONITOR=false');
    return;
  }
  if (state.running) {
    logger.info('[ExitMonitor] already running');
    return;
  }

  // Optional: load config from disk once on boot. Failures fall back to
  // the in-memory defaults — we never block startup on a config read.
  void loadConfigFromDisk();

  state.running = true;
  logger.info({ intervalMs: TICK_INTERVAL_MS }, '[ExitMonitor] starting');

  // Fire one tick immediately so the operator sees output without
  // waiting a full minute on boot.
  void runTick();
  state.intervalHandle = setInterval(() => { void runTick(); }, TICK_INTERVAL_MS);
}

export function stopExitMonitor(): void {
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  state.running = false;
  logger.info('[ExitMonitor] stopped');
}

async function loadConfigFromDisk(): Promise<void> {
  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const file = resolve(
      process.env['EXIT_RULES_FILE'] ?? './data/exit-rules.json',
    );
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<StrategyExitConfigMap>;
    // Shallow-merge per-strategy so a partial config still works.
    const merged: StrategyExitConfigMap = { ...DEFAULT_STRATEGY_EXIT_CONFIG };
    for (const k of Object.keys(merged) as StrategyTag[]) {
      if (raw[k]) merged[k] = { ...merged[k], ...raw[k] };
    }
    setStrategyExitConfig(merged);
    logger.info({ file }, '[ExitMonitor] loaded strategy config from disk');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[ExitMonitor] config load failed — using defaults',
    );
  }
}

// ── Tick implementation ────────────────────────────────────────────────

async function runTick(): Promise<void> {
  const tickStartedAt = Date.now();
  state.ticksTotal++;
  const tickEvaluations: PositionEvaluation[] = [];
  let exitsThisTick = 0;

  try {
    const positions = await loadAllOpenPositions();
    if (positions.length > MAX_OPEN_POSITIONS) {
      logger.warn(
        { open: positions.length, cap: MAX_OPEN_POSITIONS },
        '[ExitMonitor] open positions exceed cap — evaluating first N only',
      );
    }
    const capped = positions.slice(0, MAX_OPEN_POSITIONS);

    if (capped.length === 0) {
      state.lastTickAt = new Date().toISOString();
      state.lastTickDurationMs = Date.now() - tickStartedAt;
      state.lastTickError = null;
      state.lastEvaluations = [];
      return;
    }

    const { bars, missing } = await fetchBarsFor(capped);
    if (missing.length > 0) {
      logger.debug({ missing }, '[ExitMonitor] price-missing — skipping these positions');
    }

    pruneStale(new Set(capped.map(p => p.trackerId)));

    for (const position of capped) {
      const evaluation = await evaluatePosition(position, bars);
      tickEvaluations.push(evaluation);
      if (evaluation.fired) exitsThisTick++;
    }

    state.exitsTotal += exitsThisTick;
    state.lastTickAt = new Date().toISOString();
    state.lastTickDurationMs = Date.now() - tickStartedAt;
    state.lastTickError = null;
    state.lastEvaluations = tickEvaluations;

    if (exitsThisTick > 0 || tickEvaluations.length > 0) {
      logger.info(
        {
          open: capped.length,
          exits: exitsThisTick,
          missing: missing.length,
          durationMs: state.lastTickDurationMs,
        },
        `[ExitMonitor] tick: ${capped.length} positions, ${exitsThisTick} exits`,
      );
    }
  } catch (err) {
    state.lastTickError = err instanceof Error ? err.message : String(err);
    state.lastTickDurationMs = Date.now() - tickStartedAt;
    logger.warn(
      { err: state.lastTickError },
      '[ExitMonitor] tick failed',
    );
  }
}

async function evaluatePosition(
  position: OpenPosition,
  bars: Map<string, ExitBar>,
): Promise<PositionEvaluation> {
  const tracker = getTrackerState(position.trackerId, { entryPrice: position.entryPrice });
  const bar = bars.get(position.trackerId);
  const baseEval: PositionEvaluation = {
    trackerId: position.trackerId,
    symbol: position.symbol,
    assetClass: position.assetClass,
    strategy: position.strategy,
    side: position.side,
    qty: position.qty,
    entryPrice: position.entryPrice,
    stopPrice: position.stopPrice,
    bar: bar ?? null,
    highSinceEntry: tracker.highSinceEntry,
    lowSinceEntry: tracker.lowSinceEntry,
    ladderPartialDone: tracker.ladderPartialDone,
    triggered: 'none',
    decision: { shouldExit: false },
    fired: false,
  };

  if (!bar) return baseEval;

  // Update high/low water marks BEFORE evaluating so trailing stops see
  // the full bar.
  const updatedHigh = Math.max(tracker.highSinceEntry, bar.high);
  const updatedLow = tracker.lowSinceEntry > 0
    ? Math.min(tracker.lowSinceEntry, bar.low)
    : bar.low;
  const updatedTracker: PositionTrackerState = {
    ...tracker,
    highSinceEntry: updatedHigh,
    lowSinceEntry: updatedLow,
    lastEvaluatedAt: new Date().toISOString(),
  };

  const stack = getStack(position.strategy);
  const evaluation = evaluateExitRules(
    {
      position: { ...position, ladderPartialDone: tracker.ladderPartialDone },
      bar,
      highSinceEntry: updatedHigh,
      lowSinceEntry: updatedLow,
      regime: await getRegimeSafe(),
      now: new Date(),
    },
    stack,
  );

  // Always persist the high/low update, even if no exit fires.
  updateTrackerState(updatedTracker);

  baseEval.highSinceEntry = updatedHigh;
  baseEval.lowSinceEntry = updatedLow;
  baseEval.triggered = evaluation.triggeredBy;
  baseEval.decision = evaluation.decision;

  if (!evaluation.decision.shouldExit) return baseEval;

  // Dispatch the exit through the asset-class-specific close helper.
  const fired = await dispatchExit(position, evaluation.decision);
  baseEval.fired = fired;

  if (fired) {
    if (evaluation.decision.reason === 'r_ladder' && evaluation.decision.partialQty != null) {
      // Partial fired — mark the tracker so the rule won't re-fire next
      // tick on the runner.
      updateTrackerState({ ...updatedTracker, ladderPartialDone: true });
    } else {
      // Full close — drop the tracker so a re-entered ticker starts
      // fresh.
      clearTrackerState(position.trackerId);
    }
  }

  return baseEval;
}

async function getRegimeSafe(): Promise<'risk_on' | 'neutral' | 'risk_off' | 'crisis'> {
  try {
    const { getStockRegime } = await import('../stock-intelligence/stock-orchestrator.js');
    const r = getStockRegime();
    return r.regime;
  } catch {
    return 'neutral';
  }
}

// ── Dispatcher: route exit decisions to the right close helper ─────────

async function dispatchExit(
  position: OpenPosition,
  decision: ExitDecision,
): Promise<boolean> {
  if (!decision.shouldExit || decision.exitPrice == null) return false;

  try {
    if (position.assetClass === 'equity') {
      return await dispatchEquityExit(position, decision);
    }
    if (position.assetClass === 'option') {
      return await dispatchOptionExit(position, decision);
    }
    if (position.assetClass === 'crypto-cex') {
      return await dispatchCexExit(position, decision);
    }
    return false;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, symbol: position.symbol, reason: decision.reason },
      '[ExitMonitor] dispatch failed',
    );
    return false;
  }
}

async function dispatchEquityExit(
  position: OpenPosition,
  decision: ExitDecision,
): Promise<boolean> {
  const { closeEquityPosition } = await import('../stock-intelligence/stock-agent.js');
  const { loadPaperLedger, savePaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
  const ledger = loadPaperLedger();
  const equityId = position.trackerId.split(':')[1];
  const livePos = ledger.equityPositions.find(p => p.id === equityId);
  if (!livePos) return false; // already closed

  if (decision.reason === 'r_ladder' && decision.partialQty && decision.partialQty < livePos.shares) {
    const partialQty = Math.floor(decision.partialQty);
    if (partialQty <= 0) return false;
    const exit = decision.exitPrice ?? livePos.currentPrice;
    const pnlUsd = (exit - livePos.entryPrice) * partialQty;
    const pnlPct = livePos.entryPrice > 0
      ? ((exit - livePos.entryPrice) / livePos.entryPrice) * 100
      : 0;

    livePos.shares -= partialQty;
    livePos.stopLossPrice = livePos.entryPrice; // breakeven stop on the runner
    ledger.equityClosed.push({
      ...livePos,
      shares: partialQty,
      exitPrice: exit,
      exitAt: new Date().toISOString(),
      pnlUsd,
      pnlPct,
    });
    ledger.paperCashUsd += partialQty * exit;
    if (pnlUsd >= 0) ledger.stats.wins += 1;
    else ledger.stats.losses += 1;
    savePaperLedger(ledger);

    await triggerExit({
      decisionId: livePos.decisionId ?? null,
      assetClass: 'equity',
      symbol: livePos.symbol,
      side: 'long',
      entryPrice: livePos.entryPrice,
      exitPrice: exit,
      qty: partialQty,
      stopPrice: position.stopPrice,
      openedAt: livePos.entryAt,
      closedAt: new Date().toISOString(),
      reason: 'target',
      notes: `r_ladder partial; remaining stop -> breakeven (${decision.notes ?? ''})`,
    });
    logger.info(
      { symbol: livePos.symbol, partialQty, exit, runnerShares: livePos.shares },
      `[ExitMonitor] R-LADDER PARTIAL ${livePos.symbol}`,
    );
    return true;
  }

  await closeEquityPosition(
    livePos,
    decision.exitPrice ?? livePos.currentPrice,
    mapToEquityCloseReason(decision.reason),
  );
  return true;
}

async function dispatchOptionExit(
  position: OpenPosition,
  decision: ExitDecision,
): Promise<boolean> {
  const { closeOptionPosition } = await import('../stock-intelligence/stock-agent.js');
  const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
  const ledger = loadPaperLedger();
  const optionId = position.trackerId.split(':')[1];
  const livePos = ledger.optionPositions.find(p => p.id === optionId);
  if (!livePos) return false;
  await closeOptionPosition(livePos, decision.exitPrice ?? livePos.currentMid, mapToOptionCloseReason(decision.reason));
  return true;
}

async function dispatchCexExit(
  position: OpenPosition,
  decision: ExitDecision,
): Promise<boolean> {
  // The crypto-agent owns the live CEX paper portfolio in-memory. We
  // don't expose a force-close helper from there yet, so the monitor
  // writes the outcome row directly. The agent's next tick will
  // reconcile its position map by observing the persisted state.
  await triggerExit({
    decisionId: position.decisionId,
    assetClass: 'crypto-cex',
    symbol: position.symbol,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: decision.exitPrice ?? position.entryPrice,
    qty: position.qty,
    stopPrice: position.stopPrice,
    openedAt: position.openedAt,
    closedAt: new Date().toISOString(),
    reason: decision.reason ?? 'manual',
    notes: decision.notes ?? null,
  });
  return true;
}

function mapToEquityCloseReason(
  reason: ExitDecision['reason'],
): 'tv_sell' | 'hard_stop' | 'trailing_tp' | 'time_stop' | 'manual' {
  switch (reason) {
    case 'stop': return 'hard_stop';
    case 'trail': return 'trailing_tp';
    case 'target': return 'trailing_tp';
    case 'time': return 'time_stop';
    case 'regime': return 'manual';
    case 'r_ladder': return 'trailing_tp';
    default: return 'manual';
  }
}

function mapToOptionCloseReason(
  reason: ExitDecision['reason'],
): 'tv_sell' | 'hard_stop' | 'trailing_tp' | 'time_stop' | 'iv_crush' | 'manual' {
  switch (reason) {
    case 'stop': return 'hard_stop';
    case 'trail': return 'trailing_tp';
    case 'target': return 'trailing_tp';
    case 'time': return 'time_stop';
    case 'regime': return 'manual';
    case 'r_ladder': return 'trailing_tp';
    default: return 'manual';
  }
}

// ── Status (used by routes) ────────────────────────────────────────────

export interface MonitorStatus {
  running: boolean;
  lastTickAt: string | null;
  lastTickDurationMs: number;
  lastTickError: string | null;
  ticksTotal: number;
  exitsTotal: number;
  intervalMs: number;
  openPositionsCap: number;
  rulesEnabled: number;
}

export function getExitMonitorStatus(): MonitorStatus {
  const enabled = new Set<string>();
  for (const cfg of Object.values(activeConfig)) {
    enabled.add('hard_stop'); // always
    if (cfg.regimeExitEnabled) enabled.add('regime_exit');
    if (cfg.rLadderEnabled) enabled.add('r_multiple_ladder');
    if (cfg.atrTrailEnabled) enabled.add('atr_trailing');
    if (cfg.timeStopDays != null && cfg.timeStopDays > 0) enabled.add('time_stop');
    if (cfg.profitTargetPct != null && cfg.profitTargetPct > 0) enabled.add('profit_target');
  }
  return {
    running: state.running,
    lastTickAt: state.lastTickAt,
    lastTickDurationMs: state.lastTickDurationMs,
    lastTickError: state.lastTickError,
    ticksTotal: state.ticksTotal,
    exitsTotal: state.exitsTotal,
    intervalMs: TICK_INTERVAL_MS,
    openPositionsCap: MAX_OPEN_POSITIONS,
    rulesEnabled: enabled.size,
  };
}

export function getExitMonitorEvaluations(): PositionEvaluation[] {
  return state.lastEvaluations;
}

// ── Manual close (admin) ───────────────────────────────────────────────

/**
 * Force-close a position by decisionId. Walks the live position lists,
 * matches on decisionId, dispatches a 'manual' exit at the current bar
 * close price (or entry price if quote isn't available).
 */
export async function manualCloseByDecisionId(decisionId: string): Promise<{
  closed: boolean;
  trackerId?: string;
  reason?: string;
}> {
  const positions = await loadAllOpenPositions();
  const target = positions.find(p => p.decisionId === decisionId);
  if (!target) {
    return { closed: false, reason: 'no open position with that decisionId' };
  }
  const { bars } = await fetchBarsFor([target]);
  const bar = bars.get(target.trackerId);
  const exitPrice = bar?.close ?? target.entryPrice;
  const fired = await dispatchExit(target, {
    shouldExit: true,
    reason: 'stop',
    exitPrice,
    notes: 'manual close via /api/v1/exits/manual-close',
  });
  if (fired) clearTrackerState(target.trackerId);
  return {
    closed: fired,
    trackerId: target.trackerId,
    reason: fired ? 'closed' : 'dispatch refused (already closed?)',
  };
}

// ── Test hooks ─────────────────────────────────────────────────────────

/** Test-only: run a single tick synchronously and return evaluations. */
export async function _runTickForTest(): Promise<PositionEvaluation[]> {
  await runTick();
  return state.lastEvaluations;
}

/** Test-only: reset internal state. */
export function _resetMonitorState(): void {
  state.running = false;
  state.intervalHandle = null;
  state.lastTickAt = null;
  state.lastTickDurationMs = 0;
  state.lastTickError = null;
  state.ticksTotal = 0;
  state.exitsTotal = 0;
  state.lastEvaluations = [];
  stackCache.clear();
  activeConfig = { ...DEFAULT_STRATEGY_EXIT_CONFIG };
}
