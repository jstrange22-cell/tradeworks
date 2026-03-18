/**
 * Performance Analytics — Phase 8
 *
 * Computes advanced trading metrics from execution history:
 * win/loss rates, P&L, risk-adjusted ratios, streaks,
 * trigger breakdowns, and daily P&L for charting.
 */

import type { SnipeExecution } from '../../routes/solana-sniper/types.js';

// ── Types ──────────────────────────────────────────────────────────────

interface TriggerStats {
  count: number;
  winRate: number;
  pnlSol: number;
}

interface LargestTrade {
  symbol: string;
  pnlSol: number;
}

interface DailyPnlEntry {
  date: string;
  pnlSol: number;
  trades: number;
}

export interface PerformanceMetrics {
  // Core
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;

  // P&L
  totalPnlSol: number;
  avgWinSol: number;
  avgLossSol: number;
  largestWin: LargestTrade | null;
  largestLoss: LargestTrade | null;

  // Risk-adjusted
  profitFactor: number;
  avgRiskReward: number;

  // Time-based
  avgHoldTimeMs: number;
  tradesPerDay: number;

  // By trigger
  triggerBreakdown: Record<string, TriggerStats>;

  // Streaks
  currentStreak: number;
  longestWinStreak: number;
  longestLossStreak: number;

  // Daily
  dailyPnl: DailyPnlEntry[];

  period: string;
}

// ── Internal trade representation ──────────────────────────────────────

interface MatchedTrade {
  mint: string;
  symbol: string;
  buySol: number;
  sellSol: number;
  pnlSol: number;
  isWin: boolean;
  buyTimestamp: number;
  sellTimestamp: number;
  holdTimeMs: number;
  trigger: string;
}

// ── Period filtering ────────────────────────────────────────────────────

type Period = 'all' | '24h' | '7d' | '30d';

function getPeriodCutoff(period: Period): number {
  if (period === 'all') return 0;
  const now = Date.now();
  const ms: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return now - (ms[period] ?? 0);
}

// ── Buy/Sell pair matching ──────────────────────────────────────────────

function matchTrades(executions: ReadonlyArray<SnipeExecution>): MatchedTrade[] {
  // Only successful executions
  const successful = executions.filter((e) => e.status === 'success');

  // Group buys by mint (FIFO queue per mint)
  const buyQueues = new Map<string, SnipeExecution[]>();
  const trades: MatchedTrade[] = [];

  for (const exec of successful) {
    if (exec.action === 'buy') {
      const queue = buyQueues.get(exec.mint) ?? [];
      queue.push(exec);
      buyQueues.set(exec.mint, queue);
    } else if (exec.action === 'sell') {
      const queue = buyQueues.get(exec.mint);
      if (!queue || queue.length === 0) continue; // orphaned sell, skip

      const buy = queue.shift()!;
      const buyTs = new Date(buy.timestamp).getTime();
      const sellTs = new Date(exec.timestamp).getTime();
      const pnl = exec.amountSol - buy.amountSol;

      trades.push({
        mint: exec.mint,
        symbol: exec.symbol,
        buySol: buy.amountSol,
        sellSol: exec.amountSol,
        pnlSol: pnl,
        isWin: pnl > 0,
        buyTimestamp: buyTs,
        sellTimestamp: sellTs,
        holdTimeMs: Math.max(0, sellTs - buyTs),
        trigger: exec.trigger,
      });
    }
  }

  return trades;
}

// ── Streak calculation ──────────────────────────────────────────────────

interface StreakResult {
  current: number;
  longestWin: number;
  longestLoss: number;
}

function calculateStreaks(trades: ReadonlyArray<MatchedTrade>): StreakResult {
  let current = 0;
  let longestWin = 0;
  let longestLoss = 0;
  let winRun = 0;
  let lossRun = 0;

  for (const trade of trades) {
    if (trade.isWin) {
      winRun++;
      lossRun = 0;
      if (winRun > longestWin) longestWin = winRun;
    } else {
      lossRun++;
      winRun = 0;
      if (lossRun > longestLoss) longestLoss = lossRun;
    }
  }

  // Current streak: positive = consecutive wins, negative = consecutive losses
  if (trades.length > 0) {
    const last = trades[trades.length - 1]!;
    if (last.isWin) {
      current = winRun;
    } else {
      current = -lossRun;
    }
  }

  return { current, longestWin, longestLoss };
}

// ── Daily P&L aggregation ──────────────────────────────────────────────

