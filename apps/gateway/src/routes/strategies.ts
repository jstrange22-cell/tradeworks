import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

/**
 * Strategy routes.
 * GET    /api/v1/strategies        - List all strategies
 * POST   /api/v1/strategies        - Create a new strategy
 * PUT    /api/v1/strategies/:id    - Update a strategy
 * PATCH  /api/v1/strategies/:id    - Partially update a strategy (toggle active, etc.)
 */

export const strategiesRouter: RouterType = Router();

/**
 * Strategy schema.
 */
const StrategySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['momentum', 'mean_reversion', 'breakout', 'smc', 'sentiment', 'macro', 'custom']),
  instruments: z.array(z.string()).min(1),
  timeframes: z.array(z.string()).min(1),
  parameters: z.record(z.unknown()).optional(),
  riskOverrides: z.object({
    maxRiskPercent: z.number().min(0.1).max(3.0).optional(),
    maxPositionSize: z.number().positive().optional(),
    maxDailyTrades: z.number().int().positive().optional(),
  }).optional(),
  active: z.boolean().default(false),
});

const StrategyPatchSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.unknown()).optional(),
  riskOverrides: z.record(z.unknown()).optional(),
});

/**
 * GET /api/v1/strategies
 * List all strategies.
 */
strategiesRouter.get('/', async (_req, res) => {
  try {
    // TODO: Integrate with @tradeworks/db, filter by req.query.active
    const strategies: unknown[] = [];

    res.json({
      data: strategies,
      total: strategies.length,
    });
  } catch (error) {
    console.error('[Strategies] Error listing strategies:', error);
    res.status(500).json({ error: 'Failed to fetch strategies' });
  }
});

/**
 * GET /api/v1/strategies/:id
 * Get a single strategy by ID.
 */
strategiesRouter.get('/:id', async (_req, res) => {
  try {
    // TODO: Integrate with @tradeworks/db
    const strategy = null;

    if (!strategy) {
      res.status(404).json({ error: 'Strategy not found' });
      return;
    }

    res.json({ data: strategy });
  } catch (error) {
    console.error('[Strategies] Error fetching strategy:', error);
    res.status(500).json({ error: 'Failed to fetch strategy' });
  }
});

/**
 * POST /api/v1/strategies
 * Create a new strategy. Requires admin or trader role.
 */
strategiesRouter.post('/', requireRole('admin', 'trader'), async (req, res) => {
  try {
    const body = StrategySchema.parse(req.body);

    // TODO: Integrate with @tradeworks/db
    const strategy = {
      id: `strat-${Date.now()}`,
      ...body,
      createdBy: req.user!.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      performance: {
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        sharpeRatio: 0,
      },
    };

    res.status(201).json({
      data: strategy,
      message: 'Strategy created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid strategy definition',
        details: error.errors,
      });
      return;
    }
    console.error('[Strategies] Error creating strategy:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

/**
 * PUT /api/v1/strategies/:id
 * Update a strategy (full replacement). Requires admin or trader role.
 */
strategiesRouter.put('/:id', requireRole('admin', 'trader'), async (req, res) => {
  try {
    const body = StrategySchema.parse(req.body);

    // TODO: Integrate with @tradeworks/db
    const updatedStrategy = {
      id: req.params.id,
      ...body,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user!.id,
    };

    res.json({
      data: updatedStrategy,
      message: 'Strategy updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid strategy definition',
        details: error.errors,
      });
      return;
    }
    console.error('[Strategies] Error updating strategy:', error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});

/**
 * PATCH /api/v1/strategies/:id
 * Partially update a strategy (e.g., toggle active). Requires admin or trader role.
 */
strategiesRouter.patch('/:id', requireRole('admin', 'trader'), async (req, res) => {
  try {
    const body = StrategyPatchSchema.parse(req.body);

    // TODO: Integrate with @tradeworks/db
    const updatedStrategy = {
      id: req.params.id,
      ...body,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user!.id,
    };

    res.json({
      data: updatedStrategy,
      message: 'Strategy updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid update data',
        details: error.errors,
      });
      return;
    }
    console.error('[Strategies] Error patching strategy:', error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});
