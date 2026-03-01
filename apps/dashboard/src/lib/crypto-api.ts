/**
 * Crypto.com Exchange Public API Client
 * Fetches live market data directly from Crypto.com's public REST API.
 * In development, requests are proxied through Vite to avoid CORS.
 *
 * Raw API field mappings (abbreviated single-char keys):
 * - Candle: o(open) h(high) l(low) c(close) v(volume) t(timestamp ms)
 * - Ticker: i(instrument) a(last) b(bid) k(ask) h(high) l(low) v(volume) vv(volumeValue) c(change) t(timestamp)
 * - Trade: d(tradeId) p(price) q(quantity) s(side) t(timestamp) i(instrument)
 * - Book: bids/asks arrays of [price, qty, count]
 */

const CRYPTO_API_BASE = '/crypto-api';

// --- Normalized types (what our app uses) ---

export interface CryptoTicker {
  instrument_name: string;
  last: string;
  best_bid: string;
  best_ask: string;
  change: string;
  high: string;
  low: string;
  volume: string;
  volume_value: string;
  timestamp: number;
}

export interface CryptoCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // ms epoch
}

export interface CryptoBookEntry {
  price: string;
  quantity: string;
  count: number;
}

export interface CryptoBook {
  bids: CryptoBookEntry[];
  asks: CryptoBookEntry[];
}

export interface CryptoTrade {
  trade_id: string;
  instrument_name: string;
  price: string;
  quantity: string;
  side: 'BUY' | 'SELL';
  timestamp: number;
}

// --- Instrument mapping ---

const INSTRUMENT_MAP: Record<string, string> = {
  'BTC-USD': 'BTC_USDT',
  'ETH-USD': 'ETH_USDT',
  'SOL-USD': 'SOL_USDT',
  'AVAX-USD': 'AVAX_USDT',
  'LINK-USD': 'LINK_USDT',
  'UNI-USD': 'UNI_USDT',
  'AAVE-USD': 'AAVE_USDT',
  'DOGE-USD': 'DOGE_USDT',
  'ADA-USD': 'ADA_USDT',
  'DOT-USD': 'DOT_USDT',
  'CRO-USD': 'CRO_USDT',
};

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1D',
};

export function toCryptoInstrument(displayName: string): string {
  return INSTRUMENT_MAP[displayName] || displayName.replace('-', '_');
}

export function toDisplayName(cryptoName: string): string {
  const entry = Object.entries(INSTRUMENT_MAP).find(([, v]) => v === cryptoName);
  return entry ? entry[0] : cryptoName.replace('_USDT', '-USD').replace('_', '-');
}

// --- Raw API call ---

async function fetchRaw(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${CRYPTO_API_BASE}/${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Crypto API error: ${res.status}`);

  const json = await res.json();
  // Crypto.com response: { id, method, code, result: { data: [...], ... } }
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(`Crypto API error code ${json.code}: ${json.method}`);
  }
  return json.result;
}

// --- Tickers ---

export async function getTicker(instrument: string): Promise<CryptoTicker> {
  const result = await fetchRaw('get-tickers', {
    instrument_name: toCryptoInstrument(instrument),
  }) as { data: Array<{ i: string; a: string; b: string; k: string; c: string; h: string; l: string; v: string; vv: string; t: number }> };

  const raw = result.data[0];
  return {
    instrument_name: raw.i,
    last: raw.a,
    best_bid: raw.b,
    best_ask: raw.k,
    change: raw.c,
    high: raw.h,
    low: raw.l,
    volume: raw.v,
    volume_value: raw.vv,
    timestamp: raw.t,
  };
}

export async function getMultipleTickers(instruments: string[]): Promise<CryptoTicker[]> {
  const results = await Promise.allSettled(
    instruments.map((inst) => getTicker(inst)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<CryptoTicker> => r.status === 'fulfilled')
    .map((r) => r.value);
}

// --- Candlesticks ---

export async function getCandlesticks(
  instrument: string,
  timeframe: string,
): Promise<CryptoCandle[]> {
  const result = await fetchRaw('get-candlestick', {
    instrument_name: toCryptoInstrument(instrument),
    timeframe: TIMEFRAME_MAP[timeframe] || timeframe,
  }) as { data: Array<{ o: string; h: string; l: string; c: string; v: string; t: number }> };

  return result.data.map((raw) => ({
    open: parseFloat(raw.o),
    high: parseFloat(raw.h),
    low: parseFloat(raw.l),
    close: parseFloat(raw.c),
    volume: parseFloat(raw.v),
    timestamp: raw.t,
  }));
}

// --- Order Book ---

export async function getOrderBook(instrument: string, depth?: number): Promise<CryptoBook> {
  const params: Record<string, string> = {
    instrument_name: toCryptoInstrument(instrument),
  };
  if (depth) params.depth = String(depth);

  const result = await fetchRaw('get-book', params) as {
    data: Array<{
      bids: Array<[string, string, string]>;
      asks: Array<[string, string, string]>;
    }>;
  };

  const raw = result.data[0];
  return {
    bids: (raw.bids || []).map(([price, qty, count]) => ({
      price,
      quantity: qty,
      count: parseInt(count, 10),
    })),
    asks: (raw.asks || []).map(([price, qty, count]) => ({
      price,
      quantity: qty,
      count: parseInt(count, 10),
    })),
  };
}

// --- Recent Trades ---

export async function getRecentTrades(instrument: string, count?: number): Promise<CryptoTrade[]> {
  const params: Record<string, string> = {
    instrument_name: toCryptoInstrument(instrument),
  };
  if (count) params.count = String(count);

  const result = await fetchRaw('get-trades', params) as {
    data: Array<{ d: string; p: string; q: string; s: string; t: number; i: string }>;
  };

  return result.data.map((raw) => ({
    trade_id: raw.d,
    instrument_name: raw.i,
    price: raw.p,
    quantity: raw.q,
    side: raw.s.toUpperCase() as 'BUY' | 'SELL',
    timestamp: raw.t,
  }));
}
