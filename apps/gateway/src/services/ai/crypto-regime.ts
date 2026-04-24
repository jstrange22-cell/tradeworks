/**
 * BTC regime multiplier — mirror of stock SPY regime. Throttles position
 * sizing when BTC trend weakens, since most crypto is correlated to BTC.
 *
 *   BTC above 20MA AND 50MA → 1.0x  (uptrend, full size)
 *   Above 20MA, below 50MA   → 0.7x  (cautious)
 *   Below 20MA               → 0.5x  (defensive)
 *
 * Cached for 1h to keep API usage polite. Fails safe to 1.0 on any error.
 */

import { logger } from '../../lib/logger.js';

const CACHE_TTL_MS = 60 * 60_000; // 1 hour
let cache: { value: number; fetchedAt: number } | null = null;

export async function getBTCRegimeMultiplier(): Promise<number> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=60&interval=daily',
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) {
      logger.warn({ status: res.status }, '[CryptoRegime] CoinGecko non-OK — fail-safe 1.0x');
      const fallback = 1.0;
      cache = { value: fallback, fetchedAt: Date.now() };
      return fallback;
    }

    const data = await res.json() as { prices?: Array<[number, number]> };
    const prices = (data.prices ?? []).map(p => p[1]);
    if (prices.length < 50) {
      logger.warn({ n: prices.length }, '[CryptoRegime] insufficient bars — fail-safe 1.0x');
      cache = { value: 1.0, fetchedAt: Date.now() };
      return 1.0;
    }

    const current = prices[prices.length - 1];
    const ma20 = prices.slice(-20).reduce((s, p) => s + p, 0) / 20;
    const ma50 = prices.slice(-50).reduce((s, p) => s + p, 0) / 50;

    let mult: number;
    if (current > ma20 && current > ma50) mult = 1.0;
    else if (current > ma20) mult = 0.7;
    else mult = 0.5;

    cache = { value: mult, fetchedAt: Date.now() };
    logger.info({ current, ma20: ma20.toFixed(0), ma50: ma50.toFixed(0), mult }, '[CryptoRegime] BTC regime multiplier');
    return mult;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[CryptoRegime] fetch failed — fail-safe 1.0x');
    const fallback = 1.0;
    cache = { value: fallback, fetchedAt: Date.now() };
    return fallback;
  }
}
