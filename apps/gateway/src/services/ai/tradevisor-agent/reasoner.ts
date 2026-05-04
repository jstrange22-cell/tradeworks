/**
 * TradeVisor reasoner — wraps Claude with structured JSON output.
 *
 * Takes a fully-gathered SignalContext, builds a tight prompt, and asks
 * Claude (via @anthropic-ai/sdk) for a binary verdict + reasoning + adjusted
 * sizing/stop. Uses the JSON-mode pattern where Claude is instructed to
 * return ONLY a JSON object — we strip markdown fences and parse defensively.
 *
 * The system prompt is loaded from openclaw-finance/SOUL.md (same source as
 * apex-chat) so the reasoner inherits the full APEX identity, security
 * rules, regulatory compliance, and escalation matrix. This means the
 * reasoner already KNOWS to escalate trades >$50K, refuse to bypass
 * circuit breakers, etc.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../../../lib/logger.js';
import type { SignalContext, Decision, DecisionVerdict } from './types.js';
import { randomUUID } from 'crypto';

// ── Load SOUL.md once at module init ────────────────────────────────────
let SOUL_PROMPT = '';
const candidatePaths = [
  resolve(process.cwd(), 'openclaw-finance/SOUL.md'),
  resolve(process.cwd(), '../../openclaw-finance/SOUL.md'),
  '/opt/tradeworks/openclaw-finance/SOUL.md',
];
for (const p of candidatePaths) {
  try {
    SOUL_PROMPT = readFileSync(p, 'utf-8');
    break;
  } catch { /* try next */ }
}
if (!SOUL_PROMPT) {
  SOUL_PROMPT = 'You are APEX, the trading intelligence agent for TradeWorks built by Strange Digital Group. Be precise, quantitative, and risk-aware.';
}

// ── Reasoner-specific instructions (appended to SOUL) ──────────────────
const REASONER_INSTRUCTIONS = `

## YOUR ROLE IN THIS REQUEST
You are evaluating a single TradeVisor signal that just fired. The signal source is the user's paid TradeVisor V2 Pine indicator running on their TradingView chart, surfaced via the APEX Webhook Bridge.

Your job is binary: should the bot ACT on this signal (with what size and stop), or should it SKIP it, or should it ESCALATE to a human?

## DECISION CRITERIA (all must align for APPROVE)
1. **Portfolio room**: position count below cap, sector cap not breached, target symbol not already held (sells are exempt from "already held").
2. **Daily P&L room**: not within 0.5% of the daily loss limit.
3. **News sanity**: no breaking negative catalyst in the last 24h that contradicts the signal direction (e.g. SEC investigation announced 1h ago + BUY signal = VETO unless extraordinary upside).
4. **Macro alignment**: in 'risk-off' or 'crisis' regime, BUY signals require Scout rank in top 10 OR atrExpansion > 1.5x to APPROVE — otherwise VETO. SELL signals get extra weight in those regimes.
5. **Scout corroboration**: if the ticker is on the watchlist, prefer it. If it's NOT on the watchlist (came in via webhook only), require BOTH chart confluence AND clean news to APPROVE.

## ESCALATE (don't auto-act) when
- Stake size would exceed $5,000 OR 5% of portfolio (per SOUL.md escalation matrix)
- Macro regime is 'crisis'
- News contains regulatory action against the issuer (lawsuit, FDA rejection, fraud accusation)
- Signal contradicts an existing position (e.g. BUY signal on a ticker we just opened a SHORT/PUT on)
- Stop placement is unclear (no obvious chart structure to anchor it to)

## SIZING LADDER (default — adjust ±50% based on conviction)
- standard score=4 → $100 base
- strong score=5 → $250 base
- prime score=6 → $500 base

You MAY recommend SIZE = 0 alongside VETO to make the rejection unambiguous.

## OUTPUT FORMAT
Respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "verdict": "approve" | "veto" | "escalate",
  "reasoning": "2-4 sentence explanation citing specific context fields",
  "confidence": 0.0..1.0,
  "adjustedSizeUsd": null | number,
  "adjustedStopPct": -3.0..-10.0
}

If verdict is "veto" or "escalate", adjustedSizeUsd should typically be null and adjustedStopPct doesn't matter.
`;

