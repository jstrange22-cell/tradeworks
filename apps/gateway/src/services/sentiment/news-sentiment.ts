/**
 * News Sentiment — Phase 4
 *
 * Placeholder for future news API integration (CryptoPanic, LunarCrush, etc.).
 *
 * Currently scores token metadata (name + description) using the NLP scorer
 * as a proxy for "narrative quality." When a free API key is registered later,
 * the `getNewsSentiment` function can be extended to fetch real headlines.
 */

import { scoreText } from './nlp-scorer.js';

// ── Types ────────────────────────────────────────────────────────────

export type SentimentLabel =
  | 'very_bullish'
  | 'bullish'
  | 'neutral'
  | 'bearish'
  | 'very_bearish';

export interface NewsSentiment {
  score: number; // -100 to +100
  label: SentimentLabel;
  sources: string[];
  fetchedAt: number;
}

// ── Label from Score ─────────────────────────────────────────────────

export function labelFromScore(score: number): SentimentLabel {
  if (score >= 60) return 'very_bullish';
  if (score >= 20) return 'bullish';
  if (score > -20) return 'neutral';
  if (score > -60) return 'bearish';
  return 'very_bearish';
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get news-like sentiment for a token.
 *
 * Currently uses the token's own name + description as a proxy.
 * When CryptoPanic or similar free-tier key is available, extend
 * this function to fetch real headlines.
 *
 * @param symbol       Token ticker (e.g. "BONK").
 * @param name         Token display name.
 * @param description  Optional pump.fun / metadata description.
 */
export async function getNewsSentiment(
  symbol: string,
  name: string,
  description?: string,
): Promise<NewsSentiment> {
  const sources: string[] = [];

  // Score the token's own metadata as narrative quality
  const combined = [name, symbol, description ?? ''].join(' ');
  const nlpResult = scoreText(combined);

  if (nlpResult.matchedWords.length > 0) {
    sources.push('token-metadata-nlp');
  }

  // TODO: When a free CryptoPanic API key is registered, add:
  //   const headlines = await fetchCryptoPanicHeadlines(symbol);
  //   const headlineScore = scoreHeadlines(headlines);
  //   merge headlineScore into final score, add 'cryptopanic' to sources

  return {
    score: nlpResult.score,
    label: labelFromScore(nlpResult.score),
    sources: sources.length > 0 ? sources : ['no-sources'],
    fetchedAt: Date.now(),
  };
}
