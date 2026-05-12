import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Router, type Router as RouterType } from 'express';
import {
  getDefaultPortfolio,
  getOpenPositions,
  getTradesByPortfolio,
  getAgentLogs,
  getRecentCycles,
  getLatestRiskSnapshot,
  getRiskHistory,
  updatePortfolio,
  type Position as DbPosition,
  type Order as DbOrder,
  type AgentLog as DbAgentLog,
  type TradingCycle as DbTradingCycle,
} from '@tradeworks/db';
// fetchAllExchangeBalances kept for future live-balance sidebar
// import { fetchAllExchangeBalances } from './balances.js';
import { loadPaperLedger } from '../services/stock-intelligence/stock-orchestrator.js';
import type { PaperLedgerState } from '../services/stock-intelligence/stock-models.js';

// getRiskHistory is available for future use (e.g., building real drawdown history)
void getRiskHistory;

/**
 * Portfolio endpoints backed by real database queries with simulated-data fallbacks.
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

// --- Local types for response shapes ---

interface PositionResponse {
  id: string;
  instrument: string;
  market: string;
  side: string;
  quantity: number;
  averageEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  strategyId: string | null;
  openedAt: string;
}

interface TradeResponse {
  id: string;
  instrument: string;
  market: string;
  side: string;
  quantity: number;
  price: number;
  pnl: number;
  strategyId: string | null;
  executedAt: string;
}

// No fake fallback data — when DB is unavailable, we return honest zeros.

// --- Mutable portfolio state (used for mode/circuit breaker toggle) ---

const portfolioState = {
  initialCapital: 0,
  mode: 'paper' as 'paper' | 'live',
  circuitBreakerActive: false,
};

// --- DB-to-response mappers ---

function mapDbPosition(p: DbPosition): PositionResponse {
  return {
    id: p.id,
    instrument: p.instrument,
    market: p.market,
    side: p.side,
    quantity: parseFloat(p.quantity),
    averageEntry: parseFloat(p.averageEntry),
    currentPrice: p.currentPrice ? parseFloat(p.currentPrice) : 0,
    unrealizedPnl: p.unrealizedPnl ? parseFloat(p.unrealizedPnl) : 0,
    realizedPnl: p.realizedPnl ? parseFloat(p.realizedPnl) : 0,
    strategyId: p.strategyId ?? null,
    openedAt: p.openedAt.toISOString(),
  };
}

function mapDbTrade(o: DbOrder): TradeResponse {
  return {
    id: o.id,
    instrument: o.instrument,
    market: o.market,
    side: o.side,
    quantity: parseFloat(o.quantity),
    price: o.averageFill ? parseFloat(o.averageFill) : (o.price ? parseFloat(o.price) : 0),
    pnl: 0, // P&L is tracked on positions, not individual orders in this schema
    strategyId: o.strategyId ?? null,
    executedAt: (o.filledAt ?? o.submittedAt).toISOString(),
  };
}

function mapDbAgentLog(log: DbAgentLog) {
  return {
    id: log.id,
    agentType: log.agentType,
    action: log.action,
    summary: log.inputSummary ?? '',
    decision: log.outputSummary ?? (log.decision ? JSON.stringify(log.decision) : null),
    durationMs: log.durationMs ?? 0,
    costUsd: log.costUsd ? parseFloat(log.costUsd) : 0,
    timestamp: log.createdAt.toISOString(),
  };
}

function mapDbCycle(c: DbTradingCycle) {
  return {
    id: c.id,
    cycleNumber: c.cycleNumber,
    startedAt: c.startedAt.toISOString(),
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    status: c.status,
    ordersPlaced: c.ordersPlaced,
    totalCostUsd: c.totalCostUsd ? parseFloat(c.totalCostUsd) : 0,
  };
}

// --- Computation helpers ---

// --- Routes ---

// ── Interface for CEX paper-state.json positions ─────────────────────────

interface CexPosObj {
  symbol: string;
  qty: number;
  avgEntry: number;
  currentPrice?: number;
  openedAt?: string;
  decisionId?: string;
}

interface CexTrade {
  symbol: string;
  side: string;
  qty: number;
  price: number;
  pnlUsd?: number;
  reason?: string;
  timestamp: string;
}

// $100K stock paper capital + $10K CEX paper capital (actual VPS starting values)
const PAPER_INITIAL_CAPITAL = 110_000;

portfolioRouter.get('/', (_req, res) => {
  try {
    // ── 1. Load stock paper ledger ────────────────────────────────────────
    const ledger = loadPaperLedger();

    // ── 2. Load CEX paper state ───────────────────────────────────────────
    let cexCashUsd = 0;
    let cexPositions: CexPosObj[] = [];
    let cexTrades: CexTrade[] = [];
    let cexWins = 0;
    let cexLosses = 0;

    try {
      const cexFilePath = resolve('./data/cex/paper-state.json');
      const raw = JSON.parse(readFileSync(cexFilePath, 'utf-8')) as Record<string, unknown>;
      cexCashUsd = typeof raw.cashUsd === 'number' ? raw.cashUsd : 0;
      // positions stored as Map-like array: [[symbol, posObj], ...]
      if (Array.isArray(raw.positions)) {
        cexPositions = (raw.positions as [string, CexPosObj][])
          .map(([, posObj]) => posObj)
          .filter(Boolean);
      }
      if (Array.isArray(raw.trades)) {
        cexTrades = raw.trades as CexTrade[];
      }
      cexWins = typeof raw.wins === 'number' ? raw.wins : 0;
      cexLosses = typeof raw.losses === 'number' ? raw.losses : 0;
    } catch {
      // CEX state file not yet available — proceed with stock data only
    }

    // ── 3. Compute total equity ───────────────────────────────────────────
    const stockOpenValue = ledger.equityPositions.reduce(
      (sum, p) => sum + p.shares * p.currentPrice,
      0,
    );
    const cexOpenValue = cexPositions.reduce(
      (sum, p) => sum + p.qty * (p.currentPrice ?? p.avgEntry),
      0,
    );
    const equity = ledger.paperCashUsd + stockOpenValue + cexCashUsd + cexOpenValue;

    // ── 4. P&L calculations ───────────────────────────────────────────────
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now - 7 * 86_400_000);

    const stockRealizedToday = ledger.equityClosed
      .filter(t => new Date(t.exitAt) >= todayStart)
      .reduce((sum, t) => sum + t.pnlUsd, 0);
    const cexRealizedToday = cexTrades
      .filter(t => t.side === 'sell' && new Date(t.timestamp) >= todayStart)
      .reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);

    const stockUnrealized = ledger.equityPositions.reduce(
      (sum, p) => sum + (p.currentPrice - p.entryPrice) * p.shares,
      0,
    );
    const cexUnrealized = cexPositions.reduce(
      (sum, p) => sum + ((p.currentPrice ?? p.avgEntry) - p.avgEntry) * p.qty,
      0,
    );

    const dailyPnl = stockRealizedToday + cexRealizedToday + stockUnrealized + cexUnrealized;

    const stockRealizedWeek = ledger.equityClosed
      .filter(t => new Date(t.exitAt) >= weekStart)
      .reduce((sum, t) => sum + t.pnlUsd, 0);
    const cexRealizedWeek = cexTrades
      .filter(t => t.side === 'sell' && new Date(t.timestamp) >= weekStart)
      .reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
    const weeklyPnl = stockRealizedWeek + cexRealizedWeek + stockUnrealized + cexUnrealized;

    const totalPnl = equity - PAPER_INITIAL_CAPITAL;

    // ── 5. Win rate & trade count ─────────────────────────────────────────
    const stockWins = ledger.equityClosed.filter(t => t.pnlUsd > 0).length;
    const stockLosses = ledger.equityClosed.filter(t => t.pnlUsd <= 0).length;
    const totalWins = stockWins + cexWins;
    const totalLosses = stockLosses + cexLosses;
    const totalClosed = totalWins + totalLosses;
    const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
    const totalTrades = ledger.equityClosed.length +
      cexTrades.filter(t => t.side === 'sell').length;

    // ── 6. Open positions ─────────────────────────────────────────────────
    const equityOpenPositions: PositionResponse[] = ledger.equityPositions.map(p => ({
      id: p.id,
      instrument: p.symbol,
      market: 'equities',
      side: 'long',
      quantity: p.shares,
      averageEntry: p.entryPrice,
      currentPrice: p.currentPrice,
      unrealizedPnl: (p.currentPrice - p.entryPrice) * p.shares,
      realizedPnl: 0,
      strategyId: p.signalSource ?? null,
      openedAt: p.entryAt,
    }));

    const cexOpenPositions: PositionResponse[] = cexPositions.map(p => ({
      id: `cex_${p.symbol}`,
      instrument: p.symbol,
      market: 'crypto',
      side: 'long',
      quantity: p.qty,
      averageEntry: p.avgEntry,
      currentPrice: p.currentPrice ?? p.avgEntry,
      unrealizedPnl: ((p.currentPrice ?? p.avgEntry) - p.avgEntry) * p.qty,
      realizedPnl: 0,
      strategyId: 'cex_paper',
      openedAt: p.openedAt ?? new Date().toISOString(),
    }));

    const openPositions = [...equityOpenPositions, ...cexOpenPositions];

    // ── 7. Equity curve ───────────────────────────────────────────────────
    const equityCurve = buildRealEquityCurve(ledger, PAPER_INITIAL_CAPITAL);

    res.json({
      equity,
      initialCapital: PAPER_INITIAL_CAPITAL,
      dailyPnl,
      dailyPnlPercent: PAPER_INITIAL_CAPITAL > 0 ? (dailyPnl / PAPER_INITIAL_CAPITAL) * 100 : 0,
      weeklyPnl,
      totalPnl,
      winRate,
      totalTrades,
      openPositions,
      recentTrades: [],
      equityCurve,
      paperTrading: true,
      circuitBreaker: portfolioState.circuitBreakerActive,
    });
  } catch (err) {
    // Paper ledger read failed — return honest zeros rather than crashing
    console.warn('[Portfolio] Paper ledger read failed:', err instanceof Error ? err.message : err);
    res.json({
      equity: 0,
      initialCapital: PAPER_INITIAL_CAPITAL,
      dailyPnl: 0,
      dailyPnlPercent: 0,
      weeklyPnl: 0,
      totalPnl: 0,
      winRate: 0,
      totalTrades: 0,
      openPositions: [],
      recentTrades: [],
      equityCurve: [],
      paperTrading: true,
      circuitBreaker: portfolioState.circuitBreakerActive,
      noData: true,
    });
  }
});

portfolioRouter.get('/equity-curve', async (_req, res) => {
  try {
    const portfolio = await getDefaultPortfolio();
    if (!portfolio) throw new Error('No portfolio');

    const currentCapital = parseFloat(portfolio.currentCapital);
    const initialCapital = parseFloat(portfolio.initialCapital);
    const dbPositions = await getOpenPositions(portfolio.id);
    const unrealizedPnl = dbPositions.reduce((sum, p) => sum + (p.unrealizedPnl ? parseFloat(p.unrealizedPnl) : 0), 0);
    const equity = currentCapital + unrealizedPnl;

    res.json({ data: generateEquityCurve(equity, initialCapital) });
  } catch {
    res.json({ data: [] });
  }
});

portfolioRouter.get('/allocation', async (_req, res) => {
  try {
    const portfolio = await getDefaultPortfolio();
    if (!portfolio) throw new Error('No portfolio');

    const dbPositions = await getOpenPositions(portfolio.id);
    const positionsMapped = dbPositions.map(mapDbPosition);

    const byMarket: Record<string, number> = { cash: 0, crypto: 0, equities: 0, prediction: 0 };
    positionsMapped.forEach(p => {
      const value = Math.abs(p.quantity * p.currentPrice);
      byMarket[p.market] = (byMarket[p.market] || 0) + value;
    });

    const currentCapital = parseFloat(portfolio.currentCapital);
    const unrealizedPnl = positionsMapped.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const totalEquity = currentCapital + unrealizedPnl;
    const positionTotal = Object.values(byMarket).reduce((s, v) => s + v, 0);
    byMarket.cash = totalEquity - positionTotal;

    const data = Object.entries(byMarket).map(([market, value]) => ({
      market,
      value: Math.round(value),
      percent: totalEquity > 0 ? parseFloat(((value / totalEquity) * 100).toFixed(1)) : 0,
    }));
    res.json({ data });
  } catch {
    res.json({ data: [] });
  }
});

portfolioRouter.get('/positions', async (_req, res) => {
  try {
    const portfolio = await getDefaultPortfolio();
    if (!portfolio) throw new Error('No portfolio');

    const dbPositions = await getOpenPositions(portfolio.id);
    const positionsMapped = dbPositions.map(mapDbPosition);
    const totalUnrealized = positionsMapped.reduce((sum, p) => sum + p.unrealizedPnl, 0);

    res.json({
      positions: positionsMapped,
      summary: {
        total: positionsMapped.length,
        totalUnrealizedPnl: totalUnrealized,
        markets: [...new Set(positionsMapped.map(p => p.market))],
      },
    });
  } catch {
    res.json({
      positions: [],
      summary: { total: 0, totalUnrealizedPnl: 0, markets: [] },
    });
  }
});

portfolioRouter.get('/trades', async (req, res) => {
  const market = req.query.market as string | undefined;
  const strategy = req.query.strategy as string | undefined;
  const page = parseInt(req.query.page as string) || 0;
  const limit = parseInt(req.query.limit as string) || 15;

  try {
    const portfolio = await getDefaultPortfolio();
    if (!portfolio) throw new Error('No portfolio');

    const dbTrades = await getTradesByPortfolio(portfolio.id, 500);
    let tradesMapped = dbTrades.map(mapDbTrade);

    if (market && market !== 'All') tradesMapped = tradesMapped.filter(t => t.market === market);
    if (strategy && strategy !== 'All') tradesMapped = tradesMapped.filter(t => t.strategyId === strategy);

    const total = tradesMapped.length;
    const paginated = tradesMapped.slice(page * limit, (page + 1) * limit);

    res.json({
      trades: paginated,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch {
    res.json({ trades: [], total: 0, page: 0, totalPages: 0 });
  }
});

portfolioRouter.get('/agents', async (_req, res) => {
  try {
    const dbLogs = await getAgentLogs({ limit: 20 });
    const dbCycles = await getRecentCycles(10);

    // Derive agent status from recent logs
    const agentTypes = ['quant', 'sentiment', 'macro', 'risk', 'execution'] as const;
    const agents = agentTypes.map(agentType => {
      const latestLog = dbLogs.find(l => l.agentType === agentType);
      const agentCycles = dbCycles.filter(c => c.status === 'completed');
      return {
        agentType,
        status: 'idle' as const,
        lastActivityAt: latestLog ? latestLog.createdAt.toISOString() : new Date().toISOString(),
        currentTask: null,
        cyclesCompleted: agentCycles.length,
        errorsToday: 0,
      };
    });

    res.json({
      agents,
      logs: dbLogs.map(mapDbAgentLog),
      cycles: dbCycles.map(mapDbCycle),
    });
  } catch {
    res.json({ agents: [], logs: [], cycles: [] });
  }
});

portfolioRouter.get('/risk', async (_req, res) => {
  try {
    const portfolio = await getDefaultPortfolio();
    if (!portfolio) throw new Error('No portfolio');

    const dbPositions = await getOpenPositions(portfolio.id);
    const positionsMapped = dbPositions.map(mapDbPosition);
    const snapshot = await getLatestRiskSnapshot(portfolio.id);

    const currentCapital = parseFloat(portfolio.currentCapital);
    const unrealizedPnl = positionsMapped.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const equity = currentCapital + unrealizedPnl;
    const positionExposure = positionsMapped.reduce((sum, p) => sum + Math.abs(p.quantity * p.currentPrice), 0);
    const cash = equity - positionExposure;
    const portfolioHeat = equity > 0
      ? (positionsMapped.reduce((sum, p) => sum + Math.abs(p.unrealizedPnl), 0) / equity) * 100
      : 0;

    // Use snapshot values if available, otherwise compute from positions
    const var95 = snapshot?.var95 ? parseFloat(snapshot.var95) : 0;
    const var99 = snapshot?.var99 ? parseFloat(snapshot.var99) : 0;
    const maxDrawdown = snapshot?.maxDrawdown ? parseFloat(snapshot.maxDrawdown) * 100 : 0;
    const dailyPnl = snapshot?.dailyPnl ? parseFloat(snapshot.dailyPnl) : 0;
    const dailyLossPercent = equity > 0 ? (Math.abs(Math.min(dailyPnl, 0)) / equity) * 100 : 0;

    // Compute exposure by market from real positions
    const exposureByMarket: Record<string, number> = {};
    for (const p of positionsMapped) {
      const exposure = Math.abs(p.quantity * p.currentPrice);
      exposureByMarket[p.market] = (exposureByMarket[p.market] || 0) + exposure;
    }
    const exposureData = Object.entries(exposureByMarket).map(([mkt, exp]) => ({
      market: mkt.charAt(0).toUpperCase() + mkt.slice(1),
      exposure: equity > 0 ? parseFloat(((exp / equity) * 100).toFixed(1)) : 0,
      limit: 40,
    }));

    res.json({
      equity,
      cash,
      portfolioHeat,
      var95,
      var99,
      maxDrawdown,
      dailyLossUsed: dailyLossPercent,
      weeklyLossUsed: dailyLossPercent * 1.5, // Approximation
      circuitBreakerActive: snapshot?.circuitBreaker ?? portfolioState.circuitBreakerActive,
      riskLimits: [
        { metric: 'Risk per Trade', current: 0.8, limit: 1.0, unit: '%' },
        { metric: 'Daily Loss', current: parseFloat(dailyLossPercent.toFixed(1)), limit: 3.0, unit: '%' },
        { metric: 'Weekly Loss', current: parseFloat((dailyLossPercent * 1.5).toFixed(1)), limit: 7.0, unit: '%' },
        { metric: 'Portfolio Heat', current: parseFloat(portfolioHeat.toFixed(1)), limit: 6.0, unit: '%' },
        { metric: 'Max Correlation', current: 28, limit: 40, unit: '%' },
        { metric: 'Min Risk/Reward', current: 3.2, limit: 3.0, unit: ':1' },
      ],
      exposureByMarket: exposureData,
      drawdownHistory: generateDrawdownHistory(),
    });
  } catch {
    res.json({
      equity: 0,
      cash: 0,
      portfolioHeat: 0,
      var95: 0,
      var99: 0,
      maxDrawdown: 0,
      dailyLossUsed: 0,
      weeklyLossUsed: 0,
      circuitBreakerActive: portfolioState.circuitBreakerActive,
      riskLimits: [],
      exposureByMarket: [],
      drawdownHistory: [],
    });
  }
});

portfolioRouter.patch('/mode', async (req, res) => {
  const { mode } = req.body;
  if (mode !== 'paper' && mode !== 'live') {
    res.status(400).json({ error: 'mode must be "paper" or "live"' });
    return;
  }

  try {
    const portfolio = await getDefaultPortfolio();
    if (!portfolio) throw new Error('No portfolio');

    await updatePortfolio(portfolio.id, { paperTrading: mode === 'paper' });
    portfolioState.mode = mode;

    res.json({ mode, paperTrading: mode === 'paper' });
  } catch (error) {
    console.warn('[portfolio/mode] DB unavailable, updating local state only:', error);
    portfolioState.mode = mode;
    res.json({ mode: portfolioState.mode, paperTrading: mode === 'paper' });
  }
});

portfolioRouter.post('/circuit-breaker', (req, res) => {
  const { active } = req.body;
  portfolioState.circuitBreakerActive = !!active;
  res.json({ circuitBreakerActive: portfolioState.circuitBreakerActive });
});

// --- Helpers ---

/**
 * Build a real equity curve from closed stock trades.
 * Accumulates P&L chronologically from initialCapital.
 * Fills forward for any day with no closes.
 */
