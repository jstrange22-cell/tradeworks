import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { vwap, rsi, atr } from '@tradeworks/indicators';

/**
 * VWAP Mean Reversion Strategy.
 *
 * Trades reversions to the Volume-Weighted Average Price when price
 * deviates significantly. Uses standard deviation bands around VWAP
 * to identify extremes.
 *
 * Entry (Long):
 * - Price is > 2 standard deviations below VWAP
 * - RSI confirms oversold (< 35)
 *
 * Entry (Short):
 * - Price is > 2 standard deviations above VWAP
 * - RSI confirms overbought (> 65)
 *
 * Exit:
 * - Target: VWAP (mean reversion)
 * - Stop: 1x ATR beyond entry
 */
export class VwapReversionStrategy extends BaseStrategy {
  readonly name = 'VWAP Mean Reversion';
  readonly market = 'crypto' as const;
  readonly strategyType = 'vwap_reversion';

  getDefaultParams() {
    return {
      rsiPeriod: 14,
      rsiOversold: 35,
      rsiOverbought: 65,
      atrPeriod: 14,
      stopAtrMultiplier: 1.0,
      deviationThreshold: 2.0,
      deviationLookback: 20,
      timeframe: '15m',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'vwap', params: {} },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const lookback = this.params.deviationLookback as number;

    if (candles.length < lookback + 10) {
      return [];
    }

    const closes = this.getCloses(candles);
    const vwapValues = vwap(candles);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const price = this.getLatestPrice(snapshot);
    const currentVwap = vwapValues[lastIdx];
    const currentRsi = rsiValues[lastIdx];
    const currentAtr = atrValues[lastIdx];

    if (currentVwap === undefined || currentRsi === undefined || currentAtr === undefined) {
      return [];
    }

    // Calculate standard deviation of price-VWAP differences
    const stdDev = this.calculateVwapStdDev(closes, vwapValues, lastIdx, lookback);
    if (stdDev === null || stdDev === 0) {
      return [];
    }

    const deviation = (price - currentVwap) / stdDev;
    const deviationThreshold = this.params.deviationThreshold as number;

    const signals: TradingSignal[] = [];

    // Bullish: price far below VWAP + oversold RSI
    if (deviation < -deviationThreshold && currentRsi < (this.params.rsiOversold as number)) {
      const stopLoss = price - currentAtr * (this.params.stopAtrMultiplier as number);
      const takeProfit = currentVwap;

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: this.calculateConfidence(Math.abs(deviation), currentRsi, 'buy'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'VWAP', value: currentVwap, signal: 'buy', confidence: 0.8 },
          { indicator: 'VWAP_Deviation', value: deviation, signal: 'buy', confidence: 0.75 },
          { indicator: 'RSI', value: currentRsi, signal: 'buy', confidence: 0.7 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Price is ${Math.abs(deviation).toFixed(1)} std devs below VWAP ($${currentVwap.toFixed(2)}). RSI oversold at ${currentRsi.toFixed(1)}. Targeting VWAP reversion at $${takeProfit.toFixed(2)}, stop $${stopLoss.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    // Bearish: price far above VWAP + overbought RSI
    if (deviation > deviationThreshold && currentRsi > (this.params.rsiOverbought as number)) {
      const stopLoss = price + currentAtr * (this.params.stopAtrMultiplier as number);
      const takeProfit = currentVwap;

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: this.calculateConfidence(Math.abs(deviation), currentRsi, 'sell'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'VWAP', value: currentVwap, signal: 'sell', confidence: 0.8 },
          { indicator: 'VWAP_Deviation', value: deviation, signal: 'sell', confidence: 0.75 },
          { indicator: 'RSI', value: currentRsi, signal: 'sell', confidence: 0.7 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Price is ${deviation.toFixed(1)} std devs above VWAP ($${currentVwap.toFixed(2)}). RSI overbought at ${currentRsi.toFixed(1)}. Targeting VWAP reversion at $${takeProfit.toFixed(2)}, stop $${stopLoss.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  private calculateVwapStdDev(
    closes: number[],
    vwapValues: number[],
    endIdx: number,
    lookback: number,
  ): number | null {
    const diffs: number[] = [];
    const startIdx = Math.max(endIdx - lookback + 1, 0);

    for (let idx = startIdx; idx <= endIdx; idx++) {
      const close = closes[idx];
      const vwapVal = vwapValues[idx];
      if (close === undefined || vwapVal === undefined) continue;
      diffs.push(close - vwapVal);
    }

    if (diffs.length < 5) return null;

    const mean = diffs.reduce((sum, val) => sum + val, 0) / diffs.length;
    const variance = diffs.reduce((sum, val) => sum + (val - mean) ** 2, 0) / diffs.length;

    return Math.sqrt(variance);
  }

  private calculateConfidence(
    deviationMagnitude: number,
    currentRsi: number,
    side: 'buy' | 'sell',
  ): number {
    // Greater deviation = stronger reversion potential
    const devConf = Math.min((deviationMagnitude - 1) / 3, 1) * 0.4;

    // RSI extremeness
    const rsiExtreme = side === 'buy'
      ? ((this.params.rsiOversold as number) - currentRsi) / 35
      : (currentRsi - (this.params.rsiOverbought as number)) / 35;
    const rsiConf = Math.min(Math.max(rsiExtreme, 0), 1) * 0.35;

    // Base confidence
    const baseConf = 0.2;

    return Math.min(baseConf + devConf + rsiConf, 0.9);
  }
}
