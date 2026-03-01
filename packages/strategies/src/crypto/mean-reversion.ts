import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { bollinger, rsi, atr } from '@tradeworks/indicators';

/**
 * Crypto Mean Reversion Strategy.
 *
 * Buys when price touches lower Bollinger Band with oversold RSI.
 * Sells when price touches upper Bollinger Band with overbought RSI.
 * Targets the middle band (SMA) as mean reversion target.
 */
export class MeanReversionStrategy extends BaseStrategy {
  readonly name = 'Crypto Mean Reversion';
  readonly market = 'crypto' as const;
  readonly strategyType = 'mean_reversion';

  getDefaultParams() {
    return {
      bollingerPeriod: 20,
      bollingerStdDev: 2.0,
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      atrPeriod: 14,
      stopMultiplier: 1.5,
      timeframe: '4h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'bollinger', params: { period: this.params.bollingerPeriod as number, stdDev: this.params.bollingerStdDev as number } },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);

    if (candles.length < (this.params.bollingerPeriod as number) + 5) {
      return [];
    }

    const closes = this.getCloses(candles);
    const bands = bollinger(closes, this.params.bollingerPeriod as number, this.params.bollingerStdDev as number);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const price = snapshot.currentPrice;
    const upper = bands.upper[lastIdx];
    const lower = bands.lower[lastIdx];
    const middle = bands.middle[lastIdx];
    const currentRsi = rsiValues[lastIdx];
    const currentAtr = atrValues[lastIdx];

    if (upper === undefined || lower === undefined || middle === undefined ||
        currentRsi === undefined || currentAtr === undefined) {
      return [];
    }

    const signals: TradingSignal[] = [];

    // Buy: price at/below lower band + RSI oversold
    if (price <= lower && currentRsi < (this.params.rsiOversold as number)) {
      const stopLoss = price - currentAtr * (this.params.stopMultiplier as number);
      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence: Math.min((((this.params.rsiOversold as number) - currentRsi) / 30) * 0.5 + 0.4, 0.9),
        entryPrice: price,
        stopLoss,
        takeProfit: middle, // Target: mean (middle band)
        indicators: [
          { indicator: 'Bollinger_Lower', value: lower, signal: 'buy', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: 'buy', confidence: 0.7 },
        ],
        reasoning: `Price at lower Bollinger Band ($${lower.toFixed(2)}) with oversold RSI (${currentRsi.toFixed(1)}). Targeting mean reversion to middle band ($${middle.toFixed(2)}).`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    // Sell: price at/above upper band + RSI overbought
    if (price >= upper && currentRsi > (this.params.rsiOverbought as number)) {
      const stopLoss = price + currentAtr * (this.params.stopMultiplier as number);
      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence: Math.min(((currentRsi - (this.params.rsiOverbought as number)) / 30) * 0.5 + 0.4, 0.9),
        entryPrice: price,
        stopLoss,
        takeProfit: middle,
        indicators: [
          { indicator: 'Bollinger_Upper', value: upper, signal: 'sell', confidence: 0.8 },
          { indicator: 'RSI', value: currentRsi, signal: 'sell', confidence: 0.7 },
        ],
        reasoning: `Price at upper Bollinger Band ($${upper.toFixed(2)}) with overbought RSI (${currentRsi.toFixed(1)}). Targeting mean reversion to middle band ($${middle.toFixed(2)}).`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }
}
