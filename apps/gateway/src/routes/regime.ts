/**
 * Market regime REST surface.
 *
 *   GET  /api/v1/regime              → current MarketRegime snapshot
 *   GET  /api/v1/regime/at?date=ISO  → backtest helper, regime as of a date
 */

import { Router, type Router as RouterType } from 'express';
import { logger } from '../lib/logger.js';
import {
  getCurrentRegime,
  getRegimeForDate,
} from '../services/orchestrator/regime.js';

export const regimeRouter: RouterType = Router();

regimeRouter.get('/', async (_req, res) => {
  try {
    const regime = await getCurrentRegime();
    res.json({ data: regime });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[regime] GET / failed',
    );
    res.status(500).json({
      error: { code: 'REGIME_UNAVAILABLE', message: 'Failed to compute regime' },
    });
  }
});

regimeRouter.get('/at', async (req, res) => {
  const date = typeof req.query['date'] === 'string' ? req.query['date'] : '';
  if (!date || Number.isNaN(new Date(date).getTime())) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Query param `date` must be a valid ISO date' },
    });
    return;
  }
  try {
    const regime = await getRegimeForDate(date);
    res.json({ data: regime });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, date },
      '[regime] GET /at failed',
    );
    res.status(500).json({
      error: { code: 'REGIME_UNAVAILABLE', message: 'Failed to compute regime for date' },
    });
  }
});
