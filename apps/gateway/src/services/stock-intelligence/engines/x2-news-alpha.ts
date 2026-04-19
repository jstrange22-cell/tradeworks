/**
 * X2: News/Sentiment Alpha — Alpaca News API Event-Driven Trades
 *
 * Uses Alpaca's news endpoint (v1beta1) for real-time event-driven signals.
 * Scans headlines for market-moving language patterns and sentiment.
 *
 * Filters:
 *   - Impact score > 0.7 (derived from keyword strength + source authority)
 *   - Strong sentiment (bullish or bearish, not neutral)
 *   - Recent (within last 2 hours) to avoid stale signals
 *   - Source quality weighting (WSJ, Bloomberg, Reuters higher than blogs)
 *
 * Auth: ALPACA_API_KEY / ALPACA_API_SECRET env vars
 * Endpoint: GET https://data.alpaca.markets/v1beta1/news
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

const ALPACA_KEY = process.env.ALPACA_API_KEY ?? '';
const ALPACA_SECRET = process.env.ALPACA_API_SECRET ?? '';

// Watchlist: liquid large-caps + key ETFs for macro moves
const NEWS_WATCHLIST = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META',
  'JPM', 'V', 'SPY', 'QQQ', 'IWM', 'XLE', 'XLF',
];

// Maximum age of news to consider (2 hours in milliseconds)
const MAX_NEWS_AGE_MS = 2 * 60 * 60 * 1000;

// Minimum impact score to generate a signal
const MIN_IMPACT_SCORE = 0.70;

// ── Sentiment Analysis ──────────────────────────────────────────────────

interface SentimentResult {
  direction: 'bullish' | 'bearish' | 'neutral';
  score: number;     // 0-1, strength of sentiment
  keywords: string[];
}

const BULLISH_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /beat(s|ing)?\s+expect/i, weight: 0.85 },
  { pattern: /record\s+(revenue|profit|earnings|high)/i, weight: 0.80 },
  { pattern: /upgrade[ds]?/i, weight: 0.75 },
  { pattern: /surge[ds]?|soar[eds]?|rally|rallies|rallied/i, weight: 0.70 },
  { pattern: /strong(er)?\s+(earnings|growth|demand|results|quarter)/i, weight: 0.75 },
  { pattern: /raise[ds]?\s+(guidance|forecast|outlook|dividend)/i, weight: 0.80 },
  { pattern: /approve[ds]?|approval|clearance/i, weight: 0.65 },
  { pattern: /partnership|acquisition|buyback|repurchase/i, weight: 0.60 },
  { pattern: /beat\s+(top|bottom)\s+line/i, weight: 0.80 },
  { pattern: /profit\s+(jump|surge|grow)/i, weight: 0.75 },
  { pattern: /positive\s+(surprise|results|data)/i, weight: 0.65 },
];

const BEARISH_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /miss(es|ed|ing)?\s+expect/i, weight: 0.85 },
  { pattern: /downgrade[ds]?/i, weight: 0.75 },
  { pattern: /plunge[ds]?|crash(es|ed)?|plummet[eds]?|tumble[ds]?/i, weight: 0.80 },
  { pattern: /warn(s|ed|ing)?|warning/i, weight: 0.70 },
  { pattern: /cut[s]?\s+(guidance|forecast|outlook|jobs|workforce|dividend)/i, weight: 0.80 },
  { pattern: /weak(er)?\s+(earnings|growth|demand|results|quarter)/i, weight: 0.75 },
  { pattern: /loss(es)?|decline[ds]?|drop[ps]?/i, weight: 0.55 },
  { pattern: /layoff[s]?|restructur/i, weight: 0.65 },
  { pattern: /lawsuit|investigation|probe|subpoena|fraud/i, weight: 0.70 },
  { pattern: /recall|safety\s+(concern|issue)|breach/i, weight: 0.65 },
  { pattern: /miss\s+(top|bottom)\s+line/i, weight: 0.80 },
  { pattern: /revenue\s+(miss|decline|drop|fall)/i, weight: 0.75 },
];

function analyzeSentiment(headline: string, summary: string): SentimentResult {
  const text = `${headline} ${summary}`.toLowerCase();
  let bullishScore = 0;
  let bearishScore = 0;
  const matchedKeywords: string[] = [];

  for (const { pattern, weight } of BULLISH_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      bullishScore += weight;
      matchedKeywords.push(match[0]);
    }
  }

  for (const { pattern, weight } of BEARISH_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      bearishScore += weight;
      matchedKeywords.push(match[0]);
    }
  }

  // Normalize scores: take the stronger sentiment
  const maxScore = Math.max(bullishScore, bearishScore);
  if (maxScore < 0.50) {
    return { direction: 'neutral', score: maxScore, keywords: matchedKeywords };
  }

  // Clear directional bias required
  const netSentiment = bullishScore - bearishScore;
  if (Math.abs(netSentiment) < 0.30) {
    return { direction: 'neutral', score: Math.abs(netSentiment), keywords: matchedKeywords };
  }

  return {
    direction: netSentiment > 0 ? 'bullish' : 'bearish',
    score: Math.min(1.0, Math.abs(netSentiment)),
    keywords: matchedKeywords,
  };
}

// ── Source Quality Scoring ───────────────────────────────────────────────

const HIGH_AUTHORITY_SOURCES = [
  'bloomberg', 'reuters', 'wall street journal', 'wsj', 'financial times',
  'cnbc', 'associated press', 'ap news', 'barron', 'marketwatch',
];

const MEDIUM_AUTHORITY_SOURCES = [
  'yahoo finance', 'seeking alpha', 'benzinga', 'thestreet', 'investopedia',
  'motley fool', 'zacks', 'tipranks',
];

function getSourceWeight(source: string): number {
  const srcLower = (source ?? '').toLowerCase();
  if (HIGH_AUTHORITY_SOURCES.some(s => srcLower.includes(s))) return 1.0;
  if (MEDIUM_AUTHORITY_SOURCES.some(s => srcLower.includes(s))) return 0.75;
  return 0.50;
}

// ── Impact Score Calculation ────────────────────────────────────────────

function calculateImpactScore(
  sentiment: SentimentResult,
  sourceWeight: number,
  ageMinutes: number,
): number {
  // Base from sentiment strength
  let impact = sentiment.score * 0.60;

  // Source authority boost
  impact += sourceWeight * 0.25;

  // Recency decay: fresher news = higher impact
  const recencyFactor = Math.max(0, 1 - (ageMinutes / 120)); // Decays to 0 over 2 hours
  impact += recencyFactor * 0.15;

  return Math.min(1.0, impact);
}

// ── Price Confirmation ──────────────────────────────────────────────────

async function getRecentPriceMove(symbol: string): Promise<{
  price: number;
  move5d: number;
  volumeSpike: boolean;
} | null> {
  try {
    const barsResp = await getBars({ symbols: [symbol], timeframe: '1Day', limit: 10 });
    const symbolBars = barsResp.bars[symbol];
    if (!symbolBars || symbolBars.length < 5) return null;

    const current = symbolBars[symbolBars.length - 1];
    const fiveDayAgo = symbolBars[symbolBars.length - 5];
    const move5d = (current.c - fiveDayAgo.c) / fiveDayAgo.c;

    // Check for volume spike (today vs 5-day average)
    const avgVol = symbolBars.slice(-5).reduce((s, b) => s + b.v, 0) / 5;
    const volumeSpike = current.v > avgVol * 1.5;

    return { price: current.c, move5d, volumeSpike };
  } catch {
    return null;
  }
}

// ── Alpaca News Types ───────────────────────────────────────────────────

interface AlpacaNewsArticle {
  id: number;
  headline: string;
  summary: string;
  author: string;
  source: string;
  url: string;
  symbols: string[];
  created_at: string;
  updated_at: string;
}

// ── Main Scanner ────────────────────────────────────────────────────────

export async function scanNewsAlpha(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  if (!ALPACA_KEY) {
    logger.warn('[X2] ALPACA_API_KEY not set — skipping news alpha scan');
    return opps;
  }

  try {
    // Fetch recent news from Alpaca
    const watchSymbols = NEWS_WATCHLIST.join(',');
    const res = await fetch(
      `https://data.alpaca.markets/v1beta1/news?symbols=${watchSymbols}&limit=20&sort=desc`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!res.ok) {
      logger.warn({ status: res.status }, '[X2] Alpaca News API returned error');
      return opps;
    }

    const data = await res.json() as { news: AlpacaNewsArticle[] };
    const articles = data.news ?? [];

    if (articles.length === 0) return opps;

    const now = Date.now();
    const processedSymbols = new Set<string>(); // Avoid duplicate signals per symbol

    for (const article of articles) {
      // Filter: skip articles without symbols
      if (!article.symbols || article.symbols.length === 0) continue;

      // Filter: skip stale news
      const articleAge = now - new Date(article.created_at).getTime();
      if (articleAge > MAX_NEWS_AGE_MS) continue;

      const ageMinutes = articleAge / 60_000;

      // Analyze sentiment
      const sentiment = analyzeSentiment(article.headline, article.summary ?? '');
      if (sentiment.direction === 'neutral') continue;

      // Calculate source quality
      const sourceWeight = getSourceWeight(article.source);

      // Calculate impact score
      const impactScore = calculateImpactScore(sentiment, sourceWeight, ageMinutes);
      if (impactScore < MIN_IMPACT_SCORE) continue;

      // Generate signals for relevant symbols from the article
      for (const symbol of article.symbols) {
        // Only process watchlist symbols
        if (!NEWS_WATCHLIST.includes(symbol)) continue;

        // One signal per symbol per scan cycle
        if (processedSymbols.has(symbol)) continue;
        processedSymbols.add(symbol);

        // Optional: get price confirmation
        let priceConfirmation = '';
        let priceBoost = 0;
        const priceData = await getRecentPriceMove(symbol);
        if (priceData) {
          const priceAligned =
            (sentiment.direction === 'bullish' && priceData.move5d > 0.01) ||
            (sentiment.direction === 'bearish' && priceData.move5d < -0.01);

          if (priceAligned) priceBoost = 5;
          if (priceData.volumeSpike) priceBoost += 3;

          priceConfirmation = ` Price: $${priceData.price.toFixed(2)}, 5d: ${(priceData.move5d * 100).toFixed(1)}%${priceData.volumeSpike ? ' [VOL SPIKE]' : ''}`;
        }

        const confidence = Math.min(78, 45 + impactScore * 25 + priceBoost);

        opps.push({
          id: randomUUID(),
          engine: 'X2',
          domain: 'cross',
          ticker: symbol,
          action: sentiment.direction === 'bullish' ? 'buy' : 'sell',
          price: priceData?.price ?? 0,
          suggestedSize: 0,
          maxSize: 3000,
          confidence,
          reasoning: `News Alpha: "${article.headline.slice(0, 100)}" [${article.source}] → ${sentiment.direction.toUpperCase()} ${symbol}. Impact: ${(impactScore * 100).toFixed(0)}%, keywords: [${sentiment.keywords.join(', ')}].${priceConfirmation}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    logger.info(
      { articles: articles.length, signals: opps.length },
      '[X2] News alpha scan complete',
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[X2] News alpha scan failed');
  }

  return opps;
}
