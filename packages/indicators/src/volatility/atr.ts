import type { OHLCV } from '@tradeworks/shared';

/**
 * Average True Range (ATR)
 *
 * True Range = max(
 *   high - low,
 *   |high - previousClose|,
 *   |low - previousClose|
 * )
 *
 * The first ATR value (at index `period`) is the SMA of the first
 * `period` true ranges. Subsequent values use Wilder smoothing:
 *   ATR = (prevATR * (period - 1) + currentTR) / period
 *
 * Returns NaN for indices 0 through period - 1.
 */
export function atr(candles: OHLCV[], period = 14): number[] {
  if (period <= 0) {
    throw new Error('ATR period must be greater than 0');
  }

  const length = candles.length;
  const result: number[] = new Array(length).fill(NaN);

  if (length < period + 1) {
    return result;
  }

  // True Range array (index 0 has no previous close, use high - low)
  const tr: number[] = new Array(length);
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highPrevClose = Math.abs(candles[i].high - candles[i - 1].close);
    const lowPrevClose = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(highLow, highPrevClose, lowPrevClose);
  }

  // Seed with SMA of first `period` true ranges (starting from index 1)
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }
  let prevAtr = sum / period;
  result[period] = prevAtr;

  // Wilder smoothing
  for (let i = period + 1; i < length; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    result[i] = prevAtr;
  }

  return result;
}
