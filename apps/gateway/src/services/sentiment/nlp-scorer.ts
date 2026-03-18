/**
 * Crypto-Specific NLP Sentiment Scorer
 *
 * Hand-built lexicon-based scorer tuned for meme coin / DeFi token
 * names, descriptions, and social posts.  Zero external dependencies.
 *
 * Scoring:
 *   1. Tokenize input (lowercase, split on whitespace & punctuation).
 *   2. Match tokens (and bi-grams) against the crypto lexicon.
 *   3. Sum raw scores, then normalize to the -100..+100 range.
 */

// ── Crypto Lexicon ──────────────────────────────────────────────────

const CRYPTO_LEXICON: Record<string, number> = {
  // Strong positive
  moon: 3,
  moonshot: 3,
  gem: 3,
  bullish: 3,
  pump: 2,
  based: 2,
  wagmi: 2,
  diamond: 2,
  rocket: 2,
  lambo: 2,
  alpha: 2,
  chad: 2,
  degen: 1,
  ape: 1,
  send: 1,
  fire: 1,
  massive: 1,
  huge: 1,
  viral: 1,
  trending: 1,
  buy: 1,

  // Neutral-positive
  hodl: 1,
  hold: 0.5,
  community: 0.5,
  launched: 0.5,

  // Negative
  rug: -5,
  scam: -5,
  honeypot: -5,
  fake: -4,
  fraud: -4,
  dump: -3,
  bearish: -3,
  rekt: -3,
  ngmi: -2,
  dead: -3,
  sell: -1,
  crash: -3,
  ponzi: -5,
  exit: -2,
  hack: -4,
  exploit: -4,
  vulnerability: -3,
  warning: -2,
  caution: -2,
  suspicious: -3,
  avoid: -3,

  // Meme-coin quality signals
  utility: 2,
  roadmap: 1,
  doxxed: 2,
  audit: 2,
  locked: 2,
  renounced: 2,
  safu: 2,
  verified: 1,

  // Red-flag name patterns
  elon: -1,
  inu: -0.5,
  safe: -0.5,

  // Overpromise red flags
  guaranteed: -3,
};

/**
 * Multi-word phrases that should be scored as a unit.
 * Checked BEFORE individual tokens so the component words
 * don't double-count.
 */
const BIGRAM_LEXICON: Record<string, number> = {
  'stay away': -4,
  'red flag': -3,
  'free money': -4,
  '100x': -2,
  'x1000': -2,
  '1000x': -2,
};

// ── Tokenizer ───────────────────────────────────────────────────────

/**
 * Normalize and tokenize text into lowercase words.
 * Keeps alphanumeric characters; everything else becomes a split point.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// ── Public API ──────────────────────────────────────────────────────

export interface NLPResult {
  /** Clamped to -100..+100 */
  score: number;
  /** Words/phrases from the lexicon that matched */
  matchedWords: string[];
}

/**
 * Score a piece of text against the crypto sentiment lexicon.
 *
 * @param text  Token name, description, social post, etc.
 * @returns     Sentiment score and matched words list.
 */
export function scoreText(text: string): NLPResult {
  if (!text || text.trim().length === 0) {
    return { score: 0, matchedWords: [] };
  }

  const lowerText = text.toLowerCase();
  let rawScore = 0;
  const matchedWords: string[] = [];

  // Track positions consumed by bigram matches to avoid double-counting
  const consumedPositions = new Set<number>();

  // --- Bigram pass -------------------------------------------------------
  for (const [phrase, weight] of Object.entries(BIGRAM_LEXICON)) {
    let searchFrom = 0;
    let idx = lowerText.indexOf(phrase, searchFrom);
    while (idx !== -1) {
      rawScore += weight;
      if (!matchedWords.includes(phrase)) matchedWords.push(phrase);

      // Mark character positions as consumed
      for (let charIdx = idx; charIdx < idx + phrase.length; charIdx++) {
        consumedPositions.add(charIdx);
      }

      searchFrom = idx + phrase.length;
      idx = lowerText.indexOf(phrase, searchFrom);
    }
  }

  // --- Unigram pass ------------------------------------------------------
  const tokens = tokenize(text);
  let charCursor = 0;

  for (const token of tokens) {
    // Find this token's position in the original lowered text
    const tokenStart = lowerText.indexOf(token, charCursor);
    if (tokenStart !== -1) {
      charCursor = tokenStart + token.length;

      // Skip if any character of this token was consumed by a bigram
      let consumed = false;
      for (let ci = tokenStart; ci < tokenStart + token.length; ci++) {
        if (consumedPositions.has(ci)) {
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
    }

    const weight = CRYPTO_LEXICON[token];
    if (weight !== undefined) {
      rawScore += weight;
      if (!matchedWords.includes(token)) matchedWords.push(token);
    }
  }

  // --- Normalize to -100..+100 -------------------------------------------
  // Empirical cap: most token descriptions have 1-8 matches.
  // Scale so that a raw score of +/-15 maps to +/-100.
  const MAX_RAW = 15;
  const normalized = Math.round((rawScore / MAX_RAW) * 100);
  const clamped = Math.max(-100, Math.min(100, normalized));

  return { score: clamped, matchedWords };
}
