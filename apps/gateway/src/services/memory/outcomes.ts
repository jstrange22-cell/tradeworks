/**
 * Outcomes are 1-to-1 with decisions. Use upsert semantics so we can
 * record an early provisional outcome and refine it later (e.g. update
 * holding_minutes when the position finally closes).
 */

import { getPool } from './db.js';
import { logger } from '../../lib/logger.js';
import type { ExitReason, OutcomeInput, OutcomeRow } from './types.js';

interface OutcomeDbRow {
  decision_id: string;
  closed_at: Date;
  realized_pnl_usd: number;
  r_multiple: number | null;
  was_stop_hit: boolean | null;
  was_target_hit: boolean | null;
  holding_minutes: number | null;
  exit_reason: ExitReason | null;
  notes: string | null;
}

function rowToOutcome(r: OutcomeDbRow): OutcomeRow {
  return {
    decisionId: r.decision_id,
    closedAt: r.closed_at,
    realizedPnlUsd: r.realized_pnl_usd,
    rMultiple: r.r_multiple,
    wasStopHit: r.was_stop_hit,
    wasTargetHit: r.was_target_hit,
    holdingMinutes: r.holding_minutes,
    exitReason: r.exit_reason,
    notes: r.notes,
  };
}

/**
 * Insert (or update on conflict) the outcome for a decision. Use this when
 * a position closes — pass the realized P&L and any optional metadata. Also
 * stamps the decision's `resolution` to 'executed' if not already set.
 * Returns `null` when memory DB is unavailable.
 */
export async function upsertOutcome(input: OutcomeInput): Promise<OutcomeRow | null> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[memory.outcomes] upsertOutcome skipped — DB unavailable');
    return null;
  }

  const sql = `
    INSERT INTO trade_outcomes (
      decision_id, closed_at, realized_pnl_usd, r_multiple,
      was_stop_hit, was_target_hit, holding_minutes, exit_reason, notes
    ) VALUES (
      $1, COALESCE($2, NOW()), $3, $4, $5, $6, $7, $8, $9
    )
    ON CONFLICT (decision_id) DO UPDATE SET
      closed_at        = EXCLUDED.closed_at,
      realized_pnl_usd = EXCLUDED.realized_pnl_usd,
      r_multiple       = EXCLUDED.r_multiple,
      was_stop_hit     = EXCLUDED.was_stop_hit,
      was_target_hit   = EXCLUDED.was_target_hit,
      holding_minutes  = EXCLUDED.holding_minutes,
      exit_reason      = EXCLUDED.exit_reason,
      notes            = EXCLUDED.notes
    RETURNING *
  `;
  const closedAt =
    input.closedAt instanceof Date
      ? input.closedAt.toISOString()
      : input.closedAt ?? null;

  const params = [
    input.decisionId,
    closedAt,
    input.realizedPnlUsd,
    input.rMultiple ?? null,
    input.wasStopHit ?? null,
    input.wasTargetHit ?? null,
    input.holdingMinutes ?? null,
    input.exitReason ?? null,
    input.notes ?? null,
  ];

  const result = await pool.query<OutcomeDbRow>(sql, params);
  const row = result.rows[0];
  if (!row) {
    logger.error('[memory.outcomes] upsertOutcome returned no row');
    return null;
  }
  return rowToOutcome(row);
}

/**
 * Fetch the outcome row for a decision, if it has been closed. Returns
 * `null` when no outcome exists or DB is unavailable.
 */
export async function getOutcomeByDecisionId(decisionId: string): Promise<OutcomeRow | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await pool.query<OutcomeDbRow>(
    'SELECT * FROM trade_outcomes WHERE decision_id = $1',
    [decisionId],
  );
  const row = result.rows[0];
  return row ? rowToOutcome(row) : null;
}
