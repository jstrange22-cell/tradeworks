/**
 * Stock Trading API Routes — 14-Engine Stock Intelligence
 */

import { Router, type Router as RouterType } from 'express';
import {
  startStockEngine, stopStockEngine, forceStockScan,
  getStockPortfolio, getStockStatus, getStockRegime,
} from '../services/stock-intelligence/stock-orchestrator.js';

export const stockTradingRouter: RouterType = Router();

stockTradingRouter.get('/status', (_req, res) => {
  res.json({ data: getStockStatus() });
});

stockTradingRouter.get('/scan', async (_req, res) => {
  try {
    const opps = await forceStockScan();
    res.json({ data: { opportunities: opps.length, topOpps: opps.slice(0, 20) }, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err instanceof Error ? err.message : 'Scan failed' }); }
});

stockTradingRouter.get('/portfolio', (_req, res) => {
  res.json({ data: getStockPortfolio() });
});

stockTradingRouter.get('/regime', (_req, res) => {
  res.json({ data: getStockRegime() });
});

stockTradingRouter.get('/activity', (_req, res) => {
  const portfolio = getStockPortfolio();
  const status = getStockStatus();
  res.json({
    data: {
      status: status.running ? 'LIVE' : 'STOPPED',
      regime: status.regime,
      scanCycles: status.scanCycles,
      cashUsd: portfolio.cashUsd,
      totalValue: portfolio.totalValue,
      pnlUsd: portfolio.totalPnlUsd,
      openPositions: portfolio.openPositions.length,
      totalTrades: portfolio.totalTrades,
      winRate: portfolio.winRate,
      byEngine: portfolio.byEngine,
      recentActivity: [
        ...portfolio.openPositions.map(p => ({
          action: p.opportunity.action.toUpperCase(),
          ticker: p.opportunity.ticker,
          engine: p.opportunity.engine,
          size: p.size,
          status: 'open' as const,
          timestamp: p.openedAt,
        })),
        ...portfolio.recentTrades.slice(-10).map(t => ({
          action: t.status === 'closed_win' ? 'WIN' : 'LOSS',
          ticker: t.opportunity.ticker,
          engine: t.opportunity.engine,
          size: t.size,
          pnl: t.pnl,
          status: t.status,
          timestamp: t.closedAt ?? t.openedAt,
        })),
      ],
    },
  });
});

stockTradingRouter.post('/start', (_req, res) => {
  startStockEngine();
  res.json({ message: 'Stock intelligence engines started', data: getStockStatus() });
});

stockTradingRouter.post('/stop', (_req, res) => {
  stopStockEngine();
  res.json({ message: 'Stock intelligence engines stopped', data: getStockStatus() });
});
