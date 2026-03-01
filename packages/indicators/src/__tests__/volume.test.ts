import { describe, it, expect } from 'vitest';
import { vwap } from '../volume/vwap.js';
import { obv } from '../volume/obv.js';
import { volumeProfile } from '../volume/volume-profile.js';
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
// VWAP
// ---------------------------------------------------------------------------

describe('vwap', () => {
  it('should return empty array for empty input', () => {
    const result = vwap([]);
    expect(result).toHaveLength(0);
  });

  it('should compute VWAP for a single candle', () => {
    // TP = (H+L+C)/3 = (12+8+10)/3 = 10
    // VWAP = (10 * 200) / 200 = 10
    const result = vwap([candle(10, 12, 8, 10, 200)]);
    expect(result[0]).toBeCloseTo(10, 10);
  });

  it('should compute cumulative VWAP correctly', () => {
    // candle 0: H=12, L=8, C=10 => TP=10, vol=100
    //   cumTPV = 10*100 = 1000, cumVol = 100, VWAP = 10
    // candle 1: H=16, L=10, C=14 => TP=(16+10+14)/3=13.333, vol=200
    //   cumTPV = 1000 + 13.333*200 = 1000 + 2666.667 = 3666.667
    //   cumVol = 100 + 200 = 300
    //   VWAP = 3666.667 / 300 = 12.222
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 100),
      candle(14, 16, 10, 12, 200),
    ];
    const result = vwap(candles);
    expect(result[0]).toBeCloseTo(10, 4);
    expect(result[1]).toBeCloseTo(3666.6667 / 300, 2);
  });

  it('should return 0 when cumulative volume is 0', () => {
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 0),
      candle(14, 16, 10, 12, 0),
    ];
    const result = vwap(candles);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });

  it('should handle single candle with zero volume', () => {
    const result = vwap([candle(10, 12, 8, 10, 0)]);
    expect(result[0]).toBe(0);
  });

  it('should return constant VWAP for equal-volume, same-price candles', () => {
    const candles: OHLCV[] = Array.from({ length: 5 }, () =>
      candle(100, 100, 100, 100, 100),
    );
    const result = vwap(candles);
    for (const v of result) {
      expect(v).toBeCloseTo(100, 10);
    }
  });

  it('should weight toward higher-volume candles', () => {
    // candle 0: TP = 10, vol = 10 (low volume)
    // candle 1: TP = 20, vol = 1000 (high volume)
    // VWAP should be much closer to 20 than to 10
    const candles: OHLCV[] = [
      candle(10, 10, 10, 10, 10),
      candle(20, 20, 20, 20, 1000),
    ];
    const result = vwap(candles);
    expect(result[1]).toBeGreaterThan(19); // should be near 20
  });

  it('should produce monotonically adjusting VWAP', () => {
    // VWAP is cumulative, so it should be a running weighted average
    // For rising prices, VWAP should rise
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i * 10, 105 + i * 10, 95 + i * 10, 100 + i * 10, 100),
    );
    const result = vwap(candles);
    // VWAP should be increasing (since prices are rising with equal volume)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it('should use typical price (H+L+C)/3', () => {
    // Candle with H=30, L=10, C=20 => TP = (30+10+20)/3 = 20
    const result = vwap([candle(20, 30, 10, 20, 100)]);
    expect(result[0]).toBeCloseTo(20, 10);
  });
});

// ---------------------------------------------------------------------------
// OBV
// ---------------------------------------------------------------------------

describe('obv', () => {
  it('should return empty array for empty input', () => {
    const result = obv([]);
    expect(result).toHaveLength(0);
  });

  it('should set first OBV to first volume', () => {
    const result = obv([candle(10, 12, 8, 10, 500)]);
    expect(result[0]).toBe(500);
  });

  it('should add volume on up-close', () => {
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 100),
      candle(12, 14, 10, 10, 200), // close 12 > 10 => add
    ];
    const result = obv(candles);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(300); // 100 + 200
  });

  it('should subtract volume on down-close', () => {
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 100),
      candle(8, 11, 7, 10, 200), // close 8 < 10 => subtract
    ];
    const result = obv(candles);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(-100); // 100 - 200
  });

  it('should keep OBV unchanged on equal close', () => {
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 100),
      candle(10, 11, 9, 10, 200), // close 10 == 10 => unchanged
    ];
    const result = obv(candles);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(100); // stays at 100
  });

  it('should handle a longer sequence correctly', () => {
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 100),   // OBV = 100
      candle(12, 14, 10, 10, 200),  // up => 100 + 200 = 300
      candle(11, 13, 9, 12, 150),   // down => 300 - 150 = 150
      candle(11, 12, 10, 11, 100),  // equal => 150
      candle(15, 16, 13, 11, 300),  // up => 150 + 300 = 450
      candle(13, 15, 12, 15, 250),  // down => 450 - 250 = 200
    ];
    const result = obv(candles);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(300);
    expect(result[2]).toBe(150);
    expect(result[3]).toBe(150);
    expect(result[4]).toBe(450);
    expect(result[5]).toBe(200);
  });

  it('should handle all equal closes', () => {
    const candles: OHLCV[] = Array.from({ length: 5 }, () =>
      candle(100, 105, 95, 100, 50),
    );
    const result = obv(candles);
    expect(result[0]).toBe(50);
    for (let i = 1; i < 5; i++) {
      expect(result[i]).toBe(50); // never changes after first
    }
  });

  it('should handle all increasing closes', () => {
    const candles: OHLCV[] = Array.from({ length: 5 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i, 100 + i, 100),
    );
    const result = obv(candles);
    // OBV should increase by 100 each step
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(200);
    expect(result[2]).toBe(300);
    expect(result[3]).toBe(400);
    expect(result[4]).toBe(500);
  });

  it('should handle all decreasing closes', () => {
    const candles: OHLCV[] = Array.from({ length: 5 }, (_, i) =>
      candle(100 - i, 105 - i, 95 - i, 100 - i, 100),
    );
    const result = obv(candles);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(0);    // 100 - 100
    expect(result[2]).toBe(-100); // 0 - 100
    expect(result[3]).toBe(-200);
    expect(result[4]).toBe(-300);
  });

  it('should return correct length', () => {
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i, 105 + i, 95 + i, 100 + i, 100),
    );
    const result = obv(candles);
    expect(result).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Volume Profile
