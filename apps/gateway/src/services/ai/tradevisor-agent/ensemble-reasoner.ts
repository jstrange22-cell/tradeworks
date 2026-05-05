/**
 * Ensemble TradeVisor reasoner — fans out the same SignalContext prompt to
 * Claude / GPT-4o / Gemini in parallel, parses each model's JSON verdict,
 * and applies consensus rules to produce a single Decision.
 *
 * Disagreement = quality signal. 3-way splits ALWAYS escalate.
 *
 * Designed to slot in next to the existing solo `reasonAboutSignal()` —
 * both functions return the same Decision shape so the caller can switch
 * via TRADEVISOR_REASONER_MODE without touching the gate.
 *
 * Cost control: respects TRADEVISOR_DAILY_AI_BUDGET_USD. When breached,
 * the ensemble auto-falls back to solo (Claude alone).
 *
 * Fail policy: respects TRADEVISOR_FAIL_MODE=closed|open. When 2+ models
 * fail and fail-mode is closed, returns a VETO. With fail-open, falls back
 * to whatever single response we have (or auto-approve if all 3 failed).
 */
import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import {
  callModelsParallel,
  detectConsensus,
  isEnabled,
  recordEnsembleSpend,
  isOverBudget,
} from '../ensemble/index.js';
import type { ModelResponse, EnsembleModelName } from '../ensemble/index.js';
import type { ModelVerdict } from '../ensemble/consensus.js';
import { reasonAboutSignal } from './reasoner.js';
import { buildEnsembleSystemPrompt, buildEnsembleUserPrompt } from './ensemble-prompt.js';
import type { Decision, DecisionVerdict, SignalContext } from './types.js';

const DEFAULT_PER_MODEL_TIMEOUT_MS = 8_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 12_000;

const FAIL_MODE: 'open' | 'closed' =
  process.env['TRADEVISOR_FAIL_MODE'] === 'open' ? 'open' : 'closed';

// Models the ensemble fans out to. DeepSeek is excluded by default — it lacks
// vision and tends to over-confidently approve. The brief explicitly listed
// claude+gpt4o+gemini.
const ENSEMBLE_MODELS: ReadonlyArray<EnsembleModelName> = ['claude', 'gpt-4o', 'gemini'];

// ── Public entry ──────────────────────────────────────────────────────────

