import type { MarketSnapshot, TradingSignal, IndicatorSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { ema, rsi, atr } from '@tradeworks/indicators';

interface TimeframeAnalysis {
  timeframe: string;
  fastEma: number;
  slowEma: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Multi-Timeframe Momentum Strategy.
 *
 * Confirms trend alignment across three timeframes (1h, 4h, 1d)
 * before entering on pullback to the entry timeframe EMA.
 *
 * All timeframes must agree on direction:
 * - Bullish: EMA 21 > EMA 50 on all three timeframes
 * - Bearish: EMA 21 < EMA 50 on all three timeframes
 *
 * Entry (Long):
 * - All 3 TFs bullish
 * - Price pulls back to 1h EMA 21 (within tolerance)
 *
 * Entry (Short):
 * - All 3 TFs bearish
 * - Price rallies to 1h EMA 21 (within tolerance)
 *
 * Exit:
 * - Stop: below 1h EMA 50
 * - Target: 3x risk distance
 */
export class MultiTimeframeMomentumStrategy extends BaseStrategy {
  readonly name = 'Multi-Timeframe Momentum';
  readonly market = 'crypto' as const;
  readonly strategyType = 'multi_timeframe_momentum';

  getDefaultParams() {
    return {
      fastEmaPeriod: 21,
      slowEmaPeriod: 50,
      rsiPeriod: 14,
      atrPeriod: 14,
      pullbackTolerancePct: 0.003,
      riskRewardMultiplier: 3.0,
      entryTimeframe: '1h',
      midTimeframe: '4h',
      highTimeframe: '1d',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'ema', params: { period: this.params.fastEmaPeriod as number } },
      { name: 'ema', params: { period: this.params.slowEmaPeriod as number } },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const entryTf = this.params.entryTimeframe as string;
    const midTf = this.params.midTimeframe as string;
    const highTf = this.params.highTimeframe as string;
    const slowPeriod = this.params.slowEmaPeriod as number;

    // Analyze all three timeframes
    const entryAnalysis = this.analyzeTimeframe(snapshot, entryTf, slowPeriod);
    const midAnalysis = this.analyzeTimeframe(snapshot, midTf, slowPeriod);
    const highAnalysis = this.analyzeTimeframe(snapshot, highTf, slowPeriod);

    if (entryAnalysis === null || midAnalysis === null || highAnalysis === null) {
      return [];
    }

    // All timeframes must align
    const allBullish = entryAnalysis.trend === 'bullish' &&
      midAnalysis.trend === 'bullish' &&
      highAnalysis.trend === 'bullish';

    const allBearish = entryAnalysis.trend === 'bearish' &&
      midAnalysis.trend === 'bearish' &&
      highAnalysis.trend === 'bearish';

    if (!allBullish && !allBearish) {
      return [];
    }

    // Calculate entry timeframe indicators
    const entryCandles = this.getCandles(snapshot, entryTf);
    const entryCloses = this.getCloses(entryCandles);
    const rsiValues = rsi(entryCloses, this.params.rsiPeriod as number);
    const atrValues = atr(entryCandles, this.params.atrPeriod as number);

    const lastIdx = entryCloses.length - 1;
    const price = this.getLatestPrice(snapshot);
    const currentRsi = rsiValues[lastIdx];
    const currentAtr = atrValues[lastIdx];

    if (currentRsi === undefined || currentAtr === undefined) {
      return [];
    }

    const tolerance = this.params.pullbackTolerancePct as number;
    const signals: TradingSignal[] = [];

    if (allBullish) {
      // Check for pullback to entry timeframe fast EMA
      const distanceToEma = (price - entryAnalysis.fastEma) / price;
      const isPullback = distanceToEma >= -tolerance && distanceToEma <= tolerance;

      if (isPullback) {
        const stopLoss = entryAnalysis.slowEma;
        const risk = price - stopLoss;

        if (risk <= 0) return [];

        const takeProfit = price + risk * (this.params.riskRewardMultiplier as number);
        const indicatorSignals = this.buildIndicatorSignals(entryAnalysis, midAnalysis, highAnalysis, currentRsi, currentAtr, 'buy');

        signals.push({
          instrument: snapshot.instrument,
          market: this.market,
          action: 'buy',
          confidence: this.calculateMtfConfidence(entryAnalysis, midAnalysis, highAnalysis, currentRsi, distanceToEma),
          entryPrice: price,
          stopLoss,
          takeProfit,
          indicators: indicatorSignals,
          reasoning: `Multi-TF bullish alignment (${entryTf}/${midTf}/${highTf} all EMA 21 > EMA 50). Pullback to ${entryTf} EMA 21 ($${entryAnalysis.fastEma.toFixed(2)}). RSI ${currentRsi.toFixed(1)}. Stop below EMA 50 ($${stopLoss.toFixed(2)}), target $${takeProfit.toFixed(2)} (1:${(this.params.riskRewardMultiplier as number).toFixed(0)} R:R).`,
          strategyId: '',
          timestamp: Date.now(),
        });
      }
    }

    if (allBearish) {
      const distanceToEma = (entryAnalysis.fastEma - price) / price;
      const isPullback = distanceToEma >= -tolerance && distanceToEma <= tolerance;

      if (isPullback) {
        const stopLoss = entryAnalysis.slowEma;
        const risk = stopLoss - price;

        if (risk <= 0) return [];

        const takeProfit = price - risk * (this.params.riskRewardMultiplier as number);
        const indicatorSignals = this.buildIndicatorSignals(entryAnalysis, midAnalysis, highAnalysis, currentRsi, currentAtr, 'sell');

        signals.push({
          instrument: snapshot.instrument,
          market: this.market,
          action: 'sell',
          confidence: this.calculateMtfConfidence(entryAnalysis, midAnalysis, highAnalysis, currentRsi, distanceToEma),
          entryPrice: price,
          stopLoss,
          takeProfit,
          indicators: indicatorSignals,
          reasoning: `Multi-TF bearish alignment (${entryTf}/${midTf}/${highTf} all EMA 21 < EMA 50). Pullback to ${entryTf} EMA 21 ($${entryAnalysis.fastEma.toFixed(2)}). RSI ${currentRsi.toFixed(1)}. Stop above EMA 50 ($${stopLoss.toFixed(2)}), target $${takeProfit.toFixed(2)} (1:${(this.params.riskRewardMultiplier as number).toFixed(0)} R:R).`,
          strategyId: '',
          timestamp: Date.now(),
        });
      }
    }

    return signals;
  }

  private analyzeTimeframe(
    snapshot: MarketSnapshot,
    timeframe: string,
    minBars: number,
  ): TimeframeAnalysis | null {
    const candles = this.getCandles(snapshot, timeframe);

    if (candles.length < minBars + 5) {
      return null;
    }

    const closes = this.getCloses(candles);
    const fastEmaValues = ema(closes, this.params.fastEmaPeriod as number);
    const slowEmaValues = ema(closes, this.params.slowEmaPeriod as number);

    const lastIdx = closes.length - 1;
    const fastEma = fastEmaValues[lastIdx];
    const slowEma = slowEmaValues[lastIdx];

    if (fastEma === undefined || slowEma === undefined) {
      return null;
    }

    let trend: 'bullish' | 'bearish' | 'neutral';
    if (fastEma > slowEma) {
      trend = 'bullish';
    } else if (fastEma < slowEma) {
      trend = 'bearish';
    } else {
      trend = 'neutral';
    }

    return { timeframe, fastEma, slowEma, trend };
  }

  private buildIndicatorSignals(
    entry: TimeframeAnalysis,
    mid: TimeframeAnalysis,
    high: TimeframeAnalysis,
    currentRsi: number,
    currentAtr: number,
    side: 'buy' | 'sell',
  ): IndicatorSignal[] {
    return [
      { indicator: `EMA_21_${entry.timeframe}`, value: entry.fastEma, signal: side, confidence: 0.7 },
      { indicator: `EMA_50_${entry.timeframe}`, value: entry.slowEma, signal: side, confidence: 0.7 },
      { indicator: `EMA_21_${mid.timeframe}`, value: mid.fastEma, signal: side, confidence: 0.75 },
      { indicator: `EMA_50_${mid.timeframe}`, value: mid.slowEma, signal: side, confidence: 0.75 },
      { indicator: `EMA_21_${high.timeframe}`, value: high.fastEma, signal: side, confidence: 0.8 },
      { indicator: `EMA_50_${high.timeframe}`, value: high.slowEma, signal: side, confidence: 0.8 },
      { indicator: 'RSI', value: currentRsi, signal: side === 'buy' && currentRsi > 40 ? 'buy' : side === 'sell' && currentRsi < 60 ? 'sell' : 'neutral', confidence: 0.6 },
      { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
    ];
  }

  private calculateMtfConfidence(
    entry: TimeframeAnalysis,
    mid: TimeframeAnalysis,
    high: TimeframeAnalysis,
    currentRsi: number,
    distanceToEma: number,
  ): number {
    // Higher TF alignment strength
    const highSep = Math.abs(high.fastEma - high.slowEma) / high.fastEma;
    const highConf = Math.min(highSep / 0.02, 1) * 0.25;

    const midSep = Math.abs(mid.fastEma - mid.slowEma) / mid.fastEma;
    const midConf = Math.min(midSep / 0.015, 1) * 0.2;

    const entrySep = Math.abs(entry.fastEma - entry.slowEma) / entry.fastEma;
    const entryConf = Math.min(entrySep / 0.01, 1) * 0.15;

    // Pullback quality (closer to EMA = better entry)
    const pullbackConf = Math.min((1 - Math.abs(distanceToEma) / 0.003), 1) * 0.2;

    // RSI in healthy range (40-60 for pullbacks)
    const rsiInRange = currentRsi >= 35 && currentRsi <= 65;
    const rsiConf = rsiInRange ? 0.1 : 0.0;

    return Math.min(highConf + midConf + entryConf + pullbackConf + rsiConf + 0.1, 0.95);
  }
}
