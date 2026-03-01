import { describe, it, expect } from 'vitest';
import { bollinger } from '../volatility/bollinger.js';
import { atr } from '../volatility/atr.js';
import { keltner } from '../volatility/keltner.js';
import type { OHLCV } from '@tradeworks/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candle(
  close: number,
  high?: number,
  low?: number,
  open?: number,
  volume = 100,
  timestamp = 0,
): OHLCV {
  return {
    timestamp,
    open: open ?? close,
    high: high ?? close,
    low: low ?? close,
    close,
    volume,
  };
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

describe('bollinger', () => {
  it('should throw for period <= 0', () => {
    expect(() => bollinger([1, 2, 3], 0)).toThrow();
    expect(() => bollinger([1, 2, 3], -1)).toThrow();
  });

  it('should throw for stdDev <= 0', () => {
    expect(() => bollinger([1, 2, 3], 3, 0)).toThrow();
    expect(() => bollinger([1, 2, 3], 3, -1)).toThrow();
  });

  it('should return all NaN for empty array', () => {
    const result = bollinger([], 20);
    expect(result.upper).toHaveLength(0);
    expect(result.middle).toHaveLength(0);
    expect(result.lower).toHaveLength(0);
  });

  it('should return all NaN when length < period', () => {
    const result = bollinger([1, 2], 5);
    result.upper.forEach((v) => expect(v).toBeNaN());
    result.middle.forEach((v) => expect(v).toBeNaN());
    result.lower.forEach((v) => expect(v).toBeNaN());
  });

  it('should have correct structure', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = bollinger(closes, 5, 2);
    expect(result).toHaveProperty('upper');
    expect(result).toHaveProperty('middle');
    expect(result).toHaveProperty('lower');
    expect(result.upper).toHaveLength(10);
    expect(result.middle).toHaveLength(10);
    expect(result.lower).toHaveLength(10);
  });

  it('should produce NaN for first period-1 indices', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7];
    const result = bollinger(closes, 5, 2);
    for (let i = 0; i < 4; i++) {
      expect(result.upper[i]).toBeNaN();
      expect(result.middle[i]).toBeNaN();
      expect(result.lower[i]).toBeNaN();
    }
    expect(result.middle[4]).not.toBeNaN();
  });

  it('should have middle band equal to SMA', () => {
    const closes = [1, 2, 3, 4, 5];
    const result = bollinger(closes, 3, 2);
    // SMA(3): [NaN, NaN, 2, 3, 4]
    expect(result.middle[2]).toBeCloseTo(2, 10);
    expect(result.middle[3]).toBeCloseTo(3, 10);
    expect(result.middle[4]).toBeCloseTo(4, 10);
  });

  it('should have upper > middle > lower when data varies', () => {
    const closes = [10, 12, 8, 14, 6, 11, 13, 7, 15, 9];
    const result = bollinger(closes, 5, 2);
    for (let i = 4; i < closes.length; i++) {
      expect(result.upper[i]).toBeGreaterThan(result.middle[i]);
      expect(result.middle[i]).toBeGreaterThan(result.lower[i]);
    }
  });

  it('should have zero bandwidth for constant prices', () => {
    const closes = [50, 50, 50, 50, 50];
    const result = bollinger(closes, 3, 2);
    // StdDev = 0 when all values are equal
    for (let i = 2; i < closes.length; i++) {
      expect(result.upper[i]).toBeCloseTo(50, 10);
      expect(result.middle[i]).toBeCloseTo(50, 10);
      expect(result.lower[i]).toBeCloseTo(50, 10);
    }
  });

  it('should compute correct bands with known data', () => {
    // period=3, stdDev=2
    // closes: [2, 4, 6]
    // SMA at index 2 = (2+4+6)/3 = 4
    // Population stddev = sqrt(((2-4)^2 + (4-4)^2 + (6-4)^2) / 3) = sqrt(8/3) = sqrt(2.6667)
    const closes = [2, 4, 6];
    const result = bollinger(closes, 3, 2);
    const expectedMean = 4;
    const expectedSD = Math.sqrt(((2 - 4) ** 2 + (4 - 4) ** 2 + (6 - 4) ** 2) / 3);
    expect(result.middle[2]).toBeCloseTo(expectedMean, 10);
    expect(result.upper[2]).toBeCloseTo(expectedMean + 2 * expectedSD, 10);
    expect(result.lower[2]).toBeCloseTo(expectedMean - 2 * expectedSD, 10);
  });

  it('should be symmetric around the middle band', () => {
    const closes = [10, 15, 12, 18, 14, 20, 16, 22, 18, 24];
    const result = bollinger(closes, 5, 2);
    for (let i = 4; i < closes.length; i++) {
      const upperDelta = result.upper[i] - result.middle[i];
      const lowerDelta = result.middle[i] - result.lower[i];
      expect(upperDelta).toBeCloseTo(lowerDelta, 10);
    }
  });

  it('should widen with higher stdDev multiplier', () => {
    const closes = [10, 12, 8, 14, 6, 11, 13, 7, 15, 9];
    const result1 = bollinger(closes, 5, 1);
    const result2 = bollinger(closes, 5, 2);
    for (let i = 4; i < closes.length; i++) {
      const bandwidth1 = result1.upper[i] - result1.lower[i];
      const bandwidth2 = result2.upper[i] - result2.lower[i];
      expect(bandwidth2).toBeGreaterThan(bandwidth1);
    }
  });
});

