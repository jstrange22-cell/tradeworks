/**
 * Optional Claude API enhancement layer for the AI scout.
 *
 * When ANTHROPIC_API_KEY is set, the scout passes the deterministically
 * top-ranked candidates to Claude with current context (SPY trend, sector
 * heatmap snapshot derived from candle data) and asks Claude to pick the
 * final N from the larger pool with reasoning. This adds qualitative
 * judgment on top of momentum/volatility scoring.
 *
 * If ANTHROPIC_API_KEY is unset, this layer is skipped and the deterministic
 * top-N is used directly. The system works without it.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import type { ScoredTicker } from './scoring.js';

interface RerankResult {
  picks: string[];
  rationale: string;
}

const MODEL = 'claude-haiku-4-5-20251001'; // Fast + cheap for ranking task

export async function claudeRerank(
  candidates: ScoredTicker[],
  targetCount: number,
  marketContext: string,
  newsBlock: string,
  log: Logger,
): Promise<RerankResult | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    log.debug('ANTHROPIC_API_KEY not set — skipping Claude rerank');
    return null;
  }

  const client = new Anthropic({ apiKey });

  // Cap candidate pool to keep prompt small + cheap. Send top 60 by score.
  const pool = candidates.slice(0, 60);
  const candidateLines = pool
    .map(
      (c, i) =>
        `${i + 1}. ${c.ticker}: score=${c.score.toFixed(3)} rs5d=${(c.rs5d * 100).toFixed(1)}% rs20d=${(c.rs20d * 100).toFixed(1)}% atrExp=${c.atrExpansion.toFixed(2)}x`,
    )
    .join('\n');

  const newsSection = newsBlock ? `\n\n${newsBlock}\n` : '';
  const prompt = `You are a momentum trading scout. Pick the ${targetCount} tickers most likely to fire actionable BUY or SELL signals from a TradeVisor V2 indicator (Keltner-channel pullback engine, rewards range expansion + momentum continuation) over the next 4-8 hours of market action.

${marketContext}

Candidate pool (already filtered by liquidity, ranked by composite momentum + volatility expansion):
${candidateLines}${newsSection}

Selection priorities (in order):
1. Strong directional momentum (high |rs20d|) with continuing volatility expansion (atrExp > 1.0)
2. Catalysts in the news (earnings, FDA approvals, M&A, analyst upgrades/downgrades, regulatory changes) — pull these ahead of pure momentum names if news is fresh and material
3. Diversify across sectors — don't pick 10 tech names at the expense of finance/health/energy
4. Slight bias toward names with stronger 5-day RS (recency) when 20-day RS is similar
5. Avoid names where momentum and volatility tell conflicting stories (e.g. high RS but contracting ATR — likely topping)
6. Avoid names with NEGATIVE catalysts (regulatory action, fraud, downgrade) unless the rs20d is also negative (i.e. you're using them as short candidates)

Return ONLY a JSON object, no prose, in this exact shape:
{"picks": ["TICKER1", "TICKER2", ...], "rationale": "one-sentence summary of theme + any specific news drivers"}

The "picks" array must contain exactly ${targetCount} ticker symbols, each from the candidate pool above.`;

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      resp.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();

    // Extract first JSON object — Claude usually returns clean JSON but be defensive
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn({ text: text.slice(0, 200) }, 'Claude response did not contain JSON');
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as { picks?: string[]; rationale?: string };
    if (!Array.isArray(parsed.picks) || parsed.picks.length === 0) {
      log.warn({ parsed }, 'Claude response missing picks array');
      return null;
    }

    const validTickers = new Set(pool.map((c) => c.ticker));
    const picks = parsed.picks.filter((t): t is string => typeof t === 'string' && validTickers.has(t));
    if (picks.length < targetCount) {
      log.warn(
        { wanted: targetCount, got: picks.length, raw: parsed.picks },
        'Claude returned fewer valid picks than requested — falling back to deterministic top-N',
      );
      return null;
    }

    return {
      picks: picks.slice(0, targetCount),
      rationale: parsed.rationale ?? '',
    };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'Claude rerank threw — falling back to deterministic');
    return null;
  }
}

/**
 * Build a compact market-context string from SPY + sector ETF data the scout
 * already fetched. Keeps Claude's prompt grounded without external API calls.
 */
export function buildMarketContext(scored: ScoredTicker[]): string {
  const spy = scored.find((s) => s.ticker === 'SPY');
  const qqq = scored.find((s) => s.ticker === 'QQQ');
  const iwm = scored.find((s) => s.ticker === 'IWM');
  const xlk = scored.find((s) => s.ticker === 'XLK');

  const lines = ['Current market context:'];
  if (spy) lines.push(`- SPY: rs5d=${(spy.rs5d * 100).toFixed(1)}% rs20d=${(spy.rs20d * 100).toFixed(1)}% atrExp=${spy.atrExpansion.toFixed(2)}x`);
  if (qqq) lines.push(`- QQQ (Nasdaq): rs5d=${(qqq.rs5d * 100).toFixed(1)}% rs20d=${(qqq.rs20d * 100).toFixed(1)}%`);
  if (iwm) lines.push(`- IWM (small caps): rs5d=${(iwm.rs5d * 100).toFixed(1)}% rs20d=${(iwm.rs20d * 100).toFixed(1)}%`);
  if (xlk) lines.push(`- XLK (tech sector): rs5d=${(xlk.rs5d * 100).toFixed(1)}% rs20d=${(xlk.rs20d * 100).toFixed(1)}%`);

  return lines.join('\n');
}