export async function reasonAboutSignalEnsemble(ctx: SignalContext): Promise<Decision> {
  const id = randomUUID();
  const startedAt = Date.now();
  const baseDecision: Omit<Decision,
    'verdict' | 'reasoning' | 'confidence' | 'adjustedSize' | 'adjustedStopPct' | 'modelUsed' | 'reasoningLatencyMs'> = {
    id,
    signal: ctx.signal,
    context: ctx,
    createdAt: new Date().toISOString(),
  };

  // Cost-cap: when over budget, fall back to solo so we don't burn money.
  if (isOverBudget()) {
    logger.warn({ symbol: ctx.signal.symbol }, '[TVAgent.ensemble] daily AI budget exceeded — falling back to solo');
    const solo = await reasonAboutSignal(ctx);
    solo.modelUsed = `${solo.modelUsed}+budget-fallback`;
    return solo;
  }

  // If fewer than 2 models are configured, the ensemble is meaningless.
  // Fall back to solo (which itself fails-closed if Claude isn't available).
  const enabledModels = ENSEMBLE_MODELS.filter(isEnabled);
  if (enabledModels.length < 2) {
    logger.warn(
      { configured: enabledModels, symbol: ctx.signal.symbol },
      '[TVAgent.ensemble] <2 models configured — falling back to solo',
    );
    const solo = await reasonAboutSignal(ctx);
    solo.modelUsed = `${solo.modelUsed}+ensemble-disabled`;
    return solo;
  }

  // Fan out
  const systemPrompt = buildEnsembleSystemPrompt();
  const userPrompt = buildEnsembleUserPrompt(ctx);
  const fanOut = await callModelsParallel({
    systemPrompt,
    userPrompt,
    models: enabledModels,
    perModelTimeoutMs: DEFAULT_PER_MODEL_TIMEOUT_MS,
    totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
    maxTokens: 600,
    temperature: 0.3,
  });

  // Track spend (so the budget guardrail trips on the NEXT call)
  recordEnsembleSpend(fanOut.responses);

  // Parse each response into a verdict
  const verdicts: ModelVerdict[] = [];
  const perModelMeta: Array<{ model: string; ok: boolean; verdict?: DecisionVerdict; latencyMs: number; error?: string }> = [];
  for (const r of fanOut.responses) {
    const parsed = parseEnsembleVerdict(r);
    perModelMeta.push({
      model: r.model,
      ok: !!parsed && !r.error,
      ...(parsed ? { verdict: parsed.verdict } : {}),
      latencyMs: r.latencyMs,
      ...(r.error ? { error: r.error } : {}),
    });
    if (parsed) verdicts.push(parsed);
  }

  // Total-timeout sentinel — if the fan-out hit its hard cap we treat as failure.
  if (fanOut.totalLatencyMs >= DEFAULT_TOTAL_TIMEOUT_MS) {
    logger.warn(
      { symbol: ctx.signal.symbol, totalLatencyMs: fanOut.totalLatencyMs, perModelMeta },
      '[TVAgent.ensemble] hit total-timeout — failing per policy',
    );
    return failureDecision(baseDecision, fanOut.responses, perModelMeta, Date.now() - startedAt,
      'ensemble hit total-timeout cap before models responded');
  }

  // <2 valid verdicts → fail per policy
  if (verdicts.length < 2) {
    logger.warn(
      { symbol: ctx.signal.symbol, validVerdicts: verdicts.length, perModelMeta },
      '[TVAgent.ensemble] insufficient valid verdicts',
    );
    return failureDecision(baseDecision, fanOut.responses, perModelMeta, Date.now() - startedAt,
      `only ${verdicts.length}/${ENSEMBLE_MODELS.length} models returned a valid JSON verdict`);
  }

  // Consensus
  const consensus = detectConsensus(verdicts);
  const latencyMs = Date.now() - startedAt;

  // Build reasoning with full ensemble transparency
  const reasoningParts: string[] = [consensus.summary];
  for (const v of consensus.agreeing) {
    reasoningParts.push(`[${v.model}/${v.verdict}@${v.confidence.toFixed(2)}] ${v.reasoning.slice(0, 300)}`);
  }
  for (const d of consensus.dissenters) {
    reasoningParts.push(`[DISSENT ${d.model}/${d.verdict}@${d.confidence.toFixed(2)}] ${d.reasoning.slice(0, 300)}`);
  }
  const reasoning = reasoningParts.join('\n');

  const decision: Decision = {
    ...baseDecision,
    verdict: consensus.verdict,
    reasoning,
    confidence: consensus.confidence,
    adjustedSize: consensus.adjustedSizeUsd,
    adjustedStopPct: consensus.adjustedStopPct,
    modelUsed: `ensemble:${verdicts.map((v) => v.model).join('+')}`,
    reasoningLatencyMs: latencyMs,
  };

  // Attach per-model metadata to context for memory analysis
  attachEnsembleMetadata(decision, perModelMeta, consensus);

  logger.info(
    {
      symbol: ctx.signal.symbol,
      action: ctx.signal.action,
      verdict: decision.verdict,
      agreement: consensus.agreement,
      confidence: decision.confidence,
      models: perModelMeta,
      totalLatencyMs: latencyMs,
    },
    `[TVAgent.ensemble] ${ctx.signal.action.toUpperCase()} ${ctx.signal.symbol} → ${decision.verdict.toUpperCase()} (agreement=${consensus.agreement.toFixed(2)})`,
  );

  return decision;
}

// ── Verdict parsing ───────────────────────────────────────────────────────

const EXPECTED_VERDICTS = new Set<DecisionVerdict>(['approve', 'veto', 'escalate']);

