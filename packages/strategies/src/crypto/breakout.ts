import type { MarketSnapshot, TradingSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { atr, obv } from '@tradeworks/indicators';

/**
 * Crypto Breakout Strategy.
 *
 * Identifies price breakouts above/below N-period high/low channels
 * confirmed by volume expansion (OBV trend) and ATR filter.
 */
export class BreakoutStrategy extends BaseStrategy {
  readonly name = 'Crypto Breakout';
  readonly market = 'crypto' as const;
  readonly strategyType = 'breakout';

  getDefaultParams() {
    return {
      channelPeriod: 20,
      atrPeriod: 14,
      stopMultiplier: 1.5,
      takeProfitMultiplier: 4.5,
      volumeConfirmation: true,
      minAtrFilter: 0.005, // Min ATR as % of price
      timeframe: '4h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
      { name: 'obv', params: {} },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const period = this.params.channelPeriod as number;

    if (candles.length < period + 5) return [];

    const atrValues = atr(candles, this.params.atrPeriod as number);
    const obvValues = obv(candles);

    const lastIdx = candles.length - 1;
    const price = snapshot.currentPrice;
    const currentAtr = atrValues[lastIdx];

    if (currentAtr === undefined) return [];

    // ATR filter: skip if volatility too low
    if (currentAtr / price < (this.params.minAtrFilter as number)) return [];

    // Calculate channel high/low over lookback period
    const lookback = candles.slice(lastIdx - period, lastIdx);
    const channelHigh = Math.max(...lookback.map(c => c.high));
    const channelLow = Math.min(...lookback.map(c => c.low));

    // Volume confirmation: OBV trending in same direction
    const obvTrending = obvValues.length >= 5 &&
      obvValues[obvValues.length - 1]! > obvValues[obvValues.length - 5]!;
    const obvDeclining = obvValues.length >= 5 &&
      obvValues[obvValues.length - 1]! < obvValues[obvValues.length - 5]!;

    const signals: TradingSignal[] = [];

    // Bullish breakout
    if (price > channelHigh) {
      const volumeOk = !(this.params.volumeConfirmation as boolean) || obvTrending;
      if (volumeOk) {
        const stopLoss = price - currentAtr * (this.params.stopMultiplier as number);
        const takeProfit = price + currentAtr * (this.params.takeProfitMultiplier as number);
        signals.push({
          instrument: snapshot.instrument,
          market: this.market,
          action: 'buy',
          confidence: volumeOk ? 0.7 : 0.5,
          entryPrice: price,
          stopLoss,
          takeProfit,
          indicators: [
            { indicator: 'Channel_High', value: channelHigh, signal: 'buy', confidence: 0.8 },
            { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
            { indicator: 'OBV_Trend', value: obvValues[lastIdx] ?? 0, signal: obvTrending ? 'buy' : 'neutral', confidence: 0.6 },
          ],
          reasoning: `Bullish breakout above ${period}-period high ($${channelHigh.toFixed(2)})${volumeOk ? ' with volume confirmation' : ''}. Stop at $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
          strategyId: '',
          timestamp: Date.now(),
        });
      }
    }

    // Bearish breakout
    if (price < channelLow) {
      const volumeOk = !(this.params.volumeConfirmation as boolean) || obvDeclining;
      if (volumeOk) {
        const stopLoss = price + currentAtr * (this.params.stopMultiplier as number);
        const takeProfit = price - currentAtr * (this.params.takeProfitMultiplier as number);
        signals.push({
          instrument: snapshot.instrument,
          market: this.market,
          action: 'sell',
          confidence: volumeOk ? 0.7 : 0.5,
          entryPrice: price,
          stopLoss,
          takeProfit,
          indicators: [
            { indicator: 'Channel_Low', value: channelLow, signal: 'sell', confidence: 0.8 },
            { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
            { indicator: 'OBV_Trend', value: obvValues[lastIdx] ?? 0, signal: obvDeclining ? 'sell' : 'neutral', confidence: 0.6 },
          ],
          reasoning: `Bearish breakout below ${period}-period low ($${channelLow.toFixed(2)})${volumeOk ? ' with volume confirmation' : ''}. Stop at $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
          strategyId: '',
          timestamp: Date.now(),
        });
      }
    }

    return signals;
  }
}
