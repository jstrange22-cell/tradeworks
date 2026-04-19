/**
 * Coinbase Advanced Trade API — OHLCV Candle Fetcher
 *
 * Fetches real intraday candles (1h/4h/1D) from Coinbase's public market data endpoint.
 * No authentication required for public market data.
 *
 * Why this exists: Tradevisor was using CoinGecko daily candles which meant indicators
 * barely moved (30 bars, no volume, single timeframe). This module provides the data
 * quality needed for real multi-timeframe TradingView-style analysis.
 */

import { logger } from '../../lib/logger.js';
import type { OHLCV } from './types.js';

export type Granularity = 'ONE_HOUR' | 'FOUR_HOUR' | 'ONE_DAY';

const GRANULARITY_SECONDS: Record<Granularity, number> = {
  ONE_HOUR: 3_600,
  FOUR_HOUR: 14_400,
  ONE_DAY: 86_400,
};

// In-memory cache — different TTLs per timeframe to balance freshness vs API load
interface CacheEntry { candles: OHLCV[]; fetchedAt: number; }
const cache = new Map<string, CacheEntry>();
const TTL_MS: Record<Granularity, number> = {
  ONE_HOUR: 300_000,      // 5 min — fresh enough for 1h signals
  FOUR_HOUR: 900_000,     // 15 min
  ONE_DAY: 3_600_000,     // 1 hour
};

/**
 * Fetch OHLCV candles from Coinbase Advanced Trade API.
 * Coinbase returns newest-first; we normalize to oldest-first for indicator libraries.
 */
export async function fetchCoinbaseCandles(
  symbol: string,
  granularity: Granularity,
  limit = 200,
): Promise<OHLCV[] | null> {
  const product = `${symbol.toUpperCase()}-USD`;
  const cacheKey = `${product}:${granularity}`;
  const now = Date.now();

  // Cache hit
  const cached = cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < TTL_MS[granularity]) {
    return cached.candles;
  }

  try {
    const end = Math.floor(now / 1000);
    const start = end - (GRANULARITY_SECONDS[granularity] * limit);
    const url = `https://api.coinbase.com/api/v3/brokerage/market/products/${product}/candles`
      + `?start=${start}&end=${end}&granularity=${granularity}&limit=${limit}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      // 404 is common for unlisted pairs — don't spam logs
      if (res.status !== 404) {
        logger.warn({ symbol, granularity, status: res.status }, '[CoinbaseCandles] Fetch failed');
      }
      return null;
    }

    const data = await res.json() as {
      candles?: Array<{
        start: string;
        low: string;
        high: string;
        open: string;
        close: string;
        volume: string;
      }>;
    };

    if (!data.candles || data.candles.length === 0) {
      return null;
    }

    // Coinbase returns newest-first — reverse to oldest-first for indicator libraries
    const candles: OHLCV[] = data.candles
      .slice()
      .reverse()
      .map(c => ({
        timestamp: parseInt(c.start, 10) * 1000,
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: parseFloat(c.volume), // REAL volume from exchange (fixes broken 0 volume)
      }));

    cache.set(cacheKey, { candles, fetchedAt: now });
    return candles;
  } catch (err) {
    logger.warn(
      { symbol, granularity, err: err instanceof Error ? err.message : err },
      '[CoinbaseCandles] Exception',
    );
    return null;
  }
}

/**
 * Fetch 1h + 4h + 1D candles for a symbol in parallel.
 * Returns all three or null if any fail.
 */
export async function fetchMultiTimeframe(symbol: string): Promise<{
  h1: OHLCV[];
  h4: OHLCV[];
  d1: OHLCV[];
} | null> {
  const [h1, h4, d1] = await Promise.all([
    fetchCoinbaseCandles(symbol, 'ONE_HOUR', 200),   // ~8 days of hourly
    fetchCoinbaseCandles(symbol, 'FOUR_HOUR', 200),  // ~33 days of 4h
    fetchCoinbaseCandles(symbol, 'ONE_DAY', 100),    // ~100 days of daily
  ]);

  if (!h1 || !h4 || !d1) return null;
  if (h1.length < 50 || h4.length < 50 || d1.length < 30) {
    logger.warn(
      { symbol, h1: h1.length, h4: h4.length, d1: d1.length },
      '[CoinbaseCandles] Insufficient candle data',
    );
    return null;
  }

  return { h1, h4, d1 };
}

/** Clear cache (for testing / manual refresh) */
export function clearCoinbaseCandleCache(): void {
  cache.clear();
}
