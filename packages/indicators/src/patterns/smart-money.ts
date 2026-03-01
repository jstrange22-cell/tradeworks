import type { OHLCV } from '@tradeworks/shared';

export interface OrderBlock {
  /** 'bullish' order block (demand zone) or 'bearish' order block (supply zone) */
  type: 'bullish' | 'bearish';
  /** Starting index of the order block candle */
  index: number;
  /** High price of the order block zone */
  high: number;
  /** Low price of the order block zone */
  low: number;
  /** Timestamp from the source candle */
  timestamp: number;
  /** Whether price has returned to mitigate this order block */
  mitigated: boolean;
}

export interface FairValueGap {
  /** 'bullish' FVG (gap up) or 'bearish' FVG (gap down) */
  type: 'bullish' | 'bearish';
  /** Index of the middle candle of the 3-candle formation */
  index: number;
  /** Top of the gap */
  high: number;
  /** Bottom of the gap */
  low: number;
  /** Size of the gap in price */
  size: number;
  /** Whether the gap has been filled by subsequent price action */
  filled: boolean;
}

export interface LiquidityZone {
  /** Whether this is a buy-side or sell-side liquidity pool */
  side: 'buy' | 'sell';
  /** Price level where liquidity is concentrated */
  price: number;
  /** Number of swing points forming this zone */
  touches: number;
  /** First candle index that contributed to this zone */
  startIndex: number;
  /** Last candle index that contributed to this zone */
  endIndex: number;
  /** Whether the zone has been swept (liquidity taken) */
  swept: boolean;
}

/**
 * Detect Institutional Order Blocks
 *
 * An order block is the last opposing candle before a strong impulsive
 * move. A bullish order block is the last bearish candle before a
 * strong bullish move; a bearish order block is the last bullish candle
 * before a strong bearish move.
 *
 * The "strong move" threshold is defined as a displacement of at least
 * 1.5x the average candle range over the lookback period.
 */
export function detectOrderBlocks(candles: OHLCV[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const length = candles.length;

  if (length < 5) return blocks;

  // Compute average candle range for threshold
  let rangeSum = 0;
  for (let i = 0; i < length; i++) {
    rangeSum += candles[i].high - candles[i].low;
  }
  const avgRange = rangeSum / length;
  const threshold = avgRange * 1.5;

  for (let i = 1; i < length - 2; i++) {
    const prev = candles[i];
    const next = candles[i + 1];
    const nextNext = candles[i + 2];

    // Check for bullish order block:
    // Previous candle is bearish, followed by a strong bullish move
    if (
      prev.close < prev.open && // bearish candle
      next.close > next.open && // bullish follow-through
      nextNext.close > nextNext.open && // continued bullish
      next.close - prev.close > threshold // impulsive displacement
    ) {
      blocks.push({
        type: 'bullish',
        index: i,
        high: prev.open,
        low: prev.low,
        timestamp: prev.timestamp,
        mitigated: false,
      });
    }

    // Check for bearish order block:
    // Previous candle is bullish, followed by a strong bearish move
    if (
      prev.close > prev.open && // bullish candle
      next.close < next.open && // bearish follow-through
      nextNext.close < nextNext.open && // continued bearish
      prev.close - next.close > threshold // impulsive displacement
    ) {
      blocks.push({
        type: 'bearish',
        index: i,
        high: prev.high,
        low: prev.open,
        timestamp: prev.timestamp,
        mitigated: false,
      });
    }
  }

  // Check mitigation: has price returned to the order block zone?
  for (const block of blocks) {
    for (let j = block.index + 3; j < length; j++) {
      if (block.type === 'bullish' && candles[j].low <= block.high) {
        block.mitigated = true;
        break;
      }
      if (block.type === 'bearish' && candles[j].high >= block.low) {
        block.mitigated = true;
        break;
      }
    }
  }

  return blocks;
}

/**
 * Detect Fair Value Gaps (FVGs)
 *
 * A fair value gap is an imbalance in price action formed by a
 * 3-candle sequence where the wicks of the first and third candles
 * do not overlap, leaving a "gap" in the middle.
 *
 * Bullish FVG: candle[i-2].high < candle[i].low (gap up)
 * Bearish FVG: candle[i-2].low > candle[i].high (gap down)
 */
export function detectFairValueGaps(candles: OHLCV[]): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const length = candles.length;

  if (length < 3) return gaps;

  for (let i = 2; i < length; i++) {
    const first = candles[i - 2];
    const third = candles[i];

    // Bullish FVG: gap between first candle's high and third candle's low
    if (first.high < third.low) {
      const gapLow = first.high;
      const gapHigh = third.low;

      gaps.push({
        type: 'bullish',
        index: i - 1,
        high: gapHigh,
        low: gapLow,
        size: gapHigh - gapLow,
        filled: false,
      });
    }

    // Bearish FVG: gap between first candle's low and third candle's high
    if (first.low > third.high) {
      const gapHigh = first.low;
      const gapLow = third.high;

      gaps.push({
        type: 'bearish',
        index: i - 1,
        high: gapHigh,
        low: gapLow,
        size: gapHigh - gapLow,
        filled: false,
      });
    }
  }

  // Check if gaps have been filled by subsequent price action
  for (const gap of gaps) {
    for (let j = gap.index + 2; j < length; j++) {
      if (gap.type === 'bullish' && candles[j].low <= gap.low) {
        gap.filled = true;
        break;
      }
      if (gap.type === 'bearish' && candles[j].high >= gap.high) {
        gap.filled = true;
        break;
      }
    }
  }

  return gaps;
}

