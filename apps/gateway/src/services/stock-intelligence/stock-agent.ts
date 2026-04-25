/**
 * Stock Agent — TradeVisor Signal Executor
 *
 * Consumes confirmed TradeVisor results (chain='stock') and places paper
 * trades into the split equity/options paper ledger maintained by
 * stock-orchestrator.ts. Live execution is intentionally gated:
 *
 *   ENABLE_LIVE_EQUITIES !== 'true' → Alpaca paper fill via signal price
 *   ENABLE_LIVE_OPTIONS  !== 'true' → synthetic fill at quote mid
 *
 * Guardrails mirror `routes/crypto-agent.ts::executeSignalTrade`:
 *   - 15-minute cooldown per (symbol, action)
 *   - Confluence gate: skip scores < 4 or grade === 'reject'
 *   - Per-book dedup (one position per symbol)
 *   - Per-book caps (MAX_EQUITY_POSITIONS, MAX_OPTION_POSITIONS)
 *
 * Position sizing (USD per trade):
 *   standard → $100   strong → $250   prime → $500
 * Options sizing reuses the same USD tier but is capped at 5 contracts.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger.js';
import {
  MAX_EQUITY_POSITIONS, MAX_OPTION_POSITIONS,
  type EquityPosition, type OptionPosition, type PaperLedgerState,
  type EquityClosedTrade, type OptionClosedTrade,
} from './stock-models.js';
import { loadPaperLedger, savePaperLedger } from './stock-orchestrator.js';
import { selectOptionContract } from './options-policy.js';
import { getOptionsChain } from '../stocks/robinhood-options.js';
import { computePositionSize } from './sizing.js';

// ── Signal Shape ────────────────────────────────────────────────────────

export interface StockAgentSignal {
  ticker: string;
  action: 'buy' | 'sell' | 'hold';
  price: number;
  score: number;
  grade: 'prime' | 'strong' | 'standard' | 'reject';
}

// ── Cooldown ────────────────────────────────────────────────────────────

const SIGNAL_COOLDOWN_MS = 15 * 60 * 1000;
const signalCooldown = new Map<string, number>();

function cooldownHit(key: string): boolean {
  const last = signalCooldown.get(key);
  if (last && Date.now() - last < SIGNAL_COOLDOWN_MS) return true;
  return false;
}

function markCooldown(key: string): void {
  signalCooldown.set(key, Date.now());
}

// ── Sizing ──────────────────────────────────────────────────────────────

const EQUITY_SIZE_BY_GRADE: Record<StockAgentSignal['grade'], number> = {
  standard: 100,
  strong: 250,
  prime: 500,
  reject: 50, // score-3 paper signals allowed when TRADEVISOR_STOCK_MIN_SCORE=3
};

// Options need a larger budget than equity because ATM calls on mega-caps
// cost $500-$1500 per contract (100x multiplier). Separate from equity.
const OPTION_BUDGET_BY_GRADE: Record<StockAgentSignal['grade'], number> = {
  standard: 1000,
  strong: 3000,
  prime: 6000,
  reject: 0,
};

const MAX_OPTION_CONTRACTS = 5;

// Minimum confluence score to pass the gate. Env-configurable so the user
// can loosen for paper testing (3/6) or tighten for live (4/6 or 5/6).
const MIN_CONFLUENCE_SCORE = parseInt(
  process.env.TRADEVISOR_STOCK_MIN_SCORE ?? '3',
  10,
);

// ── Ledger Accessor ─────────────────────────────────────────────────────

// Cache the loaded ledger in-memory so concurrent signal callbacks operate
// on a single source of truth. Each mutation persists before returning.
let ledger: PaperLedgerState | null = null;

function getLedger(): PaperLedgerState {
  if (!ledger) ledger = loadPaperLedger();
  return ledger;
}

function persist(): void {
  if (ledger) savePaperLedger(ledger);
}

// ── Shared Gates ────────────────────────────────────────────────────────

function passesGates(signal: StockAgentSignal, book: 'equity' | 'option'): boolean {
  if (!signal.ticker || !signal.price || signal.price <= 0) {
    logger.warn({ signal }, `[StockAgent] ${book} signal rejected — missing ticker or price`);
    return false;
  }
  if (signal.action !== 'buy' && signal.action !== 'sell') return false;
  // Score-only gate. The 'grade' label comes from the engine's getGrade() which
  // assigns 'reject' for any score < 4 — but with TRADEVISOR_ACTION_THRESHOLD=3
  // the engine emits action='buy' on 3/6 signals while still labeling them
  // 'reject'. Grade is a UI/log artifact; score is the real signal-quality gate.
  if (signal.score < MIN_CONFLUENCE_SCORE) {
    logger.info(
      { ticker: signal.ticker, score: signal.score, grade: signal.grade, min: MIN_CONFLUENCE_SCORE },
      `[StockAgent] ${book} signal below confluence gate — skip`,
    );
    return false;
  }

  const symbol = signal.ticker.toUpperCase();
  const cooldownKey = `${book}_${symbol}_${signal.action}`;
  if (cooldownHit(cooldownKey)) return false;

  return true;
}

// ── Equity Execution ────────────────────────────────────────────────────

/**
 * Execute a TradeVisor-confirmed equity signal. Currently paper-only —
 * when ENABLE_LIVE_EQUITIES is flipped on in a future round, this should
 * route through `apps/gateway/src/services/stocks/alpaca-client.ts`.
 * Returns `true` iff a position was opened.
 */