export function parseEnsembleVerdict(r: ModelResponse): ModelVerdict | null {
  if (r.error || !r.reply) return null;
  const cleaned = r.reply
    .trim()
    .replace(/^```json\s*/, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = obj['verdict'];
    if (typeof verdict !== 'string' || !EXPECTED_VERDICTS.has(verdict as DecisionVerdict)) return null;
    const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
    const confidence = typeof obj['confidence'] === 'number'
      ? Math.max(0, Math.min(1, obj['confidence']))
      : 0.5;
    const sizeRaw = obj['adjustedSizeUsd'];
    const adjustedSizeUsd =
      sizeRaw === null || sizeRaw === undefined
        ? null
        : typeof sizeRaw === 'number'
          ? sizeRaw
          : null;
    const stopRaw = obj['adjustedStopPct'];
    const adjustedStopPct = typeof stopRaw === 'number'
      ? Math.max(-10, Math.min(-1, stopRaw))
      : -5;
    return {
      model: r.model,
      verdict: verdict as DecisionVerdict,
      confidence,
      reasoning,
      adjustedSizeUsd,
      adjustedStopPct,
      latencyMs: r.latencyMs,
    };
  } catch {
    return null;
  }
}

// ── Failure path ──────────────────────────────────────────────────────────

function failureDecision(
  base: Omit<Decision, 'verdict' | 'reasoning' | 'confidence' | 'adjustedSize' | 'adjustedStopPct' | 'modelUsed' | 'reasoningLatencyMs'>,
  responses: ReadonlyArray<ModelResponse>,
  perModelMeta: ReadonlyArray<{ model: string; ok: boolean; verdict?: DecisionVerdict; latencyMs: number; error?: string }>,
  latencyMs: number,
  why: string,
): Decision {
  const okResponses = responses.filter((r) => !r.error && r.reply.length > 0);
  if (FAIL_MODE === 'open' && okResponses.length === 1) {
    const single = parseEnsembleVerdict(okResponses[0]!);
    if (single) {
      logger.warn({ why }, '[TVAgent.ensemble] failing OPEN with lone valid response (legacy override)');
      const decision: Decision = {
        ...base,
        verdict: single.verdict,
        reasoning: `Ensemble degraded — only ${single.model} returned a valid verdict (lone-voice fallback). ${single.reasoning}`,
        confidence: single.confidence * 0.5, // heavy penalty for a degraded ensemble
        adjustedSize: single.verdict === 'approve' ? single.adjustedSizeUsd : null,
        adjustedStopPct: single.adjustedStopPct,
        modelUsed: `ensemble-degraded:${single.model}`,
        reasoningLatencyMs: latencyMs,
      };
      attachEnsembleMetadata(decision, perModelMeta);
      return decision;
    }
  }
  if (FAIL_MODE === 'open') {
    logger.warn({ why }, '[TVAgent.ensemble] failing OPEN (legacy override) — auto-approve');
    const decision: Decision = {
      ...base,
      verdict: 'approve',
      reasoning: `Ensemble fail-open: ${why}. Defaulted to APPROVE per legacy override.`,
      confidence: 0.3,
      adjustedSize: null,
      adjustedStopPct: -5,
      modelUsed: 'ensemble-degraded:fail-open',
      reasoningLatencyMs: latencyMs,
    };
    attachEnsembleMetadata(decision, perModelMeta);
    return decision;
  }
  // Fail-closed
  logger.warn({ why }, '[TVAgent.ensemble] failing CLOSED — VETO');
  const decision: Decision = {
    ...base,
    verdict: 'veto',
    reasoning: `VETO (fail-closed): ${why}. Configure additional model API keys or set TRADEVISOR_FAIL_MODE=open to override.`,
    confidence: 0,
    adjustedSize: 0,
    adjustedStopPct: -5,
    modelUsed: 'ensemble-degraded:fail-closed',
    reasoningLatencyMs: latencyMs,
  };
  attachEnsembleMetadata(decision, perModelMeta);
  return decision;
}

// ── Metadata attachment (for memory + future calibration) ─────────────────

interface PerModelMeta {
  model: string;
  ok: boolean;
  verdict?: DecisionVerdict;
  latencyMs: number;
  error?: string;
}

interface DecisionWithEnsembleMeta extends Decision {
  ensemble?: {
    perModel: ReadonlyArray<PerModelMeta>;
    agreement?: number;
    dissenters?: Array<{ model: string; verdict: DecisionVerdict; reasoning: string }>;
  };
}

function attachEnsembleMetadata(
  decision: Decision,
  perModelMeta: ReadonlyArray<PerModelMeta>,
  consensus?: { agreement: number; dissenters: ReadonlyArray<ModelVerdict> },
): void {
  // We extend the Decision object with an optional `ensemble` field. The
  // `decisions.ts` JSONL log captures whatever serializable fields are on
  // the object, so this becomes available for offline calibration.
  const d = decision as DecisionWithEnsembleMeta;
  const meta: NonNullable<DecisionWithEnsembleMeta['ensemble']> = { perModel: perModelMeta };
  if (consensus) {
    meta.agreement = consensus.agreement;
    meta.dissenters = consensus.dissenters.map((dv) => ({
      model: String(dv.model),
      verdict: dv.verdict,
      reasoning: dv.reasoning.slice(0, 400),
    }));
  }
  d.ensemble = meta;
}
