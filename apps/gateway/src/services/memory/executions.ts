/**
 * CRUD for the `executions` table — broker fills tied to a decision.
 *
 * `insertExecution` validates that the parent decision exists before writing
 * so we never end up with orphan rows (the FK already enforces this, but a
 * pre-check gives a cleaner error message to the caller).
 */

import { getPool } from './db.js';
import { logger } from '../../lib/logger.js';
import type {
  AssetClass,
  ExecutionInput,
  ExecutionRow,
  FillStatus,
  Side,
} from './types.js';

interface ExecutionDbRow {
  id: string;
  decision_id: string;
  created_at: Date;
  asset_class: AssetClass;
  symbol: string;
  side: Side;
  quantity: number;
  fill_price: number | null;
  fill_status: FillStatus;
  broker: string;
  raw_response: unknown;
}

function rowToExecution(r: ExecutionDbRow): ExecutionRow {
  return {
    id: r.id,
    decisionId: r.decision_id,
    createdAt: r.created_at,
    assetClass: r.asset_class,
    symbol: r.symbol,
    side: r.side,
    quantity: r.quantity,
    fillPrice: r.fill_price,
    fillStatus: r.fill_status,
    broker: r.broker,
    rawResponse: r.raw_response,
  };
}

/**
 * Insert a broker execution row. Throws a clear error if `decisionId` does
 * not exist (rather than relying on the raw FK violation message).
 * Returns `null` when memory DB is unavailable.
 */
export async function insertExecution(input: ExecutionInput): Promise<ExecutionRow | null> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[memory.executions] insertExecution skipped — DB unavailable');
    return null;
  }

  // Pre-flight existence check for friendlier errors.
  const exists = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM decisions WHERE id = $1) AS exists',
    [input.decisionId],
  );
  if (!exists.rows[0]?.exists) {
    throw new Error(`insertExecution: decision ${input.decisionId} does not exist`);
  }

  const sql = `
    INSERT INTO executions (
      decision_id, asset_class, symbol, side, quantity,
      fill_price, fill_status, broker, raw_response
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    RETURNING *
  `;
  const params = [
    input.decisionId,
    input.assetClass,
    input.symbol,
    input.side,
    input.quantity,
    input.fillPrice ?? null,
    input.fillStatus,
    input.broker,
    JSON.stringify(input.rawResponse ?? null),
  ];

  const result = await pool.query<ExecutionDbRow>(sql, params);
  const row = result.rows[0];
  if (!row) {
    logger.error('[memory.executions] insertExecution returned no row');
    return null;
  }
  return rowToExecution(row);
}

/**
 * All executions for a single decision, oldest first. Returns [] when unavailable.
 */
export async function getExecutionsByDecisionId(decisionId: string): Promise<ExecutionRow[]> {
  const pool = getPool();
  if (!pool) return [];

  const result = await pool.query<ExecutionDbRow>(
    'SELECT * FROM executions WHERE decision_id = $1 ORDER BY created_at ASC',
    [decisionId],
  );
  return result.rows.map(rowToExecution);
}
