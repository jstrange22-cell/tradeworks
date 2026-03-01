import type { PositionSizeParams, PositionSizeResult } from '@tradeworks/shared';

/**
 * Calculate position size using the 1% Rule.
 * Formula: Position Size = (Total Capital × Risk%) / (Entry Price - Stop Loss Price)
 */
export function calculatePositionSize(params: PositionSizeParams): PositionSizeResult {
  const { totalCapital, riskPercentage, entryPrice, stopLossPrice } = params;

  if (totalCapital <= 0) {
    return { positionSize: 0, riskAmount: 0, stopLossDistance: 0, riskRewardRatio: null };
  }

  if (entryPrice <= 0 || stopLossPrice <= 0) {
    return { positionSize: 0, riskAmount: 0, stopLossDistance: 0, riskRewardRatio: null };
  }

  const stopLossDistance = Math.abs(entryPrice - stopLossPrice);

  if (stopLossDistance === 0) {
    return { positionSize: 0, riskAmount: 0, stopLossDistance: 0, riskRewardRatio: null };
  }

  const riskAmount = totalCapital * riskPercentage;
  const positionSize = riskAmount / stopLossDistance;

  return {
    positionSize,
    riskAmount,
    stopLossDistance,
    riskRewardRatio: null, // Set by caller with take-profit
  };
}

/**
 * Calculate position size with risk-reward ratio validation.
 * Returns null if the risk-reward ratio is below minimum.
 */
export function calculatePositionSizeWithRR(
  params: PositionSizeParams & { takeProfitPrice: number; minRiskReward: number }
): PositionSizeResult | null {
  const { takeProfitPrice, minRiskReward, entryPrice, stopLossPrice } = params;

  const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
  const takeProfitDistance = Math.abs(takeProfitPrice - entryPrice);

  if (stopLossDistance === 0) return null;

  const riskRewardRatio = takeProfitDistance / stopLossDistance;

  if (riskRewardRatio < minRiskReward) {
    return null; // Reject: doesn't meet minimum R:R
  }

  const result = calculatePositionSize(params);
  return { ...result, riskRewardRatio };
}

/**
 * Kelly Criterion for optimal position sizing.
 * f* = (bp - q) / b
 * where b = odds (risk-reward ratio), p = win probability, q = 1-p
 *
 * Returns fraction of capital to risk (typically use half-Kelly for safety).
 */
export function kellyCriterion(
  winRate: number,
  avgWinLossRatio: number,
  halfKelly: boolean = true
): number {
  if (winRate <= 0 || winRate >= 1 || avgWinLossRatio <= 0) {
    return 0;
  }

  const b = avgWinLossRatio;
  const p = winRate;
  const q = 1 - p;

  const kelly = (b * p - q) / b;

  if (kelly <= 0) return 0;

  return halfKelly ? kelly / 2 : kelly;
}

/**
 * Calculate maximum number of shares/units affordable within risk constraints.
 */
export function maxAffordableUnits(
  capital: number,
  currentPrice: number,
  maxAllocationPercent: number
): number {
  const maxCapital = capital * maxAllocationPercent;
  return Math.floor(maxCapital / currentPrice);
}
