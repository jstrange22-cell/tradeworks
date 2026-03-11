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
  stats: TemplateStats;
}

export interface TemplateStatusItem extends SniperTemplate {
  running: boolean;
  dailySpentSol: number;
  openPositionCount: number;
}

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
  templateId?: string;
  templateName?: string;
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

export type PageTab = 'scanner' | 'pumpfun' | 'sniper' | 'whales' | 'moonshot' | 'holdings';
