/**
 * Sports Betting API Routes — 6-Engine Sports Intelligence
 *
 * GET  /api/v1/sports/status          — Engine status
 * GET  /api/v1/sports/scan            — Force scan all 6 engines
 * GET  /api/v1/sports/portfolio       — Paper sports portfolio
 * GET  /api/v1/sports/clv             — CLV tracking report
 * GET  /api/v1/sports/events          — Upcoming events with odds
 * POST /api/v1/sports/start           — Start sports engines
 * POST /api/v1/sports/stop            — Stop sports engines
 */

import { Router, type Router as RouterType } from 'express';
import {
  startSportsEngine,
  stopSportsEngine,
  forceScan,
  getSportsPortfolio,
  getSportsStatus,
  getCLVReport,
} from '../services/sports-intelligence/sports-orchestrator.js';
import { getOdds } from '../services/sports-intelligence/odds-api-client.js';

export const sportsBettingRouter: RouterType = Router();

sportsBettingRouter.get('/status', (_req, res) => {
  res.json({ data: getSportsStatus() });
});

sportsBettingRouter.get('/scan', async (_req, res) => {
  try {
    const opps = await forceScan();
    res.json({
      data: {
        opportunities: opps.length,
        topOpps: opps.slice(0, 20).map(o => ({
          engine: o.engine,
          sport: o.sport,
          homeTeam: o.homeTeam,
          awayTeam: o.awayTeam,
          side: o.side,
          softBook: o.softBook,
          evPct: (o.evPct * 100).toFixed(1) + '%',
          trueProb: (o.trueProb * 100).toFixed(0) + '%',
          confidence: o.confidence,
          reasoning: o.reasoning,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scan failed' });
  }
});

sportsBettingRouter.get('/portfolio', (_req, res) => {
  res.json({ data: getSportsPortfolio() });
});

sportsBettingRouter.get('/clv', (_req, res) => {
  res.json({ data: getCLVReport() });
});

sportsBettingRouter.get('/events', async (req, res) => {
  try {
    const sport = (req.query.sport as string) ?? 'americanfootball_nfl';
    const events = await getOdds({ sport, regions: 'us', markets: 'h2h' });
    res.json({
      data: events.map(e => ({
        id: e.id,
        sport: e.sport_key,
        homeTeam: e.home_team,
        awayTeam: e.away_team,
        commenceTime: e.commence_time,
        bookmakers: e.bookmakers.length,
      })),
      count: events.length,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

sportsBettingRouter.post('/start', (_req, res) => {
  startSportsEngine();
  res.json({ message: 'Sports intelligence engines started', data: getSportsStatus() });
});

sportsBettingRouter.post('/stop', (_req, res) => {
  stopSportsEngine();
  res.json({ message: 'Sports intelligence engines stopped', data: getSportsStatus() });
});

// GET /activity — Live activity feed for dashboard
sportsBettingRouter.get('/activity', (_req, res) => {
  const portfolio = getSportsPortfolio();
  const status = getSportsStatus();

  const recentActivity = [
    ...portfolio.openBets.map(b => ({
      action: 'BET' as const,
      symbol: `${b.opportunity.homeTeam} vs ${b.opportunity.awayTeam}`,
      detail: `${b.opportunity.engine} ${b.opportunity.side} on ${b.opportunity.softBook}`,
      amount: b.size,
      ev: `+${(b.opportunity.evPct * 100).toFixed(1)}%`,
      status: 'open' as const,
      timestamp: b.placedAt,
    })),
    ...portfolio.recentBets.map(b => ({
      action: b.status === 'won' ? 'WIN' as const : 'LOSS' as const,
      symbol: `${b.opportunity.homeTeam} vs ${b.opportunity.awayTeam}`,
      detail: `${b.opportunity.engine} P&L: $${b.pnl.toFixed(2)}`,
      amount: b.size,
      ev: `+${(b.opportunity.evPct * 100).toFixed(1)}%`,
      status: b.status,
      timestamp: b.settledAt ?? b.placedAt,
    })),
  ];

  res.json({
    data: {
      status: status.running ? 'LIVE' : 'STOPPED',
      scanCycles: status.scanCycles,
      cashUsd: portfolio.cashUsd,
      totalValue: portfolio.totalValue,
      pnlUsd: portfolio.totalPnlUsd,
      openBets: portfolio.openBets.length,
      totalBets: portfolio.totalBets,
      winRate: portfolio.winRate,
      clv: portfolio.rollingClv,
      recentActivity,
    },
  });
});
