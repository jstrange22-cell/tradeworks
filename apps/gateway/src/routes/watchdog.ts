/**
 * Watchdog HTTP API.
 *   GET  /api/v1/watchdog/status — current status + recent log
 *   GET  /api/v1/watchdog/log?limit=N — last N JSONL events (default 200, max 1000)
 *   GET  /api/v1/watchdog/config — view config
 *   PATCH /api/v1/watchdog/config — update enabled checks / budgets
 *   POST /api/v1/watchdog/run-now — force a tick + return latest log entries
 *   GET  /api/v1/watchdog/checks — list of available checks
 */

import { Router, type Router as RouterType } from 'express';
import {
  getWatchdogStatus,
  getWatchdogLog,
  getWatchdogConfig,
  setWatchdogConfig,
  runWatchdogNow,
  listChecks,
} from '../services/watchdog/watchdog.js';

export const watchdogRouter: RouterType = Router();

watchdogRouter.get('/status', (_req, res) => {
  try {
    res.json({ data: getWatchdogStatus() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'status failed' });
  }
});

watchdogRouter.get('/log', (req, res) => {
  try {
    const limit = Math.min(1000, parseInt((req.query.limit as string) ?? '200', 10) || 200);
    res.json({ data: getWatchdogLog(limit) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'log failed' });
  }
});

watchdogRouter.get('/config', (_req, res) => {
  try {
    res.json({ data: getWatchdogConfig() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'config failed' });
  }
});

watchdogRouter.patch('/config', (req, res) => {
  try {
    const next = setWatchdogConfig(req.body ?? {});
    res.json({ data: next });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'config update failed' });
  }
});

watchdogRouter.post('/run-now', async (_req, res) => {
  try {
    const result = await runWatchdogNow();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'run-now failed' });
  }
});

watchdogRouter.get('/checks', (_req, res) => {
  try {
    res.json({ data: listChecks() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'checks failed' });
  }
});
