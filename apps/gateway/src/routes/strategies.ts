import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getStrategies,
  getStrategy,
  createStrategy,
  updateStrategy,
  toggleStrategy,
  deleteStrategy,
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

// ---------------------------------------------------------------------------
// In-memory fallback store (used when PostgreSQL is unavailable)
// ---------------------------------------------------------------------------
interface MemoryStrategy {
  id: string;
  name: string;
  market: string;
  strategyType: string;
  enabled: boolean;
  params: Record<string, unknown>;
  riskPerTrade: string | null;
  maxAllocation: string | null;
  minRiskReward: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const memoryStrategies = new Map<string, MemoryStrategy>();

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
    } catch {
      // DB unavailable — use in-memory store
      strategies = [...memoryStrategies.values()] as unknown as Strategy[];
    }

    // Merge in-memory strategies that aren't in the DB result
    const dbIds = new Set(strategies.map(s => s.id));
    for (const memStrat of memoryStrategies.values()) {
      if (!dbIds.has(memStrat.id)) {
        strategies.push(memStrat as unknown as Strategy);
      }
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

// ---------------------------------------------------------------------------
// Strategy Templates
// ---------------------------------------------------------------------------

const STRATEGY_TEMPLATES = [
  {
    id: 'tpl-btc-trend',
    name: 'BTC Trend Follower',
    description: 'Follows Bitcoin momentum using SMA crossovers. Goes long when price crosses above SMA 20 with SMA 50 confirming the trend direction.',
    type: 'momentum',
    strategyType: 'momentum',
    market: 'crypto',
    instruments: ['BTC-USD'],
    timeframes: ['1h', '4h'],
    parameters: { fastPeriod: 20, slowPeriod: 50, threshold: 0.02, rsiOverbought: 75, rsiOversold: 30 },
    riskOverrides: { maxRiskPercent: 1.0, maxPositionSize: 0.5 },
    difficulty: 'beginner' as const,
  },
  {
    id: 'tpl-eth-mean-reversion',
    name: 'ETH Mean Reversion',
    description: 'Buys ETH when price dips below the lower Bollinger Band and sells when it returns to the mean. Profits from price snapping back to average.',
    type: 'mean_reversion',
    strategyType: 'mean_reversion',
    market: 'crypto',
    instruments: ['ETH-USD'],
    timeframes: ['1h', '4h'],
    parameters: { period: 20, stdDev: 2.0, entryDeviation: -2.0, exitDeviation: 0 },
    riskOverrides: { maxRiskPercent: 0.8, maxPositionSize: 0.3 },
    difficulty: 'beginner' as const,
  },
  {
    id: 'tpl-large-cap-momentum',
    name: 'Large Cap Momentum',
    description: 'Identifies top US stocks by 90-day price momentum. Buys the strongest performers and rides the trend. Ideal for capturing equity rallies.',
    type: 'momentum',
    strategyType: 'momentum',
    market: 'equities',
    instruments: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'],
    timeframes: ['1d'],
    parameters: { lookbackDays: 90, topN: 5, rebalanceFrequency: '7d', minMomentum: 0.05 },
    riskOverrides: { maxRiskPercent: 1.0, maxPositionSize: 0.15 },
    difficulty: 'intermediate' as const,
  },
  {
    id: 'tpl-blue-chip-value',
    name: 'Blue Chip Value',
    description: 'Buys undervalued S&P 500 stocks with low P/E ratios and high dividend yields. Conservative strategy for steady returns and income.',
    type: 'mean_reversion',
    strategyType: 'mean_reversion',
    market: 'equities',
    instruments: ['SPY', 'VTI', 'JNJ', 'PG', 'KO', 'PEP'],
    timeframes: ['1d'],
    parameters: { maxPERatio: 15, minDividendYield: 2.0, rebalanceFrequency: '30d' },
    riskOverrides: { maxRiskPercent: 1.5, maxPositionSize: 0.2 },
    difficulty: 'beginner' as const,
  },
  {
    id: 'tpl-crypto-breakout',
    name: 'Crypto Breakout',
    description: 'Detects consolidation breakouts using ATR volatility channels. Enters when price breaks out of a tight range with volume confirmation.',
    type: 'breakout',
    strategyType: 'custom',
    market: 'crypto',
    instruments: ['BTC-USD', 'ETH-USD', 'SOL-USD'],
    timeframes: ['15m', '1h'],
    parameters: { atrPeriod: 14, atrMultiplier: 1.5, consolidationPeriod: 20, volumeThreshold: 1.5 },
    riskOverrides: { maxRiskPercent: 0.8, maxPositionSize: 0.3 },
    difficulty: 'intermediate' as const,
  },
  {
    id: 'tpl-multi-asset-balanced',
    name: 'Multi-Asset Balanced',
    description: 'Diversified 60/40 across crypto and equities with automatic rebalancing. Lower risk through diversification across asset classes.',
    type: 'custom',
    strategyType: 'custom',
    market: 'all',
    instruments: ['BTC-USD', 'ETH-USD', 'SPY', 'QQQ'],
    timeframes: ['1d'],
    parameters: { cryptoAllocation: 0.4, equityAllocation: 0.6, rebalancePeriod: '7d', rebalanceThreshold: 0.05 },
    riskOverrides: { maxRiskPercent: 1.0, maxPositionSize: 0.3 },
    difficulty: 'beginner' as const,
  },
];

/**
 * GET /api/v1/strategies/templates
 * Returns pre-built strategy templates.
 */
strategiesRouter.get('/templates', (_req, res) => {
  res.json({ data: STRATEGY_TEMPLATES });
});

/**
 * POST /api/v1/strategies/from-template
 * Clone a template as a new user strategy.
 */
strategiesRouter.post('/from-template', requireRole('admin', 'trader'), async (req, res) => {
  try {
    const { templateId, name: overrideName } = req.body as { templateId: string; name?: string };
    const template = STRATEGY_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const stratName = overrideName?.trim() || template.name;

    let strategy;
    try {
      strategy = await createStrategy({
        name: stratName,
        market: (template.market === 'all' ? 'crypto' : template.market) as 'crypto' | 'equities' | 'forex' | 'futures' | 'options',
        strategyType: template.strategyType as NewStrategy['strategyType'],
        params: {
          ...template.parameters,
          instruments: template.instruments,
          timeframes: template.timeframes,
          description: template.description,
          zodType: template.type,
          templateId: template.id,
        },
        enabled: true,
        riskPerTrade: template.riskOverrides.maxRiskPercent != null
          ? String(template.riskOverrides.maxRiskPercent)
          : undefined,
      });
    } catch (dbError) {
      console.warn('[Strategies] DB unavailable, saving to in-memory store');
      strategy = {
        id: `strat-${Date.now()}`,
        name: stratName,
        market: template.market,
        strategyType: template.strategyType,
        enabled: true,
        params: {
          ...template.parameters,
          instruments: template.instruments,
          timeframes: template.timeframes,
          description: template.description,
          zodType: template.type,
          templateId: template.id,
        },
        riskPerTrade: String(template.riskOverrides.maxRiskPercent),
        maxAllocation: null,
        minRiskReward: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryStrategies.set(strategy.id, strategy as MemoryStrategy);
    }

    res.status(201).json({ data: strategy, message: `Strategy "${stratName}" created from template` });
  } catch (error) {
    console.error('[Strategies] Error creating from template:', error);
    res.status(500).json({ error: 'Failed to create strategy from template' });
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
    } catch {
      // DB unavailable — check in-memory store
      strategy = memoryStrategies.get(req.params.id as string) as unknown as Strategy | undefined;
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
      console.warn('[Strategies] DB unavailable, saving to in-memory store');
      strategy = {
        id: `strat-${Date.now()}`,
        name: body.name,
        market: 'crypto',
        strategyType: mapStrategyType(body.type),
        enabled: body.active,
        params: buildParams(body),
        riskPerTrade: body.riskOverrides?.maxRiskPercent != null
          ? String(body.riskOverrides.maxRiskPercent) : null,
        maxAllocation: null,
        minRiskReward: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryStrategies.set(strategy.id, strategy as MemoryStrategy);
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
    } catch {
      console.warn('[Strategies] DB unavailable, updating in-memory store');
      const existing = memoryStrategies.get(req.params.id as string);
      updatedStrategy = {
        ...(existing ?? {}),
        id: req.params.id as string,
        name: body.name,
        strategyType: mapStrategyType(body.type),
        enabled: body.active,
        params: buildParams(body),
        riskPerTrade: body.riskOverrides?.maxRiskPercent != null
          ? String(body.riskOverrides.maxRiskPercent) : null,
        updatedAt: new Date().toISOString(),
      };
      memoryStrategies.set(req.params.id as string, updatedStrategy as MemoryStrategy);
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
 * DELETE /api/v1/strategies/:id
 * Delete a strategy.
 */
strategiesRouter.delete('/:id', async (req, res) => {
  try {
    try {
      await deleteStrategy(req.params.id as string);
    } catch {
      // DB unavailable — just remove from memory
    }
    memoryStrategies.delete(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    console.error('[Strategies] Error deleting strategy:', error);
    res.status(500).json({ error: 'Failed to delete strategy' });
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
    } catch {
      console.warn('[Strategies] DB unavailable, patching in-memory store');
      const existing = memoryStrategies.get(req.params.id as string);
      if (existing) {
        if (body.active !== undefined) existing.enabled = body.active;
        if (body.name !== undefined) existing.name = body.name;
        if (body.parameters) existing.params = { ...existing.params, ...body.parameters };
        existing.updatedAt = new Date().toISOString();
        memoryStrategies.set(existing.id, existing);
      }
      updatedStrategy = existing ?? {
        id: req.params.id as string,
        ...body,
        updatedAt: new Date().toISOString(),
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
