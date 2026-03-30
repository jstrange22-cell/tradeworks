import {
  ema,
  rsi,
  macd,
  supertrend,
  bollinger,
  stochastic,
  obv as calcObv,
  atr as calcAtr,
  detectOrderBlocks,
  detectFairValueGaps,
} from '@tradeworks/indicators';
import type { CryptoCandle } from '@/lib/crypto-api';

export interface AIMarker {
  time: number; // seconds epoch
  direction: 'buy' | 'sell';
  price: number;
  confidence: number;
}

export interface OBZone {
  time: number;
  high: number;
  low: number;
  type: 'bullish' | 'bearish';
}

export interface FVGZone {
  time: number;
  high: number;
  low: number;
  type: 'bullish' | 'bearish';
  filled: boolean;
}

export interface AISignalResult {
  direction: 'buy' | 'sell' | 'neutral';
  confidence: number; // 0–100
  score: number;      // –1 to +1
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  atr: number;
  reasoning: string[];
  layerScores: { trend: number; momentum: number; structure: number; volume: number };
  htfBias: 'bullish' | 'bearish' | 'neutral';
  markers: AIMarker[];
  orderBlocks: OBZone[];
  fvgs: FVGZone[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lastValidAt(arr: number[], idx: number): number {
  const start = Math.min(idx, arr.length - 1);
  for (let i = start; i >= 0; i--) {
    const v = arr[i];
    if (Number.isFinite(v) && !Number.isNaN(v)) return v;
  }
  return 0;
}

function computeBOSArray(candles: CryptoCandle[], lookback = 10): number[] {
  const bos = new Array<number>(candles.length).fill(0);
  for (let i = lookback; i < candles.length; i++) {
    let swingHigh = -Infinity;
    let swingLow = Infinity;
    for (let j = i - lookback; j < i; j++) {
      if (candles[j].high > swingHigh) swingHigh = candles[j].high;
      if (candles[j].low < swingLow) swingLow = candles[j].low;
    }
    if (candles[i].close > swingHigh) bos[i] = 1;
    else if (candles[i].close < swingLow) bos[i] = -1;
  }
  return bos;
}

function neutralResult(candles: CryptoCandle[]): AISignalResult {
  const last = candles[candles.length - 1];
  const price = last?.close ?? 0;
  return {
    direction: 'neutral', confidence: 0, score: 0,
    entryPrice: price, stopLoss: price, tp1: price, tp2: price, tp3: price,
    atr: 0, reasoning: ['Insufficient data'],
    layerScores: { trend: 0, momentum: 0, structure: 0, volume: 0 },
    htfBias: 'neutral', markers: [], orderBlocks: [], fvgs: [],
  };
}

// ── Main computation ─────────────────────────────────────────────────────────

export function computeAISignal(
  candles: CryptoCandle[],
  htfCandles?: CryptoCandle[],
): AISignalResult {
  if (candles.length < 15) return neutralResult(candles);

  const closes = candles.map(c => c.close);
  const n = candles.length;

  // ── Indicators ────────────────────────────────────────────────────────────
  const ema12Arr = ema(closes, 12);
  const ema26Arr = ema(closes, 26);
  const ema50Arr = ema(closes, 50);
  const rsiArr = rsi(closes, 14);
  const macdResult = macd(closes, 12, 26, 9);
  const stResult = supertrend(candles, 10, 3);
  const bbResult = bollinger(closes, 20, 2);
  const stochResult = stochastic(candles, 14, 3);
  const obvArr = calcObv(candles);
  const atrArr = calcAtr(candles, 14);
  const bos = computeBOSArray(candles);

  const e12 = lastValidAt(ema12Arr, n - 1);
  const e26 = lastValidAt(ema26Arr, n - 1);
  const e50 = lastValidAt(ema50Arr, n - 1);
  const lastRsi = lastValidAt(rsiArr, n - 1);
  const lastHist = lastValidAt(macdResult.histogram, n - 1);
  const prevHist = lastValidAt(macdResult.histogram, n - 2);
  const lastK = lastValidAt(stochResult.k, n - 1);
  const lastD = lastValidAt(stochResult.d, n - 1);
  const prevK = lastValidAt(stochResult.k, n - 2);
  const prevD = lastValidAt(stochResult.d, n - 2);
  const lastClose = closes[n - 1];
  const bbUpper = lastValidAt(bbResult.upper, n - 1);
  const bbLower = lastValidAt(bbResult.lower, n - 1);
  const atrVal = lastValidAt(atrArr, n - 1) || lastClose * 0.01;
  const stDir = stResult.direction[n - 1] ?? 0;

  // ── Trend layer ───────────────────────────────────────────────────────────
  const reasoning: string[] = [];
  let emaScore = 0;
  // Require full stack alignment — partial alignment scores 0
  if (e12 > e26 && e26 > e50) { emaScore = 0.6; reasoning.push('EMA bullish stack'); }
  else if (e12 < e26 && e26 < e50) { emaScore = -0.6; reasoning.push('EMA bearish stack'); }
  const stScore = stDir === 1 ? 0.5 : stDir === -1 ? -0.5 : 0;
  if (stScore > 0) reasoning.push('SuperTrend bullish');
  else if (stScore < 0) reasoning.push('SuperTrend bearish');
  // Both EMA stack AND SuperTrend must agree for full trend score
  const trendScore = clamp(emaScore + stScore, -1, 1);

  // ── Momentum layer ────────────────────────────────────────────────────────
  let rsiScore = 0;
  // Tighter extremes (30/70) for high-conviction oversold/overbought
  if (lastRsi < 30) { rsiScore = 1.0; reasoning.push(`RSI oversold ${lastRsi.toFixed(1)}`); }
  else if (lastRsi > 70) { rsiScore = -1.0; reasoning.push(`RSI overbought ${lastRsi.toFixed(1)}`); }
  else if (lastRsi < 40) { rsiScore = 0.4; reasoning.push(`RSI low ${lastRsi.toFixed(1)}`); }
  else if (lastRsi > 60) { rsiScore = -0.4; reasoning.push(`RSI high ${lastRsi.toFixed(1)}`); }
  else rsiScore = lastRsi < 50 ? 0.1 : -0.1;

  let macdScore = 0;
  if (lastHist > 0 && prevHist <= 0) { macdScore = 0.7; reasoning.push('MACD bullish cross'); }
  else if (lastHist < 0 && prevHist >= 0) { macdScore = -0.7; reasoning.push('MACD bearish cross'); }
  else macdScore = lastHist > 0 ? 0.3 : -0.3;

  let stochScore = 0;
  if (lastK > lastD && prevK <= prevD && lastK < 30) { stochScore = 1.0; reasoning.push('Stoch oversold cross'); }
  else if (lastK < lastD && prevK >= prevD && lastK > 70) { stochScore = -1.0; reasoning.push('Stoch overbought cross'); }
  else stochScore = lastK < 30 ? 0.3 : lastK > 70 ? -0.3 : 0;

  const momentumScore = clamp((rsiScore + macdScore + stochScore) / 3, -1, 1);

  // ── Structure layer ───────────────────────────────────────────────────────
  let bbScore = 0;
  if (lastClose < bbLower) { bbScore = 0.8; reasoning.push('Price below BB lower'); }
  else if (lastClose > bbUpper) { bbScore = -0.8; reasoning.push('Price above BB upper'); }

  const bosCur = bos[n - 1];
  const bosScore = bosCur === 1 ? 0.5 : bosCur === -1 ? -0.5 : 0;
  if (bosCur === 1) reasoning.push('BOS bullish break');
  else if (bosCur === -1) reasoning.push('BOS bearish break');

  const rawOBs = detectOrderBlocks(candles);
  const activeOBs = rawOBs.filter(ob => !ob.mitigated).slice(-5);
  let obScore = 0;
  for (const ob of activeOBs) {
    const mid = (ob.high + ob.low) / 2;
    if (Math.abs(lastClose - mid) / lastClose < 0.02) {
      obScore = ob.type === 'bullish' ? 0.3 : -0.3;
      break;
    }
  }

  const structureScore = clamp((bbScore + bosScore + obScore) / 3, -1, 1);

  // ── Volume layer ──────────────────────────────────────────────────────────
  const volLookback = Math.min(20, n - 1);
  const avgVol = candles.slice(-volLookback - 1, -1).reduce((s, c) => s + c.volume, 0) / volLookback;
  const lastCan = candles[n - 1];
  let volScore = 0;
  if (lastCan.volume > avgVol * 1.5) {
    volScore = lastCan.close > lastCan.open ? 1.0 : -1.0;
    reasoning.push(volScore > 0 ? 'Volume spike bullish' : 'Volume spike bearish');
  }
  const obvLookback = Math.min(5, n - 1);
  const obvEnd = lastValidAt(obvArr, n - 1);
  const obvStart = lastValidAt(obvArr, n - 1 - obvLookback);
  const obvScore = obvEnd > obvStart ? 0.5 : obvEnd < obvStart ? -0.5 : 0;
  const volumeScore = clamp((volScore + obvScore) / 2, -1, 1);

  // ── Final score ───────────────────────────────────────────────────────────
  // Rebalanced: trend is most reliable, volume confirmation matters more
  const score = trendScore * 0.40 + momentumScore * 0.25 + structureScore * 0.20 + volumeScore * 0.15;

  // ── HTF Bias ──────────────────────────────────────────────────────────────
  let htfBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (htfCandles && htfCandles.length >= 50) {
    const hc = htfCandles.map(c => c.close);
    const he12 = lastValidAt(ema(hc, 12), hc.length - 1);
    const he26 = lastValidAt(ema(hc, 26), hc.length - 1);
    const he50 = lastValidAt(ema(hc, 50), hc.length - 1);
    if (he12 > he26 && he26 > he50) htfBias = 'bullish';
    else if (he12 < he26 && he26 < he50) htfBias = 'bearish';
  }

  // ── Direction + confidence ────────────────────────────────────────────────
  // Raised threshold from 0.40 → 0.50: fewer signals, higher quality
  let direction: 'buy' | 'sell' | 'neutral' = 'neutral';
  if (score >= 0.50) direction = 'buy';
  else if (score <= -0.50) direction = 'sell';

  let confidence = Math.min(95, Math.round(Math.abs(score) * 100));

  // HTF opposition blocks signal entirely when it strongly disagrees
  if (htfBias !== 'neutral' && htfCandles && htfCandles.length >= 50) {
    if (
      (direction === 'buy' && htfBias === 'bearish') ||
      (direction === 'sell' && htfBias === 'bullish')
    ) {
      // Only allow signal through if it's very strong (score > 0.65)
      if (Math.abs(score) < 0.65) {
        direction = 'neutral';
        reasoning.push('HTF opposes – signal blocked');
      } else {
        confidence = Math.round(confidence * 0.65);
        reasoning.push('HTF opposes – confidence reduced');
      }
    } else if (
      (direction === 'buy' && htfBias === 'bullish') ||
      (direction === 'sell' && htfBias === 'bearish')
    ) {
      // HTF alignment boosts confidence
      confidence = Math.min(95, Math.round(confidence * 1.15));
      reasoning.push('HTF aligned – confidence boosted');
    }
  }

  // ── ATR levels ────────────────────────────────────────────────────────────
  // Fixed R:R: SL=1.5x, TP1=2.5x (1.67:1), TP2=5x (3.33:1), TP3=8x (5.33:1)
  // Previous TP1 was 1.5x (1:1 R:R) — even at 70% win rate barely profitable
  const mult = direction === 'sell' ? -1 : 1;
  const stopLoss = direction === 'sell'
    ? lastClose + 1.5 * atrVal
    : lastClose - 1.5 * atrVal;
  const tp1 = lastClose + mult * 2.5 * atrVal;
  const tp2 = lastClose + mult * 5.0 * atrVal;
  const tp3 = lastClose + mult * 8.0 * atrVal;

  // ── Historical markers ────────────────────────────────────────────────────
  const markers: AIMarker[] = [];
  let lastMarkerIdx = -5;

  function scoreAtIdx(i: number): number {
    const te12 = ema12Arr[i] ?? 0; const te26 = ema26Arr[i] ?? 0; const te50 = ema50Arr[i] ?? 0;
    let ts = 0;
    if (te12 > te26 && te26 > te50) ts = 0.5;
    else if (te12 < te26 && te26 < te50) ts = -0.5;
    const tsd = stResult.direction[i] ?? 0;
    const trend = clamp(ts + (tsd === 1 ? 0.5 : tsd === -1 ? -0.5 : 0), -1, 1);

    const rVal = rsiArr[i] ?? 50;
    const rs = rVal < 35 ? 1 : rVal > 65 ? -1 : rVal < 50 ? 0.3 : -0.3;
    const hh = macdResult.histogram[i] ?? 0; const ph = macdResult.histogram[i - 1] ?? 0;
    const ms = hh > 0 && ph <= 0 ? 0.7 : hh < 0 && ph >= 0 ? -0.7 : hh > 0 ? 0.3 : -0.3;
    const momentum = clamp((rs + ms) / 2, -1, 1);

    const cl = candles[i].close;
    const bu = bbResult.upper[i] ?? cl * 1.02; const bl = bbResult.lower[i] ?? cl * 0.98;
    const structure = clamp((cl < bl ? 0.8 : cl > bu ? -0.8 : 0) + (bos[i] === 1 ? 0.5 : bos[i] === -1 ? -0.5 : 0), -1, 1);

    return trend * 0.35 + momentum * 0.30 + structure * 0.25;
  }

  const markerStart = Math.min(26, Math.floor(n * 0.4));
  for (let i = markerStart; i < n; i += 3) {
    const localScore = scoreAtIdx(i);
    if (Math.abs(localScore) >= 0.50 && i - lastMarkerIdx >= 5) {
      markers.push({
        time: Math.floor(candles[i].timestamp / 1000),
        direction: localScore > 0 ? 'buy' : 'sell',
        price: candles[i].close,
        confidence: Math.min(95, Math.round(Math.abs(localScore) * 100)),
      });
      lastMarkerIdx = i;
    }
  }

  // ── Order Blocks & FVGs ───────────────────────────────────────────────────
  const orderBlocks: OBZone[] = activeOBs.map(ob => ({
    time: Math.floor(ob.timestamp / 1000),
    high: ob.high,
    low: ob.low,
    type: ob.type,
  }));

  const rawFVGs = detectFairValueGaps(candles);
  const fvgs: FVGZone[] = rawFVGs
    .filter(fvg => !fvg.filled)
    .slice(-8)
    .map(fvg => ({
      time: Math.floor(candles[fvg.index].timestamp / 1000),
      high: fvg.high,
      low: fvg.low,
      type: fvg.type,
      filled: fvg.filled,
    }));

  return {
    direction, confidence, score,
    entryPrice: lastClose, stopLoss, tp1, tp2, tp3, atr: atrVal,
    reasoning: reasoning.slice(0, 5),
    layerScores: { trend: trendScore, momentum: momentumScore, structure: structureScore, volume: volumeScore },
    htfBias, markers, orderBlocks, fvgs,
  };
}
