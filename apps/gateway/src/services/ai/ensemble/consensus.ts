/**
 * Consensus + dissent detection for ensemble verdicts.
 *
 * Each model returns a structured trade verdict. This module:
 *   1. Tallies which verdict (approve/veto/escalate) the models pick
 *   2. Computes an agreement score (1.0 = all-agree, 0.66 = 2-of-3, 0.5 = split, 0.33 = all-different)
 *   3. Identifies dissenters (models that picked the minority verdict)
 *   4. Picks the dominant verdict — with one critical safety override:
 *      a 3-way disagreement ALWAYS becomes "escalate" (per spec). This is a
 *      quality signal that the trade needs human input.
 */
import type { DecisionVerdict } from '../tradevisor-agent/types.js';
import type { EnsembleModelName } from './types.js';

export interface ModelVerdict {
  model: EnsembleModelName | string;
  verdict: DecisionVerdict;
  confidence: number;
  reasoning: string;
  adjustedSizeUsd: number | null;
  adjustedStopPct: number;
  /** Latency from the underlying model call. */
  latencyMs?: number;
}

export interface ConsensusResult {
  /** The final verdict after applying consensus rules. */
  verdict: DecisionVerdict;
  /** 0..1 — fraction of models that agreed with the dominant verdict. */
  agreement: number;
  /** Models in the agreeing majority. */
  agreeing: ModelVerdict[];
  /** Models that disagreed (empty when full consensus). */
  dissenters: ModelVerdict[];
  /**
   * Confidence scaled by agreement strength.
   * - 3-of-3: mean of all 3 confidences
   * - 2-of-3: 0.7 × mean of agreeing pair
   * - 3-way disagreement: 0.0 (always escalate)
   * - 1 valid response only: that model's confidence × 0.7 (lone-voice penalty)
   */
  confidence: number;
  /** Suggested adjusted size — picked from majority. null when verdict != approve. */
  adjustedSizeUsd: number | null;
  /** Suggested adjusted stop pct — picked from majority. */
  adjustedStopPct: number;
  /**
   * Why we landed where we did, in one sentence. Useful to splice into the
   * Decision.reasoning field.
   */
  summary: string;
  /** True when fewer than 2 models contributed valid verdicts (caller should fail-closed). */
  insufficient: boolean;
}

/**
 * Detect consensus across an array of per-model verdicts.
 *
 * Behavior matches the spec in the brief:
 *   - All agree → mean confidence
 *   - 2-of-3 agree → majority verdict, mark dissenter, conf scaled 0.7×
 *   - 3-way disagreement → ALWAYS escalate, confidence = 0.0
 *   - <2 valid verdicts → insufficient=true, defer to caller (fail-closed in prod)
 */
export function detectConsensus(verdicts: ReadonlyArray<ModelVerdict>): ConsensusResult {
  if (verdicts.length === 0) {
    return {
      verdict: 'veto',
      agreement: 0,
      agreeing: [],
      dissenters: [],
      confidence: 0,
      adjustedSizeUsd: null,
      adjustedStopPct: -5,
      summary: 'No models returned valid verdicts.',
      insufficient: true,
    };
  }

  if (verdicts.length === 1) {
    const only = verdicts[0]!;
    return {
      verdict: only.verdict,
      agreement: 1, // only voice agrees with itself
      agreeing: [only],
      dissenters: [],
      confidence: clampConf(only.confidence * 0.7), // lone-voice penalty
      adjustedSizeUsd: only.adjustedSizeUsd,
      adjustedStopPct: only.adjustedStopPct,
      summary: `Only ${only.model} returned a valid verdict (${only.verdict}); applied lone-voice confidence penalty.`,
      insufficient: true, // caller should still treat as low-trust
    };
  }

  // Tally
  const buckets = new Map<DecisionVerdict, ModelVerdict[]>();
  for (const v of verdicts) {
    const arr = buckets.get(v.verdict) ?? [];
    arr.push(v);
    buckets.set(v.verdict, arr);
  }

  // 3-way disagreement (each verdict appears once across exactly 3 different categories)
  if (buckets.size >= 3 && verdicts.length >= 3) {
    return {
      verdict: 'escalate',
      agreement: 1 / verdicts.length, // each verdict has 1 vote
      agreeing: [],
      dissenters: [...verdicts],
      confidence: 0,
      adjustedSizeUsd: null,
      adjustedStopPct: -5,
      summary: `3-way disagreement across ${verdicts.length} models (${verdicts.map((v) => `${v.model}=${v.verdict}`).join(', ')}). Escalating per ensemble spec.`,
      insufficient: false,
    };
  }

  // Find dominant bucket
  let dominantVerdict: DecisionVerdict = 'veto';
  let dominantBucket: ModelVerdict[] = [];
  for (const [verdict, arr] of buckets) {
    if (arr.length > dominantBucket.length) {
      dominantBucket = arr;
      dominantVerdict = verdict;
    }
  }

  const dissenters = verdicts.filter((v) => v.verdict !== dominantVerdict);
  const agreement = dominantBucket.length / verdicts.length;
  const fullConsensus = agreement === 1;

  // Confidence calculation
  const meanAgreeingConf = dominantBucket.reduce((s, v) => s + v.confidence, 0) / dominantBucket.length;
  const confidence = fullConsensus ? clampConf(meanAgreeingConf) : clampConf(meanAgreeingConf * 0.7);

  // Pick adjustedSize / adjustedStop from the median of the agreeing bucket
  const sortedSizes = dominantBucket
    .map((v) => v.adjustedSizeUsd)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const adjustedSizeUsd = sortedSizes.length > 0
    ? sortedSizes[Math.floor(sortedSizes.length / 2)] ?? null
    : null;

  const sortedStops = dominantBucket
    .map((v) => v.adjustedStopPct)
    .sort((a, b) => a - b);
  const adjustedStopPct = sortedStops.length > 0
    ? (sortedStops[Math.floor(sortedStops.length / 2)] ?? -5)
    : -5;

  const summary = fullConsensus
    ? `${verdicts.length}/${verdicts.length} models agree on ${dominantVerdict.toUpperCase()}.`
    : `${dominantBucket.length}/${verdicts.length} models picked ${dominantVerdict.toUpperCase()}; dissenters: ${dissenters.map((d) => `${d.model}=${d.verdict}`).join(', ')}.`;

  return {
    verdict: dominantVerdict,
    agreement,
    agreeing: dominantBucket,
    dissenters,
    confidence,
    // For non-approve verdicts the size doesn't matter; null it out for clarity.
    adjustedSizeUsd: dominantVerdict === 'approve' ? adjustedSizeUsd : null,
    adjustedStopPct,
    summary,
    insufficient: false,
  };
}

function clampConf(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
