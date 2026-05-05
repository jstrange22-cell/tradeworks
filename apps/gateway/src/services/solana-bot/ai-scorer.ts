/**
 * AI scorer — Claude rates each surviving candidate 0..1.
 *
 * This is a *separate* Claude call from the agent reasoner. The scorer's
 * job is "would TradeWorks be willing to even consider this token?" — fast,
 * cheap (Haiku-tier), with a numeric output. The agent reasoner is the
 * heavier reasoning step that decides the final approve/veto/escalate
 * AFTER seeing the scorer's score + red flags.
 *
 * Per-mint cache keeps repeat scans cheap — same token within 10 min
 * returns the cached score.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../lib/logger.js';
import type { TokenCandidate } from '../ai/solana-agent/types.js';
import type { AiScore } from '../ai/solana-agent/types.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { score: AiScore; cachedAt: number }>();

const MODEL = process.env['SOLANA_SCORER_MODEL'] ?? 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are TradeWorks' Solana memecoin scorer. Given a token candidate's on-chain + market data, output a JSON object scoring whether the token is worth passing to the trading agent for a paper-trade decision.

Score 0..1 where:
- 0.0-0.4: Skip (likely rug, too thin, no momentum, suspicious metrics)
- 0.4-0.7: Borderline (some merit, real risks)
- 0.7-0.85: Reasonable candidate (clean metrics, real flow, no obvious red flags)
- 0.85-1.0: Strong candidate (clean metrics, accelerating volume, established holder base, organic momentum)

ALWAYS list any red flags you spot — even if score is high. Examples:
- liquidity:volume ratio off (over-promoted on Birdeye but low actual flow)
- price action looks parabolic (about to reverse)
- created very recently (high rug probability remaining)
- holder concentration unknown (data missing)
- name/symbol resembles a known scam pattern

Output ONLY a JSON object, no prose:
{
  "score": 0.0..1.0,
  "reasoning": "1-3 sentence explanation",
  "redFlags": ["specific red flag 1", "specific red flag 2"]
}`;

function buildUserPrompt(c: TokenCandidate): string {
  return [
    `TOKEN: ${c.symbol} (${c.name}) at ${c.mint.slice(0, 12)}...`,
    `Price: $${c.priceUsd}, MCap: $${c.marketCapUsd.toFixed(0)}, Liquidity: $${c.liquidityUsd.toFixed(0)}`,
    `Volume 24h: $${c.volume24hUsd.toFixed(0)} (vol/liq ratio: ${(c.volume24hUsd / Math.max(1, c.liquidityUsd)).toFixed(2)})`,
    `Age: ${c.ageMinutes.toFixed(0)} minutes`,
    `Price change 1h: ${(c.priceChange1h * 100).toFixed(1)}%, 24h: ${(c.priceChange24h * 100).toFixed(1)}%`,
    `Holders: ${c.holderCount > 0 ? c.holderCount : '(data unavailable)'}`,
    `Top 10 holder %: ${c.top10HolderPct > 0 ? (c.top10HolderPct * 100).toFixed(1) + '%' : '(data unavailable)'}`,
    `Mint authority renounced: ${c.mintRenounced}, Freeze renounced: ${c.freezeRenounced}`,
    '',
    'SCORE THIS TOKEN. Output ONLY the JSON object.',
  ].join('\n');
}

function parse(raw: string): { score: number; reasoning: string; redFlags: string[] } | null {
  const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const score = typeof obj['score'] === 'number' ? Math.max(0, Math.min(1, obj['score'])) : null;
    if (score === null) return null;
    const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
    const redFlags = Array.isArray(obj['redFlags']) ? (obj['redFlags'] as unknown[]).filter((x) => typeof x === 'string') as string[] : [];
    return { score, reasoning, redFlags };
  } catch { return null; }
}

export async function scoreCandidate(c: TokenCandidate): Promise<AiScore> {
  // Cache hit
  const cached = cache.get(c.mint);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.score;
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return {
      score: 0,
      reasoning: 'No Anthropic API key configured — scorer fails closed.',
      redFlags: ['no API key'],
      modelUsed: 'none',
      cachedAt: new Date().toISOString(),
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(c) }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const parsed = parse(text);
    const score: AiScore = parsed
      ? {
          score: parsed.score,
          reasoning: parsed.reasoning,
          redFlags: parsed.redFlags,
          modelUsed: MODEL,
          cachedAt: new Date().toISOString(),
        }
      : {
          score: 0,
          reasoning: `Unparseable scorer output: ${text.slice(0, 200)}`,
          redFlags: ['scorer output unparseable'],
          modelUsed: MODEL,
          cachedAt: new Date().toISOString(),
        };
    cache.set(c.mint, { score, cachedAt: Date.now() });
    return score;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, mint: c.mint.slice(0, 8) }, '[Scorer] Claude call threw');
    return {
      score: 0,
      reasoning: `Scorer threw: ${msg}`,
      redFlags: ['scorer error'],
      modelUsed: MODEL,
      cachedAt: new Date().toISOString(),
    };
  }
}