/**
 * Detect Liquidity Zones
 *
 * Liquidity zones are areas where stop losses and pending orders are
 * likely concentrated. They form at:
 *   - Swing highs (buy-side liquidity — stops above)
 *   - Swing lows (sell-side liquidity — stops below)
 *
 * Zones are identified by clustering nearby swing points within a
 * tolerance of 0.2% of the swing price. The more touches at a level,
 * the more significant the liquidity pool.
 */
export function detectLiquidityZones(candles: OHLCV[]): LiquidityZone[] {
  const length = candles.length;

  if (length < 5) return [];

  const lookback = 3;
  const tolerance = 0.002; // 0.2%

  // Find swing highs and swing lows
  const swingHighs: { price: number; index: number }[] = [];
  const swingLows: { price: number; index: number }[] = [];

  for (let i = lookback; i < length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isSwingHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) swingHighs.push({ price: candles[i].high, index: i });
    if (isSwingLow) swingLows.push({ price: candles[i].low, index: i });
  }

  // Cluster swing points into zones
  function clusterSwings(
    swings: { price: number; index: number }[],
    side: 'buy' | 'sell',
  ): LiquidityZone[] {
    if (swings.length === 0) return [];

    const sorted = [...swings].sort((a, b) => a.price - b.price);
    const zones: LiquidityZone[] = [];

    let clusterStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const isLast = i === sorted.length;
      const gapExceedsTolerance =
        !isLast &&
        (sorted[i].price - sorted[i - 1].price) / sorted[i - 1].price > tolerance;

      if (isLast || gapExceedsTolerance) {
        // Form a zone from clusterStart to i-1
        const clusterSwings = sorted.slice(clusterStart, i);
        const avgPrice =
          clusterSwings.reduce((sum, s) => sum + s.price, 0) / clusterSwings.length;
        const indices = clusterSwings.map((s) => s.index);

        zones.push({
          side,
          price: Math.round(avgPrice * 100000) / 100000,
          touches: clusterSwings.length,
          startIndex: Math.min(...indices),
          endIndex: Math.max(...indices),
          swept: false,
        });

        clusterStart = i;
      }
    }

    return zones;
  }

  const buyZones = clusterSwings(swingHighs, 'buy');
  const sellZones = clusterSwings(swingLows, 'sell');
  const allZones = [...buyZones, ...sellZones];

  // Check if zones have been swept (liquidity taken)
  for (const zone of allZones) {
    for (let j = zone.endIndex + 1; j < length; j++) {
      if (zone.side === 'buy' && candles[j].high > zone.price) {
        zone.swept = true;
        break;
      }
      if (zone.side === 'sell' && candles[j].low < zone.price) {
        zone.swept = true;
        break;
      }
    }
  }

  return allZones;
}