function buildDailyPnl(trades: ReadonlyArray<MatchedTrade>): DailyPnlEntry[] {
  const daily = new Map<string, { pnlSol: number; trades: number }>();

  for (const trade of trades) {
    const date = new Date(trade.sellTimestamp).toISOString().slice(0, 10);
    const existing = daily.get(date) ?? { pnlSol: 0, trades: 0 };
    existing.pnlSol += trade.pnlSol;
    existing.trades++;
    daily.set(date, existing);
  }

  return [...daily.entries()]
    .map(([date, data]) => ({ date, pnlSol: data.pnlSol, trades: data.trades }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Trigger breakdown ──────────────────────────────────────────────────

function buildTriggerBreakdown(
  trades: ReadonlyArray<MatchedTrade>,
): Record<string, TriggerStats> {
  const groups = new Map<string, { wins: number; total: number; pnlSol: number }>();

  for (const trade of trades) {
    const existing = groups.get(trade.trigger) ?? { wins: 0, total: 0, pnlSol: 0 };
    existing.total++;
    if (trade.isWin) existing.wins++;
    existing.pnlSol += trade.pnlSol;
    groups.set(trade.trigger, existing);
  }

  const result: Record<string, TriggerStats> = {};
  for (const [trigger, data] of groups) {
    result[trigger] = {
      count: data.total,
      winRate: data.total > 0 ? data.wins / data.total : 0,
      pnlSol: data.pnlSol,
    };
  }
  return result;
}

// ── Main computation ────────────────────────────────────────────────────

export function computePerformanceMetrics(params: {
  executions: ReadonlyArray<SnipeExecution>;
  period?: Period;
  templateId?: string;
}): PerformanceMetrics {
  const period = params.period ?? 'all';
  const cutoff = getPeriodCutoff(period);

  // Filter executions
  let filtered = params.executions;
  if (cutoff > 0) {
    filtered = filtered.filter(
      (e) => new Date(e.timestamp).getTime() >= cutoff,
    );
  }
  if (params.templateId) {
    filtered = filtered.filter((e) => e.templateId === params.templateId);
  }

  // Sort chronologically for correct FIFO matching
  const sorted = [...filtered].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const trades = matchTrades(sorted);

  // Edge case: no completed trades
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlSol: 0,
      avgWinSol: 0,
      avgLossSol: 0,
      largestWin: null,
      largestLoss: null,
      profitFactor: 0,
      avgRiskReward: 0,
      avgHoldTimeMs: 0,
      tradesPerDay: 0,
      triggerBreakdown: {},
      currentStreak: 0,
      longestWinStreak: 0,
      longestLossStreak: 0,
      dailyPnl: [],
      period,
    };
  }

  const wins = trades.filter((t) => t.isWin);
  const losses = trades.filter((t) => !t.isWin);

  const grossProfit = wins.reduce((s, t) => s + t.pnlSol, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlSol, 0));

  const avgWinSol = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLossSol = losses.length > 0 ? grossLoss / losses.length : 0;

  // Largest win/loss
  let largestWin: LargestTrade | null = null;
  let largestLoss: LargestTrade | null = null;

  for (const trade of trades) {
    if (trade.isWin) {
      if (!largestWin || trade.pnlSol > largestWin.pnlSol) {
        largestWin = { symbol: trade.symbol, pnlSol: trade.pnlSol };
      }
    } else {
      if (!largestLoss || trade.pnlSol < largestLoss.pnlSol) {
        largestLoss = { symbol: trade.symbol, pnlSol: trade.pnlSol };
      }
    }
  }

  // Time-based metrics
  const totalHoldTimeMs = trades.reduce((s, t) => s + t.holdTimeMs, 0);
  const avgHoldTimeMs = totalHoldTimeMs / trades.length;

  // Trades per day: span from first to last trade
  const firstTs = trades[0]!.sellTimestamp;
  const lastTs = trades[trades.length - 1]!.sellTimestamp;
  const spanDays = Math.max(1, (lastTs - firstTs) / (24 * 60 * 60 * 1000));
  const tradesPerDay = trades.length / spanDays;

  const streaks = calculateStreaks(trades);

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / trades.length,
    totalPnlSol: grossProfit - grossLoss,
    avgWinSol,
    avgLossSol,
    largestWin,
    largestLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgRiskReward: avgLossSol > 0 ? avgWinSol / avgLossSol : 0,
    avgHoldTimeMs,
    tradesPerDay,
    triggerBreakdown: buildTriggerBreakdown(trades),
    currentStreak: streaks.current,
    longestWinStreak: streaks.longestWin,
    longestLossStreak: streaks.longestLoss,
    dailyPnl: buildDailyPnl(trades),
    period,
  };
}
