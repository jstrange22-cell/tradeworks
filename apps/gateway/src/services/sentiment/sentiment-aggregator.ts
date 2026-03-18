/**
 * Sentiment Aggregator — Phase 4
 *
 * Combines NLP, Reddit / ApeWisdom, and DexScreener social signals
 * into a single weighted SentimentScore.
 *
 * Weights:
 *   NLP (token metadata)     40%
 *   Reddit (ApeWisdom)        20%
 *   DexScreener (buy/sell)    40%
 *
 * All network calls fail gracefully — missing components are
 * redistributed proportionally.
 */

import { scoreText } from './nlp-scorer.js';
import { labelFromScore, type SentimentLabel } from './news-sentiment.js';
import {
  getRedditMentions,
  scoreRedditMention,
  scoreDexScreenerSocial,
} from './social-tracker.js';

// ── Types ────────────────────────────────────────────────────────────

export interface SentimentScore {
  score: number; // -100 to +100
  label: SentimentLabel;
  components: {
    nlpScore: number;
    redditScore: number;
    dexScreenerScore: number;
  };
  details: string[];
}

export interface SentimentParams {
  mint: string;
  symbol: string;
  name: string;
  description?: string;
  buys24h?: number;
  sells24h?: number;
  volume24h?: number;
}

// ── Clamp helper ────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Compute a composite sentiment score from all available free sources.
 */
export async function getSentiment(params: SentimentParams): Promise<SentimentScore> {
  const details: string[] = [];

  // ── NLP Score (always available) ──────────────────────────────────
  const textToScore = [params.name, params.symbol, params.description ?? ''].join(' ');
  const nlpResult = scoreText(textToScore);
  const nlpScore = nlpResult.score;

  if (nlpResult.matchedWords.length > 0) {
    details.push(`NLP matched: ${nlpResult.matchedWords.join(', ')} → ${nlpScore}`);
  } else {
    details.push('NLP: no lexicon matches in token metadata');
  }

  // ── Reddit / ApeWisdom Score ──────────────────────────────────────
  let redditScore = 0;
  let redditAvailable = false;

  try {
    const mention = await getRedditMentions(params.symbol);
    redditScore = scoreRedditMention(mention);
    redditAvailable = mention !== null;

    if (mention) {
      details.push(
        `Reddit: rank #${mention.rank}, ${mention.mentions} mentions → ${redditScore}`,
      );
    } else {
      details.push(`Reddit: ${params.symbol} not found on ApeWisdom`);
    }
  } catch {
    details.push('Reddit: ApeWisdom fetch failed');
  }

  // ── DexScreener Social Score ──────────────────────────────────────
  const dexSignal = scoreDexScreenerSocial(params.buys24h, params.sells24h);
  const dexScore = dexSignal.score;

  if (params.buys24h !== undefined || params.sells24h !== undefined) {
    details.push(
      `DexScreener: ${params.buys24h ?? 0}B/${params.sells24h ?? 0}S ` +
      `(ratio ${dexSignal.buySellRatio}) → ${dexScore}`,
    );
  } else {
    details.push('DexScreener: no buy/sell data provided');
  }

  // ── Weighted Composite ────────────────────────────────────────────
  // Base weights: NLP 40%, Reddit 20%, DexScreener 40%
  const hasDex = params.buys24h !== undefined || params.sells24h !== undefined;

  let wNlp = 0.4;
  let wReddit = redditAvailable ? 0.2 : 0;
  let wDex = hasDex ? 0.4 : 0;

  // Redistribute missing weights proportionally
  const totalWeight = wNlp + wReddit + wDex;
  if (totalWeight > 0 && totalWeight < 1) {
    const scale = 1 / totalWeight;
    wNlp *= scale;
    wReddit *= scale;
    wDex *= scale;
  }

  const raw = nlpScore * wNlp + redditScore * wReddit + dexScore * wDex;
  const finalScore = clamp(Math.round(raw), -100, 100);
  const label = labelFromScore(finalScore);

  details.push(`Composite: ${finalScore} (${label}) [NLP=${wNlp.toFixed(0)}% Reddit=${wReddit.toFixed(0)}% Dex=${wDex.toFixed(0)}%]`);

  return {
    score: finalScore,
    label,
    components: {
      nlpScore,
      redditScore,
      dexScreenerScore: dexScore,
    },
    details,
  };
}