const FULL_SYSTEM_PROMPT = SOUL_PROMPT + REASONER_INSTRUCTIONS;

// ── Build the per-signal user prompt ────────────────────────────────────
function buildUserPrompt(ctx: SignalContext): string {
  const s = ctx.signal;
  const lines: string[] = [];
  lines.push(`SIGNAL: ${s.action.toUpperCase()} ${s.symbol} @ $${s.price} (${s.assetClass})`);
  lines.push(`Source: ${s.sourceLabel ?? 'webhook'}, grade=${s.grade} (score=${s.score}), tf=${s.timeframe}, exchange=${s.exchange}`);

  lines.push('\nPORTFOLIO:');
  lines.push(`  cash: $${ctx.portfolio.cashUsd.toFixed(2)}, positions: ${ctx.portfolio.totalPositions}/${ctx.portfolio.maxPositions}`);
  lines.push(`  already-holding-${s.symbol}: ${ctx.portfolio.alreadyHolding ? 'YES' : 'no'}`);
  if (ctx.portfolio.equityPositions.length > 0) {
    const top = ctx.portfolio.equityPositions
      .slice(0, 8)
      .map((p) => `${p.symbol}(${p.sector},${p.unrealizedPnl >= 0 ? '+' : ''}$${p.unrealizedPnl.toFixed(0)})`)
      .join(', ');
    lines.push(`  open: ${top}`);
  }
  const sectorOfSymbol = ctx.portfolio.equityPositions.find((p) => p.symbol === s.symbol)?.sector
    ?? 'unknown';
  const sectorCount = ctx.portfolio.sectorCount[sectorOfSymbol] ?? 0;
  lines.push(`  sector(${sectorOfSymbol}) count: ${sectorCount}/${ctx.portfolio.sectorCap}`);

  lines.push('\nDAILY P&L:');
  lines.push(`  today realized: ${ctx.dailyPnl.pct >= 0 ? '+' : ''}${ctx.dailyPnl.pct.toFixed(2)}% (limit ${ctx.dailyPnl.limitPct}%, remaining headroom ${ctx.dailyPnl.remaining.toFixed(2)}%)`);

  lines.push('\nMACRO REGIME:');
  lines.push(`  ${ctx.macro.regime} — SPY rs5d=${(ctx.macro.spyRs5d * 100).toFixed(1)}% rs20d=${(ctx.macro.spyRs20d * 100).toFixed(1)}% (${ctx.macro.notes})`);

  lines.push('\nSCOUT WATCHLIST:');
  if (ctx.scout) {
    lines.push(`  rank #${ctx.scout.rank}/${ctx.scout.totalStocks} (${ctx.scout.refreshSource})`);
    lines.push(`  rs5d=${(ctx.scout.rs5d * 100).toFixed(1)}% rs20d=${(ctx.scout.rs20d * 100).toFixed(1)}% atrExp=${ctx.scout.atrExpansion.toFixed(2)}x`);
    if (ctx.scout.rationale) lines.push(`  Claude's pick rationale: ${ctx.scout.rationale.slice(0, 300)}`);
  } else {
    lines.push(`  ${s.symbol} NOT on the AI watchlist — webhook-driven signal only`);
  }

  lines.push('\nNEWS (last 24h):');
  if (ctx.news.length === 0) {
    lines.push('  no headlines in window');
  } else {
    for (const n of ctx.news.slice(0, 5)) {
      const ageStr = n.ageHours < 1 ? `${(n.ageHours * 60).toFixed(0)}m ago` : `${n.ageHours.toFixed(1)}h ago`;
      lines.push(`  [${ageStr} ${n.source}] ${n.headline}`);
    }
  }

  lines.push('\nCHART STATE:');
  if (ctx.chart) {
    lines.push(`  ${ctx.chart.matchedSymbol} on ${ctx.chart.resolution}`);
    if (Object.keys(ctx.chart.studyValues).length > 0) {
      lines.push(`  studies: ${JSON.stringify(ctx.chart.studyValues)}`);
    }
    if (ctx.chart.pineLines.length > 0) {
      lines.push(`  key levels: ${ctx.chart.pineLines.slice(0, 6).map((l) => `$${l.toFixed(2)}`).join(', ')}`);
    }
  } else {
    lines.push('  (chart MCP not available — bridge passed price + grade only)');
  }

  lines.push('\nDECIDE NOW. Return only the JSON object.');
  return lines.join('\n');
}

