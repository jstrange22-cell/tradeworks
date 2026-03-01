import type { EnginePosition } from './engines/crypto/coinbase-engine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  exchange: string;
  exchangePositions: EnginePosition[];
  dbPositions: EnginePosition[];
  newPositions: EnginePosition[];       // On exchange but not in DB
  stalePositions: EnginePosition[];     // In DB but not on exchange
  mismatchedPositions: Array<{
    instrument: string;
    exchangeQty: number;
    dbQty: number;
    diff: number;
  }>;
  reconciled: boolean;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Single-engine reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile positions from a specific exchange against the database.
 * Positions are matched by instrument name. Discrepancies are categorized as
 * new (exchange-only), stale (DB-only), or mismatched (quantity differs).
 */
export async function reconcilePositions(
  exchangeName: string,
  exchangePositions: EnginePosition[],
  dbPositions: EnginePosition[],
): Promise<ReconciliationResult> {
  const timestamp = new Date();

  const exchangeMap = new Map<string, EnginePosition>();
  for (const pos of exchangePositions) {
    exchangeMap.set(pos.instrument, pos);
  }

  const dbMap = new Map<string, EnginePosition>();
  for (const pos of dbPositions) {
    dbMap.set(pos.instrument, pos);
  }

  const newPositions: EnginePosition[] = [];
  const mismatchedPositions: ReconciliationResult['mismatchedPositions'] = [];

  for (const [instrument, exchPos] of exchangeMap) {
    const dbPos = dbMap.get(instrument);

    if (!dbPos) {
      newPositions.push(exchPos);
      continue;
    }

    const diff = exchPos.quantity - dbPos.quantity;
    if (Math.abs(diff) > 1e-8) {
      mismatchedPositions.push({
        instrument,
        exchangeQty: exchPos.quantity,
        dbQty: dbPos.quantity,
        diff,
      });
    }
  }

  const stalePositions: EnginePosition[] = [];
  for (const [instrument, dbPos] of dbMap) {
    if (!exchangeMap.has(instrument)) {
      stalePositions.push(dbPos);
    }
  }

  const reconciled =
    newPositions.length === 0 &&
    stalePositions.length === 0 &&
    mismatchedPositions.length === 0;

  return {
    exchange: exchangeName,
    exchangePositions,
    dbPositions,
    newPositions,
    stalePositions,
    mismatchedPositions,
    reconciled,
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Full reconciliation across all engines
// ---------------------------------------------------------------------------

/**
 * Run full reconciliation across all engines. Each engine is processed
 * independently so a failure in one does not block others.
 *
 * When autoCorrect is true, the exchange is treated as source of truth
 * and the updateDbPositions callback is invoked to sync the database.
 */
export async function runFullReconciliation(
  engines: Record<string, { getPositions: () => Promise<EnginePosition[]> }>,
  getDbPositions: () => Promise<EnginePosition[]>,
  options?: {
    autoCorrect?: boolean;
    updateDbPositions?: (
      exchangeName: string,
      positions: EnginePosition[],
    ) => Promise<void>;
  },
): Promise<ReconciliationResult[]> {
  const results: ReconciliationResult[] = [];
  const engineNames = Object.keys(engines);

  console.log('[Reconciliation] ====================================================');
  console.log('[Reconciliation] Starting full position reconciliation');
  console.log(`[Reconciliation] Engines to reconcile: ${engineNames.join(', ') || '(none)'}`);
  console.log('[Reconciliation] ====================================================');

  if (engineNames.length === 0) {
    console.log('[Reconciliation] No engines registered. Nothing to reconcile.');
    return results;
  }

  let allDbPositions: EnginePosition[];
  try {
    allDbPositions = await getDbPositions();
    console.log(`[Reconciliation] Loaded ${allDbPositions.length} position(s) from database.`);
  } catch (error) {
    console.error('[Reconciliation] Failed to load positions from database:', error);
    return results;
  }

  for (const engineName of engineNames) {
    const engine = engines[engineName];

    try {
      console.log(`[Reconciliation] --- ${engineName} ---`);

      const exchangePositions = await engine.getPositions();
      console.log(`[Reconciliation]   Exchange positions: ${exchangePositions.length}`);

      const dbPositions = filterDbPositionsForEngine(engineName, allDbPositions);
      console.log(`[Reconciliation]   DB positions (filtered): ${dbPositions.length}`);

      const result = await reconcilePositions(engineName, exchangePositions, dbPositions);
      results.push(result);

      logReconciliationResult(result);

      if (options?.autoCorrect && !result.reconciled && options.updateDbPositions) {
        console.log(`[Reconciliation]   Auto-correcting DB to match exchange...`);
        try {
          await options.updateDbPositions(engineName, exchangePositions);
          console.log(`[Reconciliation]   Auto-correction complete for ${engineName}.`);
        } catch (updateError) {
          console.error(`[Reconciliation]   Auto-correction FAILED for ${engineName}:`, updateError);
        }
      }
    } catch (engineError) {
      console.error(`[Reconciliation]   FAILED to reconcile ${engineName}:`, engineError);
    }
  }

  logReconciliationSummary(results);
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter DB positions relevant to a given engine using instrument naming conventions.
 *   - Crypto: contains "_" (e.g. BTC_USDT)
 *   - Equity: no "_" and no "/" (e.g. AAPL)
 *   - Prediction: contains "/" (e.g. outcome tokens)
 */
function filterDbPositionsForEngine(
  engineName: string,
  allDbPositions: EnginePosition[],
): EnginePosition[] {
  const name = engineName.toLowerCase();

  if (name.includes('coinbase') || name.includes('crypto') || name.includes('binance')) {
    return allDbPositions.filter(p => p.instrument.includes('_'));
  }
  if (name.includes('equity') || name.includes('stock') || name.includes('alpaca')) {
    return allDbPositions.filter(p => !p.instrument.includes('_') && !p.instrument.includes('/'));
  }
  if (name.includes('prediction') || name.includes('polymarket') || name.includes('kalshi')) {
    return allDbPositions.filter(p => p.instrument.includes('/'));
  }

  return allDbPositions;
}

function logReconciliationResult(result: ReconciliationResult): void {
  if (result.reconciled) {
    console.log(`[Reconciliation]   RECONCILED — exchange and DB are in sync.`);
    return;
  }

  console.warn(`[Reconciliation]   DISCREPANCIES FOUND for ${result.exchange}:`);

  if (result.newPositions.length > 0) {
    console.warn(`[Reconciliation]     New (exchange only): ${result.newPositions.length}`);
    for (const pos of result.newPositions) {
      console.warn(`[Reconciliation]       + ${pos.instrument}  qty=${pos.quantity}  side=${pos.side}`);
    }
  }

  if (result.stalePositions.length > 0) {
    console.warn(`[Reconciliation]     Stale (DB only): ${result.stalePositions.length}`);
    for (const pos of result.stalePositions) {
      console.warn(`[Reconciliation]       - ${pos.instrument}  qty=${pos.quantity}  side=${pos.side}`);
    }
  }

  if (result.mismatchedPositions.length > 0) {
    console.warn(`[Reconciliation]     Mismatched quantities: ${result.mismatchedPositions.length}`);
    for (const mm of result.mismatchedPositions) {
      console.warn(
        `[Reconciliation]       ~ ${mm.instrument}  exchange=${mm.exchangeQty}  db=${mm.dbQty}  diff=${mm.diff.toFixed(8)}`,
      );
    }
  }
}

function logReconciliationSummary(results: ReconciliationResult[]): void {
  const border = '-'.repeat(72);
  console.log(border);
  console.log('  RECONCILIATION SUMMARY');
  console.log(border);

  const synced = results.filter(r => r.reconciled).length;
  const drifted = results.filter(r => !r.reconciled).length;
  const totalNew = results.reduce((s, r) => s + r.newPositions.length, 0);
  const totalStale = results.reduce((s, r) => s + r.stalePositions.length, 0);
  const totalMismatch = results.reduce((s, r) => s + r.mismatchedPositions.length, 0);

  console.log(`  Engines processed:    ${results.length}`);
  console.log(`  In sync:              ${synced}`);
  console.log(`  With discrepancies:   ${drifted}`);
  console.log(`  New positions:        ${totalNew}`);
  console.log(`  Stale positions:      ${totalStale}`);
  console.log(`  Quantity mismatches:  ${totalMismatch}`);
  console.log(border);
}
