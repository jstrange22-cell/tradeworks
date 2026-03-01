import { Router, type Router as RouterType } from 'express';

/**
 * Portfolio endpoints with simulated paper trading state.
 * Returns portfolio summary, equity curve, allocation, positions, trades, and agent status.
 *
 * GET /api/v1/portfolio           - Full portfolio summary
 * GET /api/v1/portfolio/equity-curve - Historical equity values
 * GET /api/v1/portfolio/allocation   - Asset allocation breakdown
 * GET /api/v1/portfolio/positions    - Open positions
 * GET /api/v1/portfolio/trades       - Recent trade history
 * GET /api/v1/portfolio/agents       - Agent status + logs + cycles
 * GET /api/v1/portfolio/risk         - Risk metrics
 * PATCH /api/v1/portfolio/mode       - Toggle paper/live
 */

export const portfolioRouter: RouterType = Router();

// --- Simulated Portfolio State ---

interface Position {
  id: string;
  instrument: string;
  market: 'crypto' | 'equity' | 'prediction';
  side: 'long' | 'short';
  quantity: number;
  averageEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  strategyId: string | null;
  openedAt: string;
}

interface Trade {
  id: string;
  instrument: string;
  market: 'crypto' | 'equity' | 'prediction';
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  pnl: number;
  strategyId: string;
  executedAt: string;
}

type AgentType = 'quant' | 'sentiment' | 'macro' | 'risk' | 'execution';
type AgentStatusValue = 'idle' | 'analyzing' | 'deciding' | 'executing' | 'error';

interface AgentStatusInfo {
  agentType: AgentType;
  status: AgentStatusValue;
  lastActivityAt: string;
  currentTask: string | null;
  cyclesCompleted: number;
  errorsToday: number;
}

// Realistic simulated positions
const positions: Position[] = [
  {
    id: 'pos-1', instrument: 'BTC-USD', market: 'crypto', side: 'long',
    quantity: 0.5, averageEntry: 94250, currentPrice: 96480,
    unrealizedPnl: 1115, realizedPnl: 0, strategyId: 'trend-following-btc',
    openedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'pos-2', instrument: 'ETH-USD', market: 'crypto', side: 'long',
    quantity: 5, averageEntry: 3420, currentPrice: 3385,
    unrealizedPnl: -175, realizedPnl: 0, strategyId: 'mean-reversion-eth',
    openedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'pos-3', instrument: 'SPY', market: 'equity', side: 'long',
    quantity: 20, averageEntry: 598.5, currentPrice: 602.3,
    unrealizedPnl: 76, realizedPnl: 0, strategyId: 'momentum-spy',
    openedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'pos-4', instrument: 'SOL-USD', market: 'crypto', side: 'long',
    quantity: 25, averageEntry: 82.4, currentPrice: 87.6,
    unrealizedPnl: 130, realizedPnl: 0, strategyId: 'breakout-sol',
    openedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
  },
];

// Realistic simulated recent trades
const trades: Trade[] = [
  { id: 't1', instrument: 'BTC-USD', market: 'crypto', side: 'buy', quantity: 0.5, price: 94250, pnl: 0, strategyId: 'trend-following-btc', executedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 't2', instrument: 'SOL-USD', market: 'crypto', side: 'sell', quantity: 50, price: 185.2, pnl: 342.5, strategyId: 'breakout-sol', executedAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 't3', instrument: 'ETH-USD', market: 'crypto', side: 'buy', quantity: 5, price: 3420, pnl: 0, strategyId: 'mean-reversion-eth', executedAt: new Date(Date.now() - 10800000).toISOString() },
  { id: 't4', instrument: 'NVDA', market: 'equity', side: 'sell', quantity: 10, price: 875.4, pnl: 215.0, strategyId: 'momentum-nvda', executedAt: new Date(Date.now() - 14400000).toISOString() },
  { id: 't5', instrument: 'SPY', market: 'equity', side: 'buy', quantity: 20, price: 598.5, pnl: 0, strategyId: 'momentum-spy', executedAt: new Date(Date.now() - 18000000).toISOString() },
  { id: 't6', instrument: 'AAPL', market: 'equity', side: 'sell', quantity: 15, price: 242.3, pnl: -89.5, strategyId: 'mean-reversion-aapl', executedAt: new Date(Date.now() - 21600000).toISOString() },
  { id: 't7', instrument: 'BTC-USD', market: 'crypto', side: 'sell', quantity: 0.3, price: 95100, pnl: 480.0, strategyId: 'trend-following-btc', executedAt: new Date(Date.now() - 25200000).toISOString() },
  { id: 't8', instrument: 'LINK-USD', market: 'crypto', side: 'buy', quantity: 200, price: 18.45, pnl: 0, strategyId: 'breakout-link', executedAt: new Date(Date.now() - 28800000).toISOString() },
  { id: 't9', instrument: 'QQQ', market: 'equity', side: 'sell', quantity: 8, price: 510.2, pnl: 156.0, strategyId: 'momentum-qqq', executedAt: new Date(Date.now() - 32400000).toISOString() },
  { id: 't10', instrument: 'AVAX-USD', market: 'crypto', side: 'sell', quantity: 100, price: 42.8, pnl: -62.0, strategyId: 'mean-reversion-avax', executedAt: new Date(Date.now() - 36000000).toISOString() },
];

