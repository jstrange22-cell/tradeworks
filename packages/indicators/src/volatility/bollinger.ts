import { sma } from '../trend/sma.js';

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

/**
 * Bollinger Bands
 *
 * Middle band = SMA(closes, period)
 * Upper band  = Middle + stdDev * standard deviation
 * Lower band  = Middle - stdDev * standard deviation
 *
 * The standard deviation is computed over the same rolling window as the SMA.
 * Returns NaN for the first `period - 1` indices.
 */
export function bollinger(
  closes: number[],
  period = 20,
  stdDev = 2,
): BollingerResult {
  if (period <= 0) {
    throw new Error('Bollinger period must be greater than 0');
  }
  if (stdDev <= 0) {
    throw new Error('Bollinger standard deviation multiplier must be greater than 0');
  }

  const length = closes.length;
  const upper: number[] = new Array(length).fill(NaN);
  const middle: number[] = new Array(length).fill(NaN);
  const lower: number[] = new Array(length).fill(NaN);

  const smaValues = sma(closes, period);

  for (let i = period - 1; i < length; i++) {
    const mean = smaValues[i];

    // Population standard deviation over the window
    let squaredSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      squaredSum += diff * diff;
    }
    const sd = Math.sqrt(squaredSum / period);

    middle[i] = mean;
    upper[i] = mean + stdDev * sd;
    lower[i] = mean - stdDev * sd;
  }

  return { upper, middle, lower };
}
