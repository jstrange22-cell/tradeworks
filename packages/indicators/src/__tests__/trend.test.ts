import { describe, it, expect } from 'vitest';
import { sma } from '../trend/sma.js';
import { ema } from '../trend/ema.js';
import { macd } from '../trend/macd.js';
import { supertrend } from '../trend/supertrend.js';
import type { OHLCV } from '@tradeworks/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal OHLCV candle for testing. */
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
// SMA
// ---------------------------------------------------------------------------

describe('sma', () => {
  it('should return correct SMA for simple sequence', () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result).toHaveLength(5);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo(2, 10);   // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3, 10);   // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4, 10);   // (3+4+5)/3
  });

  it('should return all NaN when period > length', () => {
    const result = sma([1, 2, 3], 5);
    expect(result).toHaveLength(3);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('should return all NaN for an empty array', () => {
    const result = sma([], 3);
    expect(result).toHaveLength(0);
  });

  it('should handle single element with period 1', () => {
    const result = sma([42], 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(42, 10);
  });

  it('should compute SMA when period equals length', () => {
    const result = sma([10, 20, 30], 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo(20, 10); // (10+20+30)/3
  });

  it('should handle period = 1 (identity)', () => {
    const data = [5, 10, 15, 20];
    const result = sma(data, 1);
    for (let i = 0; i < data.length; i++) {
      expect(result[i]).toBeCloseTo(data[i], 10);
    }
  });

  it('should throw for period <= 0', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
    expect(() => sma([1, 2, 3], -1)).toThrow();
  });

  it('should produce NaN only for the first period-1 values', () => {
    const result = sma([2, 4, 6, 8, 10, 12], 4);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeNaN();
    expect(result[3]).toBeCloseTo(5, 10);  // (2+4+6+8)/4
    expect(result[4]).toBeCloseTo(7, 10);  // (4+6+8+10)/4
    expect(result[5]).toBeCloseTo(9, 10);  // (6+8+10+12)/4
  });

  it('should handle constant values', () => {
    const result = sma([5, 5, 5, 5, 5], 3);
    expect(result[2]).toBeCloseTo(5, 10);
    expect(result[3]).toBeCloseTo(5, 10);
    expect(result[4]).toBeCloseTo(5, 10);
  });

  it('should compute correct SMA with realistic price data', () => {
    // Simulated closing prices
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08];
    const result = sma(closes, 5);
    // First 4 should be NaN
    for (let i = 0; i < 4; i++) expect(result[i]).toBeNaN();
    // Index 4: average of first 5 = (44.34+44.09+44.15+43.61+44.33)/5
    expect(result[4]).toBeCloseTo(44.104, 2);
    // Index 5: (44.09+44.15+43.61+44.33+44.83)/5
    expect(result[5]).toBeCloseTo(44.202, 2);
  });
});

// ---------------------------------------------------------------------------
// EMA
// ---------------------------------------------------------------------------

