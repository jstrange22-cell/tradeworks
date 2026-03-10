import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { supertrend, ema, atr } from '@tradeworks/indicators';

/**
 * Supertrend Trend Following Strategy.
 *
 * Uses the Supertrend indicator (ATR-based dynamic support/resistance)
 * to identify trend direction changes. Confirmed by EMA alignment
 * for higher-probability entries.
 *
 * Entry (Long):
 * - Supertrend flips from down (-1) to up (1)
 * - Price is above EMA 21 (trend confirmation)
 *
 * Entry (Short):
 * - Supertrend flips from up (1) to down (-1)
 * - Price is below EMA 21
 *
 * Exit:
 * - Stop: Supertrend level (dynamic trailing stop)
 * - Target: 3x ATR from entry
 */
export class SupertrendStrategy extends BaseStrategy {
  readonly name = 'Supertrend Trend Following';
  readonly market = 'crypto' as const;
  readonly strategyType = 'supertrend';

  getDefaultParams() {
    return {
      supertrendPeriod: 10,
      supertrendMultiplier: 3.0,
      emaPeriod: 21,
      atrPeriod: 14,
      takeProfitAtrMultiplier: 3.0,
      timeframe: '1h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'supertrend', params: { period: this.params.supertrendPeriod as number, multiplier: this.params.supertrendMultiplier as number } },
      { name: 'ema', params: { period: this.params.emaPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const minBars = Math.max(
      this.params.supertrendPeriod as number,
      this.params.emaPeriod as number,
      this.params.atrPeriod as number,
    ) + 5;

    if (candles.length < minBars) {
      return [];
    }

    const closes = this.getCloses(candles);
    const stResult = supertrend(
      candles,
      this.params.supertrendPeriod as number,
      this.params.supertrendMultiplier as number,
    );
    const emaValues = ema(closes, this.params.emaPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;
    const price = this.getLatestPrice(snapshot);

    const currentDirection = stResult.direction[lastIdx];
    const prevDirection = stResult.direction[prevIdx];
    const currentSupertrend = stResult.trend[lastIdx];
    const currentEma = emaValues[lastIdx];
    const currentAtr = atrValues[lastIdx];

    if (
      currentDirection === undefined || prevDirection === undefined ||
      currentSupertrend === undefined || currentEma === undefined ||
      currentAtr === undefined
    ) {
      return [];
    }

    const signals: TradingSignal[] = [];
    const directionFlipBullish = prevDirection === -1 && currentDirection === 1;
    const directionFlipBearish = prevDirection === 1 && currentDirection === -1;

    // Bullish: supertrend flips up + price above EMA
    if (directionFlipBullish && price > currentEma) {
      const stopLoss = currentSupertrend;
      const takeProfit = price + currentAtr * (this.params.takeProfitAtrMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: this.calculateConfidence(price, currentEma, currentSupertrend, currentAtr, 'buy'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'Supertrend', value: currentSupertrend, signal: 'buy', confidence: 0.8 },
          { indicator: 'Supertrend_Direction', value: currentDirection, signal: 'buy', confidence: 0.85 },
          { indicator: 'EMA_21', value: currentEma, signal: price > currentEma ? 'buy' : 'sell', confidence: 0.65 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Supertrend flipped bullish with price above EMA 21 ($${currentEma.toFixed(2)}). Dynamic stop at supertrend level $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    // Bearish: supertrend flips down + price below EMA
    if (directionFlipBearish && price < currentEma) {
      const stopLoss = currentSupertrend;
      const takeProfit = price - currentAtr * (this.params.takeProfitAtrMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: this.calculateConfidence(price, currentEma, currentSupertrend, currentAtr, 'sell'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'Supertrend', value: currentSupertrend, signal: 'sell', confidence: 0.8 },
          { indicator: 'Supertrend_Direction', value: currentDirection, signal: 'sell', confidence: 0.85 },
          { indicator: 'EMA_21', value: currentEma, signal: price < currentEma ? 'sell' : 'buy', confidence: 0.65 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Supertrend flipped bearish with price below EMA 21 ($${currentEma.toFixed(2)}). Dynamic stop at supertrend level $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  private calculateConfidence(
    price: number,
    emaValue: number,
    supertrendLevel: number,
    currentAtr: number,
    side: 'buy' | 'sell',
  ): number {
    // EMA alignment strength (how far price is from EMA in the right direction)
    const emaDistance = side === 'buy'
      ? (price - emaValue) / price
      : (emaValue - price) / price;
    const emaConf = Math.min(Math.max(emaDistance / 0.01, 0), 1) * 0.3;

    // Supertrend distance from price (wider = stronger signal)
    const stDistance = Math.abs(price - supertrendLevel) / price;
    const stConf = Math.min(stDistance / 0.02, 1) * 0.35;

    // ATR as percentage of price (moderate is best)
    const atrRatio = currentAtr / price;
    const atrConf = (atrRatio > 0.003 && atrRatio < 0.05) ? 0.25 : 0.1;

    return Math.min(emaConf + stConf + atrConf + 0.1, 0.9);
  }
}
