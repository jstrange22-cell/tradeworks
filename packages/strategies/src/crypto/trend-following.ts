import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { ema, rsi, macd, atr } from '@tradeworks/indicators';

/**
 * Crypto Trend Following Strategy.
 *
 * Uses EMA crossover (fast/slow) confirmed by RSI and MACD.
 * ATR-based stop loss and take profit placement.
 *
 * Entry conditions (Long):
 * - Fast EMA crosses above Slow EMA
 * - RSI > 50 (momentum confirmation)
 * - MACD histogram positive
 *
 * Entry conditions (Short):
 * - Fast EMA crosses below Slow EMA
 * - RSI < 50
 * - MACD histogram negative
 *
 * Exit:
 * - Stop loss: Entry - (ATR * stopMultiplier)
 * - Take profit: Entry + (ATR * takeProfitMultiplier)
 */
export class TrendFollowingStrategy extends BaseStrategy {
  readonly name = 'Crypto Trend Following';
  readonly market = 'crypto' as const;
  readonly strategyType = 'trend_following';

  getDefaultParams() {
    return {
      fastEmaPeriod: 12,
      slowEmaPeriod: 26,
      rsiPeriod: 14,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      atrPeriod: 14,
      stopMultiplier: 2.0,
      takeProfitMultiplier: 6.0, // 1:3 with 2x ATR stop
      timeframe: '1h',
      minRsi: 50,
      maxRsi: 50,
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'ema', params: { period: this.params.fastEmaPeriod as number } },
      { name: 'ema', params: { period: this.params.slowEmaPeriod as number } },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'macd', params: { fast: this.params.macdFast as number, slow: this.params.macdSlow as number, signal: this.params.macdSignal as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);

    if (candles.length < (this.params.slowEmaPeriod as number) + 5) {
      return []; // Not enough data
    }

    const closes = this.getCloses(candles);

    // Calculate indicators
    const fastEma = ema(closes, this.params.fastEmaPeriod as number);
    const slowEma = ema(closes, this.params.slowEmaPeriod as number);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const macdResult = macd(closes, this.params.macdFast as number, this.params.macdSlow as number, this.params.macdSignal as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;

    const currentFastEma = fastEma[lastIdx];
    const currentSlowEma = slowEma[lastIdx];
    const prevFastEma = fastEma[prevIdx];
    const prevSlowEma = slowEma[prevIdx];
    const currentRsi = rsiValues[lastIdx];
    const currentHistogram = macdResult.histogram[lastIdx];
    const currentAtr = atrValues[lastIdx];
    const currentPrice = snapshot.currentPrice;

    if (currentFastEma === undefined || currentSlowEma === undefined ||
        prevFastEma === undefined || prevSlowEma === undefined ||
        currentRsi === undefined || currentHistogram === undefined ||
        currentAtr === undefined) {
      return [];
    }

    const signals: TradingSignal[] = [];

    // Bullish crossover
    const bullishCross = prevFastEma <= prevSlowEma && currentFastEma > currentSlowEma;
    // Bearish crossover
    const bearishCross = prevFastEma >= prevSlowEma && currentFastEma < currentSlowEma;

    if (bullishCross && currentRsi > (this.params.minRsi as number) && currentHistogram > 0) {
      const stopLoss = currentPrice - currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = currentPrice + currentAtr * (this.params.takeProfitMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: this.calculateConfidence(currentRsi, currentHistogram, currentAtr, currentPrice),
        entryPrice: currentPrice,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'EMA_Cross', value: currentFastEma - currentSlowEma, signal: 'buy', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: currentRsi > 50 ? 'buy' : 'neutral', confidence: 0.6 },
          { indicator: 'MACD_Histogram', value: currentHistogram, signal: currentHistogram > 0 ? 'buy' : 'sell', confidence: 0.7 },
        ],
        reasoning: `Bullish EMA crossover confirmed by RSI (${currentRsi.toFixed(1)}) and positive MACD histogram. ATR-based stops at ${stopLoss.toFixed(2)}, target at ${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    if (bearishCross && currentRsi < (this.params.maxRsi as number) && currentHistogram < 0) {
      const stopLoss = currentPrice + currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = currentPrice - currentAtr * (this.params.takeProfitMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: this.calculateConfidence(100 - currentRsi, Math.abs(currentHistogram), currentAtr, currentPrice),
        entryPrice: currentPrice,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'EMA_Cross', value: currentFastEma - currentSlowEma, signal: 'sell', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: currentRsi < 50 ? 'sell' : 'neutral', confidence: 0.6 },
          { indicator: 'MACD_Histogram', value: currentHistogram, signal: 'sell', confidence: 0.7 },
        ],
        reasoning: `Bearish EMA crossover confirmed by RSI (${currentRsi.toFixed(1)}) and negative MACD histogram. ATR-based stops at ${stopLoss.toFixed(2)}, target at ${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  private calculateConfidence(rsiStrength: number, histogramMagnitude: number, currentAtr: number, price: number): number {
    // Normalize RSI strength (distance from 50)
    const rsiConf = Math.min(Math.abs(rsiStrength - 50) / 30, 1) * 0.3;
    // MACD histogram magnitude relative to price
    const macdConf = Math.min(histogramMagnitude / (price * 0.001), 1) * 0.4;
    // ATR-based volatility confirmation (moderate ATR is best)
    const atrRatio = currentAtr / price;
    const atrConf = (atrRatio > 0.005 && atrRatio < 0.05) ? 0.3 : 0.1;

    return Math.min(rsiConf + macdConf + atrConf, 0.95);
  }
}
