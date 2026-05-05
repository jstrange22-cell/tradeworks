/**
 * Vector storage and similarity search for decisions.
 *
 * pgvector accepts vectors as a string-formatted literal: `'[0.1,0.2,...]'`.
 * Cast with `::vector` so the planner uses the ivfflat index.
 *
 * Cosine similarity = 1 - cosine_distance, so we compute it inline as
 * `1 - (embedding <=> $1::vector)` — the `<=>` operator is the cosine
 * distance op shipped with pgvector.
 */

import { getPool } from './db.js';
import { logger } from '../../lib/logger.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_PROVIDER, embedText } from './embedder.js';
import type {
  ExitReason,
  OutcomeRow,
  SimilarDecision,
  Verdict,
} from './types.js';

interface SimilarityDbRow {
  decision_id: string;
  similarity: number;
  strategy: string;
  verdict: Verdict | null;
  // joined outcome columns (nullable — LEFT JOIN)
  o_decision_id: string | null;
  o_closed_at: Date | null;
  o_realized_pnl_usd: number | null;
  o_r_multiple: number | null;
  o_was_stop_hit: boolean | null;
  o_was_target_hit: boolean | null;
  o_holding_minutes: number | null;
  o_exit_reason: ExitReason | null;
  o_notes: string | null;
}

/**
 * Render a numeric vector into the textual literal pgvector expects.
 */
function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

/**
 * Validate vector shape. Throws if the dim mismatches the schema column.
 */
function assertVectorShape(v: number[]): void {
  if (!Array.isArray(v)) throw new Error('embedding must be a number[]');
  if (v.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding dim mismatch: got ${v.length}, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
}

/**
 * Store (or replace) the embedding for a decision. Pass `null` to use
 * the stub embedder for the supplied text — useful when the caller
 * doesn't have a vector yet.
 */
export async function embedDecision(
  decisionId: string,
  vector: number[] | null,
  fallbackText?: string,
): Promise<void> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[memory.embeddings] embedDecision skipped — DB unavailable');
    return;
  }

  const v = vector ?? (await embedText(fallbackText ?? ''));
  assertVectorShape(v);

  const sql = `
    INSERT INTO decision_embeddings (decision_id, embedding, provider)
    VALUES ($1, $2::vector, $3)
    ON CONFLICT (decision_id) DO UPDATE SET
      embedding   = EXCLUDED.embedding,
      provider    = EXCLUDED.provider,
      embedded_at = NOW()
  `;
  await pool.query(sql, [decisionId, toPgVector(v), EMBEDDING_PROVIDER]);
}

/**
 * Convenience: embed via `embedText(text)` and store in one call.
 */
export async function embedAndStore(decisionId: string, text: string): Promise<void> {
  const v = await embedText(text);
  await embedDecision(decisionId, v);
}

/**
 * Top-k nearest neighbours by cosine similarity. Joins the outcome row
 * (when present) so callers can filter on realised P&L without a second trip.
 *
 * Results are ordered by similarity DESC; ties broken by recency.
 */
export async function searchSimilar(
  vector: number[],
  k = 10,
): Promise<SimilarDecision[]> {
  const pool = getPool();
  if (!pool) return [];
  assertVectorShape(vector);

  const safeK = Math.min(Math.max(1, k), 200);
  const sql = `
    SELECT
      d.id                              AS decision_id,
      1 - (e.embedding <=> $1::vector)  AS similarity,
      d.strategy                        AS strategy,
      d.verdict                         AS verdict,
      o.decision_id                     AS o_decision_id,
      o.closed_at                       AS o_closed_at,
      o.realized_pnl_usd                AS o_realized_pnl_usd,
      o.r_multiple                      AS o_r_multiple,
      o.was_stop_hit                    AS o_was_stop_hit,
      o.was_target_hit                  AS o_was_target_hit,
      o.holding_minutes                 AS o_holding_minutes,
      o.exit_reason                     AS o_exit_reason,
      o.notes                           AS o_notes
    FROM decision_embeddings e
    JOIN decisions d ON d.id = e.decision_id
    LEFT JOIN trade_outcomes o ON o.decision_id = d.id
    ORDER BY e.embedding <=> $1::vector ASC, d.created_at DESC
    LIMIT $2
  `;

  const result = await pool.query<SimilarityDbRow>(sql, [toPgVector(vector), safeK]);
  return result.rows.map((r) => ({
    decisionId: r.decision_id,
    similarity: r.similarity,
    strategy: r.strategy,
    verdict: r.verdict,
    outcome: r.o_decision_id
      ? ({
          decisionId: r.o_decision_id,
          // assertion safe: o_decision_id !== null implies LEFT JOIN matched.
          closedAt: r.o_closed_at as Date,
          realizedPnlUsd: r.o_realized_pnl_usd as number,
          rMultiple: r.o_r_multiple,
          wasStopHit: r.o_was_stop_hit,
          wasTargetHit: r.o_was_target_hit,
          holdingMinutes: r.o_holding_minutes,
          exitReason: r.o_exit_reason,
          notes: r.o_notes,
        } satisfies OutcomeRow)
      : null,
  }));
}

/**
 * Embed `text` then run a similarity search. Convenience for callers that
 * only have a query string.
 */
export async function searchSimilarByText(
  text: string,
  k = 10,
): Promise<SimilarDecision[]> {
  const v = await embedText(text);
  return searchSimilar(v, k);
}