// Agent status
const agents: Record<AgentType, AgentStatusInfo> = {
  quant: { agentType: 'quant', status: 'idle', lastActivityAt: new Date(Date.now() - 120000).toISOString(), currentTask: null, cyclesCompleted: 42, errorsToday: 0 },
  sentiment: { agentType: 'sentiment', status: 'analyzing', lastActivityAt: new Date().toISOString(), currentTask: 'Scanning BTC-USD social sentiment', cyclesCompleted: 41, errorsToday: 1 },
  macro: { agentType: 'macro', status: 'idle', lastActivityAt: new Date(Date.now() - 300000).toISOString(), currentTask: null, cyclesCompleted: 42, errorsToday: 0 },
  risk: { agentType: 'risk', status: 'idle', lastActivityAt: new Date(Date.now() - 60000).toISOString(), currentTask: null, cyclesCompleted: 42, errorsToday: 0 },
  execution: { agentType: 'execution', status: 'idle', lastActivityAt: new Date(Date.now() - 180000).toISOString(), currentTask: null, cyclesCompleted: 38, errorsToday: 0 },
};

const agentLogs = [
  { id: 'l1', agentType: 'quant', action: 'analyze', summary: 'BTC-USD trend analysis: bullish continuation, RSI 58.3', decision: 'BUY signal confidence 0.72', durationMs: 3200, costUsd: 0.004, timestamp: new Date(Date.now() - 120000).toISOString() },
  { id: 'l2', agentType: 'sentiment', action: 'scan', summary: 'Social sentiment scan across 4 sources', decision: 'Neutral-positive (0.23)', durationMs: 5100, costUsd: 0.006, timestamp: new Date(Date.now() - 180000).toISOString() },
  { id: 'l3', agentType: 'macro', action: 'evaluate', summary: 'No upcoming high-impact events in 48h', decision: null, durationMs: 2800, costUsd: 0.003, timestamp: new Date(Date.now() - 300000).toISOString() },
  { id: 'l4', agentType: 'risk', action: 'assess', summary: 'Portfolio heat 3.2%, VaR95 within limits', decision: 'Trade approved: BTC-USD long 0.5', durationMs: 450, costUsd: 0.001, timestamp: new Date(Date.now() - 320000).toISOString() },
  { id: 'l5', agentType: 'execution', action: 'execute', summary: 'Market order BTC-USD 0.5 @ $94,250', decision: 'Filled with 0.02% slippage', durationMs: 890, costUsd: 0.0, timestamp: new Date(Date.now() - 340000).toISOString() },
  { id: 'l6', agentType: 'quant', action: 'analyze', summary: 'ETH-USD mean reversion setup detected', decision: 'BUY signal confidence 0.65', durationMs: 2900, costUsd: 0.004, timestamp: new Date(Date.now() - 600000).toISOString() },
  { id: 'l7', agentType: 'risk', action: 'assess', summary: 'Correlation check: ETH/BTC 0.78 - within limits', decision: 'Trade approved with reduced size', durationMs: 380, costUsd: 0.001, timestamp: new Date(Date.now() - 620000).toISOString() },
  { id: 'l8', agentType: 'execution', action: 'execute', summary: 'Market order ETH-USD 5 @ $3,420', decision: 'Filled with 0.01% slippage', durationMs: 720, costUsd: 0.0, timestamp: new Date(Date.now() - 640000).toISOString() },
];