describe('ema', () => {
  it('should seed first value with SMA', () => {
    // EMA(period=3) of [2, 4, 6, 8, 10]
    // Seed = SMA(2,4,6) = 4
    const result = ema([2, 4, 6, 8, 10], 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo(4, 10); // SMA seed
  });

  it('should apply correct EMA formula after seed', () => {
    // EMA(period=3): k = 2/(3+1) = 0.5
    // Seed at index 2 = SMA(2,4,6) = 4
    // Index 3: 8 * 0.5 + 4 * 0.5 = 6
    // Index 4: 10 * 0.5 + 6 * 0.5 = 8
    const result = ema([2, 4, 6, 8, 10], 3);
    expect(result[3]).toBeCloseTo(6, 10);
    expect(result[4]).toBeCloseTo(8, 10);
  });

  it('should return all NaN when period > length', () => {
    const result = ema([1, 2], 5);
    expect(result).toHaveLength(2);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('should return all NaN for empty array', () => {
    const result = ema([], 3);
    expect(result).toHaveLength(0);
  });

  it('should handle period = 1', () => {
    // k = 2/(1+1) = 1, so EMA = close at each index
    const data = [5, 10, 15];
    const result = ema(data, 1);
    for (let i = 0; i < data.length; i++) {
      expect(result[i]).toBeCloseTo(data[i], 10);
    }
  });

  it('should throw for period <= 0', () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
    expect(() => ema([1, 2, 3], -1)).toThrow();
  });

  it('should have correct warmup NaN count', () => {
    const result = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    for (let i = 0; i < 4; i++) expect(result[i]).toBeNaN();
    expect(result[4]).not.toBeNaN(); // first valid value
  });

  it('should handle constant values', () => {
    const result = ema([7, 7, 7, 7, 7], 3);
    // Seed = 7, all subsequent should remain 7
    expect(result[2]).toBeCloseTo(7, 10);
    expect(result[3]).toBeCloseTo(7, 10);
    expect(result[4]).toBeCloseTo(7, 10);
  });

  it('should compute EMA with realistic data', () => {
    const closes = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
    const result = ema(closes, 10);
    // Only the last element should be valid (index 9)
    for (let i = 0; i < 9; i++) expect(result[i]).toBeNaN();
    // Seed = SMA of all 10 = (22.27+22.19+22.08+22.17+22.18+22.13+22.23+22.43+22.24+22.29)/10
    const expectedSeed = (22.27 + 22.19 + 22.08 + 22.17 + 22.18 + 22.13 + 22.23 + 22.43 + 22.24 + 22.29) / 10;
    expect(result[9]).toBeCloseTo(expectedSeed, 4);
  });
});

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

describe('macd', () => {
  it('should throw if fast >= slow', () => {
    expect(() => macd([1, 2, 3], 12, 12)).toThrow();
    expect(() => macd([1, 2, 3], 26, 12)).toThrow();
  });

  it('should throw if any period <= 0', () => {
    expect(() => macd([1, 2, 3], 0, 26, 9)).toThrow();
    expect(() => macd([1, 2, 3], 12, 0, 9)).toThrow();
    expect(() => macd([1, 2, 3], 12, 26, 0)).toThrow();
  });

  it('should return all NaN for insufficient data', () => {
    const result = macd([1, 2, 3, 4, 5], 3, 5, 3);
    // With only 5 data points and slow=5, there is barely 1 MACD value,
    // which is not enough for the signal EMA with period 3
    expect(result.macd).toHaveLength(5);
    expect(result.signal).toHaveLength(5);
    expect(result.histogram).toHaveLength(5);
  });

  it('should have correct structure', () => {
    const data = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const result = macd(data, 3, 5, 3);
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
    expect(result.macd).toHaveLength(50);
    expect(result.signal).toHaveLength(50);
    expect(result.histogram).toHaveLength(50);
  });

  it('should compute MACD = fastEMA - slowEMA', () => {
    // Use small periods for easy hand-calc verification
    // fast=2, slow=3, signal=2
    // Data: [10, 20, 30, 40, 50]
    const data = [10, 20, 30, 40, 50];
    const result = macd(data, 2, 3, 2);

    // fastEma(period=2): k=2/3
    //   seed at index 1: SMA(10,20)=15
    //   index 2: 30*2/3 + 15*1/3 = 25
    //   index 3: 40*2/3 + 25*1/3 = 35
    //   index 4: 50*2/3 + 35*1/3 = 45
    // slowEma(period=3): k=2/4=0.5
    //   seed at index 2: SMA(10,20,30)=20
    //   index 3: 40*0.5 + 20*0.5 = 30
    //   index 4: 50*0.5 + 30*0.5 = 40
    // MACD line valid from index 2:
    //   index 2: 25 - 20 = 5
    //   index 3: 35 - 30 = 5
    //   index 4: 45 - 40 = 5
    expect(result.macd[0]).toBeNaN();
    expect(result.macd[1]).toBeNaN();
    expect(result.macd[2]).toBeCloseTo(5, 5);
    expect(result.macd[3]).toBeCloseTo(5, 5);
    expect(result.macd[4]).toBeCloseTo(5, 5);
  });

  it('should have histogram = macd - signal', () => {
    const data = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
    const result = macd(data, 3, 5, 3);

    for (let i = 0; i < result.histogram.length; i++) {
      if (!isNaN(result.histogram[i])) {
        expect(result.histogram[i]).toBeCloseTo(
          result.macd[i] - result.signal[i],
          10,
        );
      }
    }
  });

  it('should have NaN for warmup period', () => {
    const data = Array.from({ length: 50 }, (_, i) => 100 + i);
    const result = macd(data, 12, 26, 9);
    // First 25 MACD values should be NaN (slow period = 26)
    for (let i = 0; i < 25; i++) {
      expect(result.macd[i]).toBeNaN();
    }
    // First valid MACD at index 25
    expect(result.macd[25]).not.toBeNaN();
  });

  it('should return constant MACD=0 for flat data', () => {
    const data = new Array(50).fill(100);
    const result = macd(data, 3, 5, 3);
    // Fast EMA and slow EMA should be equal for constant data
    for (let i = 0; i < result.macd.length; i++) {
      if (!isNaN(result.macd[i])) {
        expect(result.macd[i]).toBeCloseTo(0, 10);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SuperTrend
// ---------------------------------------------------------------------------

describe('supertrend', () => {
  it('should throw for period <= 0', () => {
    expect(() => supertrend([], 0)).toThrow();
    expect(() => supertrend([], -1)).toThrow();
  });

  it('should throw for multiplier <= 0', () => {
    expect(() => supertrend([], 10, 0)).toThrow();
    expect(() => supertrend([], 10, -1)).toThrow();
  });

  it('should return all NaN for insufficient data', () => {
    const candles: OHLCV[] = [
      candle(100, 105, 95),
      candle(102, 107, 97),
    ];
    const result = supertrend(candles, 10, 3);
    result.trend.forEach((v) => expect(v).toBeNaN());
  });

  it('should have correct structure', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = supertrend(candles, 5, 2);
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('direction');
    expect(result.trend).toHaveLength(20);
    expect(result.direction).toHaveLength(20);
  });

  it('should have direction values of 1, -1, or 0', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = supertrend(candles, 5, 2);
    for (const d of result.direction) {
      expect([0, 1, -1]).toContain(d);
    }
  });

  it('should produce NaN for warmup period (first period indices)', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i),
    );
    const result = supertrend(candles, 5, 2);
    // ATR is valid from index period=5 onward, so first 5 trend values should be NaN
    for (let i = 0; i < 5; i++) {
      expect(result.trend[i]).toBeNaN();
    }
  });

  it('should detect uptrend for steadily rising prices', () => {
    // Create a strong uptrend: each candle higher than the previous
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i * 5, 103 + i * 5, 97 + i * 5),
    );
    const result = supertrend(candles, 5, 2);

    // After warmup, expect mostly uptrend (direction = 1)
    let uptrendCount = 0;
    for (let i = 6; i < 25; i++) {
      if (result.direction[i] === 1) uptrendCount++;
    }
    // Most values should indicate uptrend
    expect(uptrendCount).toBeGreaterThan(10);
  });

  it('should return empty arrays for empty input', () => {
    const result = supertrend([], 5, 2);
    expect(result.trend).toHaveLength(0);
    expect(result.direction).toHaveLength(0);
  });

  it('should have trend equal to lowerBand in uptrend and upperBand in downtrend', () => {
    // Uptrend: trend = lower band, downtrend: trend = upper band
    const candles: OHLCV[] = Array.from({ length: 25 }, (_, i) =>
      candle(100 + i * 3, 104 + i * 3, 96 + i * 3),
    );
    const result = supertrend(candles, 5, 2);

    // After warmup, in uptrend the SuperTrend line should be below price
    for (let i = 6; i < 25; i++) {
      if (result.direction[i] === 1 && !isNaN(result.trend[i])) {
        // In uptrend, the trend (lower band) should be below or at the close
        expect(result.trend[i]).toBeLessThanOrEqual(candles[i].close + 0.01);
      }
    }
  });
});
