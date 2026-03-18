// ─── Solana Domain Types ──────────────────────────────────────────────────

export interface SolanaTokenBalance {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  valueUsd: number;
  logoUri?: string;
}

export interface SolanaBalanceData {
  wallet: string;
  rpcUrl: string;
  solBalance: number;
  solValueUsd: number;
  tokens: SolanaTokenBalance[];
  totalValueUsd: number;
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  pairCreatedAt: string | null;
  imageUrl: string | null;
  url: string;
}

export interface TokenSafety {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPercent: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
}

export interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  creator: string;
  createdAt: string;
  marketCap: number;
  usdMarketCap: number;
  replyCount: number;
  bondingCurveProgress: number;
  graduated: boolean;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  kingOfTheHill: boolean;
}

export interface SniperConfig {
  enabled: boolean;
  buyAmountSol: number;
  dailyBudgetSol: number;
  slippageBps: number;
  priorityFee: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  minLiquidityUsd: number;
  maxMarketCapUsd: number;
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  maxOpenPositions: number;
  autoBuyPumpFun: boolean;
  autoBuyTrending: boolean;
  minMoonshotScore?: number;
  stalePriceTimeoutMs?: number;
  maxPositionAgeMs?: number;
  trailingStopActivatePercent?: number;
  trailingStopPercent?: number;
  buyCooldownMs?: number;
  minMarketCapUsd?: number;
  maxCreatorDeploysPerHour?: number;
  maxTrendingMarketCapUsd?: number;
  minTrendingMomentumPercent?: number;
  /** Mints that should NEVER be sold or cleaned up */
  protectedMints?: string[];
  /** Paper mode — simulated trades, no real transactions */
  paperMode?: boolean;
  // Phase 1: Momentum
  momentumWindowMs?: number;
  minUniqueBuyers?: number;
  minBuySellRatio?: number;
  minBuyVolumeSol?: number;
  // Phase 2: Filters
  minBondingCurveSol?: number;
  maxBondingCurveProgress?: number;
  enableSpamFilter?: boolean;
  // Phase 3: Circuit Breakers
  consecutiveLossPauseThreshold?: number;
  consecutiveLossPauseMs?: number;
  maxDailyLossSol?: number;
  // Phase 4: RugCheck
  enableRugCheck?: boolean;
  minRugCheckScore?: number;
  maxTopHolderPct?: number;
  rugCheckTimeoutMs?: number;
}

// ─── Sniper Template Types ───────────────────────────────────────────────

export interface TemplateStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  createdAt: string;
}

export interface SniperTemplate {
  id: string;
  name: string;
  enabled: boolean;
  buyAmountSol: number;
  dailyBudgetSol: number;
  slippageBps: number;
  priorityFee: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  minLiquidityUsd: number;
  maxMarketCapUsd: number;
  requireMintRevoked: boolean;
  requireFreezeRevoked: boolean;
  maxOpenPositions: number;
  autoBuyPumpFun: boolean;
  autoBuyTrending: boolean;
  paperMode?: boolean;
  // Phase 1: Momentum
  momentumWindowMs?: number;
  minUniqueBuyers?: number;
  minBuySellRatio?: number;
  minBuyVolumeSol?: number;
  // Phase 2: Filters
  minBondingCurveSol?: number;
  maxBondingCurveProgress?: number;
  enableSpamFilter?: boolean;
  // Phase 3: Circuit Breakers
  consecutiveLossPauseThreshold?: number;
  consecutiveLossPauseMs?: number;
  maxDailyLossSol?: number;
  // Phase 4: RugCheck
  enableRugCheck?: boolean;
  minRugCheckScore?: number;
  maxTopHolderPct?: number;
  rugCheckTimeoutMs?: number;
  stats: TemplateStats;
}

export interface TemplateStatusItem extends SniperTemplate {
  running: boolean;
  dailySpentSol: number;
  openPositionCount: number;
  paperBalanceSol?: number;
  pendingTokens?: number;
  circuitBreakerPausedUntil?: number;
  consecutiveLosses?: number;
  dailyRealizedLossSol?: number;
}

export interface ActivePosition {
  mint: string;
  symbol: string;
  name: string;
  description?: string;
  buyPrice: number;
  currentPrice: number;
  amountTokens: number;
  pnlPercent: number;
  buySignature: string;
  boughtAt: string;
  templateId?: string;
  templateName?: string;
  costUsd?: number;
  valueUsd?: number;
  unrealizedPnlUsd?: number;
  lastPriceChangeAt?: string;
  highWaterMarkPrice?: number;
  buyCostSol?: number;
  trigger?: string;
  paperMode?: boolean;
}

export interface SnipeExecution {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  amountSol: number;
  signature: string | null;
  status: 'pending' | 'success' | 'failed';
  error: string | null;
  trigger: string;
  templateId?: string;
  templateName?: string;
  timestamp: string;
  paperMode?: boolean;
  /** Realized P&L in SOL (sell executions only) */
  pnlSol?: number;
  /** Realized P&L as percentage (sell executions only) */
  pnlPercent?: number;
}

// ─── Whale / Copy Trading Types ──────────────────────────────────────────

export interface WhaleCopyConfig {
  enabled: boolean;
  buyAmountSol: number;
  maxSlippageBps: number;
  copySells: boolean;
  takeProfitPercent: number;
  stopLossPercent: number;
  antiMev: boolean;
  priorityFee: number;
}

export interface WhaleActivity {
  id: string;
  whaleAddress: string;
  whaleLabel: string;
  type: 'buy' | 'sell' | 'transfer';
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  amountUsd: number;
  amountTokens: number;
  priceUsd: number;
  signature: string;
  timestamp: string;
  copied: boolean;
}

export interface TrackedWhale {
  address: string;
  label: string;
  addedAt?: string;
  totalTxns: number;
  lastActivity: string | null;
  copyTradeEnabled?: boolean;
  pnlEstimate?: number;
  winRate?: number;
  pnl7d?: number;
  pnl30d?: number;
  totalVolume?: number;
  txCount7d?: number;
  tags?: string[];
  copyConfig?: WhaleCopyConfig | null;
}

export interface DiscoverWhale {
  address: string;
  label: string;
  tags: string[];
  isTracked: boolean;
  copyEnabled: boolean;
}

export interface MoonshotScore {
  mint: string;
  symbol: string;
  name: string;
  score: number;
  factors: Record<string, { score: number; weight: number; weighted: number; details: string }>;
  rugRisk: string;
  rugWarnings: string[];
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  priceChange24h: number;
  scoredAt: string;
  recommendation: string;
}

// ─── Holdings P&L Types ─────────────────────────────────────────────────

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

export interface HoldingsSummary {
  totalHoldings: number;
  openPositions: number;
  closedPositions: number;
  totalInvestedSol: number;
  totalReturnedSol: number;
  realizedPnlSol: number;
}

export type PageTab = 'scanner' | 'pumpfun' | 'sniper' | 'whales' | 'moonshot' | 'holdings' | 'pnl';
