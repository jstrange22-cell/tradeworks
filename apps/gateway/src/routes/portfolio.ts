import { Router, type Router as RouterType } from 'express';

/**
 * Portfolio endpoints.
 * Returns portfolio summary, equity curve, and allocation data.
 *
 * GET /api/v1/portfolio - Portfolio summary
 * GET /api/v1/portfolio/equity-curve - Historical equity values
 * GET /api/v1/portfolio/allocation - Asset allocation breakdown
 */

export const portfolioRouter: RouterType = Router();

// In-memory portfolio state (will be replaced by database)
const portfolioState = {
  equity: 100_000,
  initialCapital: 100_000,
  dailyPnl: 0,
  dailyPnlPercent: 0,
  openPositions: 0,
  totalTrades: 0,
  winRate: 0,
  mode: 'paper' as 'paper' | 'live',
  circuitBreakerActive: false,
};

portfolioRouter.get('/', (_req, res) => {
  res.json({
    equity: portfolioState.equity,
    initialCapital: portfolioState.initialCapital,
    dailyPnl: portfolioState.dailyPnl,
    dailyPnlPercent: portfolioState.dailyPnlPercent,
    allTimeReturn: ((portfolioState.equity - portfolioState.initialCapital) / portfolioState.initialCapital) * 100,
    openPositions: portfolioState.openPositions,
    totalTrades: portfolioState.totalTrades,
    winRate: portfolioState.winRate,
    mode: portfolioState.mode,
    circuitBreakerActive: portfolioState.circuitBreakerActive,
    risk: {
      portfolioHeat: 0,
      var95: 0,
      var99: 0,
      maxDrawdown: 0,
      dailyLossUsed: 0,
      weeklyLossUsed: 0,
    },
  });
});

portfolioRouter.get('/equity-curve', (_req, res) => {
  // Generate flat equity curve (no trades yet)
  const now = Date.now();
  const dayMs = 86_400_000;
  const points = [];

  for (let i = 30; i >= 0; i--) {
    points.push({
      date: new Date(now - i * dayMs).toISOString().split('T')[0],
      equity: portfolioState.equity,
    });
  }

  res.json({ data: points });
});

portfolioRouter.get('/allocation', (_req, res) => {
  res.json({
    data: [
      { market: 'cash', value: portfolioState.equity, percent: 100 },
      { market: 'crypto', value: 0, percent: 0 },
      { market: 'equity', value: 0, percent: 0 },
      { market: 'prediction', value: 0, percent: 0 },
    ],
  });
});

// Update portfolio mode
portfolioRouter.patch('/mode', (req, res) => {
  const { mode } = req.body;
  if (mode !== 'paper' && mode !== 'live') {
    res.status(400).json({ error: 'mode must be "paper" or "live"' });
    return;
  }
  portfolioState.mode = mode;
  res.json({ mode: portfolioState.mode });
});

export { portfolioState };
