// ---------------------------------------------------------------------------
// Settings domain types
// ---------------------------------------------------------------------------

export interface MaskedApiKey {
  id: string;
  service: string;
  keyName: string;
  maskedKey: string;
  environment: string;
  createdAt: string;
}

export interface ApiKeysResponse {
  data: MaskedApiKey[];
  total: number;
}

export interface TestResult {
  success: boolean;
  message: string;
}

export interface RiskLimits {
  maxRiskPerTrade: number;
  dailyLossCap: number;
  weeklyLossCap: number;
  maxPortfolioHeat: number;
  minRiskReward: number;
  maxCorrelation: number;
}

export interface ProtectedAsset {
  symbol: string;
  locked: boolean;
  snapshotQuantity: number;
  snapshotValueUsd: number;
}

export interface AssetProtectionConfig {
  engineTradingEnabled: boolean;
  tradingBudgetUsd: number;
  budgetUsedUsd: number;
  protectedAssets: Record<string, ProtectedAsset>;
  enginePositions: unknown[];
  snapshotTakenAt: string | null;
}

// ---------------------------------------------------------------------------
// Notification types
// ---------------------------------------------------------------------------

export type NotificationChannelType = 'email' | 'discord' | 'telegram';

export interface NotificationChannel {
  type: NotificationChannelType;
  enabled: boolean;
  config: Record<string, string>;
}

export type NotificationEvent =
  | 'trade_executed'
  | 'circuit_breaker_triggered'
  | 'daily_pnl_summary'
  | 'whale_alert'
  | 'arbitrage_opportunity'
  | 'risk_alert';

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  'trade_executed',
  'circuit_breaker_triggered',
  'daily_pnl_summary',
  'whale_alert',
  'arbitrage_opportunity',
  'risk_alert',
] as const;

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  trade_executed: 'Trade Executed',
  circuit_breaker_triggered: 'Circuit Breaker Triggered',
  daily_pnl_summary: 'Daily P&L Summary',
  whale_alert: 'Whale Alert',
  arbitrage_opportunity: 'Arbitrage Opportunity',
  risk_alert: 'Risk Alert',
};

export interface NotificationPreferences {
  channels: NotificationChannel[];
  subscribedEvents: NotificationEvent[];
}

export interface NotificationTestResult {
  success: boolean;
  channelType: NotificationChannelType;
  detail: string;
}

// ---------------------------------------------------------------------------
// Exchange / Service types
// ---------------------------------------------------------------------------

export type ServiceType = 'coinbase' | 'alpaca' | 'robinhood' | 'polymarket' | 'solana';

export const SERVICE_INFO: Record<string, { label: string; color: string; description: string }> = {
  coinbase: { label: 'Coinbase', color: 'text-blue-400', description: 'Cryptocurrency trading via Coinbase Advanced' },
  alpaca: { label: 'Alpaca', color: 'text-green-400', description: 'Stock & ETF trading via Alpaca' },
  robinhood: { label: 'Robinhood', color: 'text-emerald-400', description: 'Crypto trading via Robinhood Crypto API (crypto only \u2014 use Alpaca for stocks)' },
  polymarket: { label: 'Polymarket', color: 'text-purple-400', description: 'Prediction market trading via Polymarket CLOB' },
  solana: { label: 'Solana', color: 'text-violet-400', description: 'Solana meme coin trading via bot wallet' },
};

export const EXCHANGE_SETUP_GUIDES: Record<string, { steps: { text: string; link?: string }[]; fields: string[] }> = {
  coinbase: {
    steps: [
      { text: 'Go to Coinbase CDP Portal and create a new API key', link: 'https://portal.cdp.coinbase.com/access/api' },
      { text: 'Select permissions: View and Trade (minimum required)' },
      { text: 'Copy the Key ID (UUID format) and paste below' },
      { text: 'Copy the API Secret (shown only once!) and paste below' },
      { text: 'For testing: select "Sandbox" environment below' },
    ],
    fields: ['apiKey', 'apiSecret'],
  },
  alpaca: {
    steps: [
      { text: 'Create a free account at Alpaca', link: 'https://alpaca.markets' },
      { text: 'Go to your Paper Trading dashboard', link: 'https://app.alpaca.markets/paper/dashboard/overview' },
      { text: 'Click "Generate API Keys" in the sidebar' },
      { text: 'Copy the Key ID and paste in "API Key" below' },
      { text: 'Copy the Secret Key and paste in "API Secret" below' },
      { text: 'For paper trading: select "Sandbox" environment below' },
    ],
    fields: ['apiKey', 'apiSecret'],
  },
  robinhood: {
    steps: [
      { text: 'Go to Robinhood Crypto Trading API portal', link: 'https://robinhood.com/account/crypto-api' },
      { text: 'Generate an API key pair (ED25519)' },
      { text: 'Copy the API Key and paste below' },
      { text: 'Copy the Private Key (PEM format) and paste in "API Secret" below' },
      { text: 'Note: This is for CRYPTO trading only. For stocks/ETFs, use Alpaca.' },
    ],
    fields: ['apiKey', 'apiSecret'],
  },
  polymarket: {
    steps: [
      { text: 'Go to Polymarket and connect a crypto wallet', link: 'https://polymarket.com' },
      { text: 'Navigate to Settings and generate CLOB API credentials' },
      { text: 'Copy the API Key, API Secret, and Passphrase' },
      { text: 'You need USDC on Polygon network for trading' },
    ],
    fields: ['apiKey', 'apiSecret', 'passphrase'],
  },
  solana: {
    steps: [
      { text: '\u{26A1} Method A \u{2014} Generate: Click "Generate Wallet" below to create a new keypair instantly' },
      { text: '\u{1F98A} Method B \u{2014} Phantom: Open Phantom \u{2192} Settings \u{2192} Security \u{2192} Export Private Key \u{2192} Paste below' },
      { text: '\u{1F4BB} Method C \u{2014} CLI: Run "solana-keygen new" and paste the base58 private key', link: 'https://docs.solanalabs.com/cli/wallets/file-system' },
      { text: 'Fund the wallet with SOL (0.1+ SOL recommended for gas fees + trading)' },
      { text: 'Optional: add a custom RPC URL (Helius, QuickNode) in "API Secret" field for faster transactions', link: 'https://www.helius.dev/' },
    ],
    fields: ['apiKey'],
  },
};