const cycles = [
  { id: 'c1', cycleNumber: 42, startedAt: new Date(Date.now() - 120000).toISOString(), completedAt: new Date(Date.now() - 60000).toISOString(), status: 'completed', ordersPlaced: 1, totalCostUsd: 0.014 },
  { id: 'c2', cycleNumber: 41, startedAt: new Date(Date.now() - 720000).toISOString(), completedAt: new Date(Date.now() - 600000).toISOString(), status: 'completed', ordersPlaced: 1, totalCostUsd: 0.009 },
  { id: 'c3', cycleNumber: 40, startedAt: new Date(Date.now() - 1320000).toISOString(), completedAt: new Date(Date.now() - 1200000).toISOString(), status: 'completed', ordersPlaced: 0, totalCostUsd: 0.011 },
  { id: 'c4', cycleNumber: 39, startedAt: new Date(Date.now() - 1920000).toISOString(), completedAt: new Date(Date.now() - 1800000).toISOString(), status: 'completed', ordersPlaced: 2, totalCostUsd: 0.018 },
  { id: 'c5', cycleNumber: 38, startedAt: new Date(Date.now() - 2520000).toISOString(), completedAt: new Date(Date.now() - 2400000).toISOString(), status: 'error', ordersPlaced: 0, totalCostUsd: 0.005 },
];

// Portfolio state
const portfolioState = {
  initialCapital: 100_000,
  mode: 'paper' as 'paper' | 'live',
  circuitBreakerActive: false,
};

function computeEquity(): number {
  const positionValue = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const realizedPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  return portfolioState.initialCapital + positionValue + realizedPnl;
}

function computeDailyPnl(): { pnl: number; percent: number } {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTrades = trades.filter(t => new Date(t.executedAt) >= todayStart);
  const realizedToday = todayTrades.reduce((sum, t) => sum + t.pnl, 0);
  const unrealizedToday = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const pnl = realizedToday + unrealizedToday;
  return { pnl, percent: (pnl / portfolioState.initialCapital) * 100 };
}

// --- Routes ---

portfolioRouter.get('/', (_req, res) => {
  const equity = computeEquity();
  const daily = computeDailyPnl();
  const totalPnl = equity - portfolioState.initialCapital;
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const closedTrades = trades.filter(t => t.pnl !== 0).length;

  res.json({
    equity,
    initialCapital: portfolioState.initialCapital,
    dailyPnl: daily.pnl,
    dailyPnlPercent: daily.percent,
    weeklyPnl: totalPnl * 0.72,
    totalPnl,
    winRate: closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0,
    totalTrades: trades.length,
    openPositions: positions,
    recentTrades: trades,
    equityCurve: generateEquityCurve(equity),
    paperTrading: portfolioState.mode === 'paper',
    circuitBreaker: portfolioState.circuitBreakerActive,
  });
});

portfolioRouter.get('/equity-curve', (_req, res) => {
  const equity = computeEquity();
  res.json({ data: generateEquityCurve(equity) });
});

portfolioRouter.get('/allocation', (_req, res) => {
  const byMarket: Record<string, number> = { cash: 0, crypto: 0, equity: 0, prediction: 0 };
  positions.forEach(p => {
    const value = Math.abs(p.quantity * p.currentPrice);
    byMarket[p.market] = (byMarket[p.market] || 0) + value;
  });
  const totalEquity = computeEquity();
  const positionTotal = Object.values(byMarket).reduce((s, v) => s + v, 0);
  byMarket.cash = totalEquity - positionTotal;

  const data = Object.entries(byMarket).map(([market, value]) => ({
    market,
    value: Math.round(value),
    percent: parseFloat(((value / totalEquity) * 100).toFixed(1)),
  }));
  res.json({ data });
});

portfolioRouter.get('/positions', (_req, res) => {
  const totalUnrealized = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  res.json({
    positions,
    summary: {
      total: positions.length,
      totalUnrealizedPnl: totalUnrealized,
      markets: [...new Set(positions.map(p => p.market))],
    },
  });
});

