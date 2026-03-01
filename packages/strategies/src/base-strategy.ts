import type { MarketType, MarketSnapshot, TradingSignal, StrategyParams, OHLCV } from '@tradeworks/shared';

export interface IndicatorConfig {
  name: string;
  params: Record<string, number>;
}

/**
 * Abstract base class for all trading strategies.
 * Each strategy must define its market, required indicators, and analysis logic.
 */
export abstract class BaseStrategy {
  abstract readonly name: string;
  abstract readonly market: MarketType;
  abstract readonly strategyType: string;

  protected params: StrategyParams;

  constructor(params?: StrategyParams) {
    this.params = params ?? this.getDefaultParams();
  }

  /**
   * Analyze market data and generate trading signals.
   */
  abstract analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]>;

  /**
   * Return the indicators this strategy requires.
   */
  abstract getRequiredIndicators(): IndicatorConfig[];

  /**
   * Return default parameters for this strategy.
   */
  abstract getDefaultParams(): StrategyParams;

  /**
   * Update strategy parameters.
   */
  updateParams(params: Partial<StrategyParams>): void {
    const merged: Record<string, string | number | boolean | number[]> = { ...this.params };
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    this.params = merged as StrategyParams;
  }

  /**
   * Get a specific candle timeframe from the snapshot.
   */
  protected getCandles(snapshot: MarketSnapshot, timeframe: string): OHLCV[] {
    return snapshot.candles[timeframe as keyof typeof snapshot.candles] ?? [];
  }

  /**
   * Extract closing prices from candles.
   */
  protected getCloses(candles: OHLCV[]): number[] {
    return candles.map(c => c.close);
  }

  /**
   * Get the latest price from a snapshot.
   */
  protected getLatestPrice(snapshot: MarketSnapshot): number {
    return snapshot.currentPrice;
  }
}