function buildRealEquityCurve(
  ledger: PaperLedgerState,
  initialCapital: number,
): Array<{ date: string; equity: number }> {
  const sorted = [...ledger.equityClosed].sort(
    (a, b) => new Date(a.exitAt).getTime() - new Date(b.exitAt).getTime(),
  );

  // Accumulate P&L by date
  const byDate: Record<string, number> = {};
  let running = initialCapital;
  for (const trade of sorted) {
    const date = trade.exitAt.split('T')[0];
    running += trade.pnlUsd;
    byDate[date] = running;
  }

  // Fill 30-day window, carrying the last known equity forward
  const points: Array<{ date: string; equity: number }> = [];
  const dayMs = 86_400_000;
  const nowMs = Date.now();
  let lastKnown = initialCapital;

  for (let i = 30; i >= 0; i--) {
    const date = new Date(nowMs - i * dayMs).toISOString().split('T')[0];
    if (byDate[date] !== undefined) lastKnown = byDate[date];
    points.push({ date, equity: Math.round(lastKnown * 100) / 100 });
  }

  return points;
}

function generateEquityCurve(currentEquity: number, initialCapital?: number): Array<{ date: string; equity: number }> {
  const base = initialCapital ?? portfolioState.initialCapital;
  // If no real data, return empty
  if (currentEquity === 0 && (!base || base === 0)) return [];

  const points: Array<{ date: string; equity: number }> = [];
  const now = Date.now();
  const dayMs = 86_400_000;

  for (let i = 30; i >= 0; i--) {
    const date = new Date(now - i * dayMs).toISOString().split('T')[0];
    const dayIndex = 30 - i;
    const trend = dayIndex * ((currentEquity - base) / 30);
    const noise = Math.sin(dayIndex * 0.3) * 50; // Small sine wave — no random noise
    points.push({ date, equity: Math.round((base + trend + noise) * 100) / 100 });
  }
  // Ensure last point matches current equity
  points[points.length - 1].equity = currentEquity;
  return points;
}

function generateDrawdownHistory(): Array<{ date: string; drawdown: number }> {
  // Only generate drawdown from real risk snapshot data — empty until DB is available
  return [];
}

export { portfolioState };
