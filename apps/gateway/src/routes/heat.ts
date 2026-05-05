/**
 * Portfolio heat routes.
 *
 *   GET /api/v1/heat            → current PortfolioHeat snapshot
 *   GET /api/v1/heat/positions  → flat OpenRiskItem[] for the cockpit UI
 *
 * Both are read-only and cached behind the heat module's 60s TTL — safe to
 * call on every cockpit refresh without straining ledger I/O.
 */

import { Router, type Router as RouterType } from 'express';
import { logger } from '../lib/logger.js';
import {
  getOpenRiskPositions,
  getPortfolioHeat,
} from '../services/orchestrator/heat.js';

export const heatRouter: RouterType = Router();

heatRouter.get('/', async (_req, res) => {
  try {
    const data = await getPortfolioHeat();
    res.json({ data });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[heat] /api/v1/heat failed',
    );
    res.status(500).json({
      error: { code: 'HEAT_UNAVAILABLE', message: 'Failed to compute portfolio heat' },
    });
  }
});

heatRouter.get('/positions', async (_req, res) => {
  try {
    const data = await getOpenRiskPositions();
    res.json({ data });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[heat] /api/v1/heat/positions failed',
    );
    res.status(500).json({
      error: { code: 'HEAT_UNAVAILABLE', message: 'Failed to enumerate open risk positions' },
    });
  }
});
