/**
 * Multi-Timeframe Technical Analysis Engine
 *
 * Fetches candle data from DexScreener, computes 15+ indicators across
 * multiple timeframes, aggregates scores with configurable weights,
 * and returns a composite analysis result.
 */

import type {
  OHLCV,
  IndicatorSignal,
  AnalysisResult,
  Timeframe,
} from './types.js';
import {
  TIMEFRAMES,
  TIMEFRAME_WEIGHTS,
  MIN_CANDLES_REQUIRED,
} from './types.js';
import { computeAllIndicators } from './indicators.js';
import { detectRegime } from './market-regime.js';
import { detectPatterns } from './candlestick-patterns.js';

// ── DexScreener Types ───────────────────────────────────────────────────

interface DexScreenerPairData {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string };
  priceUsd: string;
  volume: { h24: number };
  priceChange: { h1: number; h24: number };
  txns: {
    h1: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPairData[] | null;
}

// ── Candle Fetching ─────────────────────────────────────────────────────

/**
 * Fetch candle data from DexScreener for a token mint.
 *
 * DexScreener's free API doesn't provide OHLCV candle endpoints directly,
 * so we fetch pair data and synthesize candles from price/volume snapshots.
 * For production, consider Birdeye or Helius for real OHLCV data.
 *
 * This implementation generates synthetic candles from the current price
 * with randomized spread based on reported volatility — suitable for
 * testing the TA pipeline. Replace with real candle source in production.
 */
async function fetchDexScreenerPairs(mint: string): Promise<DexScreenerPairData[]> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return [];

  const data = (await response.json()) as DexScreenerResponse;
  if (!data.pairs) return [];

  // Filter to Solana pairs only
  return data.pairs.filter((p) => p.chainId === 'solana');
}

/**
 * Synthesize OHLCV candles from a DexScreener pair's price and volume data.
 *
 * Since DexScreener free API only gives current price + 24h volume,
 * we create approximate candles using reported price change as volatility proxy.
 * This is a stopgap — replace with Birdeye OHLCV when available.
 */
function synthesizeCandles(
  pair: DexScreenerPairData,
  timeframe: Timeframe,
  count: number,
): OHLCV[] {
  const price = parseFloat(pair.priceUsd);
  if (!Number.isFinite(price) || price <= 0) return [];

  const h1Change = Math.abs(pair.priceChange?.h1 ?? 1) / 100;
  const h24Change = Math.abs(pair.priceChange?.h24 ?? 5) / 100;
  const h24Volume = pair.volume?.h24 ?? 0;

  // Timeframe durations in minutes
  const tfMinutes: Record<Timeframe, number> = {
    '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240,
  };
  const minutes = tfMinutes[timeframe];
  const candlesPerHour = 60 / minutes;

  // Scale volatility per candle based on timeframe
  const hourlyVol = h1Change > 0 ? h1Change : h24Change / Math.sqrt(24);
  const candleVol = hourlyVol / Math.sqrt(candlesPerHour);

  // Volume per candle
  const volumePerCandle = h24Volume > 0
    ? h24Volume / (24 * candlesPerHour)
    : 1000;

  const candles: OHLCV[] = [];
  let currentPrice = price / (1 + h1Change * (count / candlesPerHour));

  const now = Date.now();

  for (let idx = 0; idx < count; idx++) {
    // Deterministic but varied movement using sine-based pattern
    const phase = (idx / count) * Math.PI * 4;
    const trend = (price - currentPrice) / (count - idx || 1);
    const noise = Math.sin(phase + idx * 0.7) * candleVol * currentPrice;

    const open = currentPrice;
    const movement = trend + noise;
    const close = Math.max(open + movement, open * 0.5);
    const high = Math.max(open, close) * (1 + candleVol * 0.5 * Math.abs(Math.sin(idx * 1.3)));
    const low = Math.min(open, close) * (1 - candleVol * 0.5 * Math.abs(Math.cos(idx * 1.7)));
    const volume = volumePerCandle * (0.5 + Math.abs(Math.sin(idx * 0.9)));

    candles.push({
      timestamp: now - (count - idx) * minutes * 60_000,
      open: Math.max(open, 0.000000001),
      high: Math.max(high, open),
      low: Math.max(Math.min(low, open), 0.000000001),
      close: Math.max(close, 0.000000001),
      volume: Math.max(volume, 0),
    });

    currentPrice = close;
  }

  return candles;
}

// ── Scoring ─────────────────────────────────────────────────────────────

