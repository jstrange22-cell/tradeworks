/**
 * Social Signal Tracker — Phase 4
 *
 * Aggregates free social-sentiment data:
 *   1. ApeWisdom API  — top-mentioned crypto on Reddit (free, no key).
 *   2. DexScreener buy/sell ratio passthrough — avoids re-fetching.
 *
 * All network calls fail gracefully and return null on error.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface RedditMention {
  name: string;
  rank: number;
  mentions: number;
  upvotes: number;
  rank24hAgo: number;
  mentions24hAgo: number;
}

export interface DexSocialSignal {
  buySellRatio: number; // buys / sells (>1 = buying pressure)
  score: number;        // -100 to +100
}

// ── ApeWisdom Cache ──────────────────────────────────────────────────

interface ApeWisdomEntry {
  name: string;
  rank: number;
  mentions: number;
  upvotes: number;
  rank_24h_ago: number;
  mentions_24h_ago: number;
}

interface ApeWisdomResponse {
  results: ApeWisdomEntry[];
}

interface ApeWisdomCache {
  data: ApeWisdomEntry[];
  fetchedAt: number;
}

let apeWisdomCache: ApeWisdomCache | null = null;
const APE_CACHE_TTL_MS = 15 * 60_000; // 15 minutes

async function fetchApeWisdomList(): Promise<ApeWisdomEntry[]> {
  // Return cache if fresh
  if (apeWisdomCache && Date.now() - apeWisdomCache.fetchedAt < APE_CACHE_TTL_MS) {
    return apeWisdomCache.data;
  }

  try {
    const response = await fetch('https://apewisdom.io/api/v1.0/filter/all-crypto/page/1', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return apeWisdomCache?.data ?? [];

    const body = (await response.json()) as ApeWisdomResponse;
    const results = Array.isArray(body?.results) ? body.results : [];

    apeWisdomCache = { data: results, fetchedAt: Date.now() };
    return results;
  } catch {
    // Network failure — return stale cache or empty
    return apeWisdomCache?.data ?? [];
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Look up a symbol on ApeWisdom's Reddit mention tracker.
 *
 * @param symbol  Token ticker (e.g. "SOL", "BONK").
 * @returns       Reddit mention data or null if not found / error.
 */
export async function getRedditMentions(symbol: string): Promise<RedditMention | null> {
  const list = await fetchApeWisdomList();
  const upper = symbol.toUpperCase();

  const match = list.find(
    (entry) => entry.name.toUpperCase() === upper,
  );

  if (!match) return null;

  return {
    name: match.name,
    rank: match.rank,
    mentions: match.mentions,
    upvotes: match.upvotes,
    rank24hAgo: match.rank_24h_ago,
    mentions24hAgo: match.mentions_24h_ago,
  };
}

/**
 * Score Reddit mention data into a -100..+100 signal.
 *
 * Heuristics:
 *   - Top-50 rank  → base boost (+20 to +50 depending on rank)
 *   - Mentions trending UP in 24h → additional +10..+30
 *   - Mentions trending DOWN      → penalty -10..-20
 */
export function scoreRedditMention(mention: RedditMention | null): number {
  if (!mention) return 0; // no data = neutral

  let score = 0;

  // Rank bonus (1 = top, 50 = barely notable)
  if (mention.rank <= 10) score += 50;
  else if (mention.rank <= 25) score += 35;
  else if (mention.rank <= 50) score += 20;
  else score += 5; // ranked but outside top 50

  // Mention momentum
  const prevMentions = mention.mentions24hAgo || 1;
  const mentionDelta = (mention.mentions - prevMentions) / prevMentions;

  if (mentionDelta > 1.0) score += 30;       // >100% increase
  else if (mentionDelta > 0.5) score += 20;  // >50% increase
  else if (mentionDelta > 0.1) score += 10;  // >10% increase
  else if (mentionDelta < -0.3) score -= 20; // >30% decrease
  else if (mentionDelta < -0.1) score -= 10; // >10% decrease

  return Math.max(-100, Math.min(100, score));
}

/**
 * Convert DexScreener buy/sell transaction counts into a sentiment score.
 *
 * Mapping:
 *   buys:sells = 3:1 → +75
 *   buys:sells = 1:1 → 0
 *   buys:sells = 1:3 → -75
 */
export function scoreDexScreenerSocial(
  buys24h: number | undefined,
  sells24h: number | undefined,
): DexSocialSignal {
  const buys = buys24h ?? 0;
  const sells = sells24h ?? 0;
  const total = buys + sells;

  if (total === 0) return { buySellRatio: 0, score: 0 };

  const ratio = sells > 0 ? buys / sells : buys > 0 ? 10 : 0;

  // Map ratio to score: ratio 1 = 0, ratio 3 = +75, ratio 0.33 = -75
  // Using log scale for symmetry: score = 75 * log2(ratio) clamped
  let score: number;
  if (ratio <= 0) {
    score = -100;
  } else {
    score = Math.round(75 * Math.log2(ratio));
  }

  return {
    buySellRatio: Math.round(ratio * 100) / 100,
    score: Math.max(-100, Math.min(100, score)),
  };
}