export async function executeEquitySignal(signal: StockAgentSignal): Promise<boolean> {
  if (!passesGates(signal, 'equity')) return false;

  const symbol = signal.ticker.toUpperCase();
  const state = getLedger();

  // Dedup: one equity position per symbol.
  if (state.equityPositions.some(p => p.symbol === symbol)) {
    logger.info({ symbol }, '[StockAgent] Already holding equity position — skip duplicate');
    return false;
  }

  // Phase 5: kill switches — daily loss / max drawdown / consecutive losses.
  {
    const { checkKillSwitches } = await import('./kill-switches.js');
    const ks = checkKillSwitches(state);
    if (ks.tripped) {
      logger.warn(
        { symbol, reason: ks.reason, resumeAt: ks.resumeAt },
        `[StockAgent] Kill switch active (${ks.reason}) — skip equity signal`,
      );
      return false;
    }
  }

  // Phase 2: sector-diversification gate. Reject if opening this symbol
  // would push its sector over the per-sector cap (default 2).
  {
    const { canOpenPosition } = await import('./sector-map.js');
    const gate = canOpenPosition(symbol, state.equityPositions);
    if (!gate.allowed) {
      logger.info({ symbol, reason: gate.reason }, '[StockAgent] Sector cap — skip');
      return false;
    }
  }

  if (state.equityPositions.length >= MAX_EQUITY_POSITIONS) {
    logger.info({ open: state.equityPositions.length }, `[StockAgent] Max equity positions (${MAX_EQUITY_POSITIONS}) — skip`);
    return false;
  }

  // Phase 5: SPY regime multiplier scales grade-based sizing down in
  // defensive / cautious tape (SPY below 50MA or below 200MA).
  let regimeMult = 1.0;
  try {
    const { getRegimeMultiplier } = await import('./kill-switches.js');
    regimeMult = await getRegimeMultiplier();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[StockAgent] regimeMultiplier failed — defaulting to 1.0',
    );
  }

  const baseSizeUsd = EQUITY_SIZE_BY_GRADE[signal.grade] ?? 0;
  const positionSizeUsd = Math.round(baseSizeUsd * regimeMult * 100) / 100;
  if (positionSizeUsd <= 0) return false;

  if (state.paperCashUsd < positionSizeUsd) {
    logger.warn({ cash: state.paperCashUsd, needed: positionSizeUsd }, '[StockAgent] Insufficient paper cash for equity signal');
    return false;
  }

  const shares = Number((positionSizeUsd / signal.price).toFixed(4));
  if (shares <= 0) return false;

  // Live path is gated — leave a breadcrumb and fall through to paper fill
  // so the system keeps functioning until live wiring lands.
  if (process.env.ENABLE_LIVE_EQUITIES === 'true') {
    logger.warn(
      { symbol, shares, price: signal.price },
      '[StockAgent] ENABLE_LIVE_EQUITIES=true but live submission not yet implemented — falling back to paper fill',
    );
  }

  // Phase 1: volatility-adjusted sizing computes the hard-stop price so the
  // position-monitor can enforce it. ATR is not yet plumbed through this
  // path, so `computePositionSize` falls back to the flat 5% stop distance.
  const sizing = computePositionSize({
    accountUsd: state.paperCashUsd + positionSizeUsd,  // approximate equity before fill
    grade: signal.grade,
    entryPrice: signal.price,
    isOption: false,
  });
  const stopLossPrice = sizing.stopLossPrice > 0 ? sizing.stopLossPrice : signal.price * 0.95;

  const nowIso = new Date().toISOString();
  const position: EquityPosition = {
    id: randomUUID(),
    symbol,
    shares,
    entryPrice: signal.price,
    currentPrice: signal.price,
    entryAt: nowIso,
    signalSource: `tradevisor_${signal.grade}`,
    signalScore: signal.score,
    stopLossPrice,
    highWaterPct: 0,
    trailingArmed: false,
    lastPriceAt: nowIso,
  };

  state.equityPositions.push(position);
  state.paperCashUsd -= positionSizeUsd;
  state.stats.totalTrades += 1;
  persist();
  markCooldown(`equity_${symbol}_${signal.action}`);

  logger.info(
    { symbol, shares, price: signal.price, grade: signal.grade, score: signal.score },
    `[StockAgent] PAPER BUY ${symbol} x${shares} @ $${signal.price.toFixed(2)}`,
  );

  return true;
}

