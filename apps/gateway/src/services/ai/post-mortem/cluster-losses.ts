/**
 * Cluster losing trades into groups that share a likely root cause.
 *
 * Strategy: deterministic, no ML required.
 *   1. Pull losing decisions+outcomes from memory in the lookback window.
 *   2. Compute a "cluster key" per trade from a small set of dimensions
 *      (strategy, regime, sector bucket, exit reason). Trades sharing a
 *      key cluster together.
 *   3. Drop singletons (need >=2 trades to extract a meaningful pattern).
 *   4. Cap output at MAX_CLUSTERS, keeping the worst clusters first.
 *
 * Each cluster ships with up to N representative trades (full decision
 * + outcome blobs) for the lesson extractor to chew on.
 */
import { logger } from '../../../lib/logger.js';
import { getRecentDecisions } from '../../memory/decisions.js';
import { getOutcomeByDecisionId } from '../../memory/outcomes.js';
import type { DecisionRow, OutcomeRow } from '../../memory/types.js';

export interface LossExample {
  decision: DecisionRow;
  outcome: OutcomeRow;
}

export interface LossCluster {
  key: string;                  // human-readable cluster id (e.g. "swing|risk-off|tech|stop")
  strategy: string;
  regime: string;
  sectorBucket: string;
  exitReason: string;
  examples: LossExample[];
  totalLossUsd: number;
  avgRMultiple: number | null;
}

export interface ClusterOptions {
  lookbackDays?: number;
  minLossesToRun?: number;
  maxClusters?: number;
  maxExamplesPerCluster?: number;
  /** When passed, used directly instead of memory lookup. Tests inject this. */
  losses?: LossExample[];
}

const DEFAULTS = {
  lookbackDays: 7,
  minLossesToRun: 5,
  maxClusters: 5,
  maxExamplesPerCluster: 5,
};

export async function loadRecentLosses(lookbackDays: number): Promise<LossExample[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const decisions = await getRecentDecisions(500, { since });
  const out: LossExample[] = [];
  for (const d of decisions) {
    // Only resolved decisions can have outcomes
    if (!d.id) continue;
    const outcome = await getOutcomeByDecisionId(d.id);
    if (!outcome) continue;
    if (Number(outcome.realizedPnlUsd) >= 0) continue;
    out.push({ decision: d, outcome });
  }
  return out;
}

/**
 * Map a trade to a small bucket key. Symbols are coarse-bucketed by sector
 * if we can derive one from the signal/context; otherwise we fall back to
 * the symbol itself (short string) so similar tickers cluster.
 */
function bucketFor(loss: LossExample): {
  strategy: string;
  regime: string;
  sectorBucket: string;
  exitReason: string;
} {
  const strategy = loss.decision.strategy || 'unknown';

  // Best-effort sector + regime extraction from the JSONB context blob
  const ctx = (loss.decision.context ?? {}) as Record<string, unknown>;
  const macro = (ctx['macro'] ?? {}) as Record<string, unknown>;
  const portfolio = (ctx['portfolio'] ?? {}) as Record<string, unknown>;
  const signal = (ctx['signal'] ?? loss.decision.signal ?? {}) as Record<string, unknown>;
  const regime = typeof macro['regime'] === 'string' ? (macro['regime'] as string) : 'unknown';

  // Sector: find the held-position sector matching the signal symbol
  let sectorBucket = 'unknown';
  const symbol = typeof signal['symbol'] === 'string' ? (signal['symbol'] as string) : '';
  if (symbol && Array.isArray(portfolio['equityPositions'])) {
    for (const p of portfolio['equityPositions'] as Array<Record<string, unknown>>) {
      if (p['symbol'] === symbol && typeof p['sector'] === 'string') {
        sectorBucket = p['sector'] as string;
        break;
      }
    }
  }
  // Fallback: bucket by asset class if we never got a sector
  if (sectorBucket === 'unknown' && typeof signal['assetClass'] === 'string') {
    sectorBucket = `asset:${signal['assetClass']}`;
  }

  const exitReason = loss.outcome.exitReason ?? 'unknown';
  return { strategy, regime, sectorBucket, exitReason };
}

function clusterKey(parts: { strategy: string; regime: string; sectorBucket: string; exitReason: string }): string {
  return [parts.strategy, parts.regime, parts.sectorBucket, parts.exitReason].join('|');
}

/**
 * Pure clustering function — no I/O. Used directly by tests.
 */
export function clusterLossesPure(
  losses: LossExample[],
  opts: { maxClusters?: number; maxExamplesPerCluster?: number } = {},
): LossCluster[] {
  const maxClusters = opts.maxClusters ?? DEFAULTS.maxClusters;
  const maxExamples = opts.maxExamplesPerCluster ?? DEFAULTS.maxExamplesPerCluster;

  const buckets = new Map<string, LossCluster>();
  for (const loss of losses) {
    const parts = bucketFor(loss);
    const key = clusterKey(parts);
    let cluster = buckets.get(key);
    if (!cluster) {
      cluster = {
        key,
        strategy: parts.strategy,
        regime: parts.regime,
        sectorBucket: parts.sectorBucket,
        exitReason: parts.exitReason,
        examples: [],
        totalLossUsd: 0,
        avgRMultiple: null,
      };
      buckets.set(key, cluster);
    }
    if (cluster.examples.length < maxExamples) cluster.examples.push(loss);
    cluster.totalLossUsd += Number(loss.outcome.realizedPnlUsd);
  }

  // Compute avg R for each cluster
  for (const c of buckets.values()) {
    const rs = c.examples
      .map((e) => e.outcome.rMultiple)
      .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
    c.avgRMultiple = rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  }

  // Drop singletons: need at least 2 trades for a cluster to be useful
  const useful = Array.from(buckets.values()).filter((c) => c.examples.length >= 2);
  // Sort by worst total loss first
  useful.sort((a, b) => a.totalLossUsd - b.totalLossUsd);
  return useful.slice(0, maxClusters);
}

/**
 * I/O wrapper. Returns null when there aren't enough losses to bother.
 */
export async function clusterRecentLosses(
  options: ClusterOptions = {},
): Promise<{ clusters: LossCluster[]; totalLossesConsidered: number } | null> {
  const lookbackDays = options.lookbackDays ?? DEFAULTS.lookbackDays;
  const minLossesToRun = options.minLossesToRun ?? DEFAULTS.minLossesToRun;
  const maxClusters = options.maxClusters ?? DEFAULTS.maxClusters;
  const maxExamples = options.maxExamplesPerCluster ?? DEFAULTS.maxExamplesPerCluster;

  const losses = options.losses ?? await loadRecentLosses(lookbackDays);
  if (losses.length < minLossesToRun) {
    logger.info(
      { lossCount: losses.length, needed: minLossesToRun },
      '[post-mortem] not enough losses to cluster — skipping',
    );
    return null;
  }
  const clusters = clusterLossesPure(losses, { maxClusters, maxExamplesPerCluster: maxExamples });
  return { clusters, totalLossesConsidered: losses.length };
}
