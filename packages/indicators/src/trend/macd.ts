import { ema } from './ema.js';

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

/**
 * Moving Average Convergence Divergence (MACD)
 *
 * MACD line   = EMA(fast) - EMA(slow)
 * Signal line = EMA(MACD line, signal period)
 * Histogram   = MACD line - Signal line
 *
 * Default parameters: fast=12, slow=26, signal=9
 */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDResult {
  if (fast <= 0 || slow <= 0 || signal <= 0) {
    throw new Error('MACD periods must be greater than 0');
  }
  if (fast >= slow) {
    throw new Error('MACD fast period must be less than slow period');
  }

  const length = closes.length;
  const macdLine: number[] = new Array(length).fill(NaN);
  const signalLine: number[] = new Array(length).fill(NaN);
  const histogram: number[] = new Array(length).fill(NaN);

  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  // MACD line = fast EMA - slow EMA (valid from index slow - 1 onward)
  for (let i = 0; i < length; i++) {
    if (!isNaN(fastEma[i]) && !isNaN(slowEma[i])) {
      macdLine[i] = fastEma[i] - slowEma[i];
    }
  }

  // Collect valid MACD values to compute the signal EMA
  const validMacdValues: number[] = [];
  const validMacdIndices: number[] = [];
  for (let i = 0; i < length; i++) {
    if (!isNaN(macdLine[i])) {
      validMacdValues.push(macdLine[i]);
      validMacdIndices.push(i);
    }
  }

  // Signal line = EMA of MACD line
  if (validMacdValues.length >= signal) {
    const signalEma = ema(validMacdValues, signal);
    for (let j = 0; j < signalEma.length; j++) {
      if (!isNaN(signalEma[j])) {
        const idx = validMacdIndices[j];
        signalLine[idx] = signalEma[j];
        histogram[idx] = macdLine[idx] - signalEma[j];
      }
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}