// ── Options Execution ───────────────────────────────────────────────────

/**
 * Execute a TradeVisor-confirmed options signal. Fetches (or synthesises)
 * an options chain, selects a contract via the policy module, and paper-
 * fills at the quote mid. Live submission is feature-flag-gated via
 * `placeOptionOrder` in robinhood-options.ts.
 */
export async function executeOptionsSignal(signal: StockAgentSignal): Promise<boolean> {
  if (!passesGates(signal, 'option')) return false;

  // Phase 4: options restricted to prime-quality signals (score >= 5). Equity
  // takes 3/6+ signals; options need 5/6+ before we risk premium decay.
  if (signal.score < 5) {
    logger.info(
      { ticker: signal.ticker, score: signal.score },
      '[StockAgent] Option signal below prime threshold (score<5) — skip',
    );
    return false;
  }

  const symbol = signal.ticker.toUpperCase();
  const state = getLedger();
  const contractType: 'call' | 'put' = signal.action === 'buy' ? 'call' : 'put';

  // Phase 5: kill switches apply to options too.
  {
    const { checkKillSwitches } = await import('./kill-switches.js');
    const ks = checkKillSwitches(state);
    if (ks.tripped) {
      logger.warn(
        { symbol, reason: ks.reason, resumeAt: ks.resumeAt },
        `[StockAgent] Kill switch active (${ks.reason}) — skip option signal`,
      );
      return false;
    }
  }

  // Dedup: one option position per (symbol, call/put).
  if (state.optionPositions.some(p => p.symbol === symbol && p.type === contractType)) {
    logger.info({ symbol, type: contractType }, '[StockAgent] Already holding option position — skip duplicate');
    return false;
  }

  if (state.optionPositions.length >= MAX_OPTION_POSITIONS) {
    logger.info({ open: state.optionPositions.length }, `[StockAgent] Max option positions (${MAX_OPTION_POSITIONS}) — skip`);
    return false;
  }

  // Fetch chain + pick contract.
  let chain;
  try {
    chain = await getOptionsChain(symbol);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, symbol }, '[StockAgent] Options chain fetch failed');
    return false;
  }
  if (!chain || chain.length === 0) {
    logger.info({ symbol }, '[StockAgent] Empty options chain — skip');
    return false;
  }

  // IV rank not yet available from the synthetic chain; pass 0 so the
  // policy uses its default 0.50 delta target. When real IV-rank data
  // lands, plumb it through here.
  // Narrow action to OptionAction — `hold` is already filtered out above
  // by passesGates(), so this is safe at runtime.
  const action: 'buy' | 'sell' = signal.action === 'sell' ? 'sell' : 'buy';
  let contract;
  try {
    contract = selectOptionContract(symbol, action, signal.price, 0, chain);
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : err, symbol }, '[StockAgent] No viable contract — skip');
    return false;
  }

  const mid = contract.estMid;
  if (!mid || mid <= 0) {
    logger.info({ symbol, occ: contract.occSymbol }, '[StockAgent] Invalid contract mid — skip');
    return false;
  }

  const budgetUsd = OPTION_BUDGET_BY_GRADE[signal.grade] ?? 0;
  if (budgetUsd <= 0) return false;

  // Each contract = 100 shares worth of premium. Cap contracts at 5.
  const perContractCost = mid * 100;
  if (perContractCost <= 0) return false;
  let contracts = Math.floor(budgetUsd / perContractCost);
  contracts = Math.max(0, Math.min(MAX_OPTION_CONTRACTS, contracts));
  if (contracts <= 0) {
    logger.info({ symbol, mid, budgetUsd }, '[StockAgent] Option budget too small for even 1 contract — skip');
    return false;
  }

  const totalCost = contracts * perContractCost;
  if (state.paperCashUsd < totalCost) {
    logger.warn({ cash: state.paperCashUsd, needed: totalCost }, '[StockAgent] Insufficient paper cash for options signal');
    return false;
  }

  if (process.env.ENABLE_LIVE_OPTIONS === 'true') {
    logger.warn(
      { symbol, occ: contract.occSymbol, contracts, mid },
      '[StockAgent] ENABLE_LIVE_OPTIONS=true but live submission not yet implemented — falling back to paper fill',
    );
  }

  const nowIso = new Date().toISOString();
  const position: OptionPosition = {
    id: randomUUID(),
    symbol,
    occSymbol: contract.occSymbol,
    type: contract.type,
    strike: contract.strike,
    expiry: contract.expiry,
    contracts,
    entryMid: mid,
    currentMid: mid,
    entryIV: 0,            // IV not yet plumbed — synthetic chain uses flat 35%
    entryAt: nowIso,
    signalSource: `tradevisor_${signal.grade}`,
    signalScore: signal.score,
    // Phase 1: hard stop at 50% of entry mid. Options halve quickly, so a
    // tighter stop than equity is sensible.
    stopLossMid: mid * 0.5,
    highWaterPct: 0,
    trailingArmed: false,
    lastPriceAt: nowIso,
  };

  state.optionPositions.push(position);
  state.paperCashUsd -= totalCost;
  state.stats.totalTrades += 1;
  persist();
  markCooldown(`option_${symbol}_${signal.action}`);

  logger.info(
    { symbol, occ: contract.occSymbol, contracts, mid, grade: signal.grade, score: signal.score },
    `[StockAgent] PAPER OPTION BUY ${symbol} ${contract.occSymbol} x${contracts} @ $${mid.toFixed(2)}`,
  );

  return true;
}

