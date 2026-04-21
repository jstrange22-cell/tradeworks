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
} from './stock-models.js';
import { loadPaperLedger, savePaperLedger } from './stock-orchestrator.js';
import { selectOptionContract } from './options-policy.js';
import { getOptionsChain } from '../stocks/robinhood-options.js';

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
  reject: 0,
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
  if (signal.grade === 'reject' || signal.score < MIN_CONFLUENCE_SCORE) {
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

  if (state.equityPositions.length >= MAX_EQUITY_POSITIONS) {
    logger.info({ open: state.equityPositions.length }, `[StockAgent] Max equity positions (${MAX_EQUITY_POSITIONS}) — skip`);
    return false;
  }

  const positionSizeUsd = EQUITY_SIZE_BY_GRADE[signal.grade] ?? 0;
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

  const position: EquityPosition = {
    id: randomUUID(),
    symbol,
    shares,
    entryPrice: signal.price,
    currentPrice: signal.price,
    entryAt: new Date().toISOString(),
    signalSource: `tradevisor_${signal.grade}`,
    signalScore: signal.score,
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

  const symbol = signal.ticker.toUpperCase();
  const state = getLedger();
  const contractType: 'call' | 'put' = signal.action === 'buy' ? 'call' : 'put';

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
    entryAt: new Date().toISOString(),
    signalSource: `tradevisor_${signal.grade}`,
    signalScore: signal.score,
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
