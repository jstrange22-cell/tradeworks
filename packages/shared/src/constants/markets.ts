export const EXCHANGES = {
  COINBASE: 'coinbase',
  ALPACA: 'alpaca',
  POLYMARKET: 'polymarket',
} as const;

export const CRYPTO_INSTRUMENTS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'AVAX-USD',
  'MATIC-USD',
  'LINK-USD',
  'UNI-USD',
  'AAVE-USD',
] as const;

export const DEFAULT_EQUITY_INSTRUMENTS = [
  'AAPL',
  'MSFT',
  'GOOGL',
  'AMZN',
  'NVDA',
  'META',
  'TSLA',
  'SPY',
  'QQQ',
  'IWM',
] as const;

export const MARKET_HOURS = {
  US_EQUITY: {
    preMarket: { start: '04:00', end: '09:30' },
    regular: { start: '09:30', end: '16:00' },
    afterHours: { start: '16:00', end: '20:00' },
    timezone: 'America/New_York',
  },
  CRYPTO: {
    // 24/7
    start: '00:00',
    end: '23:59',
    timezone: 'UTC',
  },
} as const;
