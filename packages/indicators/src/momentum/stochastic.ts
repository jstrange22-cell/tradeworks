import type { OHLCV } from '@tradeworks/shared';
import { sma } from '../trend/sma.js';

export interface StochasticResult {
  /** %K — fast stochastic line */
  k: number[];
  /** %D — SMA of %K */
  d: number[];
}

/**
 * Stochastic Oscillator (%K and %D)
 *
 * %K = 100 * (close - lowestLow(kPeriod)) / (highestHigh(kPeriod) - lowestLow(kPeriod))
 * %D = SMA(%K, dPeriod)
 *
 * Both values range from 0 to 100.
 */
export function stochastic(
  candles: OHLCV[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult {
  if (kPeriod <= 0 || dPeriod <= 0) {
    throw new Error('Stochastic periods must be greater than 0');
  }

  const length = candles.length;
  const kValues: number[] = new Array(length).fill(NaN);

  for (let i = kPeriod - 1; i < length; i++) {
    let lowestLow = Infinity;
    let highestHigh = -Infinity;

    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].low < lowestLow) lowestLow = candles[j].low;
      if (candles[j].high > highestHigh) highestHigh = candles[j].high;
    }

    const range = highestHigh - lowestLow;
    if (range === 0) {
      kValues[i] = 50; // Flat market — neutral
    } else {
      kValues[i] = 100 * ((candles[i].close - lowestLow) / range);
    }
  }

  // %D is the SMA of %K values. We extract valid %K values, compute
  // SMA on them, then map back.
  const validK: number[] = [];
  const validIndices: number[] = [];
  for (let i = 0; i < length; i++) {
    if (!isNaN(kValues[i])) {
      validK.push(kValues[i]);
      validIndices.push(i);
    }
  }

  const dValues: number[] = new Array(length).fill(NaN);
  if (validK.length >= dPeriod) {
    const dSma = sma(validK, dPeriod);
    for (let j = 0; j < dSma.length; j++) {
      if (!isNaN(dSma[j])) {
        dValues[validIndices[j]] = dSma[j];
      }
    }
  }

  return { k: kValues, d: dValues };
}
