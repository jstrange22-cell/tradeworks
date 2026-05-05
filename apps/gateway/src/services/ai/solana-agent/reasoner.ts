/**
 * Solana DEX reasoner.
 *
 * Critical safety difference from the stocks-side TradeVisor reasoner: this
 * fails OPEN as VETO, not as APPROVE. Memecoin trading is too risky to
 * default to "fire" on any reasoning error — when in doubt, skip.
 *
 * System prompt is the same OpenClaw SOUL.md, with DEX-specific decision
 * criteria appended (hard caps, GoPlus/holder thresholds, escalation matrix
 * for institutional-sized trades).
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import type { SolanaSignalContext, SolanaDecision, SolanaDecisionVerdict } from './types.js';

let SOUL_PROMPT = '';
const candidatePaths = [
  resolve(process.cwd(), 'openclaw-finance/SOUL.md'),
  resolve(process.cwd(), '../../openclaw-finance/SOUL.md'),
  '/opt/tradeworks/openclaw-finance/SOUL.md',
];
for (const p of candidatePaths) {
  try { SOUL_PROMPT = readFileSync(p, 'utf-8'); break; } catch { /* try next */ }
}
if (!SOUL_PROMPT) {
  SOUL_PROMPT = 'You are APEX, the trading intelligence agent for TradeWorks built by Strange Digital Group. Be precise, quantitative, risk-aware.';
}

const REASONER_INSTRUCTIONS = `

## YOUR ROLE IN THIS REQUEST
You are evaluating a single Solana DEX token candidate from the v2 scanner. The candidate already passed hard filters (liquidity >$25K, age >30min, top-10 holders <40%, GoPlus security >=70, mint+freeze authority renounced) AND received an AI score >=0.70 from the scorer. Your job is binary: APPROVE the paper trade with a size, VETO it, or ESCALATE for human review.

## HARD CAPS (CANNOT BE OVERRIDDEN)
- Paper wallet starts at $5,000 (separate from stock paper)
- Max position size: $50 per trade
- Max concurrent positions: 10
- Daily loss circuit breaker: -5% ($250) — bot stops opening new for 24h
- AI score threshold: >=0.70 (already enforced before you see the candidate; treat scores between 0.70 and 0.85 with extra skepticism)
- GoPlus security score threshold: >=70 (already enforced)

## DECISION CRITERIA (all must align for APPROVE)
1. **Capital headroom**: paperLedger.openPositions < maxPositions, today's loss has not consumed >70% of dailyLossLimitUsd
2. **AI conviction**: AI score >=0.70. Stronger conviction (>=0.85) merits the full $50 size; 0.70-0.85 should size down to $25.
3. **No red flags surfaced by the AI scorer** that contradict approval
4. **Liquidity**: candidate.liquidityUsd >= $25,000 (sanity-check the filter pipeline; if it slipped through under-sized, VETO)
5. **Volume**: candidate.volume24hUsd >= candidate.liquidityUsd * 0.5 (token must have actual flow, not just sitting in a pool)
6. **Momentum**: priceChange1h between -20% and +50% (avoid both rugged tokens and parabolic blow-off tops that are about to mean-revert)

## ESCALATE (don't auto-act) when
- candidate.marketCapUsd > $1,000,000 (institutional-sized — out of scope for memecoin paper bot, want human review)
- AI scorer's redFlags array contains a flag (any red flag, even if score is high)
- Holder distribution shows top 1 holder >10% (concentrated whale risk; user should review)
- todayLossUsd is within 20% of dailyLossLimitUsd (one more bad trade trips the breaker; want human gate)

## VETO (skip the trade) when
- Any APPROVE criterion fails
- Volume <50% of liquidity (illiquid)
- priceChange1h outside -20% to +50%
- todayLossUsd already exceeds dailyLossLimitUsd
- openPositions >= maxPositions

## SIZING
- AI score 0.85+ -> $50
- AI score 0.70-0.85 -> $25
- Below 0.70 -> never approve (already enforced upstream; VETO if you see one)

## OUTPUT FORMAT
Respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "verdict": "approve" | "veto" | "escalate",
  "reasoning": "2-4 sentence explanation citing specific candidate fields + AI score + ledger state",
  "confidence": 0.0..1.0,
  "sizeUsd": null | 25 | 50
}

If verdict is "veto" or "escalate", sizeUsd should be null.
`;

const FULL_SYSTEM_PROMPT = SOUL_PROMPT + REASONER_INSTRUCTIONS;

