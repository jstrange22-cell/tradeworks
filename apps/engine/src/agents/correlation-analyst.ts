import { buildCorrelationMatrix } from '@tradeworks/risk';

export interface CorrelationAnalysis {
  matrix: Record<string, Record<string, number>>; // instrument -> instrument -> correlation
  regime: 'risk_on' | 'risk_off' | 'transitioning';
  avgCorrelation: number;
  highCorrelationPairs: Array<{ pair: [string, string]; correlation: number }>;
  diversificationScore: number; // 0-1, higher = more diversified
  reasoning: string;
}

const RISK_OFF_THRESHOLD = 0.75;
const RISK_ON_THRESHOLD = 0.4;
const HIGH_CORRELATION_THRESHOLD = 0.7;
const MIN_SERIES_LENGTH = 5;

/**
 * Convert a numeric NxN matrix + instrument list into a nested Record.
 */
function matrixToRecord(
  instruments: readonly string[],
  numericMatrix: readonly (readonly number[])[]
): Record<string, Record<string, number>> {
  const record: Record<string, Record<string, number>> = {};

  for (let i = 0; i < instruments.length; i++) {
    const instrument = instruments[i]!;
    record[instrument] = {};
    for (let j = 0; j < instruments.length; j++) {
      record[instrument]![instruments[j]!] = numericMatrix[i]?.[j] ?? 0;
    }
  }

  return record;
}

/**
 * Calculate average absolute correlation across all unique pairs.
 * Excludes self-correlations (diagonal).
 */
function calculateAverageCorrelation(
  instruments: readonly string[],
  numericMatrix: readonly (readonly number[])[]
): number {
  const count = instruments.length;
  if (count < 2) return 0;

  let sum = 0;
  let pairs = 0;

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      sum += Math.abs(numericMatrix[i]?.[j] ?? 0);
      pairs++;
    }
  }

  return pairs > 0 ? sum / pairs : 0;
}

/**
 * Classify market regime based on average cross-asset correlation.
 *
 * - risk_off: High correlation means assets move together (herding / panic)
 * - risk_on: Low correlation means normal differentiated markets
 * - transitioning: In between, correlation is shifting
 */
function classifyRegime(
  avgCorrelation: number
): 'risk_on' | 'risk_off' | 'transitioning' {
  if (avgCorrelation >= RISK_OFF_THRESHOLD) return 'risk_off';
  if (avgCorrelation <= RISK_ON_THRESHOLD) return 'risk_on';
  return 'transitioning';
}

/**
 * Calculate a diversification score from 0 (fully correlated) to 1 (fully diversified).
 * Inversely proportional to average correlation.
 */
function calculateDiversificationScore(avgCorrelation: number): number {
  return Math.max(0, Math.min(1, 1 - avgCorrelation));
}

/**
 * Build reasoning string for the correlation analysis.
 */
function buildReasoning(
  instrumentCount: number,
  avgCorrelation: number,
  regime: 'risk_on' | 'risk_off' | 'transitioning',
  highPairCount: number,
  diversificationScore: number
): string {
  const parts: string[] = [];

  parts.push(`Analyzed ${instrumentCount} instruments`);
  parts.push(`Average cross-asset correlation: ${avgCorrelation.toFixed(3)}`);

  const regimeLabel =
    regime === 'risk_on'
      ? 'Risk-on (low correlation, diversified)'
      : regime === 'risk_off'
        ? 'Risk-off (high correlation, herding behavior)'
        : 'Transitioning (correlation regime shifting)';
  parts.push(`Market regime: ${regimeLabel}`);

  if (highPairCount > 0) {
    parts.push(`${highPairCount} highly correlated pair${highPairCount > 1 ? 's' : ''} (>= ${HIGH_CORRELATION_THRESHOLD})`);
  }

  parts.push(`Diversification score: ${diversificationScore.toFixed(2)}/1.00`);

  return parts.join('. ') + '.';
}

/**
 * Analyze correlations between crypto assets to detect regime changes.
 *
 * Takes a map of instrument names to price history arrays, computes the
 * full pairwise correlation matrix, classifies the current market regime
 * (risk-on / risk-off / transitioning), and outputs a diversification score.
 *
 * @param priceHistory - Record of instrument name to array of prices (chronological)
 * @returns Full correlation analysis with regime classification
 */
export function analyzeCorrelations(
  priceHistory: Record<string, number[]>
): CorrelationAnalysis {
  const instruments = Object.keys(priceHistory);

  // Edge case: not enough instruments
  if (instruments.length < 2) {
    return {
      matrix: instruments.length === 1
        ? { [instruments[0]!]: { [instruments[0]!]: 1 } }
        : {},
      regime: 'risk_on',
      avgCorrelation: 0,
      highCorrelationPairs: [],
      diversificationScore: 1,
      reasoning: 'Insufficient instruments for correlation analysis (need at least 2).',
    };
  }

  // Convert prices to returns (percentage change) for correlation calc
  const returnSeries = new Map<string, number[]>();
  for (const instrument of instruments) {
    const prices = priceHistory[instrument]!;
    if (prices.length < MIN_SERIES_LENGTH) {
      continue;
    }
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1]!;
      returns.push(prev !== 0 ? (prices[i]! - prev) / prev : 0);
    }
    returnSeries.set(instrument, returns);
  }

  // Need at least 2 valid return series
  if (returnSeries.size < 2) {
    return {
      matrix: {},
      regime: 'risk_on',
      avgCorrelation: 0,
      highCorrelationPairs: [],
      diversificationScore: 1,
      reasoning: 'Insufficient price history for correlation analysis (need at least 5 data points per instrument).',
    };
  }

  // Build correlation matrix using @tradeworks/risk
  const correlationResult = buildCorrelationMatrix(
    returnSeries,
    HIGH_CORRELATION_THRESHOLD
  );

  const matrixRecord = matrixToRecord(
    correlationResult.instruments,
    correlationResult.matrix
  );

  const avgCorrelation = calculateAverageCorrelation(
    correlationResult.instruments,
    correlationResult.matrix
  );

  const regime = classifyRegime(avgCorrelation);
  const diversificationScore = calculateDiversificationScore(avgCorrelation);

  const highCorrelationPairs = correlationResult.highlyCorrelated.map(
    ({ pair, correlation }) => ({ pair, correlation })
  );

  const reasoning = buildReasoning(
    correlationResult.instruments.length,
    avgCorrelation,
    regime,
    highCorrelationPairs.length,
    diversificationScore
  );

  return {
    matrix: matrixRecord,
    regime,
    avgCorrelation,
    highCorrelationPairs,
    diversificationScore,
    reasoning,
  };
}
