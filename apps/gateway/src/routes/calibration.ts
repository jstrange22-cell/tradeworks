/**
 * Calibration HTTP API.
 *   POST /api/v1/calibration/run    — trigger an on-demand calibration build
 *   GET  /api/v1/calibration/status — last summary metadata (size, mtime)
 *
 * Both routes are admin-gated. The POST blocks until the run completes
 * (typically <2s for in-memory aggregation; longer if the DB is busy).
 */

import { Router, type Router as RouterType } from 'express';
import { statSync, readFileSync } from 'fs';
import { requireRole } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import {
  runCalibration,
  resolveDataPath,
  CALIBRATION_JSON_PATH,
  CALIBRATION_SUMMARY_PATH,
} from '../services/ai/calibration/index.js';

export const calibrationRouter: RouterType = Router();

calibrationRouter.post('/run', requireRole('admin'), async (req, res) => {
  const days = Number(req.body?.windowDays ?? 365);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    res.status(400).json({ error: 'windowDays must be 1..3650' });
    return;
  }
  try {
    const result = await runCalibration(days);
    res.json({
      data: {
        ok: result.ok,
        rowCount: result.rowCount,
        summaryBytes: result.summaryBytes,
        windowDays: result.windowDays,
        generatedAt: result.generatedAt,
        jsonPath: result.jsonPath,
        summaryPath: result.summaryPath,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[calibration.route] run failed');
    res.status(500).json({ error: 'calibration run failed', detail: msg });
  }
});

calibrationRouter.get('/status', requireRole('admin'), (_req, res) => {
  const summaryPath = resolveDataPath(CALIBRATION_SUMMARY_PATH);
  const jsonPath = resolveDataPath(CALIBRATION_JSON_PATH);
  try {
    const stat = statSync(summaryPath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    res.json({
      data: {
        summaryPath,
        jsonPath,
        summaryBytes: stat.size,
        mtime: new Date(stat.mtimeMs).toISOString(),
        ageHours,
        stale: ageHours > 24 * 7,
      },
    });
  } catch {
    res.json({ data: { summaryPath, jsonPath, summaryBytes: 0, mtime: null, stale: true } });
  }
});

calibrationRouter.get('/summary', requireRole('admin'), (_req, res) => {
  const summaryPath = resolveDataPath(CALIBRATION_SUMMARY_PATH);
  try {
    const content = readFileSync(summaryPath, 'utf-8');
    res.type('text/markdown').send(content);
  } catch {
    res.status(404).json({ error: 'no calibration summary yet — run POST /run first' });
  }
});
