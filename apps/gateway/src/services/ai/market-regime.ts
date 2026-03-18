/**
 * Market Regime Detection
 *
 * Classifies market conditions from indicator signals and candle data.
 *
 * Regimes:
 *   trending_up    — ADX > 25 AND close > EMA50 > EMA200
 *   trending_down  — ADX > 25 AND close < EMA50 < EMA200
 *   ranging        — ADX < 20
 *   high_volatility — ATR in top 20% of recent history
 *   low_volatility  — ATR in bottom 20% of recent history
 */

import type { OHLCV, IndicatorSignal, MarketRegime } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function findSignal(signals: IndicatorSignal[], name: string): IndicatorSignal | undefined {
  return signals.find((s) => s.name === name);
}

function computeATRPercentile(candles: OHLCV[], lookback = 50): number {
  if (candles.length < 15) return 50; // Default to middle if not enough data

  const period = 14;
  const atrValues: number[] = [];

  for (let endIdx = period; endIdx <= candles.length; endIdx++) {
    const slice = candles.slice(endIdx - period, endIdx);
    let atrSum = 0;
    for (let idx = 1; idx < slice.length; idx++) {
      const prev = slice[idx - 1];
      const curr = slice[idx];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close),
      );
      atrSum += tr;
    }
    atrValues.push(atrSum / (slice.length - 1));
  }

  if (atrValues.length === 0) return 50;

  const recent = atrValues.slice(-lookback);
  const currentATR = recent[recent.length - 1];
  const sorted = [...recent].sort((a, b) => a - b);
  const rank = sorted.findIndex((val) => val >= currentATR);
  return rank >= 0 ? (rank / sorted.length) * 100 : 50;
}

// ── Main Detection ──────────────────────────────────────────────────────

export function detectRegime(signals: IndicatorSignal[], candles: OHLCV[]): MarketRegime {
  if (candles.length === 0 || signals.length === 0) return 'ranging';

  const lastClose = candles[candles.length - 1].close;

  const adxSignal = findSignal(signals, 'ADX');
  const ema50Signal = findSignal(signals, 'EMA50');
  const ema200Signal = findSignal(signals, 'EMA200');
  const adxValue = adxSignal?.value ?? 0;
  const ema50 = ema50Signal?.value ?? 0;
  const ema200 = ema200Signal?.value ?? 0;

  // 1. Check trend first (ADX-based)
  if (adxValue > 25 && ema50 > 0 && ema200 > 0) {
    if (lastClose > ema50 && ema50 > ema200) return 'trending_up';
    if (lastClose < ema50 && ema50 < ema200) return 'trending_down';
  }

  if (adxValue < 20 && adxValue > 0) return 'ranging';

  // 2. Check volatility (ATR percentile)
  const atrPercentile = computeATRPercentile(candles);

  if (atrPercentile > 80) return 'high_volatility';
  if (atrPercentile < 20) return 'low_volatility';

  // 3. Default: ranging or mild trend
  if (adxValue >= 20 && adxValue <= 25) {
    // Weak trend zone — check price position
    if (ema50 > 0 && ema200 > 0) {
      if (lastClose > ema50 && ema50 > ema200) return 'trending_up';
      if (lastClose < ema50 && ema50 < ema200) return 'trending_down';
    }
  }

  return 'ranging';
}
