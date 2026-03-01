import type { OHLCV } from '@tradeworks/shared';

export interface CandlestickPattern {
  /** Name of the detected pattern */
  name: string;
  /** Whether the pattern is bullish or bearish */
  type: 'bullish' | 'bearish';
  /** Index in the candle array where the pattern ends */
  index: number;
  /** Subjective reliability: 'low' | 'medium' | 'high' */
  reliability: 'low' | 'medium' | 'high';
}

// ---------- Helpers ----------

function bodySize(c: OHLCV): number {
  return Math.abs(c.close - c.open);
}

function candleRange(c: OHLCV): number {
  return c.high - c.low;
}

function upperShadow(c: OHLCV): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c: OHLCV): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: OHLCV): boolean {
  return c.close > c.open;
}

function isBearish(c: OHLCV): boolean {
  return c.close < c.open;
}

// ---------- Single-candle patterns ----------

function isDoji(c: OHLCV): boolean {
  const range = candleRange(c);
  if (range === 0) return true;
  return bodySize(c) / range < 0.1;
}

function isHammer(c: OHLCV): boolean {
  const body = bodySize(c);
  const range = candleRange(c);
  if (range === 0 || body === 0) return false;

  const lower = lowerShadow(c);
  const upper = upperShadow(c);

  // Lower shadow >= 2x body, upper shadow <= 30% of body
  return lower >= 2 * body && upper <= body * 0.3;
}

function isInvertedHammer(c: OHLCV): boolean {
  const body = bodySize(c);
  const range = candleRange(c);
  if (range === 0 || body === 0) return false;

  const lower = lowerShadow(c);
  const upper = upperShadow(c);

  // Upper shadow >= 2x body, lower shadow <= 30% of body
  return upper >= 2 * body && lower <= body * 0.3;
}

// ---------- Two-candle patterns ----------

function isBullishEngulfing(prev: OHLCV, curr: OHLCV): boolean {
  return (
    isBearish(prev) &&
    isBullish(curr) &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  );
}

function isBearishEngulfing(prev: OHLCV, curr: OHLCV): boolean {
  return (
    isBullish(prev) &&
    isBearish(curr) &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  );
}

// ---------- Three-candle patterns ----------

function isMorningStar(a: OHLCV, b: OHLCV, c: OHLCV): boolean {
  // First candle: long bearish
  // Second candle: small body (star) gapping down
  // Third candle: long bullish closing above first candle's midpoint
  const aBody = bodySize(a);
  const bBody = bodySize(b);
  const cBody = bodySize(c);
  const aRange = candleRange(a);

  if (aRange === 0) return false;

  return (
    isBearish(a) &&
    aBody / aRange > 0.5 &&
    bBody < aBody * 0.5 &&
    Math.max(b.open, b.close) < Math.min(a.open, a.close) &&
    isBullish(c) &&
    cBody / candleRange(c) > 0.5 &&
    c.close > (a.open + a.close) / 2
  );
}

function isEveningStar(a: OHLCV, b: OHLCV, c: OHLCV): boolean {
  // Mirror of Morning Star
  const aBody = bodySize(a);
  const bBody = bodySize(b);
  const cBody = bodySize(c);
  const aRange = candleRange(a);

  if (aRange === 0) return false;

  return (
    isBullish(a) &&
    aBody / aRange > 0.5 &&
    bBody < aBody * 0.5 &&
    Math.min(b.open, b.close) > Math.max(a.open, a.close) &&
    isBearish(c) &&
    cBody / candleRange(c) > 0.5 &&
    c.close < (a.open + a.close) / 2
  );
}

