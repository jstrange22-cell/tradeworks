/**
 * Exit-monitor routes.
 *
 *   GET  /api/v1/exits/status                        — monitor health snapshot
 *   GET  /api/v1/exits/positions                     — open positions + last evaluation
 *   POST /api/v1/exits/manual-close/:decisionId      — admin manual close
 *
 * The monitor is started during gateway boot (see index.ts). These routes
 * are read-only except for the manual-close path, which is gated to admin
 * users.
 */
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import {
  getExitMonitorStatus,
  getExitMonitorEvaluations,
  manualCloseByDecisionId,
} from '../services/exits/index.js';

export const exitsRouter: RouterType = Router();

// ── GET /status ────────────────────────────────────────────────────────

exitsRouter.get('/status', (_req, res) => {
  try {
    res.json({ data: getExitMonitorStatus() });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[Routes/Exits] /status failed',
    );
    res.status(500).json({ error: 'failed to fetch status' });
  }
});

// ── GET /positions ─────────────────────────────────────────────────────

exitsRouter.get('/positions', (_req, res) => {
  try {
    const evaluations = getExitMonitorEvaluations();
    res.json({
      data: evaluations,
      summary: {
        total: evaluations.length,
        firedThisTick: evaluations.filter(e => e.fired).length,
        wouldExit: evaluations.filter(e => e.decision.shouldExit && !e.fired).length,
      },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[Routes/Exits] /positions failed',
    );
    res.status(500).json({ error: 'failed to fetch positions' });
  }
});

// ── POST /manual-close/:decisionId ─────────────────────────────────────

const manualCloseParams = z.object({
  decisionId: z.string().uuid().or(z.string().min(8)), // accept any non-trivial id
});

exitsRouter.post('/manual-close/:decisionId', async (req, res) => {
  // Admin gate. devAuth in dev injects role='admin'; production enforces JWT.
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'admin role required' });
    return;
  }
  const parsed = manualCloseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid decisionId', details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await manualCloseByDecisionId(parsed.data.decisionId);
    res.json({ data: result });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, decisionId: parsed.data.decisionId },
      '[Routes/Exits] /manual-close failed',
    );
    res.status(500).json({ error: 'manual close failed' });
  }
});
