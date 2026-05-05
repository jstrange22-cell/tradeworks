/**
 * Birdeye DEX data client.
 *
 * Free tier: 30 requests/minute on the trending endpoint. We use it as the
 * primary candidate firehose — DexScreener cross-reference + on-chain
 * holder data + GoPlus security check do the actual filtering downstream.
 *
 * BIRDEYE_API_KEY is required. Without it, fetchTrendingTokens returns
 * an empty array and the scanner cycle no-ops — same fail-closed pattern
 * as the rest of the v2 architecture.
 */
import { logger } from '../../lib/logger.js';

const API_BASE = 'https://public-api.birdeye.so';
const MIN_GAP_MS = 1100; // ~54/min, well under 60/min limit

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export interface BirdeyeTokenRow {
  address: string;        // mint
  symbol: string;
  name: string;
  price: number;
  priceChange24h: number;  // pct
  volume24hUSD: number;
  liquidity: number;
  marketCap: number;
  decimals: number;
  // many more fields exist; we only care about these
}

export async function fetchTrendingTokens(limit = 50): Promise<BirdeyeTokenRow[]> {
  const apiKey = process.env['BIRDEYE_API_KEY'];
  if (!apiKey) {
    logger.warn('[Birdeye] BIRDEYE_API_KEY not set — returning empty trending list');
    return [];
  }
  await throttle();
  // Trending endpoint — sort by 24h volume desc gives liquid candidates first.
  const url = `${API_BASE}/defi/token_trending?sort_by=volume24hUSD&sort_type=desc&offset=0&limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      if (res.status === 429) {
        logger.warn('[Birdeye] 429 — backing off, returning empty');
        await new Promise((r) => setTimeout(r, 5000));
        return [];
      }
      logger.warn({ status: res.status }, '[Birdeye] non-OK response');
      return [];
    }
    const json = (await res.json()) as { success?: boolean; data?: { tokens?: BirdeyeTokenRow[] } };
    if (!json.success || !json.data?.tokens) {
      logger.warn({ json }, '[Birdeye] unexpected response shape');
      return [];
    }
    return json.data.tokens;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[Birdeye] fetch failed');
    return [];
  }
}

/**
 * Token metadata lookup — used to compute age (creation time) and verify
 * mint/freeze authority renunciation. Cheaper than calling RPC directly.
 */
export interface BirdeyeTokenMeta {
  symbol: string;
  name: string;
  decimals: number;
  supply: number;
  // ms since epoch
  createdAt?: number;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
}

export async function fetchTokenMeta(mint: string): Promise<BirdeyeTokenMeta | null> {
  const apiKey = process.env['BIRDEYE_API_KEY'];
  if (!apiKey) return null;
  await throttle();
  const url = `${API_BASE}/defi/token_overview?address=${encodeURIComponent(mint)}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: BirdeyeTokenMeta };
    return json.success && json.data ? json.data : null;
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err, mint }, '[Birdeye] meta fetch failed');
    return null;
  }
}
