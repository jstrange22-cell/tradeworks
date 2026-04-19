/**
 * Cross-Market Capital Allocation Routes
 *
 * Unified portfolio intelligence across all 4 markets.
 *
 * GET  /api/v1/allocation            — Current allocation recommendation
 * GET  /api/v1/allocation/config     — Allocation config
 * POST /api/v1/allocation/config     — Update allocation config
 * GET  /api/v1/allocation/overview   — Full multi-market overview
 */

import { Router, type Router as RouterType } from 'express';
import {
  getAllocation,
  generateAllocation,
  getAllocationConfig,
  updateAllocationConfig,
  type AllocationConfig,
} from '../services/ai/capital-allocator.js';
import { getMacroRegime } from '../services/ai/macro-regime.js';

export const allocationRouter: RouterType = Router();

// GET / — Current capital allocation recommendation
allocationRouter.get('/', async (req, res) => {
  try {
    const totalCapital = req.query.capital
      ? parseFloat(req.query.capital as string)
      : undefined;

    const allocation = totalCapital
      ? await generateAllocation({ totalCapital })
      : await getAllocation();

    res.json({ data: allocation });
  } catch (err) {
    res.status(500).json({
      error: 'Allocation failed',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// GET /config — Current allocation config
allocationRouter.get('/config', (_req, res) => {
  res.json({ data: getAllocationConfig() });
});

// POST /config — Update allocation config
allocationRouter.post('/config', (req, res) => {
  try {
    const updates = req.body as Partial<AllocationConfig>;
    const updated = updateAllocationConfig(updates);
    res.json({ data: updated });
  } catch (err) {
    res.status(400).json({
      error: 'Invalid config',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// GET /overview — Full multi-market overview
allocationRouter.get('/overview', async (_req, res) => {
  try {
    const [allocation, regime] = await Promise.all([
      getAllocation(),
      getMacroRegime(),
    ]);

    res.json({
      data: {
        regime: {
          current: regime.regime,
          confidence: regime.confidence,
          positionSizeMultiplier: regime.positionSizeMultiplier,
          summary: regime.summary,
        },
        allocation: allocation.allocations.map(a => ({
          market: a.market,
          percent: a.allocationPercent,
          usd: a.allocationUsd,
          risk: a.riskLevel,
          status: a.status,
          reasoning: a.reasoning,
        })),
        cashReserve: {
          percent: allocation.cashReservePercent,
          usd: allocation.cashReserve,
        },
        totalCapital: allocation.totalCapital,
        generatedAt: allocation.generatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: 'Overview failed',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});
