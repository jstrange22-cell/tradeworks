/**
 * TradeVisor Agent — types shared across context gathering, reasoning,
 * decision storage, and the webhook integration point.
 */

export type AssetClass = 'stock' | 'crypto-cex' | 'crypto-dex' | 'unknown';

/** Raw signal as it arrives at the gateway webhook. */
export interface IncomingSignal {
  symbol: string;            // post-normalization (no exchange prefix, no USD suffix for crypto)
  action: 'buy' | 'sell';
  price: number;
  score: number;             // 4 = standard, 5 = strong, 6 = prime
  grade: 'standard' | 'strong' | 'prime';
  timeframe: string;         // "15", "5", etc.
  exchange: string;          // "AMEX", "COINBASE", etc.
  sourceLabel?: string;      // raw APEX label e.g. "BUY B"
  receivedAt: string;        // ISO timestamp
  assetClass: AssetClass;
}

/** Snapshot of all context the reasoner gets before deciding. */
export interface SignalContext {
  signal: IncomingSignal;

  // Chart state via TV MCP — optional, may be null if TV closed or symbol mismatch.
  chart: ChartContext | null;

  // News headlines from last 24h for this ticker (Finnhub).
  news: NewsHeadline[];

  // Portfolio snapshot at signal time.
  portfolio: PortfolioSnapshot;

  // Scout watchlist position (rank) and AI rationale, if applicable.
  scout: ScoutContext | null;

  // Macro regime classification.
  macro: MacroContext;

  // Today's realized P&L vs daily loss limit.
  dailyPnl: { pct: number; limitPct: number; remaining: number };
}

export interface ChartContext {
  matchedSymbol: string;     // what TV is currently showing
  resolution: string;
  studyValues: Record<string, string | number>; // e.g. { RSI: 67.4, ATR: 1.23 }
  pineLabels: Array<{ text: string; price: number }>;  // recent BUY/SELL markers
  pineLines: number[];       // horizontal price levels (support/resistance)
}

export interface NewsHeadline {
  datetime: number;
  headline: string;
  summary: string;
  source: string;
  ageHours: number;
}

export interface PortfolioSnapshot {
  cashUsd: number;
  equityPositions: Array<{
    symbol: string;
    shares: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    sector: string;
  }>;
  totalPositions: number;
  maxPositions: number;
  sectorCount: Record<string, number>;
  sectorCap: number;
  alreadyHolding: boolean;     // true if signal symbol already has an open position
}

export interface ScoutContext {
  rank: number;                // 1 = top pick, 30 = bottom of stocks list
  totalStocks: number;
  rs5d: number;
  rs20d: number;
  atrExpansion: number;
  reason: string;
  refreshSource: 'deterministic' | 'claude-reranked';
  rationale: string;           // Claude's overall watchlist rationale
}

export interface MacroContext {
  regime: 'risk-on' | 'risk-off' | 'transitioning' | 'crisis' | 'unknown';
  spyRs5d: number;
  spyRs20d: number;
  notes: string;
}

/** What the reasoner returns. */
export type DecisionVerdict = 'approve' | 'veto' | 'escalate';

export interface Decision {
  id: string;                  // UUID
  signal: IncomingSignal;
  context: SignalContext;
  verdict: DecisionVerdict;
  reasoning: string;
  confidence: number;          // 0..1
  adjustedSize: number | null; // USD; null = use grade default
  adjustedStopPct: number;     // negative number, e.g. -5.0
  modelUsed: string;
  reasoningLatencyMs: number;
  createdAt: string;
  // For escalations only — set when human resolves them
  resolvedAt?: string;
  resolvedBy?: 'human' | 'auto-timeout';
  resolution?: 'approved' | 'vetoed';
}
