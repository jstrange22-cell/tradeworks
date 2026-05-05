/**
 * CRUD for the `decisions` table.
 *
 * Every public function is a no-op (warn + empty return) when
 * `MEMORY_DB_URL` is unset, so callers never need to guard.
 */

import { getPool } from './db.js';
import { logger } from '../../lib/logger.js';
import type {
  DecisionInput,
  DecisionRow,
  RecentDecisionsFilter,
  Resolution,
  Verdict,
} from './types.js';

interface DecisionDbRow {
  id: string;
  created_at: Date;
  resolved_at: Date | null;
  strategy: string;
  signal: unknown;
  context: unknown;
  verdict: Verdict | null;
  reasoning: string | null;
  confidence: number | null;
  adjusted_size_usd: number | null;
  adjusted_stop_pct: number | null;
  model_used: string | null;
  reasoning_latency_ms: number | null;
  resolution: Resolution | null;
}

function rowToDecision(r: DecisionDbRow): DecisionRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    strategy: r.strategy,
    signal: r.signal,
    context: r.context,
    verdict: r.verdict,
    reasoning: r.reasoning,
    confidence: r.confidence,
    adjustedSizeUsd: r.adjusted_size_usd,
    adjustedStopPct: r.adjusted_stop_pct,
    modelUsed: r.model_used,
    reasoningLatencyMs: r.reasoning_latency_ms,
    resolution: r.resolution,
  };
}

/**
 * Insert a new decision. Returns the inserted row (including server-generated
 * id + created_at). Returns `null` when memory DB is unavailable.
 */
export async function insertDecision(input: DecisionInput): Promise<DecisionRow | null> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[memory.decisions] insertDecision skipped — DB unavailable');
    return null;
  }

  const sql = `
    INSERT INTO decisions (
      strategy, signal, context, verdict, reasoning, confidence,
      adjusted_size_usd, adjusted_stop_pct, model_used, reasoning_latency_ms
    ) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const params = [
    input.strategy,
    JSON.stringify(input.signal ?? null),
    JSON.stringify(input.context ?? null),
    input.verdict ?? null,
    input.reasoning ?? null,
    input.confidence ?? null,
    input.adjustedSizeUsd ?? null,
    input.adjustedStopPct ?? null,
    input.modelUsed ?? null,
    input.reasoningLatencyMs ?? null,
  ];

  const result = await pool.query<DecisionDbRow>(sql, params);
  const row = result.rows[0];
  if (!row) {
    logger.error('[memory.decisions] insertDecision returned no row');
    return null;
  }
  return rowToDecision(row);
}

/**
 * Update the resolution column on an existing decision and stamp resolved_at.
 * Returns the updated row, or `null` if not found / DB unavailable.
 */
export async function updateDecisionResolution(
  id: string,
  resolution: Resolution,
): Promise<DecisionRow | null> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[memory.decisions] updateDecisionResolution skipped — DB unavailable');
    return null;
  }

  const sql = `
    UPDATE decisions
       SET resolution = $2,
           resolved_at = COALESCE(resolved_at, NOW())
     WHERE id = $1
     RETURNING *
  `;
  const result = await pool.query<DecisionDbRow>(sql, [id, resolution]);
  const row = result.rows[0];
  return row ? rowToDecision(row) : null;
}

/**
 * Fetch a single decision by id. Returns `null` when not found / unavailable.
 */
export async function getDecisionById(id: string): Promise<DecisionRow | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await pool.query<DecisionDbRow>(
    'SELECT * FROM decisions WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  return row ? rowToDecision(row) : null;
}

/**
 * Fetch the most recent decisions (newest first). Returns [] when DB unavailable.
 * `limit` capped at 1000 server-side as a safety belt.
 */
export async function getRecentDecisions(
  limit = 50,
  filter: RecentDecisionsFilter = {},
): Promise<DecisionRow[]> {
  const pool = getPool();
  if (!pool) return [];

  const safeLimit = Math.min(Math.max(1, limit), 1000);
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.strategy) {
    params.push(filter.strategy);
    where.push(`strategy = $${params.length}`);
  }
  if (filter.verdict) {
    params.push(filter.verdict);
    where.push(`verdict = $${params.length}`);
  }
  if (filter.resolution) {
    params.push(filter.resolution);
    where.push(`resolution = $${params.length}`);
  }
  if (filter.since) {
    params.push(filter.since instanceof Date ? filter.since.toISOString() : filter.since);
    where.push(`created_at >= $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(safeLimit);
  const sql = `
    SELECT * FROM decisions
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query<DecisionDbRow>(sql, params);
  return result.rows.map(rowToDecision);
}
