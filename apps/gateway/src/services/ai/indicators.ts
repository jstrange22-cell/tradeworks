/**
 * Indicator calculation helpers.
 *
 * Wraps `trading-signals` classes and implements manual indicators
 * (MFI, Supertrend) that the library doesn't provide.
 * Each function accepts an OHLCV array and returns an IndicatorSignal.
 */

import {
  RSI,
  MACD,
  BollingerBands,
  EMA,
  SMA,
  StochasticRSI,
  ADX,
  ATR,
  CCI,
  OBV,
  VWAP,
  PSAR,
  WilliamsR,
} from 'trading-signals';

import type { OHLCV, IndicatorSignal } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeNum(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

// ── Library-based indicators ────────────────────────────────────────────

export function calcRSI(candles: OHLCV[]): IndicatorSignal {
  const rsi = new RSI(14);
  for (const candle of candles) {
    rsi.update(candle.close, false);
  }
  const value = safeNum(rsi.getResult());
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (value < 30) { signal = 'bullish'; strength = clamp((30 - value) * 3.33, 0, 100); }
  else if (value > 70) { signal = 'bearish'; strength = clamp((value - 70) * 3.33, 0, 100); }
  else { strength = 50 - Math.abs(value - 50); }
  return { name: 'RSI', value, signal, strength };
}

export function calcMACD(candles: OHLCV[]): IndicatorSignal {
  const macd = new MACD(new EMA(12), new EMA(26), new EMA(9));
  for (const candle of candles) {
    macd.update(candle.close, false);
  }
  const result = macd.getResult();
  const histogram = safeNum(result?.histogram);
  const macdLine = safeNum(result?.macd);
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (histogram > 0 && macdLine > 0) { signal = 'bullish'; strength = clamp(histogram * 1000, 50, 100); }
  else if (histogram < 0 && macdLine < 0) { signal = 'bearish'; strength = clamp(Math.abs(histogram) * 1000, 50, 100); }
  else { strength = clamp(Math.abs(histogram) * 500, 0, 50); }
  return { name: 'MACD', value: histogram, signal, strength };
}

export function calcBollingerBands(candles: OHLCV[]): IndicatorSignal {
  const bb = new BollingerBands(20, 2);
  for (const candle of candles) {
    bb.update(candle.close, false);
  }
  const result = bb.getResult();
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const upper = safeNum(result?.upper);
  const lower = safeNum(result?.lower);
  const middle = safeNum(result?.middle);
  const bandwidth = upper - lower;
  const position = bandwidth > 0 ? (lastClose - lower) / bandwidth : 0.5;
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (position < 0.2) { signal = 'bullish'; strength = clamp((0.2 - position) * 500, 50, 100); }
  else if (position > 0.8) { signal = 'bearish'; strength = clamp((position - 0.8) * 500, 50, 100); }
  else { strength = 50 - Math.abs(position - 0.5) * 100; }
  return { name: 'BollingerBands', value: middle, signal, strength };
}

export function calcEMA(candles: OHLCV[], period: number): IndicatorSignal {
  const ema = new EMA(period);
  for (const candle of candles) {
    ema.update(candle.close, false);
  }
  const value = safeNum(ema.getResult());
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const pctDiff = value > 0 ? ((lastClose - value) / value) * 100 : 0;
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (pctDiff > 1) { signal = 'bullish'; strength = clamp(pctDiff * 20, 50, 100); }
  else if (pctDiff < -1) { signal = 'bearish'; strength = clamp(Math.abs(pctDiff) * 20, 50, 100); }
  else { strength = clamp(Math.abs(pctDiff) * 50, 0, 50); }
  return { name: `EMA${period}`, value, signal, strength };
}

export function calcSMA(candles: OHLCV[], period: number): IndicatorSignal {
  const sma = new SMA(period);
  for (const candle of candles) {
    sma.update(candle.close, false);
  }
  const value = safeNum(sma.getResult());
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const pctDiff = value > 0 ? ((lastClose - value) / value) * 100 : 0;
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (pctDiff > 1) { signal = 'bullish'; strength = clamp(pctDiff * 20, 50, 100); }
  else if (pctDiff < -1) { signal = 'bearish'; strength = clamp(Math.abs(pctDiff) * 20, 50, 100); }
  else { strength = clamp(Math.abs(pctDiff) * 50, 0, 50); }
  return { name: `SMA${period}`, value, signal, strength };
}

export function calcStochasticRSI(candles: OHLCV[]): IndicatorSignal {
  const stochRsi = new StochasticRSI(14);
  for (const candle of candles) {
    stochRsi.update(candle.close, false);
  }
  const value = safeNum(stochRsi.getResult());
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (value < 20) { signal = 'bullish'; strength = clamp((20 - value) * 5, 50, 100); }
  else if (value > 80) { signal = 'bearish'; strength = clamp((value - 80) * 5, 50, 100); }
  else { strength = 50 - Math.abs(value - 50); }
  return { name: 'StochRSI', value, signal, strength };
}

export function calcADX(candles: OHLCV[]): IndicatorSignal {
  const adx = new ADX(14);
  for (const candle of candles) {
    adx.update({ high: candle.high, low: candle.low, close: candle.close }, false);
  }
  const value = safeNum(adx.getResult());
  // ADX measures trend strength, not direction
  let signal: IndicatorSignal['signal'] = 'neutral';
  const strength = clamp(value, 0, 100);
  if (value > 25) {
    // Check direction from +DI vs -DI
    const pdi = safeNum(adx.pdi);
    const mdi = safeNum(adx.mdi);
    signal = pdi > mdi ? 'bullish' : 'bearish';
  }
  return { name: 'ADX', value, signal, strength };
}

export function calcATR(candles: OHLCV[]): IndicatorSignal {
  const atr = new ATR(14);
  for (const candle of candles) {
    atr.update({ high: candle.high, low: candle.low, close: candle.close }, false);
  }
  const value = safeNum(atr.getResult());
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const atrPct = lastClose > 0 ? (value / lastClose) * 100 : 0;
  // ATR is volatility — not directional
  return { name: 'ATR', value, signal: 'neutral', strength: clamp(atrPct * 10, 0, 100) };
}

export function calcCCI(candles: OHLCV[]): IndicatorSignal {
  const cci = new CCI(20);
  for (const candle of candles) {
    cci.update({ high: candle.high, low: candle.low, close: candle.close }, false);
  }
  const value = safeNum(cci.getResult());
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (value > 100) { signal = 'bullish'; strength = clamp((value - 100) * 0.5, 50, 100); }
  else if (value < -100) { signal = 'bearish'; strength = clamp((Math.abs(value) - 100) * 0.5, 50, 100); }
  else { strength = clamp(Math.abs(value) * 0.5, 0, 50); }
  return { name: 'CCI', value, signal, strength };
}

export function calcOBV(candles: OHLCV[]): IndicatorSignal {
  const obv = new OBV(14);
  for (const candle of candles) {
    obv.update({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }, false);
  }
  const value = safeNum(obv.getResult());
  // Trend direction based on OBV slope over last few values
  const recentCandles = candles.slice(-5);
  const obvValues: number[] = [];
  const obvCalc = new OBV(14);
  for (const candle of candles) {
    obvCalc.update({ open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }, false);
    const result = obvCalc.getResult();
    if (result !== null) obvValues.push(result);
  }
  const recentSlice = obvValues.slice(-5);
  const slope = recentSlice.length >= 2
    ? (recentSlice[recentSlice.length - 1] - recentSlice[0]) / recentSlice.length
    : 0;
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (slope > 0) { signal = 'bullish'; strength = clamp(60 + Math.abs(slope) * 0.001, 50, 100); }
  else if (slope < 0) { signal = 'bearish'; strength = clamp(60 + Math.abs(slope) * 0.001, 50, 100); }
  void recentCandles; // referenced for clarity
  return { name: 'OBV', value, signal, strength };
}

export function calcVWAP(candles: OHLCV[]): IndicatorSignal {
  const vwap = new VWAP();
  for (const candle of candles) {
    vwap.update({ high: candle.high, low: candle.low, close: candle.close, volume: candle.volume }, false);
  }
  const value = safeNum(vwap.getResult());
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const pctDiff = value > 0 ? ((lastClose - value) / value) * 100 : 0;
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (pctDiff > 0.5) { signal = 'bullish'; strength = clamp(pctDiff * 30, 50, 100); }
  else if (pctDiff < -0.5) { signal = 'bearish'; strength = clamp(Math.abs(pctDiff) * 30, 50, 100); }
  return { name: 'VWAP', value, signal, strength };
}

export function calcPSAR(candles: OHLCV[]): IndicatorSignal {
  const psar = new PSAR({ accelerationStep: 0.02, accelerationMax: 0.2 });
  for (const candle of candles) {
    psar.update({ high: candle.high, low: candle.low }, false);
  }
  const value = safeNum(psar.getResult());
  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const signal: IndicatorSignal['signal'] = lastClose > value ? 'bullish' : 'bearish';
  const distance = lastClose > 0 ? Math.abs(lastClose - value) / lastClose * 100 : 0;
  return { name: 'PSAR', value, signal, strength: clamp(50 + distance * 10, 50, 100) };
}

export function calcWilliamsR(candles: OHLCV[]): IndicatorSignal {
  const wr = new WilliamsR(14);
  for (const candle of candles) {
    wr.update({ high: candle.high, low: candle.low, close: candle.close }, false);
  }
  const value = safeNum(wr.getResult());
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  // Williams %R ranges from -100 to 0
  if (value < -80) { signal = 'bullish'; strength = clamp((Math.abs(value) - 80) * 5, 50, 100); }
  else if (value > -20) { signal = 'bearish'; strength = clamp((20 + value) * 5, 50, 100); }
  else { strength = 50 - Math.abs(value + 50); }
  return { name: 'WilliamsR', value, signal, strength };
}

// ── Manual indicators ───────────────────────────────────────────────────

export function calcSupertrend(candles: OHLCV[], period = 10, multiplier = 3): IndicatorSignal {
  if (candles.length < period + 1) {
    return { name: 'Supertrend', value: 0, signal: 'neutral', strength: 0 };
  }

  // Calculate ATR manually for supertrend
  const trValues: number[] = [];
  for (let idx = 1; idx < candles.length; idx++) {
    const prev = candles[idx - 1];
    const curr = candles[idx];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trValues.push(tr);
  }

  // Simple ATR
  let atrValue = 0;
  if (trValues.length >= period) {
    const slice = trValues.slice(-period);
    atrValue = slice.reduce((sum, val) => sum + val, 0) / period;
  }

  const last = candles[candles.length - 1];
  const hl2 = (last.high + last.low) / 2;
  const upperBand = hl2 + multiplier * atrValue;
  const lowerBand = hl2 - multiplier * atrValue;

  const signal: IndicatorSignal['signal'] = last.close > lowerBand ? 'bullish' : 'bearish';
  const distPct = last.close > 0
    ? Math.abs(last.close - (signal === 'bullish' ? lowerBand : upperBand)) / last.close * 100
    : 0;

  return { name: 'Supertrend', value: signal === 'bullish' ? lowerBand : upperBand, signal, strength: clamp(50 + distPct * 10, 50, 100) };
}

export function calcMFI(candles: OHLCV[], period = 14): IndicatorSignal {
  if (candles.length < period + 1) {
    return { name: 'MFI', value: 50, signal: 'neutral', strength: 0 };
  }

  let positiveFlow = 0;
  let negativeFlow = 0;

  const startIdx = candles.length - period;
  for (let idx = startIdx; idx < candles.length; idx++) {
    const curr = candles[idx];
    const prev = candles[idx - 1];
    const typicalPrice = (curr.high + curr.low + curr.close) / 3;
    const prevTypical = (prev.high + prev.low + prev.close) / 3;
    const rawMoneyFlow = typicalPrice * curr.volume;

    if (typicalPrice > prevTypical) {
      positiveFlow += rawMoneyFlow;
    } else if (typicalPrice < prevTypical) {
      negativeFlow += rawMoneyFlow;
    }
  }

  const mfi = negativeFlow === 0 ? 100 : 100 - 100 / (1 + positiveFlow / negativeFlow);
  let signal: IndicatorSignal['signal'] = 'neutral';
  let strength = 50;
  if (mfi < 20) { signal = 'bullish'; strength = clamp((20 - mfi) * 5, 50, 100); }
  else if (mfi > 80) { signal = 'bearish'; strength = clamp((mfi - 80) * 5, 50, 100); }
  else { strength = 50 - Math.abs(mfi - 50); }

  return { name: 'MFI', value: mfi, signal, strength };
}

// ── Run All Indicators ──────────────────────────────────────────────────

export function computeAllIndicators(candles: OHLCV[]): IndicatorSignal[] {
  if (candles.length < 2) return [];

  const results: IndicatorSignal[] = [];

  const tryPush = (fn: () => IndicatorSignal): void => {
    try {
      const result = fn();
      if (Number.isFinite(result.value)) results.push(result);
    } catch {
      // Not enough data — skip silently
    }
  };

  // Library-based
  tryPush(() => calcRSI(candles));
  tryPush(() => calcMACD(candles));
  tryPush(() => calcBollingerBands(candles));
  tryPush(() => calcEMA(candles, 9));
  tryPush(() => calcEMA(candles, 21));
  tryPush(() => calcEMA(candles, 50));
  tryPush(() => calcEMA(candles, 200));
  tryPush(() => calcSMA(candles, 50));
  tryPush(() => calcSMA(candles, 200));
  tryPush(() => calcStochasticRSI(candles));
  tryPush(() => calcADX(candles));
  tryPush(() => calcATR(candles));
  tryPush(() => calcCCI(candles));
  tryPush(() => calcOBV(candles));
  tryPush(() => calcVWAP(candles));
  tryPush(() => calcPSAR(candles));
  tryPush(() => calcWilliamsR(candles));

  // Manual
  tryPush(() => calcSupertrend(candles));
  tryPush(() => calcMFI(candles));

  return results;
}
