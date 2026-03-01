/**
 * Value at Risk (VaR) Calculator using Historical Simulation method.
 * VaR estimates the maximum expected loss over a given time period at a confidence level.
 */

export interface VaRResult {
  var95: number;
  var99: number;
  expectedShortfall95: number; // CVaR / Expected Shortfall
  expectedShortfall99: number;
}

/**
 * Calculate VaR using historical simulation.
 * @param returns Array of historical returns (as decimals, e.g., -0.02 = -2%)
 * @param portfolioValue Current portfolio value
 * @returns VaR at 95% and 99% confidence levels
 */
export function calculateVaR(returns: number[], portfolioValue: number): VaRResult {
  if (returns.length < 30) {
    return { var95: 0, var99: 0, expectedShortfall95: 0, expectedShortfall99: 0 };
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const n = sorted.length;

  // VaR at confidence levels
  const index95 = Math.floor(n * 0.05);
  const index99 = Math.floor(n * 0.01);

  const var95 = Math.abs(sorted[index95]!) * portfolioValue;
  const var99 = Math.abs(sorted[Math.max(index99, 0)]!) * portfolioValue;

  // Expected Shortfall (average of losses beyond VaR)
  const es95Returns = sorted.slice(0, index95 + 1);
  const es99Returns = sorted.slice(0, Math.max(index99 + 1, 1));

  const avgEs95 = es95Returns.reduce((sum, r) => sum + r, 0) / es95Returns.length;
  const avgEs99 = es99Returns.reduce((sum, r) => sum + r, 0) / es99Returns.length;

  return {
    var95,
    var99,
    expectedShortfall95: Math.abs(avgEs95) * portfolioValue,
    expectedShortfall99: Math.abs(avgEs99) * portfolioValue,
  };
}

/**
 * Calculate daily returns from an array of portfolio values.
 */
export function calculateReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev !== 0) {
      returns.push((values[i]! - prev) / prev);
    }
  }
  return returns;
}

/**
 * Calculate rolling VaR over a window of returns.
 */
export function rollingVaR(
  returns: number[],
  portfolioValue: number,
  windowSize: number = 252 // ~1 year of trading days
): VaRResult[] {
  const results: VaRResult[] = [];
  for (let i = windowSize; i <= returns.length; i++) {
    const window = returns.slice(i - windowSize, i);
    results.push(calculateVaR(window, portfolioValue));
  }
  return results;
}
