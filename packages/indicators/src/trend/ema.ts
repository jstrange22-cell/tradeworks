/**
 * Exponential Moving Average (EMA)
 *
 * Uses the standard smoothing factor k = 2 / (period + 1).
 * The first valid value is at index `period - 1` and is seeded with
 * the SMA of the first `period` closes. Prior indices are NaN.
 */
export function ema(closes: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('EMA period must be greater than 0');
  }

  const result: number[] = new Array(closes.length).fill(NaN);

  if (closes.length < period) {
    return result;
  }

  const k = 2 / (period + 1);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  let prev = sum / period;
  result[period - 1] = prev;

  // Apply EMA formula
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result[i] = prev;
  }

  return result;
}
