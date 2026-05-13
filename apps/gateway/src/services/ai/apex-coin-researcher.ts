/**
 * APEX Researcher — per-asset Claude Haiku intelligence for gate context.
 *
 * Covers both crypto (coin discovery) and stocks (swing scanner signals).
 * Each researched asset gets a one-sentence AI rationale stored in a 1-hour
 * TTL cache. The TradeVisor gate's context gatherer reads this cache so
 * ctx.scout.rationale is specific to the asset being evaluated instead of a
 * generic global watchlist summary.
 *
 * Crypto path:  swarm-coordinator.ts → cryptoAgent()  → batchResearchCoins()
 * Stock path:   swarm-coordinator.ts → stocksAgent()  → batchResearchStocks()
 * Consumed by:  tradevisor-agent/context.ts → fetchScout()
 *
 * Cost estimate: ~$0.15–0.30/day combined (Haiku, cached 1h, ≤10 assets/scan).
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../lib/logger.js';

// ── Config ───────────────────────────────────────────────────────────────

const HAIKU_MODEL = process.env['APEX_RESEARCHER_MODEL'] ?? 'claude-haiku-4-5';
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour — swarm runs every 15 min so this stays fresh
const MAX_BATCH = 5;                   // research at most 5 coins per swarm tick

// ── Types ────────────────────────────────────────────────────────────────

export interface CoinResearchInput {
  symbol: string;
  name?: string;
  discoveryScore: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  sources?: string[];
}

interface RationaleEntry {
  rationale: string;
  researchedAt: number;
}

// ── State ────────────────────────────────────────────────────────────────

const rationaleCache = new Map<string, RationaleEntry>();

// Lazy-init client — only constructed when needed so the module can load on
// servers where ANTHROPIC_API_KEY isn't set (will fail gracefully at call time).
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  return _client;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Return cached rationale for a symbol, or null if not yet researched or expired.
 * Sync — safe to call from the context gatherer's synchronous path.
 */
export function getCoinRationale(symbol: string): string | null {
  const entry = rationaleCache.get(symbol.toUpperCase());
  if (!entry) return null;
  if (Date.now() - entry.researchedAt > CACHE_TTL_MS) {
    rationaleCache.delete(symbol.toUpperCase());
    return null;
  }
  return entry.rationale;
}

/**
 * Research one coin via Claude Haiku. Returns the rationale string (or empty on
 * failure). Caches result so repeated calls within 1h are instant.
 */
export async function researchCoin(coin: CoinResearchInput): Promise<string> {
  const key = coin.symbol.toUpperCase();
  const cached = getCoinRationale(key);
  if (cached) return cached;

  const prompt = buildPrompt(coin);

  try {
    const resp = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';
    // Trim to 200 chars so the gate prompt stays concise
    const rationale = raw.slice(0, 200);

    if (rationale) {
      rationaleCache.set(key, { rationale, researchedAt: Date.now() });
      logger.info(
        { symbol: coin.symbol, score: coin.discoveryScore, rationale },
        '[ApexResearcher] coin researched',
      );
    }

    return rationale;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, symbol: coin.symbol },
      '[ApexResearcher] Haiku call failed — skipping coin',
    );
    return '';
  }
}

/**
 * Research up to MAX_BATCH coins concurrently (fire-and-forget friendly).
 * Skips coins that are already cached. Errors per-coin are caught internally.
 */
export async function batchResearchCoins(coins: CoinResearchInput[]): Promise<void> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    // No key configured — skip silently (gate will show null scout for crypto)
    return;
  }

  const uncached = coins.filter((c) => !getCoinRationale(c.symbol)).slice(0, MAX_BATCH);
  if (uncached.length === 0) return;

  logger.info(
    { count: uncached.length, symbols: uncached.map((c) => c.symbol) },
    '[ApexResearcher] starting batch research',
  );

  await Promise.allSettled(uncached.map((c) => researchCoin(c)));
}

// ── Stock research ────────────────────────────────────────────────────────

/** Subset of SwingSignal used for Haiku research — avoid a circular import. */
export interface StockResearchInput {
  symbol: string;
  confidence: number;           // 0-100
  action: 'buy' | 'sell' | 'hold';
  reasons: string[];
  riskReward: number;
  indicators: {
    rsi14: number;
    macdCrossover: boolean;
    volumeRatio: number;
    atr14: number;
    priceVsEma200: number;
    bbPosition: number;
  };
}

/**
 * Research a single stock swing setup via Claude Haiku. Uses the same shared
 * cache as crypto so `getResearchRationale()` returns either.
 */
