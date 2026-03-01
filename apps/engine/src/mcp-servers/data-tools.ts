import type { OHLCV } from '@tradeworks/shared';

/**
 * MCP tool definitions for market data access.
 * These tools are exposed to analysis agents for retrieving market data.
 */

export interface OrderBookEntry {
  price: number;
  size: number;
}

export interface OrderBook {
  instrument: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  spreadPercent: number;
  timestamp: Date;
}

export interface SentimentData {
  instrument: string;
  overallScore: number; // -1.0 to +1.0
  newsScore: number;
  socialScore: number;
  onChainScore: number; // Crypto only
  fearGreedIndex: number; // 0-100
  sources: Array<{
    name: string;
    score: number;
    articles: number;
    timestamp: Date;
  }>;
}

export interface MacroData {
  fedFundsRate: number;
  cpiYoY: number;
  ppiYoY: number;
  unemploymentRate: number;
  gdpGrowth: number;
  pmiManufacturing: number;
  pmiServices: number;
  vix: number;
  dxyIndex: number;
  us10YYield: number;
  us2YYield: number;
  yieldCurveSpread: number; // 10Y - 2Y
  m2MoneySupply: number;
  consumerConfidence: number;
  timestamp: Date;
}

/**
 * Get OHLCV candle data for an instrument.
 */
export async function getCandles(params: {
  instrument: string;
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
  limit?: number;
  start?: Date;
  end?: Date;
}): Promise<OHLCV[]> {
  const limit = params.limit ?? 200;
  console.log(`[DataTools] Fetching ${limit} ${params.timeframe} candles for ${params.instrument}`);

  // TODO: Route to appropriate data source based on instrument type
  // - Crypto: from ingest service (ClickHouse) or exchange API
  // - Equities: from Alpaca data API
  // - Prediction markets: from Polymarket historical data

  // Placeholder: return empty candles
  return [];
}

/**
 * Get current order book for an instrument.
 */
export async function getOrderBook(params: {
  instrument: string;
  depth?: number;
}): Promise<OrderBook> {
  const depth = params.depth ?? 20;
  console.log(`[DataTools] Fetching order book for ${params.instrument} (depth: ${depth})`);

  // TODO: Fetch real-time order book from appropriate exchange
  return {
    instrument: params.instrument,
    bids: [],
    asks: [],
    spread: 0,
    spreadPercent: 0,
    timestamp: new Date(),
  };
}

/**
 * Get sentiment scores for an instrument.
 */
export async function getSentiment(params: {
  instrument: string;
  sources?: ('news' | 'social' | 'onchain')[];
}): Promise<SentimentData> {
  const sources = params.sources ?? ['news', 'social', 'onchain'];
  console.log(`[DataTools] Fetching sentiment for ${params.instrument} from ${sources.join(', ')}`);

  // TODO: Aggregate sentiment from multiple providers
  // - News: newsapi.org, cryptopanic, etc.
  // - Social: Twitter API, Reddit API
  // - On-chain: Glassnode, IntoTheBlock

  return {
    instrument: params.instrument,
    overallScore: 0,
    newsScore: 0,
    socialScore: 0,
    onChainScore: 0,
    fearGreedIndex: 50,
    sources: [],
  };
}

/**
 * Get macroeconomic data.
 */
export async function getMacroData(): Promise<MacroData> {
  console.log('[DataTools] Fetching macro economic data...');

  // TODO: Integrate with macro data providers
  // - FRED API for US economic data
  // - Alpha Vantage for market indices
  // - Yahoo Finance for VIX, DXY, yields

  return {
    fedFundsRate: 0,
    cpiYoY: 0,
    ppiYoY: 0,
    unemploymentRate: 0,
    gdpGrowth: 0,
    pmiManufacturing: 0,
    pmiServices: 0,
    vix: 0,
    dxyIndex: 0,
    us10YYield: 0,
    us2YYield: 0,
    yieldCurveSpread: 0,
    m2MoneySupply: 0,
    consumerConfidence: 0,
    timestamp: new Date(),
  };
}

/**
 * MCP tool schema definitions for agent consumption.
 */
export const DATA_TOOL_SCHEMAS = {
  getCandles: {
    name: 'getCandles',
    description: 'Get OHLCV candle data for any instrument and timeframe',
    parameters: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Instrument symbol (e.g., BTC-USD, AAPL, ETH-USD)' },
        timeframe: {
          type: 'string',
          enum: ['1m', '5m', '15m', '1h', '4h', '1d', '1w'],
          description: 'Candle timeframe',
        },
        limit: { type: 'number', description: 'Number of candles to fetch (default: 200, max: 1000)' },
        start: { type: 'string', description: 'Start date (ISO 8601)' },
        end: { type: 'string', description: 'End date (ISO 8601)' },
      },
      required: ['instrument', 'timeframe'],
    },
  },
  getOrderBook: {
    name: 'getOrderBook',
    description: 'Get current order book depth for an instrument',
    parameters: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Instrument symbol' },
        depth: { type: 'number', description: 'Order book depth (default: 20)' },
      },
      required: ['instrument'],
    },
  },
  getSentiment: {
    name: 'getSentiment',
    description: 'Get sentiment scores for an instrument from news, social media, and on-chain sources',
    parameters: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Instrument symbol' },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['news', 'social', 'onchain'] },
          description: 'Sentiment sources to query',
        },
      },
      required: ['instrument'],
    },
  },
  getMacroData: {
    name: 'getMacroData',
    description: 'Get macroeconomic data including rates, inflation, employment, GDP, VIX, and yield curve',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};
