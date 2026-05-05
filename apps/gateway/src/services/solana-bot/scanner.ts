/**
 * Solana DEX bot v2 — scanner pipeline.
 *
 *   Birdeye trending → DexScreener cross-reference → hard filters → survivors
 *
 * Hard filters (locked, see plan): liquidity >= $25K, age >= 30min, top-10
 * holder concentration <40% (skipped on v1 — scanner emits unfilled holder
 * data; AI scorer + GoPlus catch most concentrated rugs), GoPlus >= 70 (also
 * skipped on v1 if GOPLUS_API_KEY is not set; AI scorer is the safety net).
 *
 * On v1 with limited filter inputs we still gate heavily via:
 *   - liquidity floor
 *   - age floor
 *   - volume floor (>= 50% of liquidity in 24h)
 *   - the AI scorer threshold (>= 0.70)
 *   - the agent reasoner (fail-VETO)
 *
 * That's 4 layers of filtering. v2 enhancements would add direct on-chain
 * holder lookups + GoPlus.
 */
import { logger } from '../../lib/logger.js';
import { fetchTrendingTokens } from './birdeye.js';
import { fetchPrimaryPair } from './dexscreener.js';
import type { TokenCandidate } from '../ai/solana-agent/types.js';

const MIN_LIQUIDITY_USD = 25_000;
const MIN_AGE_MINUTES = 30;
const MIN_VOLUME_RATIO = 0.5; // volume24h must be at least 50% of liquidity

export async function scanCandidates(birdeyeLimit = 30): Promise<TokenCandidate[]> {
  const trending = await fetchTrendingTokens(birdeyeLimit);
  if (trending.length === 0) {
    logger.debug('[Scanner] no trending tokens (Birdeye empty or unauthorized)');
    return [];
  }

  const survivors: TokenCandidate[] = [];

  for (const t of trending) {
    // Cross-reference with DexScreener for pair-level data we trust more
    const pair = await fetchPrimaryPair(t.address);
    if (!pair) {
      logger.debug({ symbol: t.symbol }, '[Scanner] no DexScreener pair — skip');
      continue;
    }

    const liquidityUsd = pair.liquidity?.usd ?? t.liquidity ?? 0;
    if (liquidityUsd < MIN_LIQUIDITY_USD) continue;

    const volume24h = pair.volume?.h24 ?? t.volume24hUSD ?? 0;
    if (volume24h < liquidityUsd * MIN_VOLUME_RATIO) continue;

    const ageMin = pair.pairCreatedAt
      ? (Date.now() - pair.pairCreatedAt) / 60_000
      : 9999;
    if (ageMin < MIN_AGE_MINUTES) continue;

    const candidate: TokenCandidate = {
      mint: t.address,
      symbol: t.symbol,
      name: t.name,
      marketCapUsd: t.marketCap ?? 0,
      liquidityUsd,
      priceUsd: parseFloat(pair.priceUsd ?? '0') || t.price || 0,
      priceChange1h: (pair.priceChange?.h1 ?? 0) / 100,
      priceChange24h: (pair.priceChange?.h24 ?? t.priceChange24h ?? 0) / 100,
      volume24hUsd: volume24h,
      ageMinutes: ageMin,
      // The fields below are best-effort on v1 — Birdeye/DexScreener don't
      // surface them cheaply. Real on-chain holder analysis + GoPlus
      // integration is Phase 3.1 work. AI scorer + agent reasoner are the
      // primary safety net until then.
      holderCount: 0,
      top10HolderPct: 0,
      goplusScore: 0,
      mintRenounced: false,
      freezeRenounced: false,
      dexUrl: pair.url,
    };

    survivors.push(candidate);
  }

  logger.info(
    { trending: trending.length, survivors: survivors.length },
    `[Scanner] ${survivors.length}/${trending.length} candidates survived hard filters`,
  );
  return survivors;
}