// ── Close Helpers ───────────────────────────────────────────────────────

export type EquityCloseReason =
  | 'tv_sell' | 'hard_stop' | 'trailing_tp' | 'time_stop' | 'manual';

export type OptionCloseReason =
  | 'tv_sell' | 'hard_stop' | 'trailing_tp' | 'time_stop' | 'iv_crush' | 'manual';

/**
 * Close an open equity position at `exitPrice`. Mutates the ledger in-place:
 *   - removes from equityPositions
 *   - pushes a EquityClosedTrade into equityClosed
 *   - credits paperCashUsd by shares * exitPrice
 *   - updates stats.wins / losses
 * Persists the ledger before returning.
 */
export async function closeEquityPosition(
  position: EquityPosition,
  exitPrice: number,
  reason: EquityCloseReason,
): Promise<void> {
  const state = getLedger();
  const idx = state.equityPositions.findIndex(p => p.id === position.id);
  if (idx === -1) {
    logger.warn({ symbol: position.symbol, id: position.id }, '[StockAgent] closeEquityPosition: position not found in ledger');
    return;
  }

  const exit = exitPrice > 0 ? exitPrice : position.currentPrice;
  const pnlUsd = (exit - position.entryPrice) * position.shares;
  const pnlPct = position.entryPrice > 0
    ? ((exit - position.entryPrice) / position.entryPrice) * 100
    : 0;

  const closed: EquityClosedTrade = {
    ...position,
    exitPrice: exit,
    exitAt: new Date().toISOString(),
    pnlUsd,
    pnlPct,
  };

  state.equityPositions.splice(idx, 1);
  state.equityClosed.push(closed);
  state.paperCashUsd += position.shares * exit;
  if (pnlUsd >= 0) state.stats.wins += 1;
  else state.stats.losses += 1;

  persist();

  logger.info(
    { symbol: position.symbol, reason, exit, pnlUsd: pnlUsd.toFixed(2), pnlPct: pnlPct.toFixed(2) },
    `[StockAgent] PAPER SELL ${position.symbol} @ $${exit.toFixed(2)} pnl=$${pnlUsd.toFixed(2)} (${reason})`,
  );
}

