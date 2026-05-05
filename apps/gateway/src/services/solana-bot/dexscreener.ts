/**
 * DexScreener cross-reference for Solana token candidates.
 *
 * No API key required. Used to verify Birdeye's liquidity/volume claims and
 * grab pair-level data the agent uses for sizing decisions. Free tier is
 * generous (300 req/min) so no throttling needed at our volume.
 */
import { logger } from '../../lib/logger.js';

export interface DexScreenerPair {
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number };
  priceChange?: { h1?: number; h24?: number };
  pairCreatedAt?: number; // ms since epoch
  url?: string;
  txns?: { h1?: { buys: number; sells: number }; h24?: { buys: number; sells: number } };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

export async function fetchTokenPairs(mint: string): Promise<DexScreenerPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const json = (await res.json()) as DexScreenerResponse;
    if (!json.pairs) return [];
    // Solana-only pairs, sort by liquidity desc so we work with the deepest pool
    return json.pairs
      .filter((p) => (p as { chainId?: string }).chainId === 'solana' || !(p as { chainId?: string }).chainId)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err, mint }, '[DexScreener] fetch failed');
    return [];
  }
}

/**
 * Pull the deepest pool's data for a token. Returns null when no Solana
 * pairs exist for the mint (very new tokens before DexScreener indexes them).
 */
export async function fetchPrimaryPair(mint: string): Promise<DexScreenerPair | null> {
  const pairs = await fetchTokenPairs(mint);
  return pairs.length > 0 ? pairs[0]! : null;
}
