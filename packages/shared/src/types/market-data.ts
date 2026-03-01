export type MarketType = 'crypto' | 'prediction' | 'equity';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  instrument: string;
  market: MarketType;
  exchange: string;
  price: number;
  quantity: number;
  side: 'buy' | 'sell' | 'unknown';
  timestamp: number;
  tradeId: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  instrument: string;
  market: MarketType;
  exchange: string;
  timestamp: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  midPrice: number;
  spread: number;
}

export interface MarketSnapshot {
  instrument: string;
  market: MarketType;
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  orderBook: OrderBook | null;
  candles: Record<Timeframe, OHLCV[]>;
  timestamp: number;
}

export interface SentimentScore {
  instrument: string;
  source: string;
  score: number; // -1.0 to 1.0
  magnitude: number; // 0 to 1.0
  articleCount: number;
  timestamp: number;
}

export interface MacroEvent {
  name: string;
  date: string;
  impact: 'high' | 'medium' | 'low';
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  currency: string;
}
