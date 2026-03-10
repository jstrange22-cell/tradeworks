import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { ema, rsi, atr } from '@tradeworks/indicators';

/**
 * EMA 9/21 Crossover with RSI Confirmation.
 *
 * Uses fast EMA (9) / slow EMA (21) crossover as the primary signal,
 * confirmed by RSI momentum filter. ATR-based risk management
 * with 1:2 risk-reward ratio.
 *
 * Entry conditions (Long):
 * - Fast EMA crosses above Slow EMA
 * - RSI > 50 (momentum confirmation)
 *
 * Entry conditions (Short):
 * - Fast EMA crosses below Slow EMA
 * - RSI < 50
 *
 * Exit:
 * - Stop loss: 1.5x ATR from entry
 * - Take profit: 3x ATR from entry (1:2 risk-reward)
 */
export class EmaCrossoverStrategy extends BaseStrategy {
  readonly name = 'EMA 9/21 Crossover';
  readonly market = 'crypto' as const;
  readonly strategyType = 'ema_crossover';

  getDefaultParams() {
    return {
      fastEmaPeriod: 9,
      slowEmaPeriod: 21,
      rsiPeriod: 14,
      rsiBuyThreshold: 50,
      rsiSellThreshold: 50,
      atrPeriod: 14,
      stopMultiplier: 1.5,
      takeProfitMultiplier: 3.0,
      timeframe: '1h',
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
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const slowPeriod = this.params.slowEmaPeriod as number;

    if (candles.length < slowPeriod + 5) {
      return [];
    }

    const closes = this.getCloses(candles);
    const fastEma = ema(closes, this.params.fastEmaPeriod as number);
    const slowEma = ema(closes, slowPeriod);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;

    const currentFast = fastEma[lastIdx];
    const currentSlow = slowEma[lastIdx];
    const prevFast = fastEma[prevIdx];
    const prevSlow = slowEma[prevIdx];
    const currentRsi = rsiValues[lastIdx];
    const currentAtr = atrValues[lastIdx];
    const price = this.getLatestPrice(snapshot);

    if (
      currentFast === undefined || currentSlow === undefined ||
      prevFast === undefined || prevSlow === undefined ||
      currentRsi === undefined || currentAtr === undefined
    ) {
      return [];
    }

    const signals: TradingSignal[] = [];
    const bullishCross = prevFast <= prevSlow && currentFast > currentSlow;
    const bearishCross = prevFast >= prevSlow && currentFast < currentSlow;

    if (bullishCross && currentRsi > (this.params.rsiBuyThreshold as number)) {
      const stopLoss = price - currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = price + currentAtr * (this.params.takeProfitMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: this.calculateConfidence(currentRsi, currentFast - currentSlow, currentAtr, price, 'buy'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'EMA_9', value: currentFast, signal: 'buy', confidence: 0.8 },
          { indicator: 'EMA_21', value: currentSlow, signal: 'buy', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: currentRsi > 50 ? 'buy' : 'neutral', confidence: 0.6 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Bullish EMA 9/21 crossover with RSI confirmation (${currentRsi.toFixed(1)}). Stop at $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)} (1:2 R:R).`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    if (bearishCross && currentRsi < (this.params.rsiSellThreshold as number)) {
      const stopLoss = price + currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = price - currentAtr * (this.params.takeProfitMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: this.calculateConfidence(currentRsi, currentSlow - currentFast, currentAtr, price, 'sell'),
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'EMA_9', value: currentFast, signal: 'sell', confidence: 0.8 },
          { indicator: 'EMA_21', value: currentSlow, signal: 'sell', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: currentRsi < 50 ? 'sell' : 'neutral', confidence: 0.6 },
          { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
        ],
        reasoning: `Bearish EMA 9/21 crossover with RSI confirmation (${currentRsi.toFixed(1)}). Stop at $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)} (1:2 R:R).`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  private calculateConfidence(
    currentRsi: number,
    emaSeparation: number,
    currentAtr: number,
    price: number,
    side: 'buy' | 'sell',
  ): number {
    const rsiDistance = side === 'buy'
      ? Math.abs(currentRsi - 50) / 50
      : Math.abs(50 - currentRsi) / 50;
    const rsiConf = Math.min(rsiDistance, 1) * 0.35;

    const emaSepRatio = Math.abs(emaSeparation) / price;
    const emaConf = Math.min(emaSepRatio / 0.005, 1) * 0.35;

    const atrRatio = currentAtr / price;
    const atrConf = (atrRatio > 0.003 && atrRatio < 0.05) ? 0.3 : 0.1;

    return Math.min(rsiConf + emaConf + atrConf, 0.95);
  }
}
