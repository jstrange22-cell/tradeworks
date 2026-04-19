/**
 * Arbitrage Intelligence — Data Models
 *
 * All interfaces for the 7-detector arb system.
 * Used by detectors, brain, validator, orchestrator, and API routes.
 */

// ── Core Arb Types ──────────────────────────────────────────────────────

export type ArbType =
  | 'type1_single_rebalance'
  | 'type2_dutch_book'
  | 'type3_cross_platform'
  | 'type4_combinatorial'
  | 'type4_combinatorial_mutex'
  | 'type5_settlement'
  | 'type6_latency'
  | 'type7_options_implied'
  | 'type8_exchange_spread'
  | 'type9_stock_crypto_spread';

export type Venue = 'kalshi' | 'polymarket' | 'deribit' | 'alpaca';
export type ArbAction = 'execute' | 'skip' | 'investigate';
export type Urgency = 'critical' | 'high' | 'medium' | 'low';

// ── Arb Opportunity (produced by detectors) ─────────────────────────────

export interface ArbLeg {
  venue: Venue;
  ticker: string;
  side: 'yes' | 'no';
  price: number;          // 0.00–1.00
  quantity: number;
}

export interface ArbOpportunity {
  id: string;                          // uuid
  arbType: ArbType;
  venue_a: Venue;
  ticker_a: string;
  title_a: string;
  side_a: 'yes' | 'no';
  price_a: number;
  venue_b: Venue;
  ticker_b: string;
  title_b: string;
  side_b: 'yes' | 'no';
  price_b: number;
  totalCost: number;                   // sum of prices (should be < 1.00 for profit)
  grossProfitPerContract: number;      // before fees
  netProfitPerContract: number;        // after fees + slippage
  fillableQuantity: number;
  confidence: number;                  // 0.0–1.0
  urgency: Urgency;
  category: string;
  description: string;
  reasoning: string;                   // for Type 4 LLM reasoning
  detectedAt: string;                  // ISO timestamp
  sizeMultiplier: number;              // default 1.0, reduced by memory warnings
  legs: ArbLeg[];
  // Type 2 Dutch Book extras
  eventTicker?: string;
  conditionsCount?: number;
  // Type 4 Combinatorial extras
  marketATitle?: string;
  marketBTitle?: string;
  edgeCases?: string[];
  // Type 7 Options extras
  optionsImpliedProb?: number;
  marketImpliedProb?: number;
}

// ── Brain Decision Output ───────────────────────────────────────────────

export interface ArbDecision {
  action: ArbAction;
  reasoning: string;
  opportunity: ArbOpportunity;
  confidence: number;
  warnings: string[];
  elapsedMs: number;
}

// ── Detector Result ─────────────────────────────────────────────────────

export interface DetectorResult {
  detector: ArbType;
  opportunities: ArbOpportunity[];
  marketsScanned: number;
  durationMs: number;
  error?: string;
}

// ── Validation Result ───────────────────────────────────────────────────

export interface ValidationResult {
  profitable: boolean;
  grossProfit: number;
  totalFees: number;
  slippage: number;
  netProfit: number;
  feeBreakdown: {
    kalshiFee: number;
    polySettlementFee: number;
  };
  recommendedQuantity: number;
}

// ── Learning / Stats ────────────────────────────────────────────────────

export interface ArbTypeStats {
  arbType: ArbType;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  currentThreshold: number;
}

export interface LearnerReport {
  stats: ArbTypeStats[];
  totalTrades: number;
  totalPnl: number;
  overallWinRate: number;
  adjustments: string[];
  generatedAt: string;
}

// ── Paper Portfolio ─────────────────────────────────────────────────────

export interface ArbPaperPosition {
  id: string;
  opportunity: ArbOpportunity;
  entryTime: string;
  entryValue: number;       // total cost of all legs
  currentValue: number;
  pnl: number;
  status: 'open' | 'closed' | 'expired';
  exitTime?: string;
  exitReason?: string;
}

export interface ArbPaperPortfolio {
  startingCapital: number;
  cashUsd: number;
  positionsValue: number;
  totalValue: number;
  totalPnlUsd: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: ArbPaperPosition[];
  recentTrades: ArbPaperPosition[];
}

// ── Config ──────────────────────────────────────────────────────────────

export interface ArbConfig {
  mode: 'paper' | 'live';
  scanIntervalMs: number;
  maxSimultaneous: number;
  maxPerTradeUsd: number;
  startingCapital: number;
  slippageCents: number;
  thresholds: {
    type1MinCents: number;
    type2MinCents: number;
    type3MinCents: number;
    type4MinCents: number;
    type5MinCents: number;
    type6MinCents: number;
    type7MinEdgePct: number;
  };
  blockedCategories: string[];
}

export const DEFAULT_ARB_CONFIG: ArbConfig = {
  mode: 'paper',
  scanIntervalMs: 30_000,
  maxSimultaneous: 5,
  maxPerTradeUsd: 200,
  startingCapital: 5000,
  slippageCents: 2,
  thresholds: {
    type1MinCents: 1.0,
    type2MinCents: 2.0,
    type3MinCents: 3.0,
    type4MinCents: 3.0,
    type5MinCents: 3.0,
    type6MinCents: 2.0,
    type7MinEdgePct: 3.0,
  },
  blockedCategories: ['CPI', 'FED', 'ECON_MACRO'],
};

// ── Market Data (shared across detectors) ───────────────────────────────

export interface NormalizedMarket {
  venue: Venue;
  ticker: string;
  eventTicker: string;
  title: string;
  category: string;
  yesPrice: number;
  noPrice: number;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  volume: number;
  liquidity: number;
  expiresAt: string;
  status: string;
  outcomes?: { name: string; price: number; tokenId?: string }[];
}

export interface NormalizedEvent {
  venue: Venue;
  eventTicker: string;
  title: string;
  category: string;
  markets: NormalizedMarket[];
}

// ── Engine Status ───────────────────────────────────────────────────────

export interface ArbEngineStatus {
  running: boolean;
  mode: 'paper' | 'live';
  scanCycles: number;
  lastScanAt: string | null;
  lastScanDurationMs: number;
  detectorsActive: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  uptime: number;
  config: ArbConfig;
}