function isThreeWhiteSoldiers(a: OHLCV, b: OHLCV, c: OHLCV): boolean {
  // Three consecutive bullish candles, each closing higher
  // Each candle opens within the previous candle's body
  // Small upper shadows
  return (
    isBullish(a) &&
    isBullish(b) &&
    isBullish(c) &&
    b.close > a.close &&
    c.close > b.close &&
    b.open > a.open &&
    b.open < a.close &&
    c.open > b.open &&
    c.open < b.close &&
    upperShadow(a) < bodySize(a) * 0.3 &&
    upperShadow(b) < bodySize(b) * 0.3 &&
    upperShadow(c) < bodySize(c) * 0.3
  );
}

function isThreeBlackCrows(a: OHLCV, b: OHLCV, c: OHLCV): boolean {
  // Three consecutive bearish candles, each closing lower
  // Each candle opens within the previous candle's body
  // Small lower shadows
  return (
    isBearish(a) &&
    isBearish(b) &&
    isBearish(c) &&
    b.close < a.close &&
    c.close < b.close &&
    b.open < a.open &&
    b.open > a.close &&
    c.open < b.open &&
    c.open > b.close &&
    lowerShadow(a) < bodySize(a) * 0.3 &&
    lowerShadow(b) < bodySize(b) * 0.3 &&
    lowerShadow(c) < bodySize(c) * 0.3
  );
}

// ---------- Main detector ----------

/**
 * Detect common candlestick patterns across an array of OHLCV candles.
 *
 * Scans for the following patterns:
 *   Single-candle:  Doji, Hammer, InvertedHammer
 *   Two-candle:     BullishEngulfing, BearishEngulfing
 *   Three-candle:   MorningStar, EveningStar, ThreeWhiteSoldiers, ThreeBlackCrows
 *
 * Returns an array of detected patterns sorted by index.
 */
export function detectCandlestickPatterns(candles: OHLCV[]): CandlestickPattern[] {
  const patterns: CandlestickPattern[] = [];
  const length = candles.length;

  for (let i = 0; i < length; i++) {
    const c = candles[i];

    // Single-candle patterns
    if (isDoji(c)) {
      patterns.push({
        name: 'Doji',
        type: i > 0 && isBearish(candles[i - 1]) ? 'bullish' : 'bearish',
        index: i,
        reliability: 'low',
      });
    }

    if (isHammer(c)) {
      patterns.push({
        name: 'Hammer',
        type: 'bullish',
        index: i,
        reliability: 'medium',
      });
    }

    if (isInvertedHammer(c)) {
      patterns.push({
        name: 'InvertedHammer',
        type: 'bullish',
        index: i,
        reliability: 'low',
      });
    }

    // Two-candle patterns (need at least 2 candles)
    if (i >= 1) {
      const prev = candles[i - 1];

      if (isBullishEngulfing(prev, c)) {
        patterns.push({
          name: 'BullishEngulfing',
          type: 'bullish',
          index: i,
          reliability: 'high',
        });
      }

      if (isBearishEngulfing(prev, c)) {
        patterns.push({
          name: 'BearishEngulfing',
          type: 'bearish',
          index: i,
          reliability: 'high',
        });
      }
    }

    // Three-candle patterns (need at least 3 candles)
    if (i >= 2) {
      const a = candles[i - 2];
      const b = candles[i - 1];

      if (isMorningStar(a, b, c)) {
        patterns.push({
          name: 'MorningStar',
          type: 'bullish',
          index: i,
          reliability: 'high',
        });
      }

      if (isEveningStar(a, b, c)) {
        patterns.push({
          name: 'EveningStar',
          type: 'bearish',
          index: i,
          reliability: 'high',
        });
      }

      if (isThreeWhiteSoldiers(a, b, c)) {
        patterns.push({
          name: 'ThreeWhiteSoldiers',
          type: 'bullish',
          index: i,
          reliability: 'high',
        });
      }

      if (isThreeBlackCrows(a, b, c)) {
        patterns.push({
          name: 'ThreeBlackCrows',
          type: 'bearish',
          index: i,
          reliability: 'high',
        });
      }
    }
  }

  return patterns;
}
