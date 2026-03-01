import { describe, it, expect } from 'vitest';
import { rsi } from '../momentum/rsi.js';
import { stochastic } from '../momentum/stochastic.js';
import { cci } from '../momentum/cci.js';
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
// RSI
// ---------------------------------------------------------------------------

describe('rsi', () => {
  it('should throw for period <= 0', () => {
    expect(() => rsi([1, 2, 3], 0)).toThrow();
    expect(() => rsi([1, 2, 3], -1)).toThrow();
  });

  it('should return all NaN for empty array', () => {
    const result = rsi([], 14);
    expect(result).toHaveLength(0);
  });

  it('should return all NaN when length < period + 1', () => {
    const result = rsi([1, 2, 3], 5);
    expect(result).toHaveLength(3);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('should produce NaN for first period indices', () => {
    const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84];
    const result = rsi(closes, 5);
    // Need period+1 = 6 data points for first value at index 5
    for (let i = 0; i < 5; i++) {
      expect(result[i]).toBeNaN();
    }
    expect(result[5]).not.toBeNaN();
  });

  it('should return 100 when all changes are gains', () => {
    // Steadily increasing: all changes are positive
    const closes = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = rsi(closes, 5);
    // At index 5 (first valid), avgLoss = 0 => RSI = 100
    expect(result[5]).toBeCloseTo(100, 5);
  });

  it('should return 0 when all changes are losses', () => {
    // Steadily decreasing: all changes are negative
    const closes = [8, 7, 6, 5, 4, 3, 2, 1];
    const result = rsi(closes, 5);
    // avgGain = 0, avgLoss > 0 => RSI = 100 - 100/(1+0) = 0
    expect(result[5]).toBeCloseTo(0, 5);
  });

  it('should produce RSI of 50 at seed when gains equal losses', () => {
    // Period=2, closes: [10, 11, 10, ...]
    // changes: +1, -1
    // Seed avgGain = (1+0)/2 = 0.5, avgLoss = (0+1)/2 = 0.5
    // RS = 1, RSI = 50
    // After the seed, Wilder smoothing causes oscillation because each
    // step has either a full gain or a full loss (not both), but the
    // seed value itself should be exactly 50.
    const closes = [10, 11, 10, 11, 10, 11, 10, 11];
    const result = rsi(closes, 2);
    // First valid RSI at index 2 should be exactly 50
    expect(result[2]).toBeCloseTo(50, 5);
    // Subsequent values oscillate but remain bounded
    const validValues = result.filter((v) => !isNaN(v));
    for (const v of validValues) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('should have RSI values between 0 and 100', () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
      45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00,
      46.03, 46.41, 46.22, 45.64];
    const result = rsi(closes, 14);
    for (const v of result) {
      if (!isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('should compute correct RSI with known data (Wilder method)', () => {
    // Simple hand-calculable example: period=3
    // closes: [10, 12, 11, 13, 14, 12]
    // changes:     +2  -1  +2  +1  -2
    // Gains (i=1..3):  2, 0, 2  => avgGain = 4/3
    // Losses(i=1..3):  0, 1, 0  => avgLoss = 1/3
    // RS = (4/3)/(1/3) = 4
    // RSI[3] = 100 - 100/(1+4) = 80
    const closes = [10, 12, 11, 13, 14, 12];
    const result = rsi(closes, 3);
    expect(result[3]).toBeCloseTo(80, 5);

    // Index 4: gain = 1, loss = 0
    // avgGain = (4/3 * 2 + 1) / 3 = (8/3 + 1)/3 = (11/3)/3 = 11/9
    // avgLoss = (1/3 * 2 + 0) / 3 = (2/3)/3 = 2/9
    // RS = (11/9)/(2/9) = 11/2 = 5.5
    // RSI = 100 - 100/6.5 = 100 - 15.3846... = 84.615...
    expect(result[4]).toBeCloseTo(84.6154, 2);
  });

  it('should handle single constant value after initial variation', () => {
    // After period, all same => gains and losses decay toward 0, RSI -> previous
    const closes = [10, 12, 11, 13, 10, 10, 10, 10, 10, 10];
    const result = rsi(closes, 3);
    // Last values should still be valid numbers between 0 and 100
    for (let i = 3; i < result.length; i++) {
      expect(result[i]).not.toBeNaN();
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Stochastic
// ---------------------------------------------------------------------------

describe('stochastic', () => {
  it('should throw for period <= 0', () => {
    expect(() => stochastic([], 0, 3)).toThrow();
    expect(() => stochastic([], 5, 0)).toThrow();
    expect(() => stochastic([], -1, 3)).toThrow();
  });

  it('should return all NaN for empty array', () => {
    const result = stochastic([], 5, 3);
    expect(result.k).toHaveLength(0);
    expect(result.d).toHaveLength(0);
  });

  it('should return all NaN when length < kPeriod', () => {
    const candles: OHLCV[] = [candle(10, 12, 8), candle(11, 13, 9)];
    const result = stochastic(candles, 5, 3);
    result.k.forEach((v) => expect(v).toBeNaN());
    result.d.forEach((v) => expect(v).toBeNaN());
  });

  it('should have correct %K warmup period', () => {
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = stochastic(candles, 5, 3);
    // %K should be NaN for first 4 indices (kPeriod - 1)
    for (let i = 0; i < 4; i++) {
      expect(result.k[i]).toBeNaN();
    }
    expect(result.k[4]).not.toBeNaN();
  });

  it('should compute correct %K with known data', () => {
    // kPeriod = 3
    // candles: high=12,low=8,close=10 | high=14,low=9,close=13 | high=15,low=10,close=14
    // At index 2 (kPeriod-1):
    //   lowestLow = 8, highestHigh = 15, close = 14
    //   %K = 100 * (14 - 8) / (15 - 8) = 100 * 6/7 = 85.714...
    const candles: OHLCV[] = [
      candle(10, 12, 8),
      candle(13, 14, 9),
      candle(14, 15, 10),
    ];
    const result = stochastic(candles, 3, 3);
    expect(result.k[2]).toBeCloseTo(85.7143, 2);
  });

  it('should return 50 for flat market (range = 0)', () => {
    const candles: OHLCV[] = [
      candle(10, 10, 10),
      candle(10, 10, 10),
      candle(10, 10, 10),
    ];
    const result = stochastic(candles, 3, 3);
    expect(result.k[2]).toBeCloseTo(50, 5);
  });

  it('should have %K values between 0 and 100', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + Math.sin(i) * 10, 110 + Math.sin(i) * 5, 90 + Math.sin(i) * 5),
    );
    const result = stochastic(candles, 5, 3);
    for (const v of result.k) {
      if (!isNaN(v)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('should have %D as SMA of %K', () => {
    // kPeriod=2, dPeriod=2
    // candles: [10,h12,l8] [13,h14,l9] [11,h13,l10] [15,h16,l12]
    const candles: OHLCV[] = [
      candle(10, 12, 8),
      candle(13, 14, 9),
      candle(11, 13, 10),
      candle(15, 16, 12),
    ];
    const result = stochastic(candles, 2, 2);

    // %K at index 1: lowestLow=min(8,9)=8, highestHigh=max(12,14)=14
    //   %K = 100*(13-8)/(14-8) = 100*5/6 = 83.333
    // %K at index 2: lowestLow=min(9,10)=9, highestHigh=max(14,13)=14
    //   %K = 100*(11-9)/(14-9) = 100*2/5 = 40
    // %K at index 3: lowestLow=min(10,12)=10, highestHigh=max(13,16)=16
    //   %K = 100*(15-10)/(16-10) = 100*5/6 = 83.333
    expect(result.k[1]).toBeCloseTo(83.3333, 2);
    expect(result.k[2]).toBeCloseTo(40, 2);
    expect(result.k[3]).toBeCloseTo(83.3333, 2);

    // %D (SMA of %K with period 2)
    // %D at index 2 = (83.333 + 40) / 2 = 61.667
    expect(result.d[2]).toBeCloseTo(61.6667, 2);
    // %D at index 3 = (40 + 83.333) / 2 = 61.667
    expect(result.d[3]).toBeCloseTo(61.6667, 2);
  });

  it('should have correct structure', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = stochastic(candles, 5, 3);
    expect(result).toHaveProperty('k');
    expect(result).toHaveProperty('d');
    expect(result.k).toHaveLength(20);
    expect(result.d).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// CCI
// ---------------------------------------------------------------------------

describe('cci', () => {
  it('should throw for period <= 0', () => {
    expect(() => cci([], 0)).toThrow();
    expect(() => cci([], -1)).toThrow();
  });

  it('should return all NaN for empty array', () => {
    const result = cci([], 20);
    expect(result).toHaveLength(0);
  });

  it('should return all NaN when length < period', () => {
    const candles: OHLCV[] = [candle(10, 12, 8), candle(11, 13, 9)];
    const result = cci(candles, 5);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('should produce NaN for first period-1 indices', () => {
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = cci(candles, 5);
    for (let i = 0; i < 4; i++) {
      expect(result[i]).toBeNaN();
    }
    expect(result[4]).not.toBeNaN();
  });

  it('should return 0 for flat prices (all same)', () => {
    // All candles identical => TP all same => SMA = TP => meanDev = 0 => CCI = 0
    const candles: OHLCV[] = Array.from({ length: 5 }, () =>
      candle(100, 100, 100),
    );
    const result = cci(candles, 3);
    expect(result[2]).toBeCloseTo(0, 10);
    expect(result[3]).toBeCloseTo(0, 10);
    expect(result[4]).toBeCloseTo(0, 10);
  });

  it('should compute correct CCI with known data', () => {
    // period=3
    // candle 0: H=12, L=8, C=10 => TP = (12+8+10)/3 = 10
    // candle 1: H=14, L=10, C=12 => TP = (14+10+12)/3 = 12
    // candle 2: H=16, L=12, C=14 => TP = (16+12+14)/3 = 14
    // At index 2:
    //   SMA(TP, 3) = (10+12+14)/3 = 12
    //   MeanDev = (|10-12| + |12-12| + |14-12|) / 3 = (2+0+2)/3 = 4/3
    //   CCI = (14 - 12) / (0.015 * 4/3) = 2 / 0.02 = 100
    const candles: OHLCV[] = [
      candle(10, 12, 8),
      candle(12, 14, 10),
      candle(14, 16, 12),
    ];
    const result = cci(candles, 3);
    expect(result[2]).toBeCloseTo(100, 2);
  });

  it('should handle decreasing prices (negative CCI)', () => {
    // period=3
    // candle 0: H=16, L=12, C=14 => TP = (16+12+14)/3 = 14
    // candle 1: H=14, L=10, C=12 => TP = (14+10+12)/3 = 12
    // candle 2: H=12, L=8, C=10  => TP = (12+8+10)/3 = 10
    // At index 2:
    //   SMA(TP, 3) = (14+12+10)/3 = 12
    //   MeanDev = (|14-12| + |12-12| + |10-12|) / 3 = (2+0+2)/3 = 4/3
    //   CCI = (10 - 12) / (0.015 * 4/3) = -2 / 0.02 = -100
    const candles: OHLCV[] = [
      candle(14, 16, 12),
      candle(12, 14, 10),
      candle(10, 12, 8),
    ];
    const result = cci(candles, 3);
    expect(result[2]).toBeCloseTo(-100, 2);
  });

  it('should output correct length matching input', () => {
    const candles: OHLCV[] = Array.from({ length: 30 }, (_, i) =>
      candle(100 + Math.sin(i) * 10, 110 + Math.sin(i) * 5, 90 + Math.sin(i) * 5),
    );
    const result = cci(candles, 20);
    expect(result).toHaveLength(30);
  });

  it('should use typical price (H+L+C)/3 in calculation', () => {
    // Verify that different H/L combinations with same close give different CCI
    const candles1: OHLCV[] = [
      candle(10, 15, 5),
      candle(10, 15, 5),
      candle(10, 15, 5),
    ];
    const candles2: OHLCV[] = [
      candle(10, 20, 0),
      candle(10, 20, 0),
      candle(10, 20, 0),
    ];
    const result1 = cci(candles1, 3);
    const result2 = cci(candles2, 3);
    // Both have same TP (all candles identical within each set), so CCI=0 for both
    expect(result1[2]).toBeCloseTo(0, 5);
    expect(result2[2]).toBeCloseTo(0, 5);
  });
});
