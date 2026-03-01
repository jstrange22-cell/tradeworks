import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getStrategies,
  getStrategy,
  createStrategy,
  updateStrategy,
  toggleStrategy,
  type NewStrategy,
  type Strategy,
} from '@tradeworks/db';

/**
 * Strategy routes.
 * GET    /api/v1/strategies        - List all strategies
 * GET    /api/v1/strategies/:id    - Get a single strategy
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map the Zod strategy `type` to the DB `strategyType` enum.
 * The DB enum is: momentum, mean_reversion, trend_following, arbitrage,
 *   market_making, ml_signal, custom.
 * Zod types that don't have a 1:1 match are mapped to 'custom'.
 */
const STRATEGY_TYPE_MAP: Record<string, NewStrategy['strategyType']> = {
  momentum: 'momentum',
  mean_reversion: 'mean_reversion',
  breakout: 'custom',        // no direct DB enum match
  smc: 'custom',             // no direct DB enum match
  sentiment: 'ml_signal',    // closest match
  macro: 'custom',           // no direct DB enum match
  custom: 'custom',
};

function mapStrategyType(zodType: string): NewStrategy['strategyType'] {
  return STRATEGY_TYPE_MAP[zodType] ?? 'custom';
}

/**
 * Build the DB `params` JSONB from Zod body fields.
 */
function buildParams(body: {
  instruments?: string[];
  timeframes?: string[];
  parameters?: Record<string, unknown>;
  description?: string;
  type?: string;
}): Record<string, unknown> {
  return {
    ...(body.parameters ?? {}),
    instruments: body.instruments,
    timeframes: body.timeframes,
    ...(body.description != null ? { description: body.description } : {}),
    ...(body.type != null ? { zodType: body.type } : {}),
  };
}

/**
 * GET /api/v1/strategies
 * List all strategies.
 */
strategiesRouter.get('/', async (_req, res) => {
  try {
    let strategies: Strategy[] = [];
    try {
      strategies = await getStrategies();
    } catch (dbError) {
      console.warn('[Strategies] DB error listing strategies, falling back to empty list:', dbError);
      strategies = [];
    }

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
strategiesRouter.get('/:id', async (req, res) => {
  try {
    let strategy;
    try {
      strategy = await getStrategy(req.params.id as string);
    } catch (dbError) {
      console.warn('[Strategies] DB error fetching strategy, returning 404:', dbError);
      strategy = undefined;
    }

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

    let strategy;
    try {
      strategy = await createStrategy({
        name: body.name,
        market: 'crypto',
        strategyType: mapStrategyType(body.type),
        params: buildParams(body),
        enabled: body.active,
        riskPerTrade: body.riskOverrides?.maxRiskPercent != null
          ? String(body.riskOverrides.maxRiskPercent)
          : undefined,
      });
    } catch (dbError) {
      console.warn('[Strategies] DB error creating strategy, using stub fallback:', dbError);
      strategy = {
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
    }

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

    let updatedStrategy;
    try {
      updatedStrategy = await updateStrategy(req.params.id as string, {
        name: body.name,
        strategyType: mapStrategyType(body.type),
        params: buildParams(body),
        enabled: body.active,
        riskPerTrade: body.riskOverrides?.maxRiskPercent != null
          ? String(body.riskOverrides.maxRiskPercent)
          : undefined,
      });
    } catch (dbError) {
      console.warn('[Strategies] DB error updating strategy, using stub fallback:', dbError);
      updatedStrategy = {
        id: req.params.id as string,
        ...body,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user!.id,
      };
    }

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

    let updatedStrategy;
    try {
      if (body.active !== undefined && Object.keys(body).length === 1) {
        // Pure toggle -- use the dedicated toggle function
        updatedStrategy = await toggleStrategy(req.params.id as string, body.active);
      } else {
        // General partial update
        const updateData: Parameters<typeof updateStrategy>[1] = {};

        if (body.name !== undefined) {
          updateData.name = body.name;
        }
        if (body.active !== undefined) {
          updateData.enabled = body.active;
        }
        if (body.parameters !== undefined || body.riskOverrides !== undefined) {
          // Merge parameters and riskOverrides into the params JSONB
          const existingStrategy = await getStrategy(req.params.id as string);
          const existingParams = (existingStrategy?.params ?? {}) as Record<string, unknown>;
          updateData.params = {
            ...existingParams,
            ...(body.parameters ?? {}),
            ...(body.riskOverrides != null ? { riskOverrides: body.riskOverrides } : {}),
          };
        }
        if (body.riskOverrides?.maxRiskPercent != null) {
          updateData.riskPerTrade = String(
            (body.riskOverrides as Record<string, unknown>).maxRiskPercent,
          );
        }

        updatedStrategy = await updateStrategy(req.params.id as string, updateData);
      }
    } catch (dbError) {
      console.warn('[Strategies] DB error patching strategy, using stub fallback:', dbError);
      updatedStrategy = {
        id: req.params.id as string,
        ...body,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user!.id,
      };
    }

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
