/**
 * Cross-asset correlation matrix for diversification analysis.
 */

export interface CorrelationResult {
  instruments: string[];
  matrix: number[][]; // NxN correlation matrix
  highlyCorrelated: Array<{
    pair: [string, string];
    correlation: number;
  }>;
}

/**
 * Calculate Pearson correlation coefficient between two return series.
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i]!;
    sumY += y[i]!;
    sumXY += x[i]! * y[i]!;
    sumX2 += x[i]! * x[i]!;
    sumY2 += y[i]! * y[i]!;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Build a full NxN correlation matrix from multiple return series.
 * @param returnSeries Map of instrument name to array of returns
 * @param threshold Correlation threshold to flag as "highly correlated" (default: 0.7)
 */
export function buildCorrelationMatrix(
  returnSeries: Map<string, number[]>,
  threshold: number = 0.7
): CorrelationResult {
  const instruments = Array.from(returnSeries.keys());
  const n = instruments.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  const highlyCorrelated: CorrelationResult['highlyCorrelated'] = [];

  for (let i = 0; i < n; i++) {
    matrix[i]![i] = 1.0; // Self-correlation is always 1
    for (let j = i + 1; j < n; j++) {
      const seriesI = returnSeries.get(instruments[i]!)!;
      const seriesJ = returnSeries.get(instruments[j]!)!;
      const corr = pearsonCorrelation(seriesI, seriesJ);

      matrix[i]![j] = corr;
      matrix[j]![i] = corr;

      if (Math.abs(corr) >= threshold) {
        highlyCorrelated.push({
          pair: [instruments[i]!, instruments[j]!],
          correlation: corr,
        });
      }
    }
  }

  return { instruments, matrix, highlyCorrelated };
}

/**
 * Check if adding a new position would exceed correlation exposure limits.
 */
export function checkCorrelationExposure(
  existingPositions: Array<{ instrument: string; riskAmount: number }>,
  newInstrument: string,
  newRiskAmount: number,
  correlationMatrix: CorrelationResult,
  maxCorrelationExposure: number
): { allowed: boolean; correlatedRisk: number; warning: string | null } {
  const instrumentIndex = correlationMatrix.instruments.indexOf(newInstrument);
  if (instrumentIndex === -1) {
    return { allowed: true, correlatedRisk: 0, warning: null };
  }

  let correlatedRisk = 0;

  for (const pos of existingPositions) {
    const posIndex = correlationMatrix.instruments.indexOf(pos.instrument);
    if (posIndex === -1) continue;

    const correlation = correlationMatrix.matrix[instrumentIndex]![posIndex]!;
    if (Math.abs(correlation) > 0.5) {
      correlatedRisk += pos.riskAmount * Math.abs(correlation);
    }
  }

  const totalCorrelatedRisk = correlatedRisk + newRiskAmount;
  const totalPortfolioRisk = existingPositions.reduce((sum, p) => sum + p.riskAmount, 0) + newRiskAmount;

  const correlationRatio = totalPortfolioRisk > 0 ? totalCorrelatedRisk / totalPortfolioRisk : 0;

  if (correlationRatio > maxCorrelationExposure) {
    return {
      allowed: false,
      correlatedRisk: totalCorrelatedRisk,
      warning: `Correlated risk exposure ${(correlationRatio * 100).toFixed(1)}% exceeds limit ${(maxCorrelationExposure * 100).toFixed(1)}%`,
    };
  }

  return { allowed: true, correlatedRisk: totalCorrelatedRisk, warning: null };
}
