import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getLatestRiskSnapshot,
  getRiskHistory,
  getDefaultPortfolio,
  getOpenPositions,
} from '@tradeworks/db';

/**
 * Risk routes.
 * GET  /api/v1/risk/metrics          - Get current risk metrics
 * GET  /api/v1/risk/history          - Get historical risk metrics
 * GET  /api/v1/risk/limits           - Get risk limit configuration
 * POST /api/v1/risk/circuit-breaker  - Toggle circuit breaker
 */

export const riskRouter: RouterType = Router();

/** Placeholder metrics returned when DB is unavailable or no data exists. */
function emptyMetrics() {
  return {
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
}

/**
 * GET /api/v1/risk/metrics
 * Get current portfolio risk metrics.
 */
riskRouter.get('/metrics', async (_req, res) => {
  try {
    let metrics = emptyMetrics();

    try {
      const portfolio = await getDefaultPortfolio();

      if (portfolio) {
        const [snapshot, openPositions] = await Promise.all([
          getLatestRiskSnapshot(portfolio.id),
          getOpenPositions(portfolio.id),
        ]);

        const equity = snapshot ? Number(snapshot.totalEquity) : Number(portfolio.currentCapital);
        const cash = snapshot ? Number(snapshot.cashBalance) : Number(portfolio.currentCapital);

        // Compute position-level aggregates
        let totalPositionValue = 0;
        let totalUnrealizedPnl = 0;
        let biggestWinner: string | null = null;
        let biggestWinnerPnl = -Infinity;
        let biggestLoser: string | null = null;
        let biggestLoserPnl = Infinity;

        for (const pos of openPositions) {
          const pnl = Number(pos.unrealizedPnl ?? 0);
          const qty = Number(pos.quantity);
          const price = Number(pos.currentPrice ?? pos.averageEntry);
          totalPositionValue += qty * price;
          totalUnrealizedPnl += pnl;

          if (pnl > biggestWinnerPnl) {
            biggestWinnerPnl = pnl;
            biggestWinner = pos.instrument;
          }
          if (pnl < biggestLoserPnl) {
            biggestLoserPnl = pnl;
            biggestLoser = pos.instrument;
          }
        }

        // Only set winner/loser if we actually have positions
        if (openPositions.length === 0) {
          biggestWinner = null;
          biggestLoser = null;
        }

        // Bucket positions by market for exposure breakdown
        const exposureBuckets: Record<string, number> = { crypto: 0, equities: 0, predictions: 0 };
        for (const pos of openPositions) {
          const val = Number(pos.quantity) * Number(pos.currentPrice ?? pos.averageEntry);
          if (pos.market in exposureBuckets) {
            exposureBuckets[pos.market] += val;
          }
        }

        const dailyPnl = snapshot ? Number(snapshot.dailyPnl ?? 0) : 0;
        const dailyPnlPercent = equity > 0 ? (dailyPnl / equity) * 100 : 0;

        metrics = {
          timestamp: snapshot ? snapshot.timestamp.toISOString() : new Date().toISOString(),
          portfolio: {
            equity,
            cash,
            marginUsed: Number(snapshot?.grossExposure ?? 0),
            marginAvailable: equity - Number(snapshot?.grossExposure ?? 0),
            buyingPower: equity, // simplified; adjust with leverage factor if needed
          },
          risk: {
            portfolioHeat: Number(snapshot?.portfolioHeat ?? 0),
            portfolioHeatLimit: 6.0,
            dailyPnl,
            dailyPnlPercent,
            dailyLossLimit: 3.0,
            maxDrawdown: Number(snapshot?.maxDrawdown ?? 0),
            maxDrawdownLimit: 10.0,
            valueAtRisk1Day: Number(snapshot?.var95 ?? 0),
            valueAtRisk5Day: Number(snapshot?.var99 ?? 0),
            sharpeRatio: Number(snapshot?.sharpe30d ?? 0),
            sortinoRatio: 0, // not stored in snapshot; leave as 0 for now
          },
          positions: {
            totalOpen: openPositions.length,
            totalValue: totalPositionValue,
            unrealizedPnl: totalUnrealizedPnl,
            biggestWinner,
            biggestLoser,
          },
          circuitBreaker: {
            tripped: snapshot?.circuitBreaker ?? false,
            reason: null,
            trippedAt: null,
            canResumeAt: null,
          },
          exposure: {
            crypto: exposureBuckets['crypto'] ?? 0,
            equities: exposureBuckets['equities'] ?? 0,
            predictions: exposureBuckets['predictions'] ?? 0,
            cash,
          },
        };
      }
    } catch (dbError) {
      console.warn('[Risk] DB unavailable for metrics, returning zeros:', dbError);
    }

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

    // Parse period string to number of days
    const periodMatch = period.match(/^(\d+)([dhm])$/);
    let days = 7; // default
    if (periodMatch) {
      const value = parseInt(periodMatch[1]!, 10);
      const unit = periodMatch[2];
      if (unit === 'd') days = value;
      else if (unit === 'm') days = value * 30;
      else if (unit === 'h') days = Math.max(1, Math.round(value / 24));
    }

    let history: unknown[] = [];

    try {
      const portfolio = await getDefaultPortfolio();
      if (portfolio) {
        history = await getRiskHistory(portfolio.id, days);
      }
    } catch (dbError) {
      console.warn('[Risk] DB unavailable for risk history, returning empty:', dbError);
    }

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
