/**
 * AI Signal Generator — Phase 4
 *
 * Combines Technical Analysis + Security Check + Momentum data +
 * Sentiment Analysis into a single confidence-scored TradeSignal.
 * Used by the sniper pipeline to make informed buy decisions.
 *
 * Weighted composite scoring:
 *   - TA score:        35%
 *   - Security score:  20%
 *   - Momentum score:  20%
 *   - Sentiment score: 15%
 *   - Volume/liquidity: 10%
 *
 * Graceful degradation: if any component fails, remaining components
 * are re-weighted proportionally.
 */

import { analyzeToken } from './technical-analysis.js';
import { enhancedSecurityCheck } from '../security/enhanced-rug-check.js';
import { getSentiment, type SentimentScore } from '../sentiment/sentiment-aggregator.js';
import type { AnalysisResult } from './types.js';
import type { SecurityVerdict } from '../security/enhanced-rug-check.js';

// ── Public Types ──────────────────────────────────────────────────────

export type SignalQuality = 'PRIME' | 'STANDARD' | 'SPECULATIVE' | 'REJECTED';

export interface TradeSignal {
  mint: string;
  symbol: string;
  name: string;
  confidence: number;        // 0-100
  quality: SignalQuality;
  direction: 'buy' | 'sell' | 'hold';
  entry: number;             // recommended entry price USD
  stopLoss: number;          // calculated SL price
  takeProfits: [number, number, number]; // 3 TP levels
  riskRewardRatio: number;
  reasoning: string[];       // human-readable reasons

  // Component scores
  taScore: number;
  securityScore: number;
  momentumScore: number;
  sentimentScore: number;
  regime: string;

  timestamp: string;
}

export interface SignalParams {
  mint: string;
  symbol: string;
  name: string;
  currentPrice: number;
  moonshotScore?: number;
  uniqueBuyers?: number;
  buySellRatio?: number;
  buyVolumeSol?: number;
  bondingCurveProgress?: number;
  // Sentiment inputs
  description?: string;
  buys24h?: number;
  sells24h?: number;
  volume24h?: number;
  // Phase 5: On-chain analytics inputs
  smartMoneyBuyers?: number;
  liquidityUsd?: number;
}

// ── TA Result Cache ──────────────────────────────────────────────────

interface CachedTAResult {
  result: AnalysisResult;
  cachedAt: number;
}

const taCache = new Map<string, CachedTAResult>();
const TA_CACHE_TTL_MS = 120_000; // 2 minutes

function getCachedTA(mint: string): AnalysisResult | null {
  const entry = taCache.get(mint);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TA_CACHE_TTL_MS) {
    taCache.delete(mint);
    return null;
  }
  return entry.result;
}

function setCachedTA(mint: string, result: AnalysisResult): void {
  // Evict stale entries if cache grows too large
  if (taCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of taCache) {
      if (now - entry.cachedAt > TA_CACHE_TTL_MS) {
        taCache.delete(key);
      }
    }
  }
  taCache.set(mint, { result, cachedAt: Date.now() });
}

// ── Momentum Score Calculation ───────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Map a value from an input range to 0-100, clamped.
 */
function mapTo100(value: number, inputMin: number, inputMax: number): number {
  if (inputMax <= inputMin) return 50;
  const normalized = (value - inputMin) / (inputMax - inputMin);
  return clamp(Math.round(normalized * 100), 0, 100);
}

function calculateMomentumScore(params: SignalParams): { score: number; components: Record<string, number> } {
  const buyerScore = mapTo100(params.uniqueBuyers ?? 0, 1, 20);
  const ratioScore = mapTo100(params.buySellRatio ?? 0, 0.5, 5.0);
  const volumeScore = mapTo100(params.buyVolumeSol ?? 0, 0, 5.0);
  const moonshotRaw = clamp(params.moonshotScore ?? 50, 0, 100);

  const components = {
    buyers: buyerScore,
    ratio: ratioScore,
    volume: volumeScore,
    moonshot: moonshotRaw,
  };

  const score = Math.round((buyerScore + ratioScore + volumeScore + moonshotRaw) / 4);

  return { score, components };
}

// ── Volume/Liquidity Score ───────────────────────────────────────────

function calculateVolumeScore(params: SignalParams): number {
  // Combine buy volume and bonding curve progress into a liquidity signal
  const volumeContrib = mapTo100(params.buyVolumeSol ?? 0, 0, 10.0);
  const bcProgress = params.bondingCurveProgress ?? 0;
  // Higher bonding curve progress = more liquidity = better
  // But too high (>0.8) means most of the curve is filled, less upside
  const bcScore = bcProgress <= 0.6
    ? mapTo100(bcProgress, 0, 0.6)
    : mapTo100(1.0 - bcProgress, 0, 0.4); // penalize approaching graduation

  return Math.round((volumeContrib * 0.6 + bcScore * 0.4));
}

// ── Quality Tier Classification ──────────────────────────────────────

