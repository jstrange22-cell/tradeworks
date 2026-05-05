/**
 * Manual smoke script — DO NOT WIRE INTO BOOT.
 *
 * Run with a real MEMORY_DB_URL:
 *
 *   MEMORY_DB_URL=postgres://... \
 *   MEMORY_AUTO_MIGRATE=true \
 *   pnpm --filter @tradeworks/gateway exec \
 *     tsx src/services/memory/__smoke__.ts
 *
 * Exercises: migrations -> decision -> execution -> outcome -> embedding ->
 * similarity search -> resolution update. Logs each step.
 */

import { logger } from '../../lib/logger.js';
import {
  closeMemoryPool,
  embedDecision,
  getDecisionById,
  getExecutionsByDecisionId,
  getOutcomeByDecisionId,
  getRecentDecisions,
  initializeMemory,
  insertDecision,
  insertExecution,
  isAvailable,
  runMigrations,
  searchSimilar,
  updateDecisionResolution,
  upsertOutcome,
  EMBEDDING_DIMENSIONS,
} from './index.js';

async function main(): Promise<void> {
  if (!process.env['MEMORY_DB_URL']) {
    logger.error('[smoke] MEMORY_DB_URL not set — refusing to run');
    process.exit(1);
  }

  logger.info('[smoke] running migrations…');
  await runMigrations();
  await initializeMemory();

  const ok = await isAvailable();
  logger.info({ ok }, '[smoke] DB available');
  if (!ok) {
    logger.error('[smoke] DB not reachable — aborting');
    process.exit(1);
  }

  logger.info('[smoke] inserting decision…');
  const decision = await insertDecision({
    strategy: 'pead',
    signal: { ticker: 'AAPL', side: 'buy', surprise_pct: 4.2 },
    context: { portfolio_value: 10_000, regime: 'trend_up' },
    verdict: 'approve',
    reasoning: 'Earnings surprise + trend regime + healthy gap volume.',
    confidence: 0.78,
    adjustedSizeUsd: 250,
    adjustedStopPct: 0.06,
    modelUsed: 'claude-opus-4-7',
    reasoningLatencyMs: 1234,
  });
  if (!decision) throw new Error('insertDecision returned null');
  logger.info({ id: decision.id }, '[smoke] decision inserted');

  logger.info('[smoke] inserting execution…');
  const exec = await insertExecution({
    decisionId: decision.id,
    assetClass: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    quantity: 1,
    fillPrice: 192.34,
    fillStatus: 'filled',
    broker: 'alpaca_paper',
    rawResponse: { order_id: 'fake-1' },
  });
  logger.info({ id: exec?.id }, '[smoke] execution inserted');

  logger.info('[smoke] upserting outcome…');
  const outcome = await upsertOutcome({
    decisionId: decision.id,
    realizedPnlUsd: 14.21,
    rMultiple: 0.95,
    wasStopHit: false,
    wasTargetHit: true,
    holdingMinutes: 320,
    exitReason: 'target',
    notes: 'Smoke test outcome.',
  });
  logger.info({ pnl: outcome?.realizedPnlUsd }, '[smoke] outcome upserted');

  logger.info('[smoke] embedding decision…');
  // Stub embedder returns zeros — provide a non-zero vector so similarity is meaningful.
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = 1;
  await embedDecision(decision.id, v);

  logger.info('[smoke] similarity search…');
  const neighbours = await searchSimilar(v, 5);
  logger.info({ count: neighbours.length, top: neighbours[0]?.similarity }, '[smoke] neighbours');

  logger.info('[smoke] read-back checks…');
  const fetched = await getDecisionById(decision.id);
  const execs = await getExecutionsByDecisionId(decision.id);
  const fetchedOutcome = await getOutcomeByDecisionId(decision.id);
  const recent = await getRecentDecisions(3, { strategy: 'pead' });
  logger.info(
    {
      fetched: !!fetched,
      execs: execs.length,
      outcome: !!fetchedOutcome,
      recent: recent.length,
    },
    '[smoke] reads ok',
  );

  logger.info('[smoke] resolving decision…');
  await updateDecisionResolution(decision.id, 'executed');

  await closeMemoryPool();
  logger.info('[smoke] done');
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, '[smoke] failed');
  process.exit(1);
});
