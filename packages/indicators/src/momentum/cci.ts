import type { OHLCV } from '@tradeworks/shared';

/**
 * Commodity Channel Index (CCI)
 *
 * CCI = (Typical Price - SMA(Typical Price, period)) / (0.015 * Mean Deviation)
 *
 * Typical Price = (High + Low + Close) / 3
 * Mean Deviation = mean of absolute deviations from the SMA
 * The constant 0.015 ensures ~75% of CCI values fall between -100 and +100.
 *
 * Returns NaN for the first `period - 1` indices.
 */
export function cci(candles: OHLCV[], period = 20): number[] {
  if (period <= 0) {
    throw new Error('CCI period must be greater than 0');
  }

  const length = candles.length;
  const result: number[] = new Array(length).fill(NaN);

  if (length < period) {
    return result;
  }

  // Pre-compute typical prices
  const tp: number[] = new Array(length);
  for (let i = 0; i < length; i++) {
    tp[i] = (candles[i].high + candles[i].low + candles[i].close) / 3;
  }

  for (let i = period - 1; i < length; i++) {
    // SMA of typical price
    let tpSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      tpSum += tp[j];
    }
    const tpSma = tpSum / period;

    // Mean deviation
    let deviationSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      deviationSum += Math.abs(tp[j] - tpSma);
    }
    const meanDeviation = deviationSum / period;

    if (meanDeviation === 0) {
      result[i] = 0;
    } else {
      result[i] = (tp[i] - tpSma) / (0.015 * meanDeviation);
    }
  }

  return result;
}
