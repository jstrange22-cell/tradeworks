import type { OHLCV } from '@tradeworks/shared';
import { ema } from '../trend/ema.js';
import { atr as computeAtr } from './atr.js';

export interface KeltnerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

/**
 * Keltner Channels
 *
 * Middle = EMA(close, emaPeriod)
 * Upper  = Middle + multiplier * ATR(atrPeriod)
 * Lower  = Middle - multiplier * ATR(atrPeriod)
 *
 * Keltner Channels are volatility-based envelopes similar to Bollinger
 * Bands, but use ATR instead of standard deviation.
 */
export function keltner(
  candles: OHLCV[],
  emaPeriod = 20,
  atrPeriod = 10,
  multiplier = 2,
): KeltnerResult {
  if (emaPeriod <= 0 || atrPeriod <= 0) {
    throw new Error('Keltner periods must be greater than 0');
  }
  if (multiplier <= 0) {
    throw new Error('Keltner multiplier must be greater than 0');
  }

  const length = candles.length;
  const upper: number[] = new Array(length).fill(NaN);
  const middle: number[] = new Array(length).fill(NaN);
  const lower: number[] = new Array(length).fill(NaN);

  const closes = candles.map((c) => c.close);
  const emaValues = ema(closes, emaPeriod);
  const atrValues = computeAtr(candles, atrPeriod);

  for (let i = 0; i < length; i++) {
    if (!isNaN(emaValues[i]) && !isNaN(atrValues[i])) {
      middle[i] = emaValues[i];
      upper[i] = emaValues[i] + multiplier * atrValues[i];
      lower[i] = emaValues[i] - multiplier * atrValues[i];
    }
  }

  return { upper, middle, lower };
}
