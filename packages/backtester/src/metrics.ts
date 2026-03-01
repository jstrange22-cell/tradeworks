import { calculateMaxDrawdown } from '@tradeworks/risk';
import type { SimulatedFill } from './executor.js';

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownAbsolute: number;
  avgHoldingPeriod: number; // in candles/bars
  expectancy: number; // avg profit per trade
}

/**
 * Calculate comprehensive backtest metrics from fills and equity curve.
 */
export function calculateMetrics(
  fills: SimulatedFill[],
  equityCurve: number[],
  initialCapital: number
): BacktestMetrics {
  const finalEquity = equityCurve[equityCurve.length - 1] ?? initialCapital;
  const totalReturn = finalEquity - initialCapital;
  const totalReturnPercent = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;

  // Pair up fills into round-trip trades
  const roundTrips = pairFills(fills);
  const pnls = roundTrips.map(rt => rt.pnl);

  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);

  const totalTrades = roundTrips.length;
  const winRate = totalTrades > 0 ? wins.length / totalTrades : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, w) => s + w, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, l) => s + l, 0) / losses.length) : 0;

  const grossProfit = wins.reduce((s, w) => s + w, 0);
  const grossLoss = Math.abs(losses.reduce((s, l) => s + l, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max drawdown
  const { maxDrawdown } = calculateMaxDrawdown(equityCurve);
  const maxDrawdownAbsolute = maxDrawdown * (Math.max(...equityCurve));

  // Daily returns for Sharpe/Sortino
  const returns = calculateDailyReturns(equityCurve);
  const sharpeRatio = calculateSharpe(returns);
  const sortinoRatio = calculateSortino(returns);

  // Calmar ratio: annualized return / max drawdown
  const annualizedReturn = totalReturnPercent / 100; // Simplified
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // Average holding period
  const holdingPeriods = roundTrips.map(rt => rt.holdingPeriod);
  const avgHoldingPeriod = holdingPeriods.length > 0
    ? holdingPeriods.reduce((s, h) => s + h, 0) / holdingPeriods.length
    : 0;

  const expectancy = totalTrades > 0 ? totalReturn / totalTrades : 0;

  return {
    totalReturn,
    totalReturnPercent,
    totalTrades,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    maxDrawdownAbsolute,
    avgHoldingPeriod,
    expectancy,
  };
}

interface RoundTrip {
  entry: SimulatedFill;
  exit: SimulatedFill;
  pnl: number;
  holdingPeriod: number;
}

function pairFills(fills: SimulatedFill[]): RoundTrip[] {
  const roundTrips: RoundTrip[] = [];

  for (let i = 0; i < fills.length - 1; i += 2) {
    const entry = fills[i]!;
    const exit = fills[i + 1]!;

    const diff = exit.fillPrice - entry.fillPrice;
    const pnl = entry.side === 'buy'
      ? diff * entry.fillQuantity
      : -diff * entry.fillQuantity;

    roundTrips.push({
      entry,
      exit,
      pnl: pnl - entry.commission - exit.commission,
      holdingPeriod: exit.timestamp - entry.timestamp,
    });
  }

  return roundTrips;
}

function calculateDailyReturns(equityCurve: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!;
    if (prev > 0) {
      returns.push((equityCurve[i]! - prev) / prev);
    }
  }
  return returns;
}

function calculateSharpe(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const excessReturns = mean - riskFreeRate / 252; // Daily risk-free rate
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;
  return (excessReturns / stdDev) * Math.sqrt(252); // Annualized
}

function calculateSortino(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const excessReturn = mean - riskFreeRate / 252;

  // Downside deviation: only negative returns
  const negativeReturns = returns.filter(r => r < 0);
  if (negativeReturns.length === 0) return excessReturn > 0 ? Infinity : 0;

  const downsideVariance = negativeReturns.reduce((s, r) => s + r ** 2, 0) / negativeReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);

  if (downsideDev === 0) return 0;
  return (excessReturn / downsideDev) * Math.sqrt(252);
}
