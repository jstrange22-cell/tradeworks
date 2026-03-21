/**
 * Solana Sniper Engine — Type Definitions
 *
 * All TypeScript interfaces and types extracted from the monolithic
 * solana-sniper.ts module. These cover configuration, templates,
 * runtime state, execution records, positions, price feeds, and P&L.
 */

// ── Configuration ───────────────────────────────────────────────────────

export interface SniperConfigFields {
  /** SOL amount per snipe (e.g. 0.05 = 0.05 SOL) */
  buyAmountSol: number;
  /** Max SOL to spend per day */
  dailyBudgetSol: number;
  /** Slippage tolerance in basis points */
  slippageBps: number;
  /** Priority fee in micro-lamports per CU */
  priorityFee: number;
  /** Auto-sell: take profit % (e.g. 100 = 2x) */
  takeProfitPercent: number;
  /** Auto-sell: stop loss % (e.g. -50 = sell at 50% loss) */
  stopLossPercent: number;
  /** Min liquidity USD to snipe */
  minLiquidityUsd: number;
  /** Max market cap USD to snipe (avoid already-pumped tokens) */
  maxMarketCapUsd: number;
  /** Only snipe tokens with mint authority revoked */
  requireMintRevoked: boolean;
  /** Only snipe tokens with freeze authority revoked */
  requireFreezeRevoked: boolean;
  /** Max concurrent open positions */
  maxOpenPositions: number;
  /** Auto-buy on pump.fun detection */
  autoBuyPumpFun: boolean;
  /** Auto-buy on trending detection (Dexscreener) */
  autoBuyTrending: boolean;
  /** Min moonshot AI score to buy (0 = disabled, 1-100 = threshold) */
  minMoonshotScore: number;
  /** Sell if price hasn't moved >1% in this many ms (default: 300000 = 5 min) */
  stalePriceTimeoutMs: number;
  /** Force sell after this many ms regardless (default: 1800000 = 30 min) */
  maxPositionAgeMs: number;
  /** Activate trailing stop when P&L reaches this % (default: 30) */
  trailingStopActivatePercent: number;
  /** Trail this % below high water mark (default: -15) */
  trailingStopPercent: number;
  /** Minimum ms between buys (default: 30000 = 30s) */
  buyCooldownMs: number;
  /** Skip tokens below this market cap (default: 5000) */
  minMarketCapUsd: number;
  /** Max tokens one creator can deploy per hour before blocking (default: 3) */
  maxCreatorDeploysPerHour: number;
  /** Max market cap for trending token auto-buys (default: 500000 — higher than PumpFun cap) */
  maxTrendingMarketCapUsd: number;
  /** Minimum 24h price change % for trending auto-buy (default: 50) */
  minTrendingMomentumPercent: number;
  /** Run in paper/simulation mode — no real transactions (default: false) */
  paperMode: boolean;
  // ── Phase 1: Momentum Confirmation Gate ──
  /** Observation window in ms before buying (default: 10000 = 10s) */
  momentumWindowMs: number;
  /** Minimum unique buyer wallets during observation (default: 5) */
  minUniqueBuyers: number;
  /** Minimum buy/sell volume ratio (default: 1.5) */
  minBuySellRatio: number;
  /** Minimum total buy volume in SOL during observation (default: 0.5) */
  minBuyVolumeSol: number;
  // ── Phase 2: Instant Reject Filters ──
  /** Minimum SOL in bonding curve to consider (default: 1.0) */
  minBondingCurveSol: number;
  /** Max bonding curve progress 0-1 before rejecting (default: 0.8) */
  maxBondingCurveProgress: number;
  /** Enable spam name filter (default: true) */
  enableSpamFilter: boolean;
  // ── Phase 3: Circuit Breakers ──
  /** Consecutive losses before pausing buys (default: 5) */
  consecutiveLossPauseThreshold: number;
  /** Pause duration in ms after consecutive losses (default: 300000 = 5min) */
  consecutiveLossPauseMs: number;
  /** Max realized loss in SOL per day before stopping (default: 0.1) */
  maxDailyLossSol: number;
  // ── Phase 4: RugCheck ──
  /** Enable RugCheck API validation (default: true) */
  enableRugCheck: boolean;
  /** Minimum RugCheck score 0-1000 (default: 500) */
  minRugCheckScore: number;
  /** Max top holder percentage (default: 30) */
  maxTopHolderPct: number;
  /** RugCheck API timeout in ms (default: 2000) */
  rugCheckTimeoutMs: number;
  // ── Phase 5: Tiered Exits ──
  /** Enable partial sells at profit milestones (default: true) */
  enableTieredExits: boolean;
  /** Profit tiers: array of { pctGain, sellPct } */
  exitTier1PctGain: number;   // default: 50 (1.5x)
  exitTier1SellPct: number;   // default: 30
  exitTier2PctGain: number;   // default: 100 (2x)
  exitTier2SellPct: number;   // default: 30
  exitTier3PctGain: number;   // default: 200 (3x)
  exitTier3SellPct: number;   // default: 30
  exitTier4PctGain: number;   // default: 500 (5x+)
  exitTier4SellPct: number;   // default: 100 (sell remaining moonbag)
  // ── Phase 6: Jito Bundles ──
  /** Enable Jito bundle execution for MEV protection (default: false) */
  enableJito: boolean;
  /** Jito tip in lamports (default: 100000 = 0.0001 SOL) */
  jitoTipLamports: number;
  // ── Phase 7: AI Signal Generator ──
  /** Enable AI signal-based buy gating (default: false — signals are logged but don't block buys) */
  useAiSignals: boolean;
  /** Minimum signal confidence 0-100 to proceed with buy when useAiSignals is true (default: 0) */
  minSignalConfidence: number;
  // ── Phase 8: Dynamic Risk & Position Sizing ──
  /** Enable dynamic position sizing via Kelly Criterion (default: false — uses fixed buyAmountSol) */
  enableDynamicSizing: boolean;
  /** Max % of wallet per trade when dynamic sizing is active (default: 0.10 = 10%) */
  maxPositionPct: number;
  // ── Phase 9: Anti-Rug Protection ──
  /** Enable anti-rug sell velocity + liquidity drain detectors (default: true) */
  enableAntiRug: boolean;
  /** Emergency sell if sell/buy SOL ratio exceeds this in the sliding window (default: 5.0) */
  antiRugSellVelocityRatio: number;
  /** Sliding window size in ms for sell velocity tracking (default: 10000 = 10s) */
  antiRugVelocityWindowMs: number;
  /** Emergency sell if bonding curve SOL drops this % from snapshot in a single trade (default: 15) */
  antiRugLiquidityDropPct: number;
  /** Don't trigger anti-rug in first N ms after buy — initial trades are noisy (default: 5000) */
  antiRugMinPositionAgeMs: number;
}

