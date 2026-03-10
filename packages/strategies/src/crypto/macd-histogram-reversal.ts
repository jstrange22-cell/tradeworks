import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { macd, rsi, atr } from '@tradeworks/indicators';

/**
 * MACD Histogram Direction Change Strategy.
 *
 * Detects momentum shifts by identifying when the MACD histogram
 * reverses direction after a sustained move. Confirmed by RSI
 * not being in extreme zones (avoiding counter-trend entries at
 * overextended levels).
 *
 * Entry (Long):
 * - MACD histogram was decreasing, now increasing (direction reversal)
 * - RSI is not overbought (< 70)
 *
 * Entry (Short):
 * - MACD histogram was increasing, now decreasing
 * - RSI is not oversold (> 30)
 *
 * Exit:
 * - Stop: 1.5x ATR from entry
 * - Target: 3x ATR from entry (1:2 R:R)
 */
export class MacdHistogramReversalStrategy extends BaseStrategy {
  readonly name = 'MACD Histogram Reversal';
  readonly market = 'crypto' as const;
  readonly strategyType = 'macd_histogram_reversal';

  getDefaultParams() {
    return {
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      atrPeriod: 14,
      stopMultiplier: 1.5,
      takeProfitMultiplier: 3.0,
      minHistogramBars: 3,
      timeframe: '1h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'macd', params: { fast: this.params.macdFast as number, slow: this.params.macdSlow as number, signal: this.params.macdSignal as number } },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const minData = (this.params.macdSlow as number) + (this.params.macdSignal as number) + 10;

    if (candles.length < minData) {
      return [];
    }

    const closes = this.getCloses(candles);
    const macdResult = macd(
      closes,
      this.params.macdFast as number,
      this.params.macdSlow as number,
      this.params.macdSignal as number,
    );
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const price = this.getLatestPrice(snapshot);
    const currentAtr = atrValues[lastIdx];
    const currentRsi = rsiValues[lastIdx];
    const currentMacd = macdResult.macd[lastIdx];
    const currentSignalLine = macdResult.signal[lastIdx];

    if (currentAtr === undefined || currentRsi === undefined ||
        currentMacd === undefined || currentSignalLine === undefined) {
      return [];
    }

    // Need at least minHistogramBars + 1 valid histogram values
    const minBars = this.params.minHistogramBars as number;
    const histogramSlice: number[] = [];

    for (let idx = lastIdx - minBars; idx <= lastIdx; idx++) {
      const val = macdResult.histogram[idx];
      if (val === undefined) return [];
      histogramSlice.push(val);
    }

    // Check for direction reversal
    const bullishReversal = this.detectBullishReversal(histogramSlice);
    const bearishReversal = this.detectBearishReversal(histogramSlice);

    const signals: TradingSignal[] = [];

    if (bullishReversal && currentRsi < (this.params.rsiOverbought as number)) {
      const stopLoss = price - currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = price + currentAtr * (this.params.takeProfitMultiplier as number);
      const currentHistogram = histogramSlice[histogramSlice.length - 1]!;

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: this.calculateConfidence(currentRsi, currentHistogram, histogramSlice, 'buy'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'MACD', value: currentMacd, signal: 'buy', confidence: 0.7 },
          { indicator: 'MACD_Signal', value: currentSignalLine, signal: 'neutral', confidence: 0.5 },
          { indicator: 'MACD_Histogram', value: currentHistogram, signal: 'buy', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: currentRsi > 50 ? 'buy' : 'neutral', confidence: 0.6 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `MACD histogram bullish reversal detected — histogram was declining, now rising. RSI at ${currentRsi.toFixed(1)} confirms room for upside. Stop $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    if (bearishReversal && currentRsi > (this.params.rsiOversold as number)) {
      const stopLoss = price + currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = price - currentAtr * (this.params.takeProfitMultiplier as number);
      const currentHistogram = histogramSlice[histogramSlice.length - 1]!;

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: this.calculateConfidence(currentRsi, currentHistogram, histogramSlice, 'sell'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'MACD', value: currentMacd, signal: 'sell', confidence: 0.7 },
          { indicator: 'MACD_Signal', value: currentSignalLine, signal: 'neutral', confidence: 0.5 },
          { indicator: 'MACD_Histogram', value: currentHistogram, signal: 'sell', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: currentRsi < 50 ? 'sell' : 'neutral', confidence: 0.6 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `MACD histogram bearish reversal detected — histogram was rising, now declining. RSI at ${currentRsi.toFixed(1)} confirms room for downside. Stop $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  /**
   * Bullish: histogram values were declining for multiple bars,
   * then the latest bar is higher than the previous (turn up).
   */
  private detectBullishReversal(histogram: number[]): boolean {
    if (histogram.length < 3) return false;

    const latest = histogram[histogram.length - 1]!;
    const prev = histogram[histogram.length - 2]!;

    // Latest must be higher than previous (direction change upward)
    if (latest <= prev) return false;

    // Check that prior bars were decreasing
    let decliningCount = 0;
    for (let idx = histogram.length - 3; idx >= 0; idx--) {
      if (histogram[idx]! > histogram[idx + 1]!) {
        decliningCount++;
      } else {
        break;
      }
    }

    return decliningCount >= 1;
  }

  /**
   * Bearish: histogram values were increasing for multiple bars,
   * then the latest bar is lower than the previous (turn down).
   */
  private detectBearishReversal(histogram: number[]): boolean {
    if (histogram.length < 3) return false;

    const latest = histogram[histogram.length - 1]!;
    const prev = histogram[histogram.length - 2]!;

    // Latest must be lower than previous (direction change downward)
    if (latest >= prev) return false;

    // Check that prior bars were increasing
    let risingCount = 0;
    for (let idx = histogram.length - 3; idx >= 0; idx--) {
      if (histogram[idx]! < histogram[idx + 1]!) {
        risingCount++;
      } else {
        break;
      }
    }

    return risingCount >= 1;
  }

  private calculateConfidence(
    currentRsi: number,
    currentHistogram: number,
    histogramSlice: number[],
    side: 'buy' | 'sell',
  ): number {
    // RSI distance from extreme
    const rsiFromExtreme = side === 'buy'
      ? ((this.params.rsiOverbought as number) - currentRsi) / 40
      : (currentRsi - (this.params.rsiOversold as number)) / 40;
    const rsiConf = Math.min(Math.max(rsiFromExtreme, 0), 1) * 0.3;

    // Histogram magnitude of the reversal
    const prev = histogramSlice[histogramSlice.length - 2] ?? 0;
    const reversalMagnitude = Math.abs(currentHistogram - prev);
    const magnitudeConf = Math.min(reversalMagnitude / 0.001, 1) * 0.4;

    // How many bars declined/rose before reversal (more = stronger signal)
    const trendBars = histogramSlice.length - 2;
    const trendConf = Math.min(trendBars / 5, 1) * 0.2;

    return Math.min(rsiConf + magnitudeConf + trendConf + 0.1, 0.9);
  }
}
