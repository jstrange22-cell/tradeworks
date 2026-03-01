export interface FibonacciLevel {
  /** The Fibonacci ratio (e.g. 0.236, 0.382, 0.5, 0.618, 0.786) */
  level: number;
  /** The price at this Fibonacci level */
  price: number;
}

/**
 * Fibonacci Retracement Levels
 *
 * Given a swing high and swing low, calculates standard retracement
 * levels. Retracement levels are measured from the high downward:
 *   price = high - level * (high - low)
 *
 * Standard levels: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
 */
export function fibonacciRetracement(
  high: number,
  low: number,
): FibonacciLevel[] {
  if (high < low) {
    throw new Error('High must be greater than or equal to low');
  }

  const range = high - low;
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  return levels.map((level) => ({
    level,
    price: high - level * range,
  }));
}

/**
 * Fibonacci Extension Levels
 *
 * Given a swing high and swing low, projects extension levels beyond
 * the high:
 *   price = high + level * (high - low)
 *
 * Standard extension levels: 0%, 61.8%, 100%, 161.8%, 200%, 261.8%, 423.6%
 */
export function fibonacciExtension(
  high: number,
  low: number,
): FibonacciLevel[] {
  if (high < low) {
    throw new Error('High must be greater than or equal to low');
  }

  const range = high - low;
  const levels = [0, 0.618, 1.0, 1.618, 2.0, 2.618, 4.236];

  return levels.map((level) => ({
    level,
    price: high + level * range,
  }));
}
