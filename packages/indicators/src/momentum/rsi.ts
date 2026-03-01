/**
 * Relative Strength Index (RSI)
 *
 * Uses the smoothed (Wilder) moving average method:
 *   1. Compute price changes.
 *   2. Separate gains and losses.
 *   3. Seed the first average gain/loss with the SMA of the first `period` changes.
 *   4. Smooth subsequent values: avgGain = (prevAvgGain * (period-1) + currentGain) / period
 *   5. RSI = 100 - 100 / (1 + avgGain / avgLoss)
 *
 * Returns NaN for the first `period` indices (not enough data).
 * RSI values range from 0 to 100.
 */
export function rsi(closes: number[], period = 14): number[] {
  if (period <= 0) {
    throw new Error('RSI period must be greater than 0');
  }

  const length = closes.length;
  const result: number[] = new Array(length).fill(NaN);

  if (length < period + 1) {
    return result;
  }

  // Compute changes
  const gains: number[] = new Array(length).fill(0);
  const losses: number[] = new Array(length).fill(0);

  for (let i = 1; i < length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      gains[i] = change;
    } else {
      losses[i] = -change;
    }
  }

  // Seed: average of first `period` changes (indices 1..period)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - 100 / (1 + rs);
  }

  // Wilder smoothing
  for (let i = period + 1; i < length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}
