/**
 * Post-mortem barrel + main entry.
 *
 * `runPostMortem()` is the only function the rest of the gateway needs to
 * know about. It's safe to call any time — it self-gates on whether there
 * are enough recent losses to bother.
 *
 * Call sites:
 *   - The nightly scheduler (`scheduler.ts`).
 *   - The /api/v1/post-mortem/run-now admin endpoint.
 *   - Tests (with options to inject deterministic input).
 */
import { logger } from '../../../lib/logger.js';
import {
  clusterRecentLosses,
  type ClusterOptions,
  type LossCluster,
} from './cluster-losses.js';
import { extractLesson, type ExtractClient, type LessonExtraction } from './extract-lesson.js';
import {
  appendPendingLesson,
  deprecateStaleLessons,
  makeLessonId,
  type Lesson,
} from './heuristics-store.js';

export interface PostMortemRunResult {
  ranAt: string;
  totalLossesConsidered: number;
  clustersAnalysed: number;
  lessonsCreated: Lesson[];
  staleDeprecated: Lesson[];
  skippedReason?: 'not-enough-losses' | 'no-clusters';
}

export interface RunOptions extends ClusterOptions {
  /** Inject a fake Anthropic client. Tests use this. */
  extractClient?: ExtractClient | null;
  /** Override file path. Tests use this. */
  heuristicsFilePath?: string;
  /** Skip stale-deprecation pass. Tests use this. */
  skipStaleDeprecation?: boolean;
  /** Override the lesson id generator (tests). */
  idGenerator?: (date: Date, seq: number) => string;
}

export async function runPostMortem(options: RunOptions = {}): Promise<PostMortemRunResult> {
  const ranAt = new Date().toISOString();
  const idGen = options.idGenerator ?? makeLessonId;

  // 1. Cluster
  const clusterResult = await clusterRecentLosses({
    lookbackDays: options.lookbackDays,
    minLossesToRun: options.minLossesToRun,
    maxClusters: options.maxClusters,
    maxExamplesPerCluster: options.maxExamplesPerCluster,
    losses: options.losses,
  });

  if (!clusterResult) {
    return {
      ranAt,
      totalLossesConsidered: 0,
      clustersAnalysed: 0,
      lessonsCreated: [],
      staleDeprecated: [],
      skippedReason: 'not-enough-losses',
    };
  }

  if (clusterResult.clusters.length === 0) {
    logger.info('[post-mortem] no useful clusters (all singletons) — skipping');
    return {
      ranAt,
      totalLossesConsidered: clusterResult.totalLossesConsidered,
      clustersAnalysed: 0,
      lessonsCreated: [],
      staleDeprecated: [],
      skippedReason: 'no-clusters',
    };
  }

  // 2. Extract lesson per cluster (skip null returns silently)
  const created: Lesson[] = [];
  const today = new Date();
  let seq = 1;

  for (const cluster of clusterResult.clusters) {
    const extraction = await extractLesson(cluster, options.extractClient);
    if (!extraction) continue;
    const lesson = appendPendingLesson(
      buildLessonInput(cluster, extraction, idGen(today, seq), ranAt),
      options.heuristicsFilePath,
    );
    created.push(lesson);
    seq += 1;
  }

  // 3. Deprecate stale Active lessons (60d default)
  let staleDeprecated: Lesson[] = [];
  if (!options.skipStaleDeprecation) {
    try {
      staleDeprecated = deprecateStaleLessons(60, options.heuristicsFilePath);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[post-mortem] stale-deprecation failed');
    }
  }

  logger.info(
    {
      lossesConsidered: clusterResult.totalLossesConsidered,
      clusters: clusterResult.clusters.length,
      lessonsCreated: created.length,
      staleDeprecated: staleDeprecated.length,
    },
    '[post-mortem] run complete',
  );

  return {
    ranAt,
    totalLossesConsidered: clusterResult.totalLossesConsidered,
    clustersAnalysed: clusterResult.clusters.length,
    lessonsCreated: created,
    staleDeprecated,
  };
}

function buildLessonInput(
  cluster: LossCluster,
  extraction: LessonExtraction,
  id: string,
  createdAt: string,
): Parameters<typeof appendPendingLesson>[0] {
  const decisionIds = cluster.examples.map((e) => e.decision.id).slice(0, 5).join(', ');
  const evidenceLine = extraction.evidence
    ? `${extraction.evidence} (cluster=${cluster.key}; decision IDs: ${decisionIds})`
    : `${cluster.examples.length} losses in cluster ${cluster.key} totaling $${cluster.totalLossUsd.toFixed(2)} (decision IDs: ${decisionIds})`;
  return {
    id,
    lesson: extraction.lesson,
    evidence: evidenceLine,
    appliesTo: extraction.appliesTo,
    impact: extraction.impact,
    createdAt,
  };
}

// Public re-exports
export { clusterRecentLosses, clusterLossesPure } from './cluster-losses.js';
export type { LossCluster, LossExample } from './cluster-losses.js';
export { extractLesson, parseExtraction, buildClusterPrompt } from './extract-lesson.js';
export type { LessonExtraction, ExtractClient } from './extract-lesson.js';
export {
  approveLesson,
  rejectLesson,
  appendPendingLesson,
  readHeuristics,
  writeHeuristics,
  renderActiveForPrompt,
  deprecateStaleLessons,
  ensureScaffolded,
  resolveHeuristicsPath,
  makeLessonId,
  parseHeuristics,
  serializeHeuristics,
} from './heuristics-store.js';
export type { Lesson, LessonStatus, HeuristicsFile, LessonImpact, LessonAppliesTo } from './heuristics-store.js';