/**
 * Close an open option position at `exitMid`. Mirrors closeEquityPosition
 * but uses contracts * mid * 100 for cash accounting.
 */
export async function closeOptionPosition(
  position: OptionPosition,
  exitMid: number,
  reason: OptionCloseReason,
): Promise<void> {
  const state = getLedger();
  const idx = state.optionPositions.findIndex(p => p.id === position.id);
  if (idx === -1) {
    logger.warn({ symbol: position.symbol, id: position.id }, '[StockAgent] closeOptionPosition: position not found in ledger');
    return;
  }

  const exit = exitMid > 0 ? exitMid : position.currentMid;
  const pnlUsd = (exit - position.entryMid) * position.contracts * 100;
  const pnlPct = position.entryMid > 0
    ? ((exit - position.entryMid) / position.entryMid) * 100
    : 0;

  const closed: OptionClosedTrade = {
    ...position,
    exitMid: exit,
    exitAt: new Date().toISOString(),
    pnlUsd,
    pnlPct,
  };

  state.optionPositions.splice(idx, 1);
  state.optionClosed.push(closed);
  state.paperCashUsd += position.contracts * exit * 100;
  if (pnlUsd >= 0) state.stats.wins += 1;
  else state.stats.losses += 1;

  persist();

  logger.info(
    { symbol: position.symbol, occ: position.occSymbol, reason, exit, pnlUsd: pnlUsd.toFixed(2), pnlPct: pnlPct.toFixed(2) },
    `[StockAgent] PAPER OPTION SELL ${position.symbol} ${position.occSymbol} @ $${exit.toFixed(2)} pnl=$${pnlUsd.toFixed(2)} (${reason})`,
  );
}

// ── TradeVisor Sell Signal Dispatch ─────────────────────────────────────

/**
 * Close any held equity position on this symbol when TradeVisor fires a
 * SELL signal. Gates on cooldown + confluence score like the buy path so we
 * don't churn on borderline signals. Returns true iff a position was closed.
 */
export async function executeEquitySellSignal(signal: StockAgentSignal): Promise<boolean> {
  if (!passesGates(signal, 'equity')) return false;

  const symbol = signal.ticker.toUpperCase();
  const state = getLedger();

  const pos = state.equityPositions.find(p => p.symbol === symbol);
  if (!pos) {
    logger.info({ symbol }, '[StockAgent] SELL signal but no equity position held — skip');
    return false;
  }

  await closeEquityPosition(pos, signal.price, 'tv_sell');
  markCooldown(`equity_${symbol}_${signal.action}`);
  return true;
}

/**
 * Close any held option position on this symbol when TradeVisor fires a
 * SELL signal. Closes BOTH call and put sides if held (rare but possible).
 */
export async function executeOptionSellSignal(signal: StockAgentSignal): Promise<boolean> {
  if (!passesGates(signal, 'option')) return false;

  const symbol = signal.ticker.toUpperCase();
  const state = getLedger();

  const held = state.optionPositions.filter(p => p.symbol === symbol);
  if (held.length === 0) {
    logger.info({ symbol }, '[StockAgent] SELL signal but no option position held — skip');
    return false;
  }

  for (const pos of held) {
    await closeOptionPosition(pos, pos.currentMid, 'tv_sell');
  }
  markCooldown(`option_${symbol}_${signal.action}`);
  return true;
}
