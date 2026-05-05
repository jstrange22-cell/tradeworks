/**
 * Solana DEX bot v2 — agent gate types.
 *
 * The candidate stream comes from the scanner (birdeye + dexscreener +
 * on-chain holder lookups + GoPlus security scoring). Each survivor that
 * scores >=0.70 from the AI scorer enters this gate. The agent decides
 * approve/veto/escalate exactly like the stocks-side TradeVisor agent —
 * shadow vs gate semantics, JSONL persistence, escalation queue surfaced
 * in APEX chat.
 */

export interface TokenCandidate {
  mint: string;                  // base58 SPL mint address
  symbol: string;
  name: string;
  marketCapUsd: number;
  liquidityUsd: number;
  priceUsd: number;
  priceChange1h: number;         // pct, e.g. 0.045 = +4.5%
  priceChange24h: number;
  volume24hUsd: number;
  ageMinutes: number;
  holderCount: number;
  top10HolderPct: number;        // 0..1
  goplusScore: number;           // 0..100
  mintRenounced: boolean;
  freezeRenounced: boolean;
  dexUrl?: string;               // dexscreener pair URL
}

export interface AiScore {
  score: number;                 // 0..1
  reasoning: string;
  redFlags: string[];
  modelUsed: string;
  cachedAt: string;
}

export interface SolanaSignalContext {
  candidate: TokenCandidate;
  aiScore: AiScore;
  // Wallet state at decision time — used for daily P&L circuit-breaker.
  paperLedger: {
    cashUsd: number;
    openPositions: number;
    maxPositions: number;
    todayRealizedUsd: number;
    dailyLossLimitUsd: number;
  };
  // Whale corroboration is Phase 3.1 — null on v1 by design.
  whaleActivity: null;
}

export type SolanaDecisionVerdict = 'approve' | 'veto' | 'escalate';

export interface SolanaDecision {
  id: string;
  candidate: TokenCandidate;
  context: SolanaSignalContext;
  verdict: SolanaDecisionVerdict;
  reasoning: string;
  confidence: number;            // 0..1
  sizeUsd: number | null;        // when approving; null on veto/escalate
  modelUsed: string;
  reasoningLatencyMs: number;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: 'human' | 'auto-timeout';
  resolution?: 'approved' | 'vetoed';
}

export interface SolanaPosition {
  id: string;
  mint: string;
  symbol: string;
  sizeUsd: number;
  entryPrice: number;
  entryAt: string;
  decisionId: string;            // joins the journal back to reasoning
}

export interface SolanaClosedTrade extends SolanaPosition {
  exitPrice: number;
  exitAt: string;
  pnlUsd: number;
  pnlPct: number;
  exitReason: string;
}

export interface SolanaPaperLedgerState {
  cashUsd: number;
  positions: SolanaPosition[];
  closed: SolanaClosedTrade[];
  todayLossUsd: number;          // realized losses today, positive number
  dayStartedAt: string;          // ISO date — when todayLossUsd was last reset
}
