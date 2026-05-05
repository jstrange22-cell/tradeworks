/**
 * Lesson extraction — call Claude Haiku with a tight, structured prompt
 * and parse the single JSON object it returns. One call per cluster.
 *
 * The contract:
 *   Input  → LossCluster (decisions + outcomes + cluster metadata)
 *   Output → LessonExtraction (single one-sentence rule + metadata)
 *
 * Failure modes are explicit:
 *   - No API key → return null (the runner logs and skips this cluster).
 *   - Unparseable response → return null.
 *   - Throws → return null. Never propagate.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../../lib/logger.js';
import type { LossCluster, LossExample } from './cluster-losses.js';
import type { LessonAppliesTo, LessonImpact } from './heuristics-store.js';

export interface LessonExtraction {
  lesson: string;
  evidence: string;
  appliesTo: LessonAppliesTo;
  impact: LessonImpact;
}

const MODEL = process.env['POST_MORTEM_MODEL'] ?? 'claude-haiku-4-5';
const MAX_TOKENS = 600;

const SYSTEM_PROMPT = `You are a trading post-mortem analyst. You read clusters of losing trades and extract a single, actionable, falsifiable heuristic per cluster that — if added to the trading agent's playbook — might prevent similar losses.

Output requirements:
- Return ONLY a single JSON object. No markdown fences, no prose before or after.
- The lesson must specify a CONDITION + ACTION (e.g. "Veto BUY in risk-off when scout rank > 30").
- The lesson must be FALSIFIABLE — concrete enough to test next time.
- The lesson must NOT be generic ("be careful in volatile markets" is NOT acceptable).
- If the cluster's signal is too weak to produce a meaningful lesson, set lesson to "INSUFFICIENT_SIGNAL" and explain why in evidence.`;

export interface ExtractClient {
  // Minimal subset of @anthropic-ai/sdk we use, so tests can mock easily.
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

function defaultClient(): ExtractClient | null {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null;
  return new Anthropic({ apiKey }) as unknown as ExtractClient;
}

function summarizeExample(e: LossExample): string {
  const sig = (e.decision.signal ?? {}) as Record<string, unknown>;
  const ctx = (e.decision.context ?? {}) as Record<string, unknown>;
  const macro = (ctx['macro'] ?? {}) as Record<string, unknown>;
  const scout = (ctx['scout'] ?? null) as Record<string, unknown> | null;
  const symbol = String(sig['symbol'] ?? '?');
  const action = String(sig['action'] ?? '?').toUpperCase();
  const grade = String(sig['grade'] ?? '?');
  const score = sig['score'];
  const regime = String(macro['regime'] ?? 'unknown');
  const verdict = e.decision.verdict ?? 'unknown';
  const conf = e.decision.confidence;
  const reasoning = (e.decision.reasoning ?? '').slice(0, 200);
  const r = e.outcome.rMultiple;
  const pnl = Number(e.outcome.realizedPnlUsd).toFixed(2);
  const exit = e.outcome.exitReason ?? 'n/a';
  const hold = e.outcome.holdingMinutes ?? 'n/a';
  const scoutLine = scout
    ? `scout-rank=${scout['rank']}/${scout['totalStocks']}`
    : 'scout=not-on-watchlist';
  return [
    `${action} ${symbol} grade=${grade}(${score ?? '?'}) regime=${regime} ${scoutLine}`,
    `  agent: verdict=${verdict} conf=${conf ?? '?'} reasoning="${reasoning}"`,
    `  outcome: pnl=$${pnl} R=${r ?? 'n/a'} exit=${exit} held=${hold}min`,
  ].join('\n');
}

export function buildClusterPrompt(cluster: LossCluster): string {
  const examples = cluster.examples.map((e, i) => `${i + 1}. ${summarizeExample(e)}`).join('\n\n');
  return [
    `Cluster: strategy=${cluster.strategy} | regime=${cluster.regime} | sector=${cluster.sectorBucket} | exit=${cluster.exitReason}`,
    `Total loss: $${cluster.totalLossUsd.toFixed(2)} across ${cluster.examples.length} trades`,
    `Average R: ${cluster.avgRMultiple === null ? 'n/a' : cluster.avgRMultiple.toFixed(2)}`,
    '',
    'Trades:',
    examples,
    '',
    'Output JSON:',
    '{ "lesson": "...", "evidence": "...", "applies_to": "buy|sell|all", "estimated_impact": "low|medium|high" }',
  ].join('\n');
}

function coerceAppliesTo(v: unknown): LessonAppliesTo {
  const s = String(v ?? '').toLowerCase();
  if (s === 'buy' || s === 'sell' || s === 'all') return s;
  return 'all';
}

function coerceImpact(v: unknown): LessonImpact {
  const s = String(v ?? '').toLowerCase();
  if (s === 'low' || s === 'medium' || s === 'high') return s;
  return 'low';
}

export function parseExtraction(raw: string): LessonExtraction | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const lesson = typeof obj['lesson'] === 'string' ? obj['lesson'].trim() : '';
    if (!lesson) return null;
    return {
      lesson,
      evidence: typeof obj['evidence'] === 'string' ? obj['evidence'] : '',
      appliesTo: coerceAppliesTo(obj['applies_to']),
      impact: coerceImpact(obj['estimated_impact']),
    };
  } catch {
    return null;
  }
}

/**
 * Call Claude with a single cluster. Returns null on any failure.
 * Tests inject `client` to mock the SDK.
 */
export async function extractLesson(
  cluster: LossCluster,
  client: ExtractClient | null = defaultClient(),
): Promise<LessonExtraction | null> {
  if (!client) {
    logger.warn('[post-mortem] extractLesson skipped — no Anthropic client');
    return null;
  }
  const userPrompt = buildClusterPrompt(cluster);
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp.content.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('').trim();
    const parsed = parseExtraction(text);
    if (!parsed) {
      logger.warn({ rawSnippet: text.slice(0, 200), clusterKey: cluster.key }, '[post-mortem] unparseable lesson');
      return null;
    }
    if (parsed.lesson === 'INSUFFICIENT_SIGNAL') {
      logger.info({ clusterKey: cluster.key, evidence: parsed.evidence }, '[post-mortem] cluster yielded no actionable lesson');
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, clusterKey: cluster.key },
      '[post-mortem] extractLesson threw',
    );
    return null;
  }
}
