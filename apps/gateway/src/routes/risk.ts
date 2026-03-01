import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';

/**
 * Risk routes.
 * GET  /api/v1/risk/metrics          - Get current risk metrics
 * POST /api/v1/risk/circuit-breaker  - Toggle circuit breaker
 */

export const riskRouter: RouterType = Router();

/**
 * GET /api/v1/risk/metrics
 * Get current portfolio risk metrics.
 */
riskRouter.get('/metrics', async (_req, res) => {
  try {
    // TODO: Integrate with @tradeworks/risk and @tradeworks/db
    const metrics = {
      timestamp: new Date().toISOString(),
      portfolio: {
        equity: 0,
        cash: 0,
        marginUsed: 0,
        marginAvailable: 0,
        buyingPower: 0,
      },
      risk: {
        portfolioHeat: 0,
        portfolioHeatLimit: 6.0,
        dailyPnl: 0,
        dailyPnlPercent: 0,
        dailyLossLimit: 3.0,
        maxDrawdown: 0,
        maxDrawdownLimit: 10.0,
        valueAtRisk1Day: 0,
        valueAtRisk5Day: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
      },
      positions: {
        totalOpen: 0,
        totalValue: 0,
        unrealizedPnl: 0,
        biggestWinner: null as string | null,
        biggestLoser: null as string | null,
      },
      circuitBreaker: {
        tripped: false,
        reason: null as string | null,
        trippedAt: null as string | null,
        canResumeAt: null as string | null,
      },
      exposure: {
        crypto: 0,
        equities: 0,
        predictions: 0,
        cash: 0,
      },
    };

    res.json({ data: metrics });
  } catch (error) {
    console.error('[Risk] Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch risk metrics' });
  }
});

/**
 * GET /api/v1/risk/history
 * Get historical risk metrics.
 */
riskRouter.get('/history', async (req, res) => {
  try {
    const period = (req.query.period as string) ?? '7d';
    const interval = (req.query.interval as string) ?? '1h';

    // TODO: Integrate with @tradeworks/db time-series data
    const history: unknown[] = [];

    res.json({
      data: history,
      period,
      interval,
    });
  } catch (error) {
    console.error('[Risk] Error fetching risk history:', error);
    res.status(500).json({ error: 'Failed to fetch risk history' });
  }
});

/**
 * Circuit breaker toggle schema.
 */
const CircuitBreakerSchema = z.object({
  action: z.enum(['trip', 'reset']),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * POST /api/v1/risk/circuit-breaker
 * Manually trip or reset the circuit breaker. Admin only.
 */
riskRouter.post('/circuit-breaker', requireRole('admin'), async (req, res) => {
  try {
    const body = CircuitBreakerSchema.parse(req.body);

    // TODO: Integrate with engine's circuit breaker via internal communication
    // For now, log the action
    const result = {
      action: body.action,
      reason: body.reason ?? (body.action === 'trip' ? 'Manual override by admin' : 'Manual reset by admin'),
      executedBy: req.user!.email,
      executedAt: new Date().toISOString(),
      success: true,
    };

    console.log(`[Risk] Circuit breaker ${body.action}: ${result.reason} (by ${req.user!.email})`);

    res.json({
      data: result,
      message: `Circuit breaker ${body.action === 'trip' ? 'activated' : 'reset'} successfully`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
      return;
    }
    console.error('[Risk] Error toggling circuit breaker:', error);
    res.status(500).json({ error: 'Failed to toggle circuit breaker' });
  }
});

/**
 * GET /api/v1/risk/limits
 * Get current risk limit configuration.
 */
riskRouter.get('/limits', async (_req, res) => {
  try {
    const limits = {
      perTradeRiskPercent: 1.0,
      highConvictionRiskPercent: 1.5,
      dailyLossLimitPercent: 3.0,
      portfolioHeatLimitPercent: 6.0,
      maxDrawdownPercent: 10.0,
      maxPositionConcentrationPercent: 10.0,
      maxSectorConcentrationPercent: 25.0,
      maxCorrelatedPositions: 3,
      maxLeverage: {
        crypto: 2.0,
        equities: 1.0,
        predictions: 1.0,
      },
      maxDailyTrades: 50,
    };

    res.json({ data: limits });
  } catch (error) {
    console.error('[Risk] Error fetching limits:', error);
    res.status(500).json({ error: 'Failed to fetch risk limits' });
  }
});
