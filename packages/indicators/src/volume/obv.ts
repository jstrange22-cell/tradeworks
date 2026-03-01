import type { OHLCV } from '@tradeworks/shared';

/**
 * On-Balance Volume (OBV)
 *
 * OBV is a cumulative total of volume. On an up-close candle the
 * volume is added; on a down-close candle the volume is subtracted.
 * If close is unchanged, OBV stays the same.
 *
 * OBV[0] = volume[0]
 * OBV[i] = OBV[i-1] + volume[i]  if close[i] > close[i-1]
 * OBV[i] = OBV[i-1] - volume[i]  if close[i] < close[i-1]
 * OBV[i] = OBV[i-1]              if close[i] == close[i-1]
 */
export function obv(candles: OHLCV[]): number[] {
  const length = candles.length;
  const result: number[] = new Array(length).fill(0);

  if (length === 0) return result;

  result[0] = candles[0].volume;

  for (let i = 1; i < length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      result[i] = result[i - 1] + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      result[i] = result[i - 1] - candles[i].volume;
    } else {
      result[i] = result[i - 1];
    }
  }

  return result;
}
