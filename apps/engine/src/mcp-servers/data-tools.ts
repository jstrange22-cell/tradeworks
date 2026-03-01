import type { OHLCV } from '@tradeworks/shared';
import {
  getCandles as fetchCandlesFromCH,
  getLatestPrice,
  getOrderBookSnapshot,
} from '@tradeworks/db';
import type { MCPTool } from './types.js';

// ---------------------------------------------------------------------------
// Result interfaces (also consumed by the orchestrator directly)
// ---------------------------------------------------------------------------

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
  overallScore: number;
  newsScore: number;
  socialScore: number;
  onChainScore: number;
  fearGreedIndex: number;
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
  yieldCurveSpread: number;
  m2MoneySupply: number;
  consumerConfidence: number;
  timestamp: Date;
}

export interface EconomicCalendarEvent {
  name: string;
  date: string;
  time: string;
  currency: string;
  impact: 'high' | 'medium' | 'low';
  forecast: number | null;
  previous: number | null;
  actual: number | null;
}

export interface NewsSentiment {
  instrument: string;
  headline: string;
  source: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Exported standalone functions (consumed by the orchestrator directly)
// ---------------------------------------------------------------------------

/**
 * Get OHLCV candle data for an instrument via ClickHouse.
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

  // Map '1w' to '1d' and aggregate manually (ClickHouse only supports up to 1d)
  const chTimeframe = params.timeframe === '1w' ? '1d' : params.timeframe;
  const chLimit = params.timeframe === '1w' ? limit * 7 : limit;

  const rawCandles = await fetchCandlesFromCH(
    params.instrument,
    chTimeframe as '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
    chLimit,
  );

  // ClickHouse returns newest-first; reverse to chronological order
  const chronological = rawCandles.reverse();

  const ohlcv: OHLCV[] = chronological.map((c) => ({
    timestamp: new Date(c.bucket).getTime(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  // If weekly was requested, aggregate daily candles into weekly buckets
  if (params.timeframe === '1w' && ohlcv.length > 0) {
    return aggregateToWeekly(ohlcv).slice(-limit);
  }

  return ohlcv;
}

/** Aggregate daily OHLCV candles into weekly buckets. */
function aggregateToWeekly(dailyCandles: OHLCV[]): OHLCV[] {
  const weeks: OHLCV[] = [];
  let current: OHLCV | null = null;

  for (const c of dailyCandles) {
    const d = new Date(c.timestamp);
    const dayOfWeek = d.getUTCDay();

    // Start a new week on Monday (1) or if no current bucket
    if (!current || dayOfWeek === 1) {
      if (current) weeks.push(current);
      current = { ...c };
    } else {
      current.high = Math.max(current.high, c.high);
      current.low = Math.min(current.low, c.low);
      current.close = c.close;
      current.volume += c.volume;
    }
  }

  if (current) weeks.push(current);
  return weeks;
}

/**
 * Get current order book for an instrument from ClickHouse snapshots.
 */
export async function getOrderBook(params: {
  instrument: string;
  depth?: number;
}): Promise<OrderBook> {
  const depth = params.depth ?? 20;
  console.log(`[DataTools] Fetching order book for ${params.instrument} (depth: ${depth})`);

  const snapshot = await getOrderBookSnapshot(params.instrument);

  if (!snapshot) {
    return {
      instrument: params.instrument,
      bids: [],
      asks: [],
      spread: 0,
      spreadPercent: 0,
      timestamp: new Date(),
    };
  }

  // Parse the stored bids/asks JSON strings
  let bids: OrderBookEntry[] = [];
  let asks: OrderBookEntry[] = [];

  try {
    const rawBids = JSON.parse(snapshot.bids) as Array<[number, number]>;
    bids = rawBids.slice(0, depth).map(([price, size]) => ({ price, size }));
  } catch {
    // bids parsing failed
  }

  try {
    const rawAsks = JSON.parse(snapshot.asks) as Array<[number, number]>;
    asks = rawAsks.slice(0, depth).map(([price, size]) => ({ price, size }));
  } catch {
    // asks parsing failed
  }

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestAsk - bestBid;

  return {
    instrument: params.instrument,
    bids,
    asks,
    spread,
    spreadPercent: bestBid > 0 ? (spread / bestBid) * 100 : 0,
    timestamp: new Date(snapshot.timestamp),
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

  // TODO: Integrate with real sentiment providers:
  //   News:     newsapi.org, CryptoPanic
  //   Social:   Twitter/X API, Reddit API
  //   On-chain: Glassnode, IntoTheBlock

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

  // TODO: Integrate with real macro data providers:
  //   FRED API     - fed funds rate, CPI, PPI, unemployment, GDP, M2
  //   Alpha Vantage - VIX, DXY
  //   Treasury.gov  - yield curve data

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

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

export const dataTools: MCPTool[] = [
  {
    name: 'get_market_data',
    description:
      'Get the latest market data for an instrument: current price, 24-hour change, 24-hour volume, and 24-hour high/low. Data sourced from ClickHouse candle aggregates.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Instrument symbol (e.g. BTC_USDT, ETH_USDT, AAPL)',
        },
      },
      required: ['instrument'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const instrument = p.instrument as string;
      console.log(`[DataTools] get_market_data: ${instrument}`);

      // Fetch latest price from trade table
      const priceData = await getLatestPrice(instrument);

      // Fetch last 24 hours of 1h candles for 24h stats
      const rawCandles = await fetchCandlesFromCH(instrument, '1h', 24);
      const candles = rawCandles.reverse();

      if (candles.length === 0 && !priceData) {
        return {
          instrument,
          error: 'No market data available for this instrument.',
        };
      }

      const currentPrice = priceData?.price ?? (candles.length > 0 ? candles[candles.length - 1]!.close : 0);
      const openPrice24h = candles.length > 0 ? candles[0]!.open : currentPrice;
      const change24h = currentPrice - openPrice24h;
      const changePercent24h = openPrice24h > 0 ? (change24h / openPrice24h) * 100 : 0;
      const volume24h = candles.reduce((sum, c) => sum + c.volume, 0);
      const high24h = candles.reduce((max, c) => Math.max(max, c.high), 0);
      const low24h = candles.reduce((min, c) => Math.min(min, c.low), Infinity);

      return {
        instrument,
        price: currentPrice,
        change24h,
        changePercent24h: Math.round(changePercent24h * 100) / 100,
        volume24h,
        high24h,
        low24h: low24h === Infinity ? 0 : low24h,
        timestamp: priceData?.trade_time ?? new Date().toISOString(),
      };
    },
  },

  {
    name: 'get_orderbook',
    description:
      'Get the L2 order book snapshot for an instrument. Returns arrays of bids and asks (price + size), spread, and spread percentage. Data sourced from ClickHouse orderbook_snapshots table.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Instrument symbol',
        },
        depth: {
          type: 'number',
          description: 'Number of price levels per side (default: 20, max: 50)',
        },
      },
      required: ['instrument'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const depth = Math.min((p.depth as number) ?? 20, 50);
      const book = await getOrderBook({
        instrument: p.instrument as string,
        depth,
      });

      // Compute additional metrics
      const bidDepth = book.bids.reduce((sum, b) => sum + b.size, 0);
      const askDepth = book.asks.reduce((sum, a) => sum + a.size, 0);
      const imbalance = bidDepth + askDepth > 0
        ? (bidDepth - askDepth) / (bidDepth + askDepth)
        : 0;

      return {
        ...book,
        bidDepth,
        askDepth,
        imbalance: Math.round(imbalance * 10000) / 10000,
        levels: book.bids.length,
      };
    },
  },

  {
    name: 'get_economic_calendar',
    description:
      'Get upcoming economic calendar events (FOMC, CPI, NFP, GDP, etc.). Returns event name, date/time, currency, impact level, and forecast/previous/actual values. Currently returns mock data -- will be connected to a live calendar feed.',
    inputSchema: {
      type: 'object',
      properties: {
        days_ahead: {
          type: 'number',
          description: 'Number of days to look ahead (default: 7, max: 30)',
        },
        impact_filter: {
          type: 'string',
          enum: ['high', 'medium', 'low', 'all'],
          description: 'Minimum impact level to include (default: all)',
        },
        currency_filter: {
          type: 'string',
          description: 'ISO currency code to filter by (e.g. USD, EUR). Default: all currencies.',
        },
      },
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const daysAhead = Math.min((p.days_ahead as number) ?? 7, 30);
      const impactFilter = (p.impact_filter as string) ?? 'all';
      const currencyFilter = p.currency_filter as string | undefined;

      console.log(
        `[DataTools] get_economic_calendar: ${daysAhead} days, impact=${impactFilter}`,
      );

      // TODO: Integrate with real economic calendar API (e.g. ForexFactory, Investing.com, FRED)
      // Mock data representing typical upcoming events
      const now = new Date();
      const mockEvents: EconomicCalendarEvent[] = [
        {
          name: 'FOMC Interest Rate Decision',
          date: offsetDate(now, 3),
          time: '14:00 ET',
          currency: 'USD',
          impact: 'high',
          forecast: 5.25,
          previous: 5.25,
          actual: null,
        },
        {
          name: 'Non-Farm Payrolls',
          date: offsetDate(now, 5),
          time: '08:30 ET',
          currency: 'USD',
          impact: 'high',
          forecast: 175000,
          previous: 187000,
          actual: null,
        },
        {
          name: 'CPI (YoY)',
          date: offsetDate(now, 8),
          time: '08:30 ET',
          currency: 'USD',
          impact: 'high',
          forecast: 3.1,
          previous: 3.2,
          actual: null,
        },
        {
          name: 'ECB Interest Rate Decision',
          date: offsetDate(now, 4),
          time: '07:45 ET',
          currency: 'EUR',
          impact: 'high',
          forecast: 4.5,
          previous: 4.5,
          actual: null,
        },
        {
          name: 'ISM Manufacturing PMI',
          date: offsetDate(now, 2),
          time: '10:00 ET',
          currency: 'USD',
          impact: 'medium',
          forecast: 48.5,
          previous: 47.8,
          actual: null,
        },
        {
          name: 'Initial Jobless Claims',
          date: offsetDate(now, 1),
          time: '08:30 ET',
          currency: 'USD',
          impact: 'medium',
          forecast: 215000,
          previous: 211000,
          actual: null,
        },
        {
          name: 'Consumer Confidence',
          date: offsetDate(now, 6),
          time: '10:00 ET',
          currency: 'USD',
          impact: 'medium',
          forecast: 103.5,
          previous: 102.0,
          actual: null,
        },
        {
          name: 'Retail Sales (MoM)',
          date: offsetDate(now, 9),
          time: '08:30 ET',
          currency: 'USD',
          impact: 'medium',
          forecast: 0.3,
          previous: 0.6,
          actual: null,
        },
      ];

      let filtered = mockEvents.filter((e) => {
        const eventDate = new Date(e.date);
        const daysDiff = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        return daysDiff >= 0 && daysDiff <= daysAhead;
      });

      if (impactFilter !== 'all') {
        const impactOrder = { high: 3, medium: 2, low: 1 };
        const minImpact = impactOrder[impactFilter as keyof typeof impactOrder] ?? 0;
        filtered = filtered.filter(
          (e) => (impactOrder[e.impact] ?? 0) >= minImpact,
        );
      }

      if (currencyFilter) {
        filtered = filtered.filter(
          (e) => e.currency.toUpperCase() === currencyFilter.toUpperCase(),
        );
      }

      return {
        events: filtered,
        count: filtered.length,
        source: 'mock', // Will change to 'live' when connected
      };
    },
  },

  {
    name: 'get_news_sentiment',
    description:
      'Get aggregated news sentiment for an instrument or topic. Returns individual headline sentiments and an overall score (-1.0 to +1.0). Currently returns mock data -- will be connected to news API providers.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Instrument symbol (e.g. BTC_USDT, ETH_USDT)',
        },
        topic: {
          type: 'string',
          description: 'Optional topic to search for (e.g. "Bitcoin ETF", "Fed rate")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of news items to return (default: 10, max: 50)',
        },
      },
      required: ['instrument'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const instrument = p.instrument as string;
      const limit = Math.min((p.limit as number) ?? 10, 50);

      console.log(`[DataTools] get_news_sentiment: ${instrument}, limit=${limit}`);

      // TODO: Integrate with real news sentiment providers:
      //   CryptoPanic API - crypto-specific news with sentiment tags
      //   NewsAPI.org     - general news articles
      //   Twitter/X API   - social media sentiment
      //   Santiment       - on-chain + social sentiment

      // Mock data representing typical crypto news sentiment
      const now = new Date();
      const mockHeadlines: NewsSentiment[] = [
        {
          instrument,
          headline: `Institutional inflows into ${instrument.split('_')[0]} ETFs reach new weekly high`,
          source: 'CoinDesk',
          sentiment: 'bullish',
          score: 0.72,
          publishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          instrument,
          headline: `${instrument.split('_')[0]} trading volume surges amid market optimism`,
          source: 'CryptoSlate',
          sentiment: 'bullish',
          score: 0.55,
          publishedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        },
        {
          instrument,
          headline: 'Regulatory uncertainty continues to weigh on crypto markets',
          source: 'Bloomberg',
          sentiment: 'bearish',
          score: -0.45,
          publishedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        },
        {
          instrument,
          headline: `On-chain data shows ${instrument.split('_')[0]} whale accumulation`,
          source: 'Glassnode',
          sentiment: 'bullish',
          score: 0.62,
          publishedAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
        },
        {
          instrument,
          headline: 'DeFi TVL continues steady recovery across major protocols',
          source: 'The Block',
          sentiment: 'neutral',
          score: 0.15,
          publishedAt: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(),
        },
        {
          instrument,
          headline: 'Major exchange reports technical issues during peak hours',
          source: 'CoinTelegraph',
          sentiment: 'bearish',
          score: -0.30,
          publishedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const headlines = mockHeadlines.slice(0, limit);
      const avgScore =
        headlines.length > 0
          ? headlines.reduce((sum, h) => sum + h.score, 0) / headlines.length
          : 0;

      const bullishCount = headlines.filter((h) => h.sentiment === 'bullish').length;
      const bearishCount = headlines.filter((h) => h.sentiment === 'bearish').length;
      const neutralCount = headlines.filter((h) => h.sentiment === 'neutral').length;

      return {
        instrument,
        overallSentiment: avgScore > 0.2 ? 'bullish' : avgScore < -0.2 ? 'bearish' : 'neutral',
        overallScore: Math.round(avgScore * 100) / 100,
        headlines,
        summary: {
          total: headlines.length,
          bullish: bullishCount,
          bearish: bearishCount,
          neutral: neutralCount,
        },
        source: 'mock', // Will change to 'live' when connected
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return ISO date string offset by N days from the given date. */
function offsetDate(from: Date, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
