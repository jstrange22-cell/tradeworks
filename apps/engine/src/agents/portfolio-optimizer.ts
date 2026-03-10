import { kellyCriterion } from '@tradeworks/risk';

export interface PositionInfo {
  instrument: string;
  currentSize: number;
  currentPnl: number;
  entryPrice: number;
  currentPrice: number;
}

export interface PortfolioOptimization {
  kellyFraction: number;
  recommendedPositionSize: number; // as % of equity
  riskParityWeights: Record<string, number>; // instrument -> weight
  maxPositionSize: number; // capped at safe level
  adjustments: Array<{
    instrument: string;
    action: 'increase' | 'decrease' | 'hold';
    reason: string;
  }>;
  reasoning: string;
}

const MAX_POSITION_PCT = 0.25; // 25% cap per position
const MIN_POSITION_PCT = 0.02; // 2% floor to avoid dust allocations
const LOSS_REDUCTION_THRESHOLD = -0.05; // -5% PnL triggers reduction

/**
 * Calculate realized volatility (standard deviation of returns)
 * from a position's entry vs current price as a simple proxy.
 * In production this would use historical return series.
 */
function estimatePositionVolatility(position: PositionInfo): number {
  if (position.entryPrice <= 0) return 1;
  const returnPct = (position.currentPrice - position.entryPrice) / position.entryPrice;
  // Use absolute return as a rough volatility proxy; floor at 1% to prevent division by zero
  return Math.max(0.01, Math.abs(returnPct));
}

/**
 * Calculate risk-parity weights: inverse-volatility weighting.
 * Each instrument gets weight proportional to 1/volatility,
 * then normalized to sum to 1.
 */
function calculateRiskParityWeights(
  positions: readonly PositionInfo[]
): Record<string, number> {
  if (positions.length === 0) return {};

  const inverseVols: Array<{ instrument: string; inverseVol: number }> = [];
  let totalInverseVol = 0;

  for (const pos of positions) {
    const vol = estimatePositionVolatility(pos);
    const invVol = 1 / vol;
    inverseVols.push({ instrument: pos.instrument, inverseVol: invVol });
    totalInverseVol += invVol;
  }

  const weights: Record<string, number> = {};
  for (const { instrument, inverseVol } of inverseVols) {
    weights[instrument] = totalInverseVol > 0 ? inverseVol / totalInverseVol : 0;
  }

  return weights;
}

/**
 * Generate per-position adjustment recommendations based on current PnL
 * and risk-parity target weights vs actual allocation.
 */
function generateAdjustments(
  positions: readonly PositionInfo[],
  equity: number,
  riskParityWeights: Readonly<Record<string, number>>
): Array<{ instrument: string; action: 'increase' | 'decrease' | 'hold'; reason: string }> {
  if (equity <= 0) return [];

  return positions.map((pos) => {
    const targetWeight = riskParityWeights[pos.instrument] ?? 0;
    const currentNotional = pos.currentSize * pos.currentPrice;
    const currentWeight = currentNotional / equity;
    const pnlPct = pos.entryPrice > 0
      ? (pos.currentPrice - pos.entryPrice) / pos.entryPrice
      : 0;

    // Deep loss: recommend reducing
    if (pnlPct < LOSS_REDUCTION_THRESHOLD) {
      return {
        instrument: pos.instrument,
        action: 'decrease' as const,
        reason: `Position is down ${(pnlPct * 100).toFixed(1)}%, exceeds ${(LOSS_REDUCTION_THRESHOLD * 100).toFixed(0)}% loss threshold`,
      };
    }

    // Overweight vs risk-parity target
    if (currentWeight > targetWeight * 1.2 && targetWeight > 0) {
      return {
        instrument: pos.instrument,
        action: 'decrease' as const,
        reason: `Overweight: current ${(currentWeight * 100).toFixed(1)}% vs target ${(targetWeight * 100).toFixed(1)}%`,
      };
    }

    // Underweight vs risk-parity target
    if (currentWeight < targetWeight * 0.8 && targetWeight > 0) {
      return {
        instrument: pos.instrument,
        action: 'increase' as const,
        reason: `Underweight: current ${(currentWeight * 100).toFixed(1)}% vs target ${(targetWeight * 100).toFixed(1)}%`,
      };
    }

    return {
      instrument: pos.instrument,
      action: 'hold' as const,
      reason: `Allocation within target range (${(currentWeight * 100).toFixed(1)}% vs ${(targetWeight * 100).toFixed(1)}%)`,
    };
  });
}

/**
 * Build reasoning string summarizing the optimization output.
 */
function buildReasoning(
  equity: number,
  kellyFraction: number,
  recommendedPct: number,
  maxPositionSize: number,
  positionCount: number,
  adjustments: ReadonlyArray<{ action: string }>
): string {
  const parts: string[] = [];

  parts.push(`Portfolio equity: $${equity.toLocaleString()}`);
  parts.push(`Kelly fraction: ${(kellyFraction * 100).toFixed(2)}% (half-Kelly applied)`);
  parts.push(`Recommended position size: ${(recommendedPct * 100).toFixed(2)}% of equity`);
  parts.push(`Max position cap: ${(maxPositionSize * 100).toFixed(1)}%`);

  if (positionCount > 0) {
    const decreaseCount = adjustments.filter((a) => a.action === 'decrease').length;
    const increaseCount = adjustments.filter((a) => a.action === 'increase').length;
    const holdCount = adjustments.filter((a) => a.action === 'hold').length;
    parts.push(
      `Position adjustments: ${increaseCount} increase, ${decreaseCount} decrease, ${holdCount} hold`
    );
  } else {
    parts.push('No open positions to rebalance');
  }

  return parts.join('. ') + '.';
}

/**
 * Optimize portfolio allocation using Kelly criterion and risk parity.
 *
 * Calculates the optimal fraction of capital to risk per trade (half-Kelly),
 * determines risk-parity weights across positions, caps position sizes
 * at safe levels, and generates per-position adjustment recommendations.
 *
 * @param equity - Total portfolio equity in USD
 * @param positions - Current open positions
 * @param winRate - Historical win rate (0-1)
 * @param avgWin - Average winning trade size in USD
 * @param avgLoss - Average losing trade size in USD (positive number)
 * @returns Portfolio optimization with sizing and adjustment recommendations
 */
export function optimizePortfolio(
  equity: number,
  positions: PositionInfo[],
  winRate: number,
  avgWin: number,
  avgLoss: number
): PortfolioOptimization {
  // Calculate Kelly fraction (half-Kelly for safety, enforced by @tradeworks/risk)
  const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
  const kellyFraction = kellyCriterion(winRate, avgWinLossRatio, true);

  // Recommended position size as % of equity, bounded by min/max
  const rawRecommended = kellyFraction;
  const recommendedPositionSize = Math.max(
    MIN_POSITION_PCT,
    Math.min(MAX_POSITION_PCT, rawRecommended)
  );

  // Cap: never exceed MAX_POSITION_PCT regardless of Kelly output
  const maxPositionSize = MAX_POSITION_PCT;

  // Risk-parity weights for current positions
  const riskParityWeights = calculateRiskParityWeights(positions);

  // Per-position adjustments
  const adjustments = generateAdjustments(positions, equity, riskParityWeights);

  const reasoning = buildReasoning(
    equity,
    kellyFraction,
    recommendedPositionSize,
    maxPositionSize,
    positions.length,
    adjustments
  );

  return {
    kellyFraction,
    recommendedPositionSize,
    riskParityWeights,
    maxPositionSize,
    adjustments,
    reasoning,
  };
}
