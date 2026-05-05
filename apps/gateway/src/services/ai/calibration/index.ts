/**
 * Calibration module — barrel + main `runCalibration` entry point.
 *
 * Pipeline:
 *   1. Pull (decision, outcome) joined rows from memory DB (last N days).
 *   2. Bucketize and aggregate into a CalibrationReport.
 *   3. Write data/calibration.json (full breakdown).
 *   4. Write data/calibration-summary.md (prompt-injectable, < ~1500 tokens).
 *
 * Safe to call when MEMORY_DB_URL is unset — produces an empty report
 * and writes a "no data" summary so the reasoner integration still works.
 */

import { mkdir, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../lib/logger.js';
import { fetchJoinedRows, buildReport, type CalibrationReport } from './aggregate.js';
import { renderJson, renderSummary } from './format.js';

export {
  CONFIDENCE_BUCKETS,
  bucketizeConfidence,
  bucketMidpoint,
  hourBucket,
  type ConfidenceBucketKey,
} from './buckets.js';

export {
  fetchJoinedRows,
  buildReport,
  type BucketStats,
  type CalibrationReport,
  type JoinedRow,
} from './aggregate.js';

export { renderJson, renderSummary } from './format.js';

export { startCalibrationScheduler, stopCalibrationScheduler } from './scheduler.js';

// ── Path resolution ────────────────────────────────────────────────────
/**
 * Returns the absolute path of `data/<filename>` under apps/gateway/.
 * Walks up from this file (services/ai/calibration/) to apps/gateway/.
 */
export function resolveDataPath(filename: string): string {
  const thisFile = fileURLToPath(import.meta.url);
  const here = dirname(thisFile);                 // .../calibration
  const aiDir = dirname(here);                    // .../ai
  const services = dirname(aiDir);                // .../services
  const srcOrDist = dirname(services);            // .../src or .../dist
  const gatewayRoot = dirname(srcOrDist);         // .../apps/gateway
  return resolve(gatewayRoot, 'data', filename);
}

export const CALIBRATION_JSON_PATH = 'calibration.json';
export const CALIBRATION_SUMMARY_PATH = 'calibration-summary.md';

// ── Result envelope ────────────────────────────────────────────────────
export interface RunCalibrationResult {
  ok: boolean;
  jsonPath: string;
  summaryPath: string;
  rowCount: number;
  summaryBytes: number;
  windowDays: number;
  generatedAt: string;
  reason?: string;
  report: CalibrationReport;
}

// ── Public: main entry ─────────────────────────────────────────────────
export async function runCalibration(windowDays = 365): Promise<RunCalibrationResult> {
  const startedAt = Date.now();
  const jsonPath = resolveDataPath(CALIBRATION_JSON_PATH);
  const summaryPath = resolveDataPath(CALIBRATION_SUMMARY_PATH);

  let rows: Awaited<ReturnType<typeof fetchJoinedRows>> = [];
  let dbReason: string | undefined;
  try {
    rows = await fetchJoinedRows(windowDays);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[calibration] fetchJoinedRows failed');
    dbReason = `fetch failed: ${msg}`;
  }

  const report = buildReport(rows, windowDays);
  const json = renderJson(report);
  let summary = renderSummary(report);

  if (!process.env['MEMORY_DB_URL']) {
    summary = `## CALIBRATION\nMEMORY_DB_URL is unset. Calibration will be empty until the memory DB is configured.\n\n${summary}`;
  } else if (rows.length === 0 && dbReason) {
    summary = `## CALIBRATION\n(${dbReason})\n\n${summary}`;
  }

  // Ensure data/ exists then write atomically-ish (writeFile overwrites).
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, json, 'utf-8');
  await writeFile(summaryPath, summary, 'utf-8');

  const summaryBytes = Buffer.byteLength(summary, 'utf-8');
  const elapsedMs = Date.now() - startedAt;
  logger.info(
    {
      rowCount: rows.length,
      summaryBytes,
      windowDays,
      elapsedMs,
      jsonPath,
      summaryPath,
    },
    '[calibration] run complete',
  );

  return {
    ok: true,
    jsonPath,
    summaryPath,
    rowCount: rows.length,
    summaryBytes,
    windowDays,
    generatedAt: report.generatedAt,
    ...(dbReason ? { reason: dbReason } : {}),
    report,
  };
}
