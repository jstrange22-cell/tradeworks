/**
 * Solana DEX bot v2 — paper ledger.
 *
 * In-memory + JSONL-persisted paper book for the Solana side. Separate from
 * the stocks paper ledger (apps/gateway/src/services/stock-intelligence)
 * and the crypto-agent legacy ledger.
 *
 *   Wallet:           $5,000 paper
 *   Max position:     $50
 *   Max concurrent:   10
 *   Daily loss circuit breaker: -$250 (5%)
 *
 * Hard caps enforced here AS WELL as in the agent reasoner — defense in
 * depth. If the agent ever returns sizeUsd > $50 the ledger clamps it.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger.js';
import type { TokenCandidate, SolanaPaperLedgerState, SolanaPosition, SolanaClosedTrade } from '../ai/solana-agent/types.js';

const LEDGER_FILE = resolve(process.env['SOLANA_LEDGER_FILE'] ?? './data/solana-paper-ledger.json');
const TRADE_LOG = resolve(process.env['SOLANA_TRADE_LOG'] ?? './data/solana-paper-trades.jsonl');

const STARTING_CASH = 5_000;
const MAX_POSITION_SIZE = 50;
const MAX_CONCURRENT = 10;
const DAILY_LOSS_LIMIT = 250; // 5% of starting cash

let state: SolanaPaperLedgerState | null = null;

function defaultState(): SolanaPaperLedgerState {
  return {
    cashUsd: STARTING_CASH,
    positions: [],
    closed: [],
    todayLossUsd: 0,
    dayStartedAt: new Date().toISOString().slice(0, 10),
  };
}

function load(): SolanaPaperLedgerState {
  if (state) {
    rolloverDayIfNeeded(state);
    return state;
  }
  if (!existsSync(LEDGER_FILE)) {
    state = defaultState();
    return state;
  }
  try {
    state = JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as SolanaPaperLedgerState;
    rolloverDayIfNeeded(state);
    return state;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[SolanaLedger] load failed; resetting');
    state = defaultState();
    return state;
  }
}

function rolloverDayIfNeeded(s: SolanaPaperLedgerState): void {
  const today = new Date().toISOString().slice(0, 10);
  if (s.dayStartedAt !== today) {
    logger.info({ wasLoss: s.todayLossUsd, newDay: today }, '[SolanaLedger] rolling over to new day');
    s.todayLossUsd = 0;
    s.dayStartedAt = today;
    persist();
  }
}

function persist(): void {
  if (!state) return;
  try {
    mkdirSync(dirname(LEDGER_FILE), { recursive: true });
    writeFileSync(LEDGER_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[SolanaLedger] persist failed');
  }
}

function logTrade(event: object): void {
  try {
    mkdirSync(dirname(TRADE_LOG), { recursive: true });
    appendFileSync(TRADE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch { /* ignore */ }
}

// ── Public API ────────────────────────────────────────────────────────

export function getLedgerState(): SolanaPaperLedgerState {
  return load();
}

export interface OpenResult {
  ok: boolean;
  position?: SolanaPosition;
  reason?: string;
}

export function openPosition(candidate: TokenCandidate, requestedSizeUsd: number, decisionId: string): OpenResult {
  const s = load();

  // Hard cap clamp
  const sizeUsd = Math.min(MAX_POSITION_SIZE, Math.max(0, requestedSizeUsd));
  if (sizeUsd <= 0) return { ok: false, reason: 'size <= 0 after clamp' };

  if (s.todayLossUsd >= DAILY_LOSS_LIMIT) {
    return { ok: false, reason: `daily loss circuit breaker tripped ($${s.todayLossUsd.toFixed(2)} of $${DAILY_LOSS_LIMIT})` };
  }
  if (s.positions.length >= MAX_CONCURRENT) {
    return { ok: false, reason: `max concurrent positions (${MAX_CONCURRENT})` };
  }
  if (s.positions.some((p) => p.mint === candidate.mint)) {
    return { ok: false, reason: 'already holding this mint' };
  }
  if (s.cashUsd < sizeUsd) {
    return { ok: false, reason: `insufficient paper cash ($${s.cashUsd.toFixed(2)} < $${sizeUsd})` };
  }
  if (candidate.priceUsd <= 0) {
    return { ok: false, reason: 'invalid candidate price' };
  }

  const position: SolanaPosition = {
    id: randomUUID(),
    mint: candidate.mint,
    symbol: candidate.symbol,
    sizeUsd,
    entryPrice: candidate.priceUsd,
    entryAt: new Date().toISOString(),
    decisionId,
  };

  s.cashUsd -= sizeUsd;
  s.positions.push(position);
  persist();
  logTrade({ event: 'open', position });
  logger.info({ symbol: candidate.symbol, mint: candidate.mint.slice(0, 8), sizeUsd, decisionId }, '[SolanaLedger] PAPER OPEN');
  return { ok: true, position };
}

export interface CloseResult {
  ok: boolean;
  closed?: SolanaClosedTrade;
  reason?: string;
}

export function closePosition(positionId: string, currentPrice: number, exitReason: string): CloseResult {
  const s = load();
  const idx = s.positions.findIndex((p) => p.id === positionId);
  if (idx === -1) return { ok: false, reason: 'position not found' };
  const pos = s.positions[idx]!;

  const proceeds = pos.sizeUsd * (currentPrice / pos.entryPrice);
  const pnlUsd = proceeds - pos.sizeUsd;
  const pnlPct = pnlUsd / pos.sizeUsd;

  const closed: SolanaClosedTrade = {
    ...pos,
    exitPrice: currentPrice,
    exitAt: new Date().toISOString(),
    pnlUsd,
    pnlPct,
    exitReason,
  };

  s.positions.splice(idx, 1);
  s.closed.push(closed);
  s.cashUsd += proceeds;
  if (pnlUsd < 0) s.todayLossUsd += Math.abs(pnlUsd);
  persist();
  logTrade({ event: 'close', closed });
  logger.info(
    { symbol: pos.symbol, sizeUsd: pos.sizeUsd, pnlUsd: pnlUsd.toFixed(2), pnlPct: (pnlPct * 100).toFixed(1), reason: exitReason },
    `[SolanaLedger] PAPER CLOSE ${pos.symbol} ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${(pnlPct * 100).toFixed(1)}%)`,
  );
  return { ok: true, closed };
}

export function getLedgerSummaryForReasoner(): {
  cashUsd: number;
  openPositions: number;
  maxPositions: number;
  todayRealizedUsd: number;     // negative when in loss
  dailyLossLimitUsd: number;
} {
  const s = load();
  return {
    cashUsd: s.cashUsd,
    openPositions: s.positions.length,
    maxPositions: MAX_CONCURRENT,
    todayRealizedUsd: -s.todayLossUsd, // expose as negative for loss
    dailyLossLimitUsd: DAILY_LOSS_LIMIT,
  };
}

export const LEDGER_HARD_CAPS = {
  STARTING_CASH,
  MAX_POSITION_SIZE,
  MAX_CONCURRENT,
  DAILY_LOSS_LIMIT,
} as const;
