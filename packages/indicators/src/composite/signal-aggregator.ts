import type { IndicatorSignal } from '@tradeworks/shared';

export interface AggregatedSignal {
  /** The consensus direction */
  direction: 'buy' | 'sell' | 'neutral';
  /**
   * Signal strength from 0 to 1.
   * 0 = no agreement, 1 = all signals agree at full confidence.
   */
  strength: number;
  /**
   * Confidence in the aggregated signal from 0 to 1.
   * Takes into account number of signals, their individual confidence,
   * and the degree of inter-signal agreement.
   */
  confidence: number;
}

/**
 * Aggregate multiple indicator signals into a single consensus signal.
 *
 * The algorithm:
 *   1. Each signal contributes a weighted vote based on its confidence.
 *      Buy signals contribute positive weight, sell signals contribute
 *      negative weight, neutral signals contribute zero.
 *
 *   2. The net score is normalized to [-1, 1] by dividing by the sum
 *      of all absolute weights. Positive = buy bias, negative = sell
 *      bias.
 *
 *   3. Direction is determined by the sign of the net score. If the
 *      absolute score is below the `neutralThreshold` (default 0.1)
 *      the direction is neutral.
 *
 *   4. Strength is the absolute value of the normalized score (0-1).
 *
 *   5. Confidence is the product of:
 *      - Average individual confidence of agreeing signals
 *      - Ratio of agreeing signals to total signals
 *      This captures both how confident each indicator is and how many
 *      indicators agree.
 *
 * Returns a neutral signal with zero strength/confidence if no signals
 * are provided.
 */
export function aggregateSignals(
  signals: IndicatorSignal[],
  neutralThreshold = 0.1,
): AggregatedSignal {
  if (signals.length === 0) {
    return { direction: 'neutral', strength: 0, confidence: 0 };
  }

  // Calculate weighted votes
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const s of signals) {
    const weight = s.confidence;
    totalWeight += weight;

    if (s.signal === 'buy') {
      totalWeightedScore += weight;
    } else if (s.signal === 'sell') {
      totalWeightedScore -= weight;
    }
    // neutral signals add to totalWeight but not to score
  }

  // Normalize to [-1, 1]
  const normalizedScore = totalWeight === 0 ? 0 : totalWeightedScore / totalWeight;

  // Determine direction
  let direction: 'buy' | 'sell' | 'neutral';
  if (Math.abs(normalizedScore) < neutralThreshold) {
    direction = 'neutral';
  } else {
    direction = normalizedScore > 0 ? 'buy' : 'sell';
  }

  // Strength is the magnitude of the consensus
  const strength = Math.abs(normalizedScore);

  // Confidence: average confidence of agreeing signals * agreement ratio
  let agreeingCount = 0;
  let agreeingConfidenceSum = 0;

  for (const s of signals) {
    if (
      (direction === 'buy' && s.signal === 'buy') ||
      (direction === 'sell' && s.signal === 'sell') ||
      (direction === 'neutral' && s.signal === 'neutral')
    ) {
      agreeingCount++;
      agreeingConfidenceSum += s.confidence;
    }
  }

  const avgAgreeingConfidence =
    agreeingCount > 0 ? agreeingConfidenceSum / agreeingCount : 0;
  const agreementRatio = agreeingCount / signals.length;
  const confidence = avgAgreeingConfidence * agreementRatio;

  return {
    direction,
    strength: Math.round(strength * 10000) / 10000,
    confidence: Math.round(confidence * 10000) / 10000,
  };
}