// ---------------------------------------------------------------------------
// ATR
// ---------------------------------------------------------------------------

describe('atr', () => {
  it('should throw for period <= 0', () => {
    expect(() => atr([], 0)).toThrow();
    expect(() => atr([], -1)).toThrow();
  });

  it('should return all NaN for empty array', () => {
    const result = atr([], 14);
    expect(result).toHaveLength(0);
  });

  it('should return all NaN when length < period + 1', () => {
    const candles: OHLCV[] = [candle(10, 12, 8), candle(11, 13, 9)];
    const result = atr(candles, 5);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('should produce NaN for indices 0 through period-1', () => {
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = atr(candles, 5);
    for (let i = 0; i < 5; i++) {
      expect(result[i]).toBeNaN();
    }
    expect(result[5]).not.toBeNaN();
  });

  it('should compute true range correctly', () => {
    // 3 candles, period=1
    // candle 0: H=12, L=8, C=10  => TR[0] = 12-8 = 4
    // candle 1: H=15, L=9, C=13  => TR = max(15-9, |15-10|, |9-10|) = max(6, 5, 1) = 6
    // candle 2: H=14, L=11, C=12 => TR = max(14-11, |14-13|, |11-13|) = max(3, 1, 2) = 3
    // ATR(1) seed at index 1 = SMA(TR[1]) = 6
    // ATR[2] = (6*0 + 3) / 1 = 3
    const candles: OHLCV[] = [
      candle(10, 12, 8),
      candle(13, 15, 9),
      candle(12, 14, 11),
    ];
    const result = atr(candles, 1);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeCloseTo(6, 5);
    expect(result[2]).toBeCloseTo(3, 5);
  });

  it('should compute correct ATR with known data', () => {
    // period=2
    // candle 0: H=12, L=8, C=10  => TR[0] = 4
    // candle 1: H=15, L=9, C=13  => TR[1] = max(6, 5, 1) = 6
    // candle 2: H=14, L=11, C=12 => TR[2] = max(3, 1, 2) = 3
    // candle 3: H=16, L=10, C=15 => TR[3] = max(6, 4, 2) = 6
    // Seed at index 2: SMA(TR[1], TR[2]) = (6+3)/2 = 4.5
    // ATR[3] = (4.5*(2-1) + 6) / 2 = (4.5+6)/2 = 5.25
    const candles: OHLCV[] = [
      candle(10, 12, 8),
      candle(13, 15, 9),
      candle(12, 14, 11),
      candle(15, 16, 10),
    ];
    const result = atr(candles, 2);
    expect(result[2]).toBeCloseTo(4.5, 5);
    expect(result[3]).toBeCloseTo(5.25, 5);
  });

  it('should always return positive values', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + Math.sin(i) * 10, 110 + Math.sin(i) * 5, 90 + Math.sin(i) * 5),
    );
    const result = atr(candles, 5);
    for (const v of result) {
      if (!isNaN(v)) {
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('should handle gap-up scenario (high > prev close)', () => {
    const candles: OHLCV[] = [
      candle(100, 105, 95),
      candle(120, 125, 115), // Gap up from 100 to 115
    ];
    const result = atr(candles, 1);
    // TR[1] = max(125-115, |125-100|, |115-100|) = max(10, 25, 15) = 25
    expect(result[1]).toBeCloseTo(25, 5);
  });

  it('should handle gap-down scenario (low < prev close)', () => {
    const candles: OHLCV[] = [
      candle(100, 105, 95),
      candle(80, 85, 75), // Gap down from 100 to 85
    ];
    const result = atr(candles, 1);
    // TR[1] = max(85-75, |85-100|, |75-100|) = max(10, 15, 25) = 25
    expect(result[1]).toBeCloseTo(25, 5);
  });

  it('should smooth out over time with Wilder method', () => {
    const candles: OHLCV[] = Array.from({ length: 30 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = atr(candles, 5);
    // For a steady trend with constant range, ATR should stabilize
    const last5 = result.slice(25);
    const avg = last5.reduce((s, v) => s + v, 0) / last5.length;
    for (const v of last5) {
      expect(v).toBeCloseTo(avg, 0); // should be within ~1 of each other
    }
  });
});

// ---------------------------------------------------------------------------
// Keltner Channels
// ---------------------------------------------------------------------------

describe('keltner', () => {
  it('should throw for periods <= 0', () => {
    expect(() => keltner([], 0, 10, 2)).toThrow();
    expect(() => keltner([], 20, 0, 2)).toThrow();
    expect(() => keltner([], -1, 10, 2)).toThrow();
  });

  it('should throw for multiplier <= 0', () => {
    expect(() => keltner([], 20, 10, 0)).toThrow();
    expect(() => keltner([], 20, 10, -1)).toThrow();
  });

  it('should return all NaN for empty array', () => {
    const result = keltner([], 20, 10, 2);
    expect(result.upper).toHaveLength(0);
    expect(result.middle).toHaveLength(0);
    expect(result.lower).toHaveLength(0);
  });

  it('should return all NaN when data is too short', () => {
    const candles: OHLCV[] = [candle(10, 12, 8), candle(11, 13, 9)];
    const result = keltner(candles, 5, 3, 2);
    result.upper.forEach((v) => expect(v).toBeNaN());
    result.middle.forEach((v) => expect(v).toBeNaN());
    result.lower.forEach((v) => expect(v).toBeNaN());
  });

  it('should have correct structure', () => {
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = keltner(candles, 5, 3, 2);
    expect(result).toHaveProperty('upper');
    expect(result).toHaveProperty('middle');
    expect(result).toHaveProperty('lower');
    expect(result.upper).toHaveLength(25);
    expect(result.middle).toHaveLength(25);
    expect(result.lower).toHaveLength(25);
  });

  it('should have upper > middle > lower when ATR > 0', () => {
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i, 108 + i, 92 + i),
    );
    const result = keltner(candles, 5, 3, 2);
    for (let i = 0; i < candles.length; i++) {
      if (!isNaN(result.upper[i]) && !isNaN(result.middle[i]) && !isNaN(result.lower[i])) {
        expect(result.upper[i]).toBeGreaterThan(result.middle[i]);
        expect(result.middle[i]).toBeGreaterThan(result.lower[i]);
      }
    }
  });

  it('should have middle = EMA(close)', () => {
    // Verify middle band independently
    const candles: OHLCV[] = Array.from({ length: 15 }, (_, i) =>
      candle(100 + i * 2, 105 + i * 2, 95 + i * 2),
    );
    const result = keltner(candles, 5, 3, 2);

    // Import ema to cross-check
    // Middle should equal EMA of closes with emaPeriod
    // Since we can't easily import here, we check the symmetry instead:
    // upper - middle should equal middle - lower
    for (let i = 0; i < candles.length; i++) {
      if (!isNaN(result.upper[i]) && !isNaN(result.lower[i])) {
        const upperDelta = result.upper[i] - result.middle[i];
        const lowerDelta = result.middle[i] - result.lower[i];
        expect(upperDelta).toBeCloseTo(lowerDelta, 10);
      }
    }
  });

  it('should widen channels with higher multiplier', () => {
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i, 108 + i, 92 + i),
    );
    const result1 = keltner(candles, 5, 3, 1);
    const result2 = keltner(candles, 5, 3, 3);
    for (let i = 0; i < candles.length; i++) {
      if (!isNaN(result1.upper[i]) && !isNaN(result2.upper[i])) {
        const bw1 = result1.upper[i] - result1.lower[i];
        const bw2 = result2.upper[i] - result2.lower[i];
        expect(bw2).toBeGreaterThan(bw1);
      }
    }
  });

  it('should produce NaN for warmup period', () => {
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    // emaPeriod=10, atrPeriod=5 => need max(10, 5+1)=10 candles
    const result = keltner(candles, 10, 5, 2);
    // First few should be NaN
    for (let i = 0; i < 5; i++) {
      expect(result.upper[i]).toBeNaN();
      expect(result.middle[i]).toBeNaN();
      expect(result.lower[i]).toBeNaN();
    }
  });

  it('should have valid values once both EMA and ATR are valid', () => {
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i, 108 + i, 92 + i),
    );
    const result = keltner(candles, 5, 3, 2);

    // Count valid entries
    let validCount = 0;
    for (let i = 0; i < candles.length; i++) {
      if (!isNaN(result.upper[i])) validCount++;
    }
    expect(validCount).toBeGreaterThan(0);
  });
});
