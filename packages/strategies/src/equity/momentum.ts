import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { rsi, ema, atr } from '@tradeworks/indicators';

/**
 * Equity Momentum Strategy.
 *
 * Identifies stocks with strong momentum using rate of change and trend filters.
 * Buys stocks showing positive momentum, sells when momentum fades.
 *
 * Entry: Price above 50 EMA + RSI 55-80 range (strong but not overbought)
 * Exit: RSI drops below 40 or price breaks below 50 EMA
 */
export class MomentumStrategy extends BaseStrategy {
  readonly name = 'Equity Momentum';
  readonly market = 'equity' as const;
  readonly strategyType = 'momentum';

  getDefaultParams() {
    return {
      emaPeriod: 50,
      rsiPeriod: 14,
      rsiEntryMin: 55,
      rsiEntryMax: 80,
      rsiExitBelow: 40,
      atrPeriod: 14,
      stopMultiplier: 2.0,
      takeProfitMultiplier: 4.0,
      timeframe: '1d',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'ema', params: { period: this.params.emaPeriod as number } },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);

    if (candles.length < (this.params.emaPeriod as number) + 5) return [];

    const closes = this.getCloses(candles);
    const emaValues = ema(closes, this.params.emaPeriod as number);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const price = snapshot.currentPrice;
    const currentEma = emaValues[lastIdx];
    const currentRsi = rsiValues[lastIdx];
    const currentAtr = atrValues[lastIdx];

    if (currentEma === undefined || currentRsi === undefined || currentAtr === undefined) return [];

    const signals: TradingSignal[] = [];

    // Entry: price above EMA + RSI in momentum zone
    if (price > currentEma &&
        currentRsi > (this.params.rsiEntryMin as number) &&
        currentRsi < (this.params.rsiEntryMax as number)) {

      const stopLoss = price - currentAtr * (this.params.stopMultiplier as number);
      const takeProfit = price + currentAtr * (this.params.takeProfitMultiplier as number);

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: 0.65,
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: [
          { indicator: 'EMA_50', value: currentEma, signal: 'buy', confidence: 0.7 },
          { indicator: 'RSI', value: currentRsi, signal: 'buy', confidence: 0.6 },
        ],
        reasoning: `Price above ${this.params.emaPeriod}-EMA ($${currentEma.toFixed(2)}) with RSI at ${currentRsi.toFixed(1)} (momentum zone). ATR stop at $${stopLoss.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    // Exit signal: RSI drops below threshold while holding
    if (currentRsi < (this.params.rsiExitBelow as number) && price < currentEma) {
      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'close',
        confidence: 0.7,
        entryPrice: price,
        stopLoss: null,
        takeProfit: null,
        indicators: [
          { indicator: 'RSI', value: currentRsi, signal: 'sell', confidence: 0.7 },
          { indicator: 'EMA_50', value: currentEma, signal: 'sell', confidence: 0.6 },
        ],
        reasoning: `Momentum fading: RSI dropped to ${currentRsi.toFixed(1)} and price below EMA. Close existing positions.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }
}