/** Backwards-compatible config shape (config fields + enabled flag) */
export interface SniperConfig extends SniperConfigFields {
  enabled: boolean;
}

// ── Templates ───────────────────────────────────────────────────────────

export interface TemplateStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  createdAt: string;
}

export interface SniperTemplate extends SniperConfigFields {
  id: string;
  name: string;
  enabled: boolean;
  stats: TemplateStats;
}

export interface TemplateRuntimeState {
  running: boolean;
  startedAt: Date | null;
  dailySpentSol: number;
  dailyResetDate: string;
  /** Virtual SOL balance for paper mode */
  paperBalanceSol: number;
  /** Consecutive losses counter for circuit breaker */
  consecutiveLosses: number;
  /** Realized loss in SOL today for daily loss limit */
  dailyRealizedLossSol: number;
  /** Timestamp when circuit breaker pause started (0 = not paused) */
  circuitBreakerPausedUntil: number;
}

// ── Execution Records ───────────────────────────────────────────────────

export interface SnipeExecution {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  amountSol: number;
  amountTokens: number | null;
  priceUsd: number | null;
  signature: string | null;
  status: 'pending' | 'success' | 'failed';
  error: string | null;
  trigger: 'manual' | 'pumpfun' | 'trending' | 'take_profit' | 'stop_loss' | 'stale_price' | 'max_age' | 'trailing_stop' | 'liquidity_crash' | 'rug_detected';
  templateId: string;
  templateName: string;
  timestamp: string;
  /** Whether this execution was simulated (paper mode) */
  paperMode?: boolean;
  /** Realized P&L in SOL for sell executions (sell amount - buy cost) */
  pnlSol?: number;
  /** Realized P&L as percentage for sell executions */
  pnlPercent?: number;
}

