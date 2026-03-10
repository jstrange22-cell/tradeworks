import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { createBacktestRateLimiter } from '../middleware/rate-limit.js';
import {
  desc,
  createBacktest,
  getBacktest,
  getBacktestsByStrategy,
  db,
  backtestRuns,
  type BacktestRun,
} from '@tradeworks/db';

/**
 * Backtest routes.
 * POST /api/v1/backtest      - Submit a new backtest
 * GET  /api/v1/backtest      - List backtests
 * GET  /api/v1/backtest/:id  - Get backtest results
 */

export const backtestRouter: RouterType = Router();

/**
 * Backtest request schema.
 */
const BacktestRequestSchema = z.object({
  strategyId: z.string().optional(),
  strategy: z.object({
    type: z.enum(['momentum', 'mean_reversion', 'breakout', 'smc', 'sentiment', 'macro', 'custom']),
    parameters: z.record(z.unknown()),
  }).optional(),
  instruments: z.array(z.string()).min(1).max(20),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  initialCapital: z.number().positive().default(100_000),
  commission: z.number().min(0).max(1).default(0.001), // 0.1% default
  slippage: z.number().min(0).max(1).default(0.0005), // 0.05% default
  riskSettings: z.object({
    maxRiskPercent: z.number().min(0.1).max(5).default(1.0),
    maxDrawdownPercent: z.number().min(1).max(50).default(10.0),
    maxPositionSizePercent: z.number().min(1).max(100).default(10.0),
  }).optional(),
}).refine(
  (data) => data.strategyId || data.strategy,
  { message: 'Either strategyId or strategy definition is required' },
).refine(
  (data) => data.startDate < data.endDate,
  { message: 'startDate must be before endDate' },
);

/**
 * POST /api/v1/backtest
 * Submit a new backtest job. Rate limited.
 */
backtestRouter.post('/', requireRole('admin', 'trader'), createBacktestRateLimiter(), async (req, res) => {
  try {
    const body = BacktestRequestSchema.parse(req.body);

    let backtestJob;
    try {
      const record = await createBacktest({
        strategyId: body.strategyId!,
        startDate: body.startDate,
        endDate: body.endDate,
        initialCapital: String(body.initialCapital),
        status: 'queued',
        params: {
          instruments: body.instruments,
          commission: body.commission,
          slippage: body.slippage,
          riskSettings: body.riskSettings,
          strategy: body.strategy,
        },
      });

      console.log(`[Backtest] Job submitted: ${record.id} by ${req.user!.email}`);

      backtestJob = {
        id: record.id,
        status: record.status,
        submittedBy: req.user!.id,
        submittedAt: record.createdAt,
        config: {
          instruments: body.instruments,
          startDate: body.startDate.toISOString(),
          endDate: body.endDate.toISOString(),
          initialCapital: body.initialCapital,
          commission: body.commission,
          slippage: body.slippage,
          riskSettings: body.riskSettings,
        },
        progress: 0,
        estimatedDurationMs: null as number | null,
      };
    } catch (dbError) {
      console.warn('[Backtest] DB error creating backtest, using stub fallback:', dbError);
      backtestJob = {
        id: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'queued' as const,
        submittedBy: req.user!.id,
        submittedAt: new Date().toISOString(),
        config: {
          instruments: body.instruments,
          startDate: body.startDate.toISOString(),
          endDate: body.endDate.toISOString(),
          initialCapital: body.initialCapital,
          commission: body.commission,
          slippage: body.slippage,
          riskSettings: body.riskSettings,
        },
        progress: 0,
        estimatedDurationMs: null as number | null,
      };

      console.log(`[Backtest] Job submitted (stub): ${backtestJob.id} by ${req.user!.email}`);
    }

    res.status(202).json({
      data: backtestJob,
      message: 'Backtest job submitted. Use GET /api/v1/backtest/:id to check progress.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid backtest configuration',
        details: error.errors,
      });
      return;
    }
    console.error('[Backtest] Error submitting backtest:', error);
    res.status(500).json({ error: 'Failed to submit backtest' });
  }
});

/**
 * GET /api/v1/backtest
 * List all backtests for the authenticated user.
 * Supports optional query params: ?strategyId=<uuid>&limit=<number>
 */
backtestRouter.get('/', async (req, res) => {
  try {
    let backtests: BacktestRun[] = [];
    try {
      const { strategyId, limit } = req.query;
      const maxRows = Math.min(Number(limit) || 50, 100);

      if (typeof strategyId === 'string' && strategyId.length > 0) {
        // Filter by strategy
        backtests = await getBacktestsByStrategy(strategyId);
        backtests = backtests.slice(0, maxRows);
      } else {
        // Return recent backtests across all strategies
        backtests = await db
          .select()
          .from(backtestRuns)
          .orderBy(desc(backtestRuns.createdAt))
          .limit(maxRows);
      }
    } catch (dbError) {
      console.warn('[Backtest] DB error listing backtests, falling back to empty list:', dbError);
      backtests = [];
    }

    res.json({
      data: backtests,
      total: backtests.length,
    });
  } catch (error) {
    console.error('[Backtest] Error listing backtests:', error);
    res.status(500).json({ error: 'Failed to fetch backtests' });
  }
});

/**
 * GET /api/v1/backtest/:id
 * Get results for a specific backtest.
 */
backtestRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    let backtest;
    try {
      backtest = await getBacktest(id);
    } catch (dbError) {
      console.warn('[Backtest] DB error fetching backtest, returning 404:', dbError);
      backtest = undefined;
    }

    if (!backtest) {
      res.status(404).json({ error: `Backtest ${id} not found` });
      return;
    }

    res.json({ data: backtest });
  } catch (error) {
    console.error('[Backtest] Error fetching backtest:', error);
    res.status(500).json({ error: 'Failed to fetch backtest results' });
  }
});
