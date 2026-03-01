import type { OHLCV } from '@tradeworks/shared';

/**
 * Volume Weighted Average Price (VWAP)
 *
 * VWAP = cumulative(typicalPrice * volume) / cumulative(volume)
 *
 * Typical Price = (High + Low + Close) / 3
 *
 * VWAP is a cumulative indicator that resets each session. In this
 * implementation we compute a running VWAP across the entire candle
 * array (suitable for intraday use within a single session).
 *
 * Returns 0 at any index where cumulative volume is zero.
 */
export function vwap(candles: OHLCV[]): number[] {
  const length = candles.length;
  const result: number[] = new Array(length).fill(0);

  let cumulativeTPV = 0; // cumulative (TP * Volume)
  let cumulativeVol = 0;

  for (let i = 0; i < length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativeTPV += tp * candles[i].volume;
    cumulativeVol += candles[i].volume;

    if (cumulativeVol === 0) {
      result[i] = 0;
    } else {
      result[i] = cumulativeTPV / cumulativeVol;
    }
  }

  return result;
}