// ── Positions ───────────────────────────────────────────────────────────

export interface ActivePosition {
  mint: string;
  symbol: string;
  name: string;
  buyPrice: number;
  currentPrice: number;
  amountTokens: number;
  pnlPercent: number;
  buySignature: string;
  boughtAt: string;
  templateId: string;
  templateName: string;
  /** Consecutive price-fetch failures (for degraded monitoring warnings) */
  priceFetchFailCount: number;
  /** ISO timestamp of last meaningful price movement (>1% change) */
  lastPriceChangeAt: string;
  /** Highest price seen since buy (for trailing stop-loss) */
  highWaterMarkPrice: number;
  /** SOL cost to acquire this position */
  buyCostSol?: number;
  /** Total sell attempts that have failed (for write-off threshold) */
  sellFailCount?: number;
  /** Whether this is a paper/simulated position */
  paperMode?: boolean;
  /** Remaining position as fraction 0-1 (1.0 = full position) */
  remainingPct?: number;
  /** Which exit tiers have been triggered (tier numbers) */
  tiersSold?: number[];
  /** Token description from pump.fun or metadata */
  description?: string;
  /** Accumulated SOL received across all partial sells (tiered exits) — used for per-position win/loss tracking */
  accumulatedSellSol?: number;
}

// ── Sell Retry Queue ────────────────────────────────────────────────────

/** Queue entry for failed sells to retry after a delay */
export interface FailedSellEntry {
  mint: string;
  trigger: SnipeExecution['trigger'];
  templateId: string;
  failedAt: number;
  retryCount: number;
}

// ── Momentum Confirmation Gate ──────────────────────────────────────────

export interface PendingToken {
  mint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  detectedAt: number;
  trades: Array<{ txType: 'buy' | 'sell'; traderPublicKey: string; solAmount: number; timestamp: number }>;
  uniqueBuyers: Set<string>;
  uniqueSellers: Set<string>;
  totalBuySol: number;
  totalSellSol: number;
  templateId: string;
  source: 'pumpfun' | 'trending';
  usdMarketCap: number;
  /** RugCheck result (null = pending/disabled) */
  rugCheckResult: { score: number; topHolderPct: number; bundleDetected: boolean } | null;
  rugCheckDone: boolean;
}

// ── Swap / DEX Types ────────────────────────────────────────────────────

export interface SwapResult {
  signature: string;
  success: boolean;
  outAmount: string | null;
}

export interface RaydiumQuoteResponse {
  success: boolean;
  data?: {
    outputAmount: string;
    [key: string]: unknown;
  };
  msg?: string;
  [key: string]: unknown;
}

export interface RaydiumSwapResponse {
  success: boolean;
  data?: {
    transaction: string[];
  };
  msg?: string;
}

// ── Price Feed Types ────────────────────────────────────────────────────

export interface DexscreenerPair {
  chainId: string;
  priceUsd?: string;
  [key: string]: unknown;
}

export interface DexscreenerTokenResponse {
  pairs?: DexscreenerPair[];
}

export interface JupiterPriceData {
  price: string;
}

export interface JupiterPriceResponse {
  data: Record<string, JupiterPriceData | undefined>;
}

// ── Holdings P&L ────────────────────────────────────────────────────────

export interface HoldingPnL {
  mint: string;
  symbol: string;
  name: string;
  totalBuySol: number;
  totalSellSol: number;
  totalBuyCount: number;
  totalSellCount: number;
  currentAmountTokens: number;
  currentPriceUsd: number;
  currentValueUsd: number;
  realizedPnlSol: number;
  unrealizedPnlPercent: number;
  avgBuyPrice: number;
  lastAction: string;
  lastActionAt: string;
  isOpen: boolean;
  templateName: string | null;
}