function classifyQuality(
  confidence: number,
  securityScore: number,
  taScore: number,
): SignalQuality {
  // Critical security risk always rejects
  if (securityScore < 30) return 'REJECTED';
  if (confidence < 35) return 'REJECTED';

  if (confidence >= 75 && securityScore >= 70 && taScore >= 50) return 'PRIME';
  if (confidence >= 55 && securityScore >= 50) return 'STANDARD';
  if (confidence >= 35) return 'SPECULATIVE';

  return 'REJECTED';
}

// ── TP/SL Calculation ────────────────────────────────────────────────

interface ExitLevels {
  stopLoss: number;
  takeProfits: [number, number, number];
  riskRewardRatio: number;
}

function calculateExitLevels(entry: number): ExitLevels {
  if (!Number.isFinite(entry) || entry <= 0) {
    return {
      stopLoss: 0,
      takeProfits: [0, 0, 0],
      riskRewardRatio: 0,
    };
  }

  // Default ATR percent = 15% if not available
  const atrPercent = 0.15;
  const stopLoss = entry * (1 - atrPercent * 2); // 30% below entry
  const tp1 = entry * 1.5;  // 50% gain
  const tp2 = entry * 2.0;  // 100% gain
  const tp3 = entry * 3.0;  // 200% gain

  const risk = entry - stopLoss;
  const reward = tp1 - entry;
  const riskRewardRatio = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

  return {
    stopLoss,
    takeProfits: [tp1, tp2, tp3],
    riskRewardRatio,
  };
}

// ── Direction Inference ──────────────────────────────────────────────

function inferDirection(taScore: number, momentumScore: number, securityScore: number): 'buy' | 'sell' | 'hold' {
  const avg = (taScore + momentumScore) / 2;
  if (securityScore < 30) return 'hold'; // too risky
  if (avg >= 55) return 'buy';
  if (avg <= 35) return 'sell';
  return 'hold';
}

// ── Reasoning Builder ────────────────────────────────────────────────

function buildReasoning(
  taResult: AnalysisResult | null,
  securityResult: SecurityVerdict | null,
  momentumData: { score: number; components: Record<string, number> },
  volumeScore: number,
  sentimentResult: SentimentScore | null,
  params: SignalParams,
): string[] {
  const reasons: string[] = [];

  // TA reasoning
  if (taResult) {
    const bullishSignals = taResult.signals.filter((s) => s.signal === 'bullish');
    const bearishSignals = taResult.signals.filter((s) => s.signal === 'bearish');
    const topBullish = bullishSignals.slice(0, 3).map((s) => s.name).join(', ');
    const topBearish = bearishSignals.slice(0, 2).map((s) => s.name).join(', ');

    let taReason = `TA score ${taResult.score}/100`;
    if (topBullish) taReason += ` — bullish: ${topBullish}`;
    if (topBearish) taReason += ` | bearish: ${topBearish}`;
    reasons.push(taReason);
  } else {
    reasons.push('TA unavailable (insufficient candle data)');
  }

  // Security reasoning
  if (securityResult) {
    const flagSummary = securityResult.flags.length > 0
      ? ` — ${securityResult.flags.slice(0, 3).join('; ')}`
      : ' — no flags';
    reasons.push(`Security score ${securityResult.score}/100 (${securityResult.riskLevel})${flagSummary}`);
  } else {
    reasons.push('Security check unavailable');
  }

  // Momentum reasoning
  const buyerCount = params.uniqueBuyers ?? 0;
  const ratio = params.buySellRatio ?? 0;
  reasons.push(
    `Momentum score ${momentumData.score}/100 — ${buyerCount} unique buyers, ${ratio.toFixed(1)}x buy/sell ratio`,
  );

  // Volume reasoning
  const vol = params.buyVolumeSol ?? 0;
  reasons.push(
    `Volume/liquidity score ${volumeScore}/100 — ${vol.toFixed(2)} SOL buy volume`,
  );

  // Sentiment reasoning
  if (sentimentResult) {
    reasons.push(
      `Sentiment score ${sentimentResult.score} (${sentimentResult.label}) — ` +
      `NLP:${sentimentResult.components.nlpScore} Reddit:${sentimentResult.components.redditScore} ` +
      `DexSocial:${sentimentResult.components.dexScreenerScore}`,
    );
  } else {
    reasons.push('Sentiment analysis unavailable');
  }

  // Regime
  if (taResult) {
    reasons.push(`Regime: ${taResult.regime}`);
  }

  // Risk warnings
  if (securityResult && securityResult.score < 50) {
    reasons.push('WARNING: security score below 50, proceed with caution');
  }

  return reasons;
}

// ── Phase 5: On-Chain Analytics Reasoning ──────────────────────────────