// ---------------------------------------------------------------------------

describe('volumeProfile', () => {
  it('should throw for buckets <= 0', () => {
    expect(() => volumeProfile([], 0)).toThrow();
    expect(() => volumeProfile([], -1)).toThrow();
  });

  it('should return empty array for empty input', () => {
    const result = volumeProfile([], 10);
    expect(result).toHaveLength(0);
  });

  it('should return single bucket when all candles have same price', () => {
    const candles: OHLCV[] = Array.from({ length: 5 }, () =>
      candle(100, 100, 100, 100, 50),
    );
    const result = volumeProfile(candles, 10);
    // When range = 0, returns a single bucket
    expect(result).toHaveLength(1);
    expect(result[0].price).toBeCloseTo(100, 5);
    expect(result[0].volume).toBe(250); // 5 * 50
  });

  it('should return correct number of buckets', () => {
    const candles: OHLCV[] = [
      candle(10, 20, 5, 10, 100),
      candle(15, 25, 10, 15, 200),
    ];
    const result = volumeProfile(candles, 6);
    expect(result).toHaveLength(6);
  });

  it('should distribute volume into correct buckets', () => {
    // Two candles at very different prices with the same volume
    // candle 0: close=10, H=12, L=8 => TP = (12+8+10)/3 = 10, vol=100
    // candle 1: close=90, H=92, L=88 => TP = (92+88+90)/3 = 90, vol=100
    // Range: 8 to 92 = 84
    // 4 buckets, each of size 21
    // Bucket 0: 8 to 29, mid=19 => TP=10 falls in bucket 0
    // Bucket 3: 71 to 92, mid=82.5 => TP=90 falls in bucket 3
    const candles: OHLCV[] = [
      candle(10, 12, 8, 10, 100),
      candle(90, 92, 88, 90, 100),
    ];
    const result = volumeProfile(candles, 4);
    expect(result).toHaveLength(4);

    // Total volume should equal 200
    const totalVol = result.reduce((sum, level) => sum + level.volume, 0);
    expect(totalVol).toBeCloseTo(200, 5);

    // Volume should be split between the lowest and highest buckets
    expect(result[0].volume).toBe(100);
    expect(result[3].volume).toBe(100);
    expect(result[1].volume).toBe(0);
    expect(result[2].volume).toBe(0);
  });

  it('should have prices sorted from lowest to highest', () => {
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i * 5, 105 + i * 5, 95 + i * 5, 100 + i * 5, 100),
    );
    const result = volumeProfile(candles, 5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].price).toBeGreaterThan(result[i - 1].price);
    }
  });

  it('should have bucket prices as midpoints', () => {
    // candles: H=20, L=10 => range 10, with 2 buckets, each size 5
    // bucket 0: 10 to 15, mid = 12.5
    // bucket 1: 15 to 20, mid = 17.5
    const candles: OHLCV[] = [
      candle(15, 20, 10, 15, 100),
    ];
    const result = volumeProfile(candles, 2);
    expect(result).toHaveLength(2);
    expect(result[0].price).toBeCloseTo(12.5, 5);
    expect(result[1].price).toBeCloseTo(17.5, 5);
  });

  it('should assign all volume to one bucket for single candle', () => {
    const candles: OHLCV[] = [candle(50, 60, 40, 50, 1000)];
    // TP = (60+40+50)/3 = 50, range = 60-40 = 20
    const result = volumeProfile(candles, 4);
    const totalVol = result.reduce((sum, level) => sum + level.volume, 0);
    expect(totalVol).toBe(1000);
  });

  it('should handle default bucket count', () => {
    const candles: OHLCV[] = [
      candle(10, 20, 5, 10, 100),
      candle(15, 25, 10, 15, 200),
    ];
    // Default is 24 buckets
    const result = volumeProfile(candles);
    expect(result).toHaveLength(24);
  });

  it('should have non-negative volumes in all buckets', () => {
    const candles: OHLCV[] = Array.from({ length: 20 }, (_, i) =>
      candle(100 + Math.sin(i) * 20, 110 + Math.sin(i) * 15, 90 + Math.sin(i) * 15, 100, 100 + i * 10),
    );
    const result = volumeProfile(candles, 10);
    for (const level of result) {
      expect(level.volume).toBeGreaterThanOrEqual(0);
    }
  });

  it('should preserve total volume across buckets', () => {
    const candles: OHLCV[] = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i * 3, 105 + i * 3, 95 + i * 3, 100 + i * 3, 50 + i * 10),
    );
    const totalInputVol = candles.reduce((sum, c) => sum + c.volume, 0);
    const result = volumeProfile(candles, 8);
    const totalOutputVol = result.reduce((sum, level) => sum + level.volume, 0);
    expect(totalOutputVol).toBeCloseTo(totalInputVol, 5);
  });
});