function buildUserPrompt(ctx: SolanaSignalContext): string {
  const c = ctx.candidate;
  const a = ctx.aiScore;
  const l = ctx.paperLedger;
  const lines: string[] = [];

  lines.push(`CANDIDATE: ${c.symbol} (${c.name}) at mint ${c.mint.slice(0, 8)}...`);
  lines.push(`  price: $${c.priceUsd.toFixed(8)}, mcap: $${c.marketCapUsd.toFixed(0)}, liquidity: $${c.liquidityUsd.toFixed(0)}, volume24h: $${c.volume24hUsd.toFixed(0)}`);
  lines.push(`  age: ${c.ageMinutes.toFixed(0)}min, holders: ${c.holderCount}, top10HolderPct: ${(c.top10HolderPct * 100).toFixed(1)}%`);
  lines.push(`  goplusScore: ${c.goplusScore}, mintRenounced: ${c.mintRenounced}, freezeRenounced: ${c.freezeRenounced}`);
  lines.push(`  priceChange1h: ${(c.priceChange1h * 100).toFixed(1)}%, priceChange24h: ${(c.priceChange24h * 100).toFixed(1)}%`);

  lines.push('\nAI SCORER:');
  lines.push(`  score: ${a.score.toFixed(3)} (model: ${a.modelUsed})`);
  lines.push(`  reasoning: ${a.reasoning.slice(0, 400)}`);
  if (a.redFlags.length > 0) lines.push(`  RED FLAGS: ${a.redFlags.join('; ')}`);
  else lines.push(`  red flags: none surfaced`);

  lines.push('\nPAPER LEDGER:');
  lines.push(`  cash: $${l.cashUsd.toFixed(2)}, open: ${l.openPositions}/${l.maxPositions}`);
  lines.push(`  today's realized loss: $${l.todayRealizedUsd.toFixed(2)} (limit $${l.dailyLossLimitUsd.toFixed(2)})`);

  lines.push('\nDECIDE NOW. Return only the JSON object.');
  return lines.join('\n');
}

function parseDecision(raw: string): { verdict: SolanaDecisionVerdict; reasoning: string; confidence: number; sizeUsd: number | null } | null {
  const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = obj['verdict'];
    if (verdict !== 'approve' && verdict !== 'veto' && verdict !== 'escalate') return null;
    const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
    const confidence = typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : 0.5;
    const sizeRaw = obj['sizeUsd'];
    const sizeUsd = sizeRaw === null || sizeRaw === undefined
      ? null
      : typeof sizeRaw === 'number'
        ? Math.max(0, Math.min(50, sizeRaw))   // hard-clamp; never above $50 regardless of model output
        : null;
    return { verdict, reasoning, confidence, sizeUsd };
  } catch { return null; }
}

const MODEL = process.env['SOLANA_AGENT_MODEL'] ?? 'claude-sonnet-4-6';

// Fail-VETO baseline (DEX is too risky for fail-open-as-approve)
function failVeto(ctx: SolanaSignalContext, reason: string, latencyMs: number, modelUsed: string): SolanaDecision {
  return {
    id: randomUUID(),
    candidate: ctx.candidate,
    context: ctx,
    verdict: 'veto',
    reasoning: reason,
    confidence: 0.5,
    sizeUsd: null,
    modelUsed,
    reasoningLatencyMs: latencyMs,
    createdAt: new Date().toISOString(),
  };
}

export async function reasonAboutCandidate(ctx: SolanaSignalContext): Promise<SolanaDecision> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const startedAt = Date.now();

  if (!apiKey) {
    logger.warn('[SolanaAgent] ANTHROPIC_API_KEY not set — failing VETO');
    return failVeto(ctx, 'Reasoner skipped — no Anthropic API key. Defaulted to VETO per fail-veto safety.', 0, 'none');
  }

  try {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(ctx);
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: FULL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const parsed = parseDecision(text);
    const latencyMs = Date.now() - startedAt;

    if (!parsed) {
      logger.warn({ rawSnippet: text.slice(0, 300) }, '[SolanaAgent] reasoner unparseable — failing VETO');
      return failVeto(ctx, `Claude output unparseable, defaulted to VETO. Raw: ${text.slice(0, 200)}`, latencyMs, MODEL);
    }

    return {
      id: randomUUID(),
      candidate: ctx.candidate,
      context: ctx,
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      sizeUsd: parsed.sizeUsd,
      modelUsed: MODEL,
      reasoningLatencyMs: latencyMs,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, latencyMs }, '[SolanaAgent] reasoner threw — failing VETO');
    return failVeto(ctx, `Reasoner threw: ${msg}. Defaulted to VETO.`, latencyMs, MODEL);
  }
}
