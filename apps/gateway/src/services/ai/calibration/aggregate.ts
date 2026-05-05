/**
 * Aggregate (decision, outcome) joined rows into the multi-cut calibration
 * stats that feed both `calibration.json` and the prompt-injectable summary.
 *
 * All math is done in TS (no SQL aggregations) so we can unit-test the
 * pipeline against synthetic data without a live DB.
 */

import { getPool } from '../../memory/db.js';
import { logger } from '../../../lib/logger.js';
import {
  bucketizeConfidence,
  hourBucket,
  type ConfidenceBucketKey,
} from './buckets.js';

// ── Joined row shape from SQL ──────────────────────────────────────────
export interface JoinedRow {
  id: string;
  strategy: string;
  verdict: string | null;
  confidence: number | null;
  signal: unknown;
  context: unknown;
  createdAt: Date;
  realizedPnlUsd: number;
  rMultiple: number | null;
  wasStopHit: boolean | null;
  wasTargetHit: boolean | null;
  exitReason: string | null;
}

// ── Per-bucket aggregate shape ─────────────────────────────────────────
export interface BucketStats {
  bucketKey: string;
  n: number;
  winRate: number;          // 0..1
  avgRMultiple: number;
  expectancyUsd: number;
  sharpeProxy: number;      // mean / stddev (or 0 if stddev=0)
  stopHitRate: number;
  targetHitRate: number;
}

export interface CalibrationReport {
  generatedAt: string;
  windowDays: number;
  totalApproves: number;
  byStrategy: BucketStats[];
  byConfidence: BucketStats[];
  byRegime: BucketStats[];
  byHour: BucketStats[];
  bySector: BucketStats[];
  failureModes: {
    highConfLossesLast30d: number;        // confidence > 0.8 closed at <=-1R
    volatileNoScoutLossesLast30d: number; // 'volatile' regime + no scout corroboration losing
  };
}

// ── DB pull ────────────────────────────────────────────────────────────
const QUERY_SQL = `
  SELECT d.id,
         d.strategy,
         d.verdict,
         d.confidence,
         d.signal,
         d.context,
         d.created_at,
         o.realized_pnl_usd,
         o.r_multiple,
         o.was_stop_hit,
         o.was_target_hit,
         o.exit_reason
    FROM decisions d
    JOIN trade_outcomes o ON o.decision_id = d.id
   WHERE d.verdict = 'approve'
     AND d.created_at >= NOW() - ($1::int * INTERVAL '1 day')
`;

interface DbJoinedRow {
  id: string;
  strategy: string;
  verdict: string | null;
  confidence: number | null;
  signal: unknown;
  context: unknown;
  created_at: Date;
  realized_pnl_usd: number;
  r_multiple: number | null;
  was_stop_hit: boolean | null;
  was_target_hit: boolean | null;
  exit_reason: string | null;
}

export async function fetchJoinedRows(windowDays = 365): Promise<JoinedRow[]> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[calibration] MEMORY_DB_URL unset — fetchJoinedRows returning []');
    return [];
  }
  const result = await pool.query<DbJoinedRow>(QUERY_SQL, [windowDays]);
  return result.rows.map((r) => ({
    id: r.id,
    strategy: r.strategy,
    verdict: r.verdict,
    confidence: r.confidence === null ? null : Number(r.confidence),
    signal: r.signal,
    context: r.context,
    createdAt: r.created_at,
    realizedPnlUsd: Number(r.realized_pnl_usd),
    rMultiple: r.r_multiple === null ? null : Number(r.r_multiple),
    wasStopHit: r.was_stop_hit,
    wasTargetHit: r.was_target_hit,
    exitReason: r.exit_reason,
  }));
}

// ── Stats helpers ──────────────────────────────────────────────────────
function aggregate(rows: JoinedRow[], bucketKey: string): BucketStats {
  if (rows.length === 0) {
    return {
      bucketKey,
      n: 0,
      winRate: 0,
      avgRMultiple: 0,
      expectancyUsd: 0,
      sharpeProxy: 0,
      stopHitRate: 0,
      targetHitRate: 0,
    };
  }
  const n = rows.length;
  const wins = rows.filter((r) => r.realizedPnlUsd > 0).length;
  const winRate = wins / n;

  const rMultiples = rows.map((r) => r.rMultiple).filter((x): x is number => x !== null);
  const avgRMultiple = rMultiples.length > 0
    ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
    : 0;

  const pnls = rows.map((r) => r.realizedPnlUsd);
  const expectancyUsd = pnls.reduce((a, b) => a + b, 0) / n;

  const variance =
    pnls.reduce((acc, p) => acc + (p - expectancyUsd) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const sharpeProxy = stddev > 0 ? expectancyUsd / stddev : 0;

  const stopHits = rows.filter((r) => r.wasStopHit === true).length;
  const targetHits = rows.filter((r) => r.wasTargetHit === true).length;

  return {
    bucketKey,
    n,
    winRate,
    avgRMultiple,
    expectancyUsd,
    sharpeProxy,
    stopHitRate: stopHits / n,
    targetHitRate: targetHits / n,
  };
}

function groupBy<K extends string>(
  rows: JoinedRow[],
  keyFn: (r: JoinedRow) => K | null,
): Map<K, JoinedRow[]> {
  const map = new Map<K, JoinedRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null) continue;
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return map;
}

