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
  timestamp: string;
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
  totalTxns: number;
  lastActivity: string | null;
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

export type PageTab = 'scanner' | 'pumpfun' | 'sniper' | 'whales' | 'moonshot';
