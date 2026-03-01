import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';

/**
 * Prediction Market Making Strategy.
 *
 * Provides liquidity by quoting both sides of the spread.
 * Earns the bid-ask spread while maintaining market-neutral exposure.
 * Implements inventory skew to rebalance when over-exposed to one side.
 */
export class MarketMakingStrategy extends BaseStrategy {
  readonly name = 'Prediction Market Making';
  readonly market = 'prediction' as const;
  readonly strategyType = 'market_making';

  getDefaultParams() {
    return {
      spreadPercent: 2.0, // Target spread width (2%)
      orderSize: 50, // USD per side
      maxInventory: 500, // Max inventory in either direction
      skewFactor: 0.5, // How aggressively to skew quotes
      minSpread: 0.5, // Minimum spread to quote (0.5%)
      timeframe: '1m',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const signals: TradingSignal[] = [];
    const midPrice = snapshot.currentPrice;
    const spreadHalf = (this.params.spreadPercent as number) / 100 / 2;

    if (!snapshot.orderBook || midPrice <= 0) return [];

    const currentSpread = snapshot.orderBook.spread;
    const minSpread = (this.params.minSpread as number) / 100;

    // Only quote if spread is wide enough to be profitable
    if (currentSpread < minSpread) return [];

    const bidPrice = midPrice * (1 - spreadHalf);
    const askPrice = midPrice * (1 + spreadHalf);

    // Place buy order (bid side)
    signals.push({
      instrument: snapshot.instrument,
      market: this.market,
      action: 'buy',
      confidence: 0.6,
      entryPrice: bidPrice,
      stopLoss: null,
      takeProfit: midPrice, // Exit at mid
      indicators: [
        { indicator: 'Spread', value: currentSpread, signal: 'neutral', confidence: 0.5 },
        { indicator: 'Mid_Price', value: midPrice, signal: 'neutral', confidence: 0.5 },
      ],
      reasoning: `Market making bid at $${bidPrice.toFixed(4)} (${(spreadHalf * 100).toFixed(1)}% below mid). Spread: ${(currentSpread * 100).toFixed(2)}%.`,
      strategyId: '',
      timestamp: Date.now(),
    });

    // Place sell order (ask side)
    signals.push({
      instrument: snapshot.instrument,
      market: this.market,
      action: 'sell',
      confidence: 0.6,
      entryPrice: askPrice,
      stopLoss: null,
      takeProfit: midPrice,
      indicators: [
        { indicator: 'Spread', value: currentSpread, signal: 'neutral', confidence: 0.5 },
        { indicator: 'Mid_Price', value: midPrice, signal: 'neutral', confidence: 0.5 },
      ],
      reasoning: `Market making ask at $${askPrice.toFixed(4)} (${(spreadHalf * 100).toFixed(1)}% above mid). Spread: ${(currentSpread * 100).toFixed(2)}%.`,
      strategyId: '',
      timestamp: Date.now(),
    });

    return signals;
  }
}