// ── Parse Claude's JSON output defensively ──────────────────────────────
function parseDecision(raw: string): { verdict: DecisionVerdict; reasoning: string; confidence: number; adjustedSizeUsd: number | null; adjustedStopPct: number } | null {
  const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = obj['verdict'];
    if (verdict !== 'approve' && verdict !== 'veto' && verdict !== 'escalate') return null;
    const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
    const confidence = typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : 0.5;
    const adjustedSizeUsd =
      obj['adjustedSizeUsd'] === null || obj['adjustedSizeUsd'] === undefined
        ? null
        : typeof obj['adjustedSizeUsd'] === 'number'
          ? obj['adjustedSizeUsd']
          : null;
    const stopRaw = obj['adjustedStopPct'];
    const adjustedStopPct = typeof stopRaw === 'number'
      ? Math.max(-10, Math.min(-1, stopRaw))
      : -5;
    return { verdict, reasoning, confidence, adjustedSizeUsd, adjustedStopPct };
  } catch {
    return null;
  }
}

// ── Public entry: reason about a signal, return a Decision ──────────────
const MODEL = process.env['TRADEVISOR_AGENT_MODEL'] ?? 'claude-sonnet-4-6';

export async function reasonAboutSignal(ctx: SignalContext): Promise<Decision> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const startedAt = Date.now();
  const id = randomUUID();
  const baseDecision: Omit<Decision, 'verdict' | 'reasoning' | 'confidence' | 'adjustedSize' | 'adjustedStopPct' | 'modelUsed' | 'reasoningLatencyMs'> = {
    id,
    signal: ctx.signal,
    context: ctx,
    createdAt: new Date().toISOString(),
  };

  // No API key → fail OPEN (approve with default sizing). The agent shouldn't
  // be a single point of failure that blocks all trading.
  if (!apiKey) {
    logger.warn('[TVAgent] ANTHROPIC_API_KEY not set — failing OPEN (auto-approve)');
    return {
      ...baseDecision,
      verdict: 'approve',
      reasoning: 'Reasoner skipped — no Anthropic API key configured. Defaulted to APPROVE per fail-open policy.',
      confidence: 0.5,
      adjustedSize: null,
      adjustedStopPct: -5,
      modelUsed: 'none',
      reasoningLatencyMs: 0,
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(ctx);
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: FULL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    const parsed = parseDecision(text);
    const latencyMs = Date.now() - startedAt;

    if (!parsed) {
      logger.warn({ rawSnippet: text.slice(0, 300) }, '[TVAgent] reasoner returned unparseable output — failing OPEN');
      return {
        ...baseDecision,
        verdict: 'approve',
        reasoning: `Claude output unparseable, defaulted to APPROVE. Raw: ${text.slice(0, 200)}`,
        confidence: 0.3,
        adjustedSize: null,
        adjustedStopPct: -5,
        modelUsed: MODEL,
        reasoningLatencyMs: latencyMs,
      };
    }

    return {
      ...baseDecision,
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      adjustedSize: parsed.adjustedSizeUsd,
      adjustedStopPct: parsed.adjustedStopPct,
      modelUsed: MODEL,
      reasoningLatencyMs: latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    logger.warn({ err: err instanceof Error ? err.message : err, latencyMs }, '[TVAgent] reasoner threw — failing OPEN');
    return {
      ...baseDecision,
      verdict: 'approve',
      reasoning: `Reasoner threw: ${err instanceof Error ? err.message : String(err)}. Defaulted to APPROVE.`,
      confidence: 0.3,
      adjustedSize: null,
      adjustedStopPct: -5,
      modelUsed: MODEL,
      reasoningLatencyMs: latencyMs,
    };
  }
}