async function researchStock(signal: StockResearchInput): Promise<string> {
  const key = signal.symbol.toUpperCase();
  const cached = getCoinRationale(key); // same cache — key namespace is fine
  if (cached) return cached;

  const prompt = buildStockPrompt(signal);

  try {
    const resp = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : '';
    const rationale = raw.slice(0, 200);

    if (rationale) {
      rationaleCache.set(key, { rationale, researchedAt: Date.now() });
      logger.info(
        { symbol: signal.symbol, confidence: signal.confidence, rationale },
        '[ApexResearcher] stock researched',
      );
    }

    return rationale;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, symbol: signal.symbol },
      '[ApexResearcher] stock Haiku call failed — skipping',
    );
    return '';
  }
}

/**
 * Research a batch of stock swing signals concurrently (fire-and-forget).
 * Only researches buy/sell signals; skips holds and already-cached symbols.
 */
export async function batchResearchStocks(signals: StockResearchInput[]): Promise<void> {
  if (!process.env['ANTHROPIC_API_KEY']) return;

  // Only research actionable signals that aren't already cached
  const uncached = signals
    .filter((s) => s.action !== 'hold' && !getCoinRationale(s.symbol))
    .slice(0, MAX_BATCH);

  if (uncached.length === 0) return;

  logger.info(
    { count: uncached.length, symbols: uncached.map((s) => s.symbol) },
    '[ApexResearcher] starting stock batch research',
  );

  await Promise.allSettled(uncached.map((s) => researchStock(s)));
}

// ── Shared lookup (works for both crypto and stocks) ─────────────────────

/**
 * Return cached rationale for any asset (crypto or stock), or null if not
 * yet researched or expired. Sync — safe to call from synchronous paths.
 */
export function getResearchRationale(symbol: string): string | null {
  return getCoinRationale(symbol); // delegates to the existing cache function
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildPrompt(coin: CoinResearchInput): string {
  const parts: string[] = [];
  parts.push(`You are a crypto analyst writing a one-sentence briefing for a trading system.`);
  parts.push(`Coin: ${coin.symbol}${coin.name ? ` (${coin.name})` : ''}`);
  parts.push(`APEX discovery score: ${coin.discoveryScore}/100`);
  if (coin.priceChange24h !== undefined) {
    parts.push(`24h change: ${coin.priceChange24h >= 0 ? '+' : ''}${coin.priceChange24h.toFixed(1)}%`);
  }
  if (coin.volume24h !== undefined && coin.volume24h > 0) {
    parts.push(`24h volume: $${(coin.volume24h / 1_000_000).toFixed(1)}M`);
  }
  if (coin.marketCap !== undefined && coin.marketCap > 0) {
    parts.push(`Market cap: $${(coin.marketCap / 1_000_000_000).toFixed(2)}B`);
  }
  if (coin.sources && coin.sources.length > 0) {
    parts.push(`Discovery sources: ${coin.sources.join(', ')}`);
  }
  parts.push('');
  parts.push(
    'Write ONE sentence (max 150 chars) explaining why this coin is worth watching right now. ' +
    'Be specific and quantitative. No JSON. No prefix. Just the sentence.',
  );
  return parts.join('\n');
}

function buildStockPrompt(s: StockResearchInput): string {
  const parts: string[] = [];
  parts.push(`You are a quantitative equity analyst writing a one-sentence briefing for a trading system.`);
  parts.push(`Stock: ${s.symbol}`);
  parts.push(`Signal: ${s.action.toUpperCase()} (confidence ${s.confidence}%, R:R ${s.riskReward.toFixed(2)})`);
  parts.push(`RSI-14: ${s.indicators.rsi14.toFixed(1)}`);
  parts.push(`Volume ratio vs 20d avg: ${s.indicators.volumeRatio.toFixed(2)}x`);
  parts.push(`MACD crossover: ${s.indicators.macdCrossover ? 'YES' : 'no'}`);
  parts.push(`Price vs EMA-200: ${s.indicators.priceVsEma200 >= 0 ? '+' : ''}${s.indicators.priceVsEma200.toFixed(1)}%`);
  parts.push(`Bollinger position: ${(s.indicators.bbPosition * 100).toFixed(0)}% (0=lower band, 100=upper)`);
  if (s.reasons.length > 0) {
    parts.push(`Technical reasons: ${s.reasons.join('; ')}`);
  }
  parts.push('');
  parts.push(
    'Write ONE sentence (max 150 chars) explaining why this stock setup is worth taking right now. ' +
    'Be specific about the technical setup. No JSON. No prefix. Just the sentence.',
  );
  return parts.join('\n');
}