portfolioRouter.get('/trades', (req, res) => {
  const market = req.query.market as string | undefined;
  const strategy = req.query.strategy as string | undefined;
  const page = parseInt(req.query.page as string) || 0;
  const limit = parseInt(req.query.limit as string) || 15;

  let filtered = [...trades];
  if (market && market !== 'All') filtered = filtered.filter(t => t.market === market);
  if (strategy && strategy !== 'All') filtered = filtered.filter(t => t.strategyId === strategy);

  const total = filtered.length;
  const paginated = filtered.slice(page * limit, (page + 1) * limit);

  res.json({
    trades: paginated,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

portfolioRouter.get('/agents', (_req, res) => {
  res.json({
    agents: Object.values(agents),
    logs: agentLogs,
    cycles,
  });
});

portfolioRouter.get('/risk', (_req, res) => {
  const equity = computeEquity();
  const portfolioHeat = positions.reduce((sum, p) => sum + Math.abs(p.unrealizedPnl), 0) / equity * 100;

  res.json({
    equity,
    cash: equity - positions.reduce((sum, p) => sum + Math.abs(p.quantity * p.currentPrice), 0),
    portfolioHeat,
    var95: 2847.5,
    var99: 4215.3,
    maxDrawdown: -4.2,
    dailyLossUsed: 1.2,
    weeklyLossUsed: 2.1,
    circuitBreakerActive: portfolioState.circuitBreakerActive,
    riskLimits: [
      { metric: 'Risk per Trade', current: 0.8, limit: 1.0, unit: '%' },
      { metric: 'Daily Loss', current: 1.2, limit: 3.0, unit: '%' },
      { metric: 'Weekly Loss', current: 2.1, limit: 7.0, unit: '%' },
      { metric: 'Portfolio Heat', current: portfolioHeat, limit: 6.0, unit: '%' },
      { metric: 'Max Correlation', current: 28, limit: 40, unit: '%' },
      { metric: 'Min Risk/Reward', current: 3.2, limit: 3.0, unit: ':1' },
    ],
    exposureByMarket: [
      { market: 'Crypto', exposure: 34.2, limit: 40 },
      { market: 'Prediction', exposure: 12.5, limit: 30 },
      { market: 'Equity', exposure: 22.8, limit: 40 },
    ],
    drawdownHistory: generateDrawdownHistory(),
  });
});

portfolioRouter.patch('/mode', (req, res) => {
  const { mode } = req.body;
  if (mode !== 'paper' && mode !== 'live') {
    res.status(400).json({ error: 'mode must be "paper" or "live"' });
    return;
  }
  portfolioState.mode = mode;
  res.json({ mode: portfolioState.mode, paperTrading: mode === 'paper' });
});

portfolioRouter.post('/circuit-breaker', (req, res) => {
  const { active } = req.body;
  portfolioState.circuitBreakerActive = !!active;
  res.json({ circuitBreakerActive: portfolioState.circuitBreakerActive });
});

// --- Helpers ---

function generateEquityCurve(currentEquity: number): Array<{ date: string; equity: number }> {
  const points: Array<{ date: string; equity: number }> = [];
  const now = Date.now();
  const dayMs = 86_400_000;

  for (let i = 30; i >= 0; i--) {
    const date = new Date(now - i * dayMs).toISOString().split('T')[0];
    const base = portfolioState.initialCapital;
    const dayIndex = 30 - i;
    const trend = dayIndex * ((currentEquity - base) / 30);
    const noise = Math.sin(dayIndex * 0.3) * 2000 + (Math.random() - 0.5) * 1500;
    points.push({ date, equity: Math.round((base + trend + noise) * 100) / 100 });
  }
  // Ensure last point matches current equity
  points[points.length - 1].equity = currentEquity;
  return points;
}

function generateDrawdownHistory(): Array<{ date: string; drawdown: number }> {
  const points: Array<{ date: string; drawdown: number }> = [];
  const now = Date.now();
  const dayMs = 86_400_000;

  for (let i = 30; i >= 0; i--) {
    const date = new Date(now - i * dayMs).toISOString().split('T')[0];
    const dayIndex = 30 - i;
    points.push({
      date,
      drawdown: -(Math.random() * 3 + Math.sin(dayIndex * 0.4) * 1.5),
    });
  }
  return points;
}

export { portfolioState };
