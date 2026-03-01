import type { OHLCV } from '@tradeworks/shared';
import { atr as computeAtr } from '../volatility/atr.js';

export interface SuperTrendResult {
  /** The SuperTrend line value at each index */
  trend: number[];
  /** 1 = uptrend (bullish), -1 = downtrend (bearish) */
  direction: number[];
}

/**
 * SuperTrend Indicator
 *
 * Uses ATR to compute upper and lower bands around the midpoint
 * (high + low) / 2 of each candle, then flips direction when price
 * crosses through a band.
 *
 * Upper band = HL2 + multiplier * ATR
 * Lower band = HL2 - multiplier * ATR
 *
 * In an uptrend the lower band is the SuperTrend line; close below
 * the lower band triggers a flip to downtrend and vice versa.
 */
export function supertrend(
  candles: OHLCV[],
  period = 10,
  multiplier = 3,
): SuperTrendResult {
  if (period <= 0) {
    throw new Error('SuperTrend period must be greater than 0');
  }
  if (multiplier <= 0) {
    throw new Error('SuperTrend multiplier must be greater than 0');
  }

  const length = candles.length;
  const trend: number[] = new Array(length).fill(NaN);
  const direction: number[] = new Array(length).fill(0);

  const atrValues = computeAtr(candles, period);

  // Pre-compute basic upper/lower bands
  const basicUpper: number[] = new Array(length).fill(NaN);
  const basicLower: number[] = new Array(length).fill(NaN);
  const finalUpper: number[] = new Array(length).fill(NaN);
  const finalLower: number[] = new Array(length).fill(NaN);

  for (let i = 0; i < length; i++) {
    if (isNaN(atrValues[i])) continue;

    const hl2 = (candles[i].high + candles[i].low) / 2;
    basicUpper[i] = hl2 + multiplier * atrValues[i];
    basicLower[i] = hl2 - multiplier * atrValues[i];
  }

  // Initialize at the first valid ATR index
  const startIdx = period; // ATR is valid from index `period` onward
  if (startIdx >= length) {
    return { trend, direction };
  }

  finalUpper[startIdx] = basicUpper[startIdx];
  finalLower[startIdx] = basicLower[startIdx];
  // Default to uptrend
  direction[startIdx] = 1;
  trend[startIdx] = finalLower[startIdx];

  for (let i = startIdx + 1; i < length; i++) {
    if (isNaN(basicUpper[i])) continue;

    // Final upper band: take the lesser of current basic upper and
    // previous final upper, unless previous close was above previous
    // final upper (which invalidates the old level).
    finalUpper[i] =
      basicUpper[i] < finalUpper[i - 1] ||
      candles[i - 1].close > finalUpper[i - 1]
        ? basicUpper[i]
        : finalUpper[i - 1];

    // Final lower band: take the greater of current basic lower and
    // previous final lower, unless previous close was below previous
    // final lower.
    finalLower[i] =
      basicLower[i] > finalLower[i - 1] ||
      candles[i - 1].close < finalLower[i - 1]
        ? basicLower[i]
        : finalLower[i - 1];

    // Determine direction
    if (direction[i - 1] === 1) {
      // Was in uptrend
      direction[i] = candles[i].close < finalLower[i] ? -1 : 1;
    } else {
      // Was in downtrend
      direction[i] = candles[i].close > finalUpper[i] ? 1 : -1;
    }

    trend[i] = direction[i] === 1 ? finalLower[i] : finalUpper[i];
  }

  return { trend, direction };
}
