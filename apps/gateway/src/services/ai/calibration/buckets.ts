/**
 * Confidence bucketization for calibration analysis.
 *
 * Buckets are intentionally coarse (6 bins) so each one carries enough
 * sample size to draw conclusions. APEX rarely emits confidence < 0.5
 * on approves so the lowest bucket is wide.
 */

export const CONFIDENCE_BUCKETS = [
  { key: '0.0-0.5', min: 0.0, max: 0.5, midpoint: 0.25 },
  { key: '0.5-0.6', min: 0.5, max: 0.6, midpoint: 0.55 },
  { key: '0.6-0.7', min: 0.6, max: 0.7, midpoint: 0.65 },
  { key: '0.7-0.8', min: 0.7, max: 0.8, midpoint: 0.75 },
  { key: '0.8-0.9', min: 0.8, max: 0.9, midpoint: 0.85 },
  { key: '0.9-1.0', min: 0.9, max: 1.0001, midpoint: 0.95 }, // 1.0001 to include exact 1.0
] as const;

export type ConfidenceBucketKey = typeof CONFIDENCE_BUCKETS[number]['key'];

/**
 * Map a raw confidence (0..1) to its bucket key.
 * Returns '0.0-0.5' for null/undefined/NaN/out-of-range inputs as a safety net.
 */
export function bucketizeConfidence(confidence: number | null | undefined): ConfidenceBucketKey {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) {
    return '0.0-0.5';
  }
  const clamped = Math.max(0, Math.min(1, confidence));
  for (const b of CONFIDENCE_BUCKETS) {
    if (clamped >= b.min && clamped < b.max) {
      return b.key;
    }
  }
  return '0.9-1.0'; // catch-all for confidence === 1.0 exactly
}

/** Get the midpoint for a bucket key — used to flag overconfidence. */
export function bucketMidpoint(key: ConfidenceBucketKey): number {
  const b = CONFIDENCE_BUCKETS.find((x) => x.key === key);
  return b?.midpoint ?? 0.5;
}

/**
 * Map a UTC hour-of-day to a regular-trading-hours bucket label.
 * 9-10 ET = open, 10-15 = mid, 15-16 = close, else after-hours.
 * (UTC offset for ET is -5 standard / -4 DST. We use the raw UTC hour
 * here and let the SQL EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/New_York')
 * produce the ET hour upstream.)
 */
export function hourBucket(etHour: number): 'open' | 'mid' | 'close' | 'after-hours' {
  if (etHour >= 9 && etHour < 10) return 'open';
  if (etHour >= 10 && etHour < 15) return 'mid';
  if (etHour >= 15 && etHour < 16) return 'close';
  return 'after-hours';
}
