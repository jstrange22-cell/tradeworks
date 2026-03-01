import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { createBacktestRateLimiter } from '../middleware/rate-limit.js';

/**
 * Backtest routes.
 * POST /api/v1/backtest      - Submit a new backtest
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

    // TODO: Integrate with @tradeworks/backtester package
    // Submit the backtest job to a queue for processing
    const backtestJob = {
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

    console.log(`[Backtest] Job submitted: ${backtestJob.id} by ${req.user!.email}`);

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
 */
backtestRouter.get('/', async (_req, res) => {
  try {
    // TODO: Integrate with @tradeworks/db, use req.query.status and req.query.limit
    const backtests: unknown[] = [];

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

    // TODO: Integrate with @tradeworks/db
    // Check if backtest belongs to the user or user is admin
    const backtest = null as unknown;

    if (!backtest) {
      res.status(404).json({ error: `Backtest ${id} not found` });
      return;
    }

    // If backtest is complete, include full results
    // If still running, include progress percentage

    res.json({ data: backtest });
  } catch (error) {
    console.error('[Backtest] Error fetching backtest:', error);
    res.status(500).json({ error: 'Failed to fetch backtest results' });
  }
});