function buildPhase5Reasoning(
  smartMoneyBuyers: number,
  liquidityUsd: number | undefined,
): string[] {
  const reasons: string[] = [];

  if (smartMoneyBuyers > 0) {
    const boost = Math.min(smartMoneyBuyers * 5, 15);
    reasons.push(`Smart money: ${smartMoneyBuyers} tracked wallet(s) active (+${boost} confidence)`);
  }

  if (liquidityUsd !== undefined) {
    if (liquidityUsd < 5000) {
      reasons.push(`Low liquidity: $${liquidityUsd.toFixed(0)} (-10 confidence penalty)`);
    } else {
      reasons.push(`Liquidity: $${liquidityUsd.toFixed(0)}`);
    }
  }

  return reasons;
}

// ── Main Signal Generator ────────────────────────────────────────────

export async function generateSignal(params: SignalParams): Promise<TradeSignal> {
  const { mint, symbol, name, currentPrice } = params;

  // Run TA, security, and sentiment in parallel for speed
  let taResult: AnalysisResult | null = getCachedTA(mint);

  const taPromise = taResult
    ? Promise.resolve(taResult)
    : analyzeToken(mint)
        .then((result) => {
          setCachedTA(mint, result);
          return result;
        })
        .catch((): null => null);

  const securityPromise = enhancedSecurityCheck(mint).catch((): null => null);

  const sentimentPromise = getSentiment({
    mint,
    symbol,
    name,
    description: params.description,
    buys24h: params.buys24h,
    sells24h: params.sells24h,
    volume24h: params.volume24h,
  }).catch((): null => null);

  const [taSettled, securityResult, sentimentResult] = await Promise.all([
    taPromise,
    securityPromise,
    sentimentPromise,
  ]);
  taResult = taSettled;

  // Component scores (with fallbacks)
  const taScore = taResult?.score ?? 50;
  const securityScore = securityResult?.score ?? 50;
  const momentumData = calculateMomentumScore(params);
  const volumeScore = calculateVolumeScore(params);
  // Sentiment maps -100..+100 → 0..100 for composite weighting
  const sentimentRaw = sentimentResult?.score ?? 0;
  const sentimentNormalized = Math.round((sentimentRaw + 100) / 2); // 0..100

  // Weighted composite with graceful degradation
  // New Phase 4 weights: TA 35%, Security 20%, Momentum 20%, Sentiment 15%, Volume 10%
  const taAvailable = taResult !== null;
  const secAvailable = securityResult !== null;
  const sentAvailable = sentimentResult !== null;

  const baseWeights = {
    ta: taAvailable ? 0.35 : 0,
    security: secAvailable ? 0.20 : 0,
    momentum: 0.20,
    sentiment: sentAvailable ? 0.15 : 0,
    volume: 0.10,
  };

  // Redistribute missing weights proportionally across available components
  const totalBase = baseWeights.ta + baseWeights.security + baseWeights.momentum
    + baseWeights.sentiment + baseWeights.volume;

  const scale = totalBase > 0 ? 1 / totalBase : 0;
  const weights = {
    ta: baseWeights.ta * scale,
    security: baseWeights.security * scale,
    momentum: baseWeights.momentum * scale,
    sentiment: baseWeights.sentiment * scale,
    volume: baseWeights.volume * scale,
  };

  let confidence = clamp(
    Math.round(
      taScore * weights.ta +
      securityScore * weights.security +
      momentumData.score * weights.momentum +
      sentimentNormalized * weights.sentiment +
      volumeScore * weights.volume,
    ),
    0,
    100,
  );

  // Phase 5: On-chain analytics adjustments
  // Smart money boost: each buyer adds +5, max +15
  const smartMoneyBoost = Math.min((params.smartMoneyBuyers ?? 0) * 5, 15);
  confidence = clamp(confidence + smartMoneyBoost, 0, 100);

  // Low liquidity penalty: if < $5000, subtract 10
  const liquidityPenalty = (params.liquidityUsd !== undefined && params.liquidityUsd < 5000) ? 10 : 0;
  confidence = clamp(confidence - liquidityPenalty, 0, 100);

  const quality = classifyQuality(confidence, securityScore, taScore);
  const direction = inferDirection(taScore, momentumData.score, securityScore);
  const exitLevels = calculateExitLevels(currentPrice);
  const reasoning = buildReasoning(
    taResult, securityResult, momentumData, volumeScore, sentimentResult, params,
  );

  // Append Phase 5 on-chain analytics reasoning
  const phase5Reasons = buildPhase5Reasoning(params.smartMoneyBuyers ?? 0, params.liquidityUsd);
  reasoning.push(...phase5Reasons);

  const regime = taResult?.regime ?? 'ranging';

  return {
    mint,
    symbol,
    name,
    confidence,
    quality,
    direction,
    entry: currentPrice,
    stopLoss: exitLevels.stopLoss,
    takeProfits: exitLevels.takeProfits,
    riskRewardRatio: exitLevels.riskRewardRatio,
    reasoning,
    taScore,
    securityScore,
    momentumScore: momentumData.score,
    sentimentScore: sentimentRaw,
    regime,
    timestamp: new Date().toISOString(),
  };
}
