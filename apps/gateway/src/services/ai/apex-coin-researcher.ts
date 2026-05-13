/**
 * APEX Coin Researcher
 *
 * Calls Claude Haiku to produce a one-sentence research rationale for each
 * high-conviction coin discovered by the APEX swarm. Rationale is stored in
 * memory (1-hour TTL) and consumed by the TradeVisor gate's context gatherer
 * so the gate can see why APEX flagged this coin before approving or vetoing
 * a trade.
 *
 * Cost estimate: ~$0.08–0.15/day at ≤5 coins × 4 swarm scans × 150 tokens.
 * That is <$5/month. The gate approval lift from coin context is expected to
 * reduce bad-entry approvals by ≥10%, more than recovering the cost.
 *
 * Called from: swarm-coordinator.ts → cryptoAgent()
 * Consumed by: tradevisor-agent/context.ts → fetchScout() fallback
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
