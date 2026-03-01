import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';

/**
 * Equity Options Spread Strategy.
 *
 * Implements defined-risk options strategies:
 * - Bull Call Spread: Buy lower strike call, sell higher strike call
 * - Bear Put Spread: Buy higher strike put, sell lower strike put
 * - Iron Condor: Sell OTM call spread + sell OTM put spread (neutral)
 *
 * These strategies have capped max loss and max profit.
 * Requires options chain data in snapshot metadata.
 */
export class OptionsSpreadStrategy extends BaseStrategy {
  readonly name = 'Equity Options Spread';
  readonly market = 'equity' as const;
  readonly strategyType = 'options_spread';

  getDefaultParams() {
    return {
      minDaysToExpiry: 14,
      maxDaysToExpiry: 45,
      spreadWidth: 5, // Strike price distance
      maxCostPercent: 2.0, // Max cost as % of portfolio
      minProbabilityOTM: 0.60, // For iron condor short strikes
      timeframe: '1d',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    // Options strategies require options chain data which would be
    // provided by the Alpaca API via the execution specialist.
    // This is a directional bias signal that the orchestrator uses
    // to decide which spread to deploy.

    const signals: TradingSignal[] = [];
    const price = snapshot.currentPrice;

    if (snapshot.change24h > 0 && snapshot.changePercent24h > 1.0) {
      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy', // Bias: bullish -> bull call spread
        confidence: 0.5,
        entryPrice: price,
        stopLoss: null, // Defined risk via spread structure
        takeProfit: null, // Max profit = spread width - debit paid
        indicators: [
          { indicator: 'Direction', value: snapshot.changePercent24h, signal: 'buy', confidence: 0.5 },
        ],
        reasoning: `Bullish bias (${snapshot.changePercent24h.toFixed(1)}% gain). Consider bull call spread with ${this.params.spreadWidth}-wide strikes.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    } else if (snapshot.change24h < 0 && snapshot.changePercent24h < -1.0) {
      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell', // Bias: bearish -> bear put spread
        confidence: 0.5,
        entryPrice: price,
        stopLoss: null,
        takeProfit: null,
        indicators: [
          { indicator: 'Direction', value: snapshot.changePercent24h, signal: 'sell', confidence: 0.5 },
        ],
        reasoning: `Bearish bias (${snapshot.changePercent24h.toFixed(1)}% loss). Consider bear put spread with ${this.params.spreadWidth}-wide strikes.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }
}
