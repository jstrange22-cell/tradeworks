/**
 * Candlestick Pattern Recognition
 *
 * Detects 10 key candlestick patterns from OHLCV data.
 * All implemented manually — no external pattern library needed.
 */

import type { OHLCV, PatternSignal } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function bodySize(candle: OHLCV): number {
  return Math.abs(candle.close - candle.open);
}

function upperShadow(candle: OHLCV): number {
  return candle.high - Math.max(candle.open, candle.close);
}

function lowerShadow(candle: OHLCV): number {
  return Math.min(candle.open, candle.close) - candle.low;
}

function isBullish(candle: OHLCV): boolean {
  return candle.close > candle.open;
}

function isBearish(candle: OHLCV): boolean {
  return candle.close < candle.open;
}

function candleRange(candle: OHLCV): number {
  return candle.high - candle.low;
}

function avgBodySize(candles: OHLCV[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, c) => sum + bodySize(c), 0) / candles.length;
}

// ── Individual Pattern Detectors ────────────────────────────────────────

function detectHammer(candle: OHLCV, avgBody: number): PatternSignal | null {
  const body = bodySize(candle);
  const lower = lowerShadow(candle);
  const upper = upperShadow(candle);
  const range = candleRange(candle);

  if (range === 0) return null;

  // Hammer: small body at top, long lower shadow (2x+ body), tiny upper shadow
  if (body > 0 && lower >= body * 2 && upper <= body * 0.5 && body < avgBody * 1.5) {
    return { pattern: 'Hammer', type: 'bullish', reliability: 65 };
  }
  return null;
}

function detectShootingStar(candle: OHLCV, avgBody: number): PatternSignal | null {
  const body = bodySize(candle);
  const lower = lowerShadow(candle);
  const upper = upperShadow(candle);

  if (body > 0 && upper >= body * 2 && lower <= body * 0.5 && body < avgBody * 1.5) {
    return { pattern: 'Shooting Star', type: 'bearish', reliability: 65 };
  }
  return null;
}

function detectDoji(candle: OHLCV, avgBody: number): PatternSignal | null {
  const body = bodySize(candle);
  const range = candleRange(candle);

  if (range === 0) return null;

  // Doji: body is less than 10% of total range OR less than 10% of average body
  if (body / range < 0.1 || (avgBody > 0 && body < avgBody * 0.1)) {
    return { pattern: 'Doji', type: 'neutral', reliability: 50 };
  }
  return null;
}

function detectSpinningTop(candle: OHLCV, avgBody: number): PatternSignal | null {
  const body = bodySize(candle);
  const upper = upperShadow(candle);
  const lower = lowerShadow(candle);
  const range = candleRange(candle);

  if (range === 0 || body === 0) return null;

  // Spinning top: small body, both shadows longer than body
  if (body < avgBody * 0.5 && upper > body && lower > body && body / range > 0.1) {
    return { pattern: 'Spinning Top', type: 'neutral', reliability: 45 };
  }
  return null;
}

function detectBullishEngulfing(prev: OHLCV, curr: OHLCV): PatternSignal | null {
  if (isBearish(prev) && isBullish(curr)) {
    if (curr.open <= prev.close && curr.close >= prev.open) {
      return { pattern: 'Bullish Engulfing', type: 'bullish', reliability: 75 };
    }
  }
  return null;
}

function detectBearishEngulfing(prev: OHLCV, curr: OHLCV): PatternSignal | null {
  if (isBullish(prev) && isBearish(curr)) {
    if (curr.open >= prev.close && curr.close <= prev.open) {
      return { pattern: 'Bearish Engulfing', type: 'bearish', reliability: 75 };
    }
  }
  return null;
}

function detectMorningStar(first: OHLCV, second: OHLCV, third: OHLCV, avgBody: number): PatternSignal | null {
  // 1st: bearish, 2nd: small body (gap down), 3rd: bullish (closes into 1st body)
  if (
    isBearish(first) &&
    bodySize(second) < avgBody * 0.5 &&
    isBullish(third) &&
    third.close > (first.open + first.close) / 2
  ) {
    return { pattern: 'Morning Star', type: 'bullish', reliability: 80 };
  }
  return null;
}

function detectEveningStar(first: OHLCV, second: OHLCV, third: OHLCV, avgBody: number): PatternSignal | null {
  if (
    isBullish(first) &&
    bodySize(second) < avgBody * 0.5 &&
    isBearish(third) &&
    third.close < (first.open + first.close) / 2
  ) {
    return { pattern: 'Evening Star', type: 'bearish', reliability: 80 };
  }
  return null;
}

function detectThreeWhiteSoldiers(c1: OHLCV, c2: OHLCV, c3: OHLCV, avgBody: number): PatternSignal | null {
  if (
    isBullish(c1) && isBullish(c2) && isBullish(c3) &&
    bodySize(c1) > avgBody * 0.6 &&
    bodySize(c2) > avgBody * 0.6 &&
    bodySize(c3) > avgBody * 0.6 &&
    c2.close > c1.close &&
    c3.close > c2.close &&
    c2.open > c1.open &&
    c3.open > c2.open
  ) {
    return { pattern: 'Three White Soldiers', type: 'bullish', reliability: 85 };
  }
  return null;
}

function detectThreeBlackCrows(c1: OHLCV, c2: OHLCV, c3: OHLCV, avgBody: number): PatternSignal | null {
  if (
    isBearish(c1) && isBearish(c2) && isBearish(c3) &&
    bodySize(c1) > avgBody * 0.6 &&
    bodySize(c2) > avgBody * 0.6 &&
    bodySize(c3) > avgBody * 0.6 &&
    c2.close < c1.close &&
    c3.close < c2.close &&
    c2.open < c1.open &&
    c3.open < c2.open
  ) {
    return { pattern: 'Three Black Crows', type: 'bearish', reliability: 85 };
  }
  return null;
}

// ── Main Detection ──────────────────────────────────────────────────────

export function detectPatterns(candles: OHLCV[]): PatternSignal[] {
  if (candles.length < 3) return [];

  const patterns: PatternSignal[] = [];
  const recentCandles = candles.slice(-10);
  const avgBody = avgBodySize(recentCandles);

  // Single-candle patterns (check last candle)
  const last = candles[candles.length - 1];
  const hammer = detectHammer(last, avgBody);
  if (hammer) patterns.push(hammer);

  const shootingStar = detectShootingStar(last, avgBody);
  if (shootingStar) patterns.push(shootingStar);

  const doji = detectDoji(last, avgBody);
  if (doji) patterns.push(doji);

  const spinningTop = detectSpinningTop(last, avgBody);
  if (spinningTop && !doji) patterns.push(spinningTop); // Don't double-count doji

  // Two-candle patterns
  if (candles.length >= 2) {
    const prev = candles[candles.length - 2];
    const bullEngulf = detectBullishEngulfing(prev, last);
    if (bullEngulf) patterns.push(bullEngulf);

    const bearEngulf = detectBearishEngulfing(prev, last);
    if (bearEngulf) patterns.push(bearEngulf);
  }

  // Three-candle patterns
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];

    const morning = detectMorningStar(c1, c2, c3, avgBody);
    if (morning) patterns.push(morning);

    const evening = detectEveningStar(c1, c2, c3, avgBody);
    if (evening) patterns.push(evening);

    const soldiers = detectThreeWhiteSoldiers(c1, c2, c3, avgBody);
    if (soldiers) patterns.push(soldiers);

    const crows = detectThreeBlackCrows(c1, c2, c3, avgBody);
    if (crows) patterns.push(crows);
  }

  return patterns;
}
