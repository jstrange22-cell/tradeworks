import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { bollinger, keltner, macd, atr } from '@tradeworks/indicators';

/**
 * Bollinger Band Squeeze Strategy (TTM Squeeze).
 *
 * Detects volatility compression when Bollinger Bands contract inside
 * Keltner Channels, then trades the breakout direction confirmed by
 * MACD histogram momentum.
 *
 * Squeeze detected:
 * - Bollinger upper < Keltner upper AND Bollinger lower > Keltner lower
 *
 * Entry:
 * - Squeeze ends (BB expand outside KC)
 * - MACD histogram direction confirms breakout
 *
 * Exit:
 * - Stop at middle Bollinger Band
 * - Target at 2x ATR from entry
 */
export class BollingerSqueezeStrategy extends BaseStrategy {
  readonly name = 'Bollinger Band Squeeze';
  readonly market = 'crypto' as const;
  readonly strategyType = 'bollinger_squeeze';

  getDefaultParams() {
    return {
      bollingerPeriod: 20,
      bollingerStdDev: 2.0,
      keltnerPeriod: 20,
      keltnerMultiplier: 1.5,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      atrPeriod: 14,
      takeProfitAtrMultiplier: 2.0,
      squeezeMinBars: 3,
      timeframe: '4h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'bollinger', params: { period: this.params.bollingerPeriod as number, stdDev: this.params.bollingerStdDev as number } },
      { name: 'keltner', params: { period: this.params.keltnerPeriod as number, multiplier: this.params.keltnerMultiplier as number } },
      { name: 'macd', params: { fast: this.params.macdFast as number, slow: this.params.macdSlow as number, signal: this.params.macdSignal as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const minBars = Math.max(
      this.params.bollingerPeriod as number,
      this.params.keltnerPeriod as number,
      this.params.macdSlow as number,
    ) + 10;

    if (candles.length < minBars) {
      return [];
    }

    const closes = this.getCloses(candles);
    const bb = bollinger(closes, this.params.bollingerPeriod as number, this.params.bollingerStdDev as number);
    const kc = keltner(candles, this.params.keltnerPeriod as number, this.params.keltnerMultiplier as number);
    const macdResult = macd(closes, this.params.macdFast as number, this.params.macdSlow as number, this.params.macdSignal as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const price = this.getLatestPrice(snapshot);
    const currentAtr = atrValues[lastIdx];
    const currentHistogram = macdResult.histogram[lastIdx];
    const prevHistogram = macdResult.histogram[lastIdx - 1];

    if (
      currentAtr === undefined ||
      currentHistogram === undefined ||
      prevHistogram === undefined
    ) {
      return [];
    }

    // Check squeeze state for recent bars
    const squeezeMinBars = this.params.squeezeMinBars as number;
    let squeezeCount = 0;

    for (let idx = lastIdx - squeezeMinBars - 1; idx < lastIdx; idx++) {
      const bbUp = bb.upper[idx];
      const bbLow = bb.lower[idx];
      const kcUp = kc.upper[idx];
      const kcLow = kc.lower[idx];

      if (bbUp === undefined || bbLow === undefined || kcUp === undefined || kcLow === undefined) {
        continue;
      }

      if (bbUp < kcUp && bbLow > kcLow) {
        squeezeCount++;
      }
    }

    // Current bar: check if squeeze has ended (BB expanded outside KC)
    const currentBbUp = bb.upper[lastIdx];
    const currentBbLow = bb.lower[lastIdx];
    const currentKcUp = kc.upper[lastIdx];
    const currentKcLow = kc.lower[lastIdx];
    const currentBbMiddle = bb.middle[lastIdx];

    if (
      currentBbUp === undefined || currentBbLow === undefined ||
      currentKcUp === undefined || currentKcLow === undefined ||
      currentBbMiddle === undefined
    ) {
      return [];
    }

    const wasInSqueeze = squeezeCount >= squeezeMinBars;
    const squeezeEnded = currentBbUp >= currentKcUp || currentBbLow <= currentKcLow;

    if (!wasInSqueeze || !squeezeEnded) {
      return [];
    }

    const signals: TradingSignal[] = [];

    // Determine breakout direction from MACD histogram
    const histogramIncreasing = currentHistogram > prevHistogram;
    const histogramPositive = currentHistogram > 0;
    const histogramNegative = currentHistogram < 0;

    // Bullish breakout: histogram increasing and/or positive
    if (histogramIncreasing && histogramPositive) {
      const stopLoss = currentBbMiddle;
      const takeProfit = price + currentAtr * (this.params.takeProfitAtrMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: this.calculateSqueezeConfidence(squeezeCount, currentHistogram, prevHistogram, currentAtr, price),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'BB_Squeeze', value: squeezeCount, signal: 'buy', confidence: 0.7 },
          { indicator: 'MACD_Histogram', value: currentHistogram, signal: 'buy', confidence: 0.75 },
          { indicator: 'BB_Middle', value: currentBbMiddle, signal: 'neutral', confidence: 0.5 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Bollinger Squeeze breakout (${squeezeCount} bars compressed). MACD histogram confirms bullish direction (${currentHistogram.toFixed(4)}). Stop at middle band $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    // Bearish breakout: histogram decreasing and negative
    if (!histogramIncreasing && histogramNegative) {
      const stopLoss = currentBbMiddle;
      const takeProfit = price - currentAtr * (this.params.takeProfitAtrMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: this.calculateSqueezeConfidence(squeezeCount, Math.abs(currentHistogram), Math.abs(prevHistogram), currentAtr, price),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'BB_Squeeze', value: squeezeCount, signal: 'sell', confidence: 0.7 },
          { indicator: 'MACD_Histogram', value: currentHistogram, signal: 'sell', confidence: 0.75 },
          { indicator: 'BB_Middle', value: currentBbMiddle, signal: 'neutral', confidence: 0.5 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Bollinger Squeeze breakout (${squeezeCount} bars compressed). MACD histogram confirms bearish direction (${currentHistogram.toFixed(4)}). Stop at middle band $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  private calculateSqueezeConfidence(
    squeezeLength: number,
    histogramMag: number,
    prevHistogramMag: number,
    currentAtr: number,
    price: number,
  ): number {
    // Longer squeeze = stronger breakout potential
    const squeezeLenConf = Math.min(squeezeLength / 10, 1) * 0.3;

    // Histogram acceleration
    const acceleration = Math.abs(histogramMag) - Math.abs(prevHistogramMag);
    const accelConf = acceleration > 0 ? 0.3 : 0.1;

    // Reasonable ATR
    const atrRatio = currentAtr / price;
    const atrConf = (atrRatio > 0.003 && atrRatio < 0.06) ? 0.3 : 0.1;

    return Math.min(squeezeLenConf + accelConf + atrConf, 0.9);
  }
}