// ── Context extractors (defensive against schema drift) ────────────────
function extractRegime(ctx: unknown): string | null {
  if (!ctx || typeof ctx !== 'object') return null;
  const c = ctx as Record<string, unknown>;
  const macro = c['macro'];
  if (macro && typeof macro === 'object') {
    const m = macro as Record<string, unknown>;
    const r = m['regime'];
    if (typeof r === 'string') return r;
  }
  return null;
}

function extractEtHour(createdAt: Date): number {
  // Fallback: derive ET hour from UTC. ET is UTC-5 (standard) / UTC-4 (DST).
  // We approximate with a fixed -5 offset; the SQL path gives an exact value
  // upstream when needed. Wraparound handled.
  const utcHour = createdAt.getUTCHours();
  return (utcHour - 5 + 24) % 24;
}

function extractSector(ctx: unknown, symbol: string | null): string | null {
  if (!ctx || typeof ctx !== 'object') return null;
  const c = ctx as Record<string, unknown>;
  const portfolio = c['portfolio'];
  if (!portfolio || typeof portfolio !== 'object') return null;
  const p = portfolio as Record<string, unknown>;
  const positions = p['equityPositions'];
  if (!Array.isArray(positions) || symbol === null) return null;
  for (const pos of positions) {
    if (pos && typeof pos === 'object') {
      const o = pos as Record<string, unknown>;
      if (o['symbol'] === symbol && typeof o['sector'] === 'string') {
        return o['sector'];
      }
    }
  }
  return null;
}

function extractSymbol(signal: unknown): string | null {
  if (!signal || typeof signal !== 'object') return null;
  const s = signal as Record<string, unknown>;
  return typeof s['symbol'] === 'string' ? s['symbol'] : null;
}

function hasScoutCorroboration(ctx: unknown): boolean {
  if (!ctx || typeof ctx !== 'object') return false;
  const c = ctx as Record<string, unknown>;
  return c['scout'] !== null && c['scout'] !== undefined;
}

// ── Public: build full report ──────────────────────────────────────────
export function buildReport(rows: JoinedRow[], windowDays = 365): CalibrationReport {
  const generatedAt = new Date().toISOString();

  // by strategy
  const byStrategyMap = groupBy(rows, (r) => r.strategy ?? 'unknown');
  const byStrategy = Array.from(byStrategyMap.entries())
    .map(([k, v]) => aggregate(v, k))
    .sort((a, b) => b.n - a.n);

  // by confidence bucket
  const byConfidenceMap = groupBy<ConfidenceBucketKey>(rows, (r) =>
    bucketizeConfidence(r.confidence),
  );
  const byConfidence = Array.from(byConfidenceMap.entries())
    .map(([k, v]) => aggregate(v, k))
    .sort((a, b) => a.bucketKey.localeCompare(b.bucketKey));

  // by regime
  const byRegimeMap = groupBy(rows, (r) => extractRegime(r.context));
  const byRegime = Array.from(byRegimeMap.entries())
    .map(([k, v]) => aggregate(v, k))
    .sort((a, b) => b.n - a.n);

  // by hour bucket
  const byHourMap = groupBy(rows, (r) => hourBucket(extractEtHour(r.createdAt)));
  const byHour = Array.from(byHourMap.entries())
    .map(([k, v]) => aggregate(v, k))
    .sort((a, b) => b.n - a.n);

  // by sector
  const bySectorMap = groupBy(rows, (r) =>
    extractSector(r.context, extractSymbol(r.signal)),
  );
  const bySector = Array.from(bySectorMap.entries())
    .map(([k, v]) => aggregate(v, k))
    .sort((a, b) => b.n - a.n);

  // failure modes (last 30d)
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const last30d = rows.filter((r) => r.createdAt >= cutoff30d);
  const highConfLosses = last30d.filter(
    (r) =>
      (r.confidence ?? 0) > 0.8 &&
      r.rMultiple !== null &&
      r.rMultiple <= -1,
  ).length;
  const volatileNoScoutLosses = last30d.filter(
    (r) =>
      extractRegime(r.context) === 'volatile' &&
      !hasScoutCorroboration(r.context) &&
      r.realizedPnlUsd < 0,
  ).length;

  return {
    generatedAt,
    windowDays,
    totalApproves: rows.length,
    byStrategy,
    byConfidence,
    byRegime,
    byHour,
    bySector,
    failureModes: {
      highConfLossesLast30d: highConfLosses,
      volatileNoScoutLossesLast30d: volatileNoScoutLosses,
    },
  };
}
