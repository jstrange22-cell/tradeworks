import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';

/**
 * Equity Pairs Trading Strategy (Statistical Arbitrage).
 *
 * Trades the spread between two correlated stocks.
 * When the spread deviates from its historical mean, the strategy
 * goes long the underperformer and short the outperformer.
 *
 * Note: This strategy requires two instruments to be analyzed together.
 * The orchestrator must provide paired snapshots via metadata.
 */
export class PairsTradingStrategy extends BaseStrategy {
  readonly name = 'Equity Pairs Trading';
  readonly market = 'equity' as const;
  readonly strategyType = 'pairs_trading';

  getDefaultParams() {
    return {
      lookbackPeriod: 60, // days for mean/std calculation
      entryZScore: 2.0, // Z-score threshold to enter
      exitZScore: 0.5, // Z-score threshold to exit
      maxZScore: 4.0, // Z-score too extreme, might be regime change
      timeframe: '1d',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    // Pairs trading requires metadata with the paired instrument data
    // This is a simplified single-instrument analysis
    // The orchestrator handles the pairing logic

    const signals: TradingSignal[] = [];
    const price = snapshot.currentPrice;

    // The actual pairs logic would calculate:
    // spreadRatio = priceA / priceB
    // zScore = (currentRatio - meanRatio) / stdRatio
    // Then trade when |zScore| > entryZScore

    // Placeholder: generate hold signal (pairs need the orchestrator to coordinate)
    signals.push({
      instrument: snapshot.instrument,
      market: this.market,
      action: 'hold',
      confidence: 0.3,
      entryPrice: price,
      stopLoss: null,
      takeProfit: null,
      indicators: [],
      reasoning: 'Pairs trading requires paired instrument analysis. Awaiting orchestrator coordination.',
      strategyId: '',
      timestamp: Date.now(),
    });

    return signals;
  }
}

/**
 * Calculate Z-score of the current spread ratio.
 * Used by the orchestrator when coordinating pairs.
 */
export function calculateSpreadZScore(
  ratios: number[],
  currentRatio: number
): { zScore: number; mean: number; std: number } {
  if (ratios.length < 2) {
    return { zScore: 0, mean: currentRatio, std: 0 };
  }

  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / (ratios.length - 1);
  const std = Math.sqrt(variance);

  const zScore = std > 0 ? (currentRatio - mean) / std : 0;

  return { zScore, mean, std };
}
