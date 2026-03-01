/**
 * Simple Moving Average (SMA)
 *
 * Calculates the arithmetic mean of the last `period` closing prices
 * at each index. The first `period - 1` values are NaN because there
 * are not enough data points to form a full window.
 */
export function sma(closes: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('SMA period must be greater than 0');
  }

  const result: number[] = new Array(closes.length).fill(NaN);

  if (closes.length < period) {
    return result;
  }

  // Compute the first window sum
  let windowSum = 0;
  for (let i = 0; i < period; i++) {
    windowSum += closes[i];
  }
  result[period - 1] = windowSum / period;

  // Slide the window forward
  for (let i = period; i < closes.length; i++) {
    windowSum += closes[i] - closes[i - period];
    result[i] = windowSum / period;
  }

  return result;
}
