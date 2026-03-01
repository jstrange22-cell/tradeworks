import type { OHLCV } from '@tradeworks/shared';

export interface VolumeProfileLevel {
  /** The midpoint price of this bucket */
  price: number;
  /** Total volume traded within this price range */
  volume: number;
}

/**
 * Volume Profile
 *
 * Distributes the total volume across `buckets` evenly-spaced price
 * levels spanning the full high-low range of the candle array.
 *
 * For each candle, its volume is assigned to the bucket whose price
 * range contains the candle's typical price (H+L+C)/3. This produces
 * a histogram of volume at each price level, useful for identifying
 * high-volume nodes (support/resistance) and low-volume nodes
 * (breakout zones).
 *
 * Returns an array sorted from lowest to highest price.
 */
export function volumeProfile(
  candles: OHLCV[],
  buckets = 24,
): VolumeProfileLevel[] {
  if (buckets <= 0) {
    throw new Error('Number of buckets must be greater than 0');
  }

  if (candles.length === 0) {
    return [];
  }

  // Find the overall price range
  let overallHigh = -Infinity;
  let overallLow = Infinity;

  for (const c of candles) {
    if (c.high > overallHigh) overallHigh = c.high;
    if (c.low < overallLow) overallLow = c.low;
  }

  const range = overallHigh - overallLow;

  // Edge case: all candles at the same price
  if (range === 0) {
    return [{ price: overallLow, volume: candles.reduce((sum, c) => sum + c.volume, 0) }];
  }

  const bucketSize = range / buckets;

  // Initialize buckets
  const volumes: number[] = new Array(buckets).fill(0);

  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    let idx = Math.floor((tp - overallLow) / bucketSize);
    // Clamp the highest price into the last bucket
    if (idx >= buckets) idx = buckets - 1;
    volumes[idx] += c.volume;
  }

  // Build result
  const result: VolumeProfileLevel[] = [];
  for (let i = 0; i < buckets; i++) {
    result.push({
      price: overallLow + bucketSize * (i + 0.5), // midpoint of bucket
      volume: volumes[i],
    });
  }

  return result;
}
