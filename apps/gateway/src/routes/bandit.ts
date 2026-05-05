/**
 * Bandit allocator REST surface.
 *
 *   GET  /api/v1/bandit/weights      → current weights snapshot
 *   POST /api/v1/bandit/recompute    → admin: trigger immediate recompute
 *   POST /api/v1/bandit/override     → admin: 24h temp override for one strategy
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import {
  canRecomputeNow,
  clearTempOverrides,
  getCurrentWeights,
  recomputeNow,
  setTempOverride,
} from '../services/orchestrator/bandit-runner.js';

export const banditRouter: RouterType = Router();

banditRouter.get('/weights', (_req, res) => {
  const weights = getCurrentWeights();
  if (!weights) {
    res.status(503).json({
      error: { code: 'BANDIT_NOT_INITIALIZED', message: 'Bandit weights not yet loaded' },
    });
    return;
  }
  res.json({ data: weights, canRecomputeNow: canRecomputeNow() });
});

banditRouter.post('/recompute', async (_req, res) => {
  const force = false;     // hourly rate-limit applies even to admin call
  const result = await recomputeNow({ force });
  if (!result) {
    res.status(429).json({
      error: {
        code: 'BANDIT_RATE_LIMITED',
        message: 'Recompute allowed at most once per hour',
      },
    });
    return;
  }
  res.json({ data: result });
});

const overrideSchema = z.object({
  strategy: z.string().min(1).max(64),
  weight: z.number().min(0).max(1),
});

banditRouter.post('/override', (req, res) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: parsed.error.message },
    });
    return;
  }
  try {
    setTempOverride(parsed.data.strategy, parsed.data.weight);
    res.json({
      data: { strategy: parsed.data.strategy, weight: parsed.data.weight, ttlHours: 24 },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[bandit] override failed');
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'failed' },
    });
  }
});

banditRouter.delete('/override', (_req, res) => {
  clearTempOverrides();
  res.json({ data: { cleared: true } });
});
