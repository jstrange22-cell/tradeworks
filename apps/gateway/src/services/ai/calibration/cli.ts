/**
 * Run-once CLI entry for the calibration job.
 *
 * Usage (from monorepo root):
 *   pnpm --filter @tradeworks/gateway run-calibration
 *
 * Or directly:
 *   tsx apps/gateway/src/services/ai/calibration/cli.ts
 *
 * Exits 0 on success (including no-data success), 1 on unexpected errors.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load monorepo-root .env (matches gateway boot pattern).
config({ path: resolve(process.cwd(), '../../.env') });
config();

import { logger } from '../../../lib/logger.js';
import { runCalibration } from './index.js';
import { closeMemoryPool } from '../../memory/db.js';

async function main(): Promise<void> {
  const days = Number(process.env['CALIBRATION_WINDOW_DAYS'] ?? 365);
  logger.info({ windowDays: days }, '[calibration.cli] starting one-shot run');
  const result = await runCalibration(days);
  // Print actual summary size for visibility (per spec)
  logger.info(
    {
      jsonPath: result.jsonPath,
      summaryPath: result.summaryPath,
      rowCount: result.rowCount,
      summaryBytes: result.summaryBytes,
      windowDays: result.windowDays,
    },
    '[calibration.cli] complete',
  );
  await closeMemoryPool();
}

main().catch(async (err) => {
  logger.error(
    { err: err instanceof Error ? err.message : String(err) },
    '[calibration.cli] failed',
  );
  await closeMemoryPool().catch(() => undefined);
  process.exit(1);
});
