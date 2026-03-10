import type { MarketSnapshot, TradingSignal, OHLCV } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import { rsi, atr } from '@tradeworks/indicators';

interface SwingPoint {
  index: number;
  price: number;
  rsiValue: number;
}

/**
 * RSI Divergence Detection Strategy.
 *
 * Detects bullish and bearish divergences between price action and RSI,
 * signaling potential trend reversals.
 *
 * Bullish divergence:
 * - Price makes a lower low
 * - RSI makes a higher low
 * - Entry on confirmation, stop below swing low, target = 2x risk
 *
 * Bearish divergence:
 * - Price makes a higher high
 * - RSI makes a lower high
 * - Entry on confirmation, stop above swing high, target = 2x risk
 */
export class RsiDivergenceStrategy extends BaseStrategy {
  readonly name = 'RSI Divergence';
  readonly market = 'crypto' as const;
  readonly strategyType = 'rsi_divergence';

  getDefaultParams() {
    return {
      rsiPeriod: 14,
      atrPeriod: 14,
      lookbackMin: 10,
      lookbackMax: 20,
      swingStrength: 2,
      rsiOversoldZone: 40,
      rsiOverboughtZone: 60,
      riskRewardMultiplier: 2.0,
      timeframe: '1h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);
    const lookbackMax = this.params.lookbackMax as number;

    if (candles.length < lookbackMax + 10) {
      return [];
    }

    const closes = this.getCloses(candles);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const currentAtr = atrValues[lastIdx];
    const price = this.getLatestPrice(snapshot);

    if (currentAtr === undefined) {
      return [];
    }

    const signals: TradingSignal[] = [];
    const strength = this.params.swingStrength as number;
    const lookbackMin = this.params.lookbackMin as number;

    const swingLows = this.findSwingLows(candles, rsiValues, lastIdx, lookbackMax, strength);
    const swingHighs = this.findSwingHighs(candles, rsiValues, lastIdx, lookbackMax, strength);

    // Bullish divergence: lower price low + higher RSI low
    if (swingLows.length >= 2) {
      const recent = swingLows[swingLows.length - 1]!;
      const previous = swingLows[swingLows.length - 2]!;

      const priceLowerLow = recent.price < previous.price;
      const rsiHigherLow = recent.rsiValue > previous.rsiValue;
      const distanceOk = (recent.index - previous.index) >= lookbackMin;
      const inOversoldZone = recent.rsiValue < (this.params.rsiOversoldZone as number);

      if (priceLowerLow && rsiHigherLow && distanceOk && inOversoldZone) {
        const swingLowPrice = recent.price;
        const stopLoss = swingLowPrice - currentAtr * 0.5;
        const risk = price - stopLoss;
        const takeProfit = price + risk * (this.params.riskRewardMultiplier as number);

        const divergenceStrength = (recent.rsiValue - previous.rsiValue) / 20;
        const confidence = Math.min(0.4 + divergenceStrength * 0.3 + (inOversoldZone ? 0.15 : 0), 0.9);

        signals.push({
          instrument: snapshot.instrument,
          market: this.market,
          action: 'buy',
          confidence,
          entryPrice: price,
          stopLoss,
          takeProfit,
          indicators: [
            { indicator: 'RSI', value: recent.rsiValue, signal: 'buy', confidence: 0.7 },
            { indicator: 'RSI_Divergence', value: recent.rsiValue - previous.rsiValue, signal: 'buy', confidence: 0.8 },
            { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
          ],
          reasoning: `Bullish RSI divergence: price made lower low ($${recent.price.toFixed(2)} vs $${previous.price.toFixed(2)}) but RSI made higher low (${recent.rsiValue.toFixed(1)} vs ${previous.rsiValue.toFixed(1)}). Stop at $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
          strategyId: '',
          timestamp: Date.now(),
        });
      }
    }

    // Bearish divergence: higher price high + lower RSI high
    if (swingHighs.length >= 2) {
      const recent = swingHighs[swingHighs.length - 1]!;
      const previous = swingHighs[swingHighs.length - 2]!;

      const priceHigherHigh = recent.price > previous.price;
      const rsiLowerHigh = recent.rsiValue < previous.rsiValue;
      const distanceOk = (recent.index - previous.index) >= lookbackMin;
      const inOverboughtZone = recent.rsiValue > (this.params.rsiOverboughtZone as number);

      if (priceHigherHigh && rsiLowerHigh && distanceOk && inOverboughtZone) {
        const swingHighPrice = recent.price;
        const stopLoss = swingHighPrice + currentAtr * 0.5;
        const risk = stopLoss - price;
        const takeProfit = price - risk * (this.params.riskRewardMultiplier as number);

        const divergenceStrength = (previous.rsiValue - recent.rsiValue) / 20;
        const confidence = Math.min(0.4 + divergenceStrength * 0.3 + (inOverboughtZone ? 0.15 : 0), 0.9);

        signals.push({
          instrument: snapshot.instrument,
          market: this.market,
          action: 'sell',
          confidence,
          entryPrice: price,
          stopLoss,
          takeProfit,
          indicators: [
            { indicator: 'RSI', value: recent.rsiValue, signal: 'sell', confidence: 0.7 },
            { indicator: 'RSI_Divergence', value: previous.rsiValue - recent.rsiValue, signal: 'sell', confidence: 0.8 },
            { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
          ],
          reasoning: `Bearish RSI divergence: price made higher high ($${recent.price.toFixed(2)} vs $${previous.price.toFixed(2)}) but RSI made lower high (${recent.rsiValue.toFixed(1)} vs ${previous.rsiValue.toFixed(1)}). Stop at $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
          strategyId: '',
          timestamp: Date.now(),
        });
      }
    }

    return signals;
  }

  private findSwingLows(
    candles: OHLCV[],
    rsiValues: number[],
    endIdx: number,
    lookback: number,
    strength: number,
  ): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const startIdx = Math.max(endIdx - lookback, strength);

    for (let idx = startIdx; idx <= endIdx - strength; idx++) {
      const rsiVal = rsiValues[idx];
      if (rsiVal === undefined) continue;

      let isSwingLow = true;
      for (let offset = 1; offset <= strength; offset++) {
        const leftCandle = candles[idx - offset];
        const rightCandle = candles[idx + offset];
        if (!leftCandle || !rightCandle) {
          isSwingLow = false;
          break;
        }
        if (candles[idx]!.low >= leftCandle.low || candles[idx]!.low >= rightCandle.low) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        swings.push({ index: idx, price: candles[idx]!.low, rsiValue: rsiVal });
      }
    }

    return swings;
  }

  private findSwingHighs(
    candles: OHLCV[],
    rsiValues: number[],
    endIdx: number,
    lookback: number,
    strength: number,
  ): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const startIdx = Math.max(endIdx - lookback, strength);

    for (let idx = startIdx; idx <= endIdx - strength; idx++) {
      const rsiVal = rsiValues[idx];
      if (rsiVal === undefined) continue;

      let isSwingHigh = true;
      for (let offset = 1; offset <= strength; offset++) {
        const leftCandle = candles[idx - offset];
        const rightCandle = candles[idx + offset];
        if (!leftCandle || !rightCandle) {
          isSwingHigh = false;
          break;
        }
        if (candles[idx]!.high <= leftCandle.high || candles[idx]!.high <= rightCandle.high) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        swings.push({ index: idx, price: candles[idx]!.high, rsiValue: rsiVal });
      }
    }

    return swings;
  }
}
