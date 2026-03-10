// ---------------------------------------------------------------------------
// Market Data Service — Crypto.com Public API
// ---------------------------------------------------------------------------

export const CRYPTO_API_BASE = 'https://api.crypto.com/exchange/v1/public';

export const INSTRUMENT_MAP: Record<string, string> = {
  'BTC-USD': 'BTC_USDT',
  'ETH-USD': 'ETH_USDT',
  'SOL-USD': 'SOL_USDT',
  'AVAX-USD': 'AVAX_USDT',
  'LINK-USD': 'LINK_USDT',
};

export const TRACKED_INSTRUMENTS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

export interface TickerData {
  instrument: string;
  last: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: number;
}

export async function fetchTicker(instrument: string): Promise<TickerData | null> {
  const apiName = INSTRUMENT_MAP[instrument];
  if (!apiName) return null;
  try {
    const res = await fetch(`${CRYPTO_API_BASE}/get-tickers?instrument_name=${apiName}`);
    const json = await res.json() as {
      code: number;
      result?: { data?: Array<{ a: string; c: string; h: string; l: string; vv: string }> };
    };
    if (json.code !== 0 || !json.result?.data?.length) return null;
    const d = json.result.data[0];
    return {
      instrument,
      last: parseFloat(d.a),
      change24h: parseFloat(d.c),
      high24h: parseFloat(d.h),
      low24h: parseFloat(d.l),
      volume: parseFloat(d.vv),
    };
  } catch (err) {
    console.warn(`[Engine] Ticker fetch failed for ${instrument}:`, err);
    return null;
  }
}

export async function fetchCandles(instrument: string): Promise<number[]> {
  const apiName = INSTRUMENT_MAP[instrument];
  if (!apiName) return [];
  try {
    const res = await fetch(`${CRYPTO_API_BASE}/get-candlestick?instrument_name=${apiName}&timeframe=1h`);
    const json = await res.json() as {
      code: number;
      result?: { data?: Array<{ c: string; t: number }> };
    };
    if (json.code !== 0 || !json.result?.data?.length) return [];
    // API returns newest first; reverse for indicator calculation
    return json.result.data
      .slice(0, 50)
      .reverse()
      .map((c) => parseFloat(c.c));
  } catch (err) {
    console.warn(`[Engine] Candle fetch failed for ${instrument}:`, err);
    return [];
  }
}