function scoreIndicators(signals: IndicatorSignal[]): number {
  if (signals.length === 0) return 50;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const sig of signals) {
    const weight = sig.strength / 100;
    let scoreValue: number;

    switch (sig.signal) {
      case 'bullish':
        scoreValue = 50 + sig.strength * 0.5; // 50-100
        break;
      case 'bearish':
        scoreValue = 50 - sig.strength * 0.5; // 0-50
        break;
      default:
        scoreValue = 50;
    }

    weightedSum += scoreValue * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
}

// ── Main Analysis ───────────────────────────────────────────────────────

export async function analyzeToken(mint: string): Promise<AnalysisResult> {
  const pairs = await fetchDexScreenerPairs(mint);

  if (pairs.length === 0) {
    return {
      score: 50,
      signals: [],
      regime: 'ranging',
      timeframeScores: {},
      candleCount: {},
    };
  }

  // Use the highest-volume Solana pair
  const primaryPair = pairs.reduce((best, pair) =>
    (pair.volume?.h24 ?? 0) > (best.volume?.h24 ?? 0) ? pair : best,
  );

  // Target candle counts per timeframe
  const targetCounts: Record<Timeframe, number> = {
    '1m': 200,
    '5m': 100,
    '15m': 60,
    '1h': 50,
    '4h': 30,
  };

  const allSignals: IndicatorSignal[] = [];
  const timeframeScores: Record<string, number> = {};
  const candleCount: Record<string, number> = {};
  let primaryCandles: OHLCV[] = [];

  // Available weight to redistribute from skipped timeframes
  let availableWeight = 0;
  const activeTimeframes: Array<{ tf: Timeframe; weight: number; score: number }> = [];

  for (const tf of TIMEFRAMES) {
    const candles = synthesizeCandles(primaryPair, tf, targetCounts[tf]);
    candleCount[tf] = candles.length;

    if (candles.length < MIN_CANDLES_REQUIRED) {
      availableWeight += TIMEFRAME_WEIGHTS[tf];
      timeframeScores[tf] = -1; // Mark as skipped
      continue;
    }

    // Use 15m as the primary candles for regime detection (best balance)
    if (tf === '15m' || (primaryCandles.length === 0 && candles.length >= MIN_CANDLES_REQUIRED)) {
      primaryCandles = candles;
    }

    const signals = computeAllIndicators(candles);
    const tfScore = scoreIndicators(signals);

    // Tag signals with timeframe
    const taggedSignals = signals.map((sig) => ({
      ...sig,
      name: `${sig.name}[${tf}]`,
    }));
    allSignals.push(...taggedSignals);

    timeframeScores[tf] = tfScore;
    activeTimeframes.push({ tf, weight: TIMEFRAME_WEIGHTS[tf], score: tfScore });
  }

  // Redistribute weight from skipped timeframes proportionally
  const totalActiveWeight = activeTimeframes.reduce((sum, entry) => sum + entry.weight, 0);

  let compositeScore = 50;
  if (activeTimeframes.length > 0 && totalActiveWeight > 0) {
    let weightedSum = 0;
    for (const entry of activeTimeframes) {
      const adjustedWeight = entry.weight + (availableWeight * entry.weight / totalActiveWeight);
      weightedSum += entry.score * adjustedWeight;
    }
    compositeScore = Math.round(weightedSum);
  }

  // Detect market regime from primary timeframe
  const primarySignals = primaryCandles.length >= MIN_CANDLES_REQUIRED
    ? computeAllIndicators(primaryCandles)
    : [];
  const regime = detectRegime(primarySignals, primaryCandles);

  // Detect candlestick patterns and boost/penalize score
  const patterns = detectPatterns(primaryCandles);
  let patternAdjustment = 0;
  for (const pattern of patterns) {
    const impact = (pattern.reliability / 100) * 5; // Max +/-5 points per pattern
    if (pattern.type === 'bullish') patternAdjustment += impact;
    else if (pattern.type === 'bearish') patternAdjustment -= impact;
  }
  compositeScore = Math.round(
    Math.max(0, Math.min(100, compositeScore + patternAdjustment)),
  );

  // Add pattern signals to output
  const patternSignals: IndicatorSignal[] = patterns.map((p) => ({
    name: `Pattern:${p.pattern}`,
    value: p.reliability,
    signal: p.type,
    strength: p.reliability,
  }));
  allSignals.push(...patternSignals);

  return {
    score: compositeScore,
    signals: allSignals,
    regime,
    timeframeScores,
    candleCount,
  };
}
