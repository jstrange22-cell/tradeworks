/**
 * Fractional Kelly Criterion — Position Sizing Engine
 *
 * Calculates optimal position size based on signal confidence,
 * historical performance, and portfolio heat. Uses half-Kelly
 * (f-star / 2) to reduce variance, standard practice in quant finance.
 */

import type { SignalQuality } from '../ai/signal-generator.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface PositionSizeResult {
  /** SOL amount to buy */
  recommendedSol: number;
  /** Raw Kelly fraction (0-1) */
  kellyFraction: number;
  /** After half-Kelly + quality multiplier + heat reduction + caps */
  adjustedFraction: number;
  /** Human-readable explanation of the sizing decision */
  reasoning: string;
}

export interface PositionSizeParams {
  walletBalanceSol: number;
  /** Signal confidence 0-100 from AI signal generator */
  signalConfidence: number;
  signalQuality: SignalQuality;
  /** Historical win rate 0-1 from template stats */
  historicalWinRate: number;
  /** Average win amount / average loss amount */
  avgWinLossRatio: number;
  /** Current portfolio risk score 0-100 */
  portfolioHeat: number;
  /** Max % of wallet per trade (e.g., 0.10 = 10%) */
  maxPositionPct: number;
  /** Configured base buy amount in SOL */
  baseBuyAmountSol: number;
}

// ── Quality Multipliers ───────────────────────────────────────────────

const QUALITY_MULTIPLIERS: Record<SignalQuality, number> = {
  PRIME: 1.0,
  STANDARD: 0.6,
  SPECULATIVE: 0.3,
  REJECTED: 0,
} as const;

// ── Calculator ────────────────────────────────────────────────────────

export function calculatePositionSize(params: PositionSizeParams): PositionSizeResult {
  const {
    walletBalanceSol,
    signalConfidence,
    signalQuality,
    historicalWinRate,
    avgWinLossRatio,
    portfolioHeat,
    maxPositionPct,
    baseBuyAmountSol,
  } = params;

  const minimumTrade = baseBuyAmountSol * 0.25;
  const reasons: string[] = [];

  // Edge case: REJECTED signals get minimum or zero
  if (signalQuality === 'REJECTED') {
    return {
      recommendedSol: 0,
      kellyFraction: 0,
      adjustedFraction: 0,
      reasoning: 'Signal quality REJECTED — no trade',
    };
  }

  // Edge case: zero or negative wallet balance
  if (walletBalanceSol <= 0) {
    return {
      recommendedSol: 0,
      kellyFraction: 0,
      adjustedFraction: 0,
      reasoning: 'Wallet balance is zero or negative',
    };
  }

  // ── Blended win probability ──
  // Mix signal confidence (normalized 0-1) with historical win rate
  const signalProbability = signalConfidence / 100;
  const hasHistory = historicalWinRate > 0;
  const blendedWinRate = hasHistory
    ? signalProbability * 0.6 + historicalWinRate * 0.4
    : signalProbability;

  reasons.push(`Win prob: ${(blendedWinRate * 100).toFixed(1)}%`);

  // ── Kelly Formula ──
  // f* = (p * b - q) / b
  const probability = Math.max(0.01, Math.min(0.99, blendedWinRate));
  const odds = Math.max(0.1, avgWinLossRatio);
  const qProbability = 1 - probability;
  const kellyFraction = (probability * odds - qProbability) / odds;

  // If Kelly is negative, expected value is negative — trade minimum or skip
  if (kellyFraction <= 0) {
    reasons.push(`Kelly negative (${(kellyFraction * 100).toFixed(2)}%) — minimum trade`);
    return {
      recommendedSol: minimumTrade,
      kellyFraction,
      adjustedFraction: 0,
      reasoning: reasons.join('; '),
    };
  }

  reasons.push(`Kelly raw: ${(kellyFraction * 100).toFixed(2)}%`);

  // ── Half Kelly (variance reduction) ──
  let adjusted = kellyFraction / 2;
  reasons.push(`Half-Kelly: ${(adjusted * 100).toFixed(2)}%`);

  // ── Quality multiplier ──
  const qualityMult = QUALITY_MULTIPLIERS[signalQuality];
  adjusted *= qualityMult;
  reasons.push(`Quality ${signalQuality}: x${qualityMult}`);

  // ── Portfolio heat reduction ──
  if (portfolioHeat > 60) {
    const heatReduction = 1 - (portfolioHeat - 60) / 100;
    const clampedReduction = Math.max(0.1, heatReduction);
    adjusted *= clampedReduction;
    reasons.push(`Heat ${portfolioHeat}: x${clampedReduction.toFixed(2)}`);
  }

  // ── Hard cap ──
  const maxFraction = maxPositionPct;
  if (adjusted > maxFraction) {
    adjusted = maxFraction;
    reasons.push(`Capped at ${(maxFraction * 100).toFixed(1)}%`);
  }

  // ── Calculate SOL amount ──
  let recommendedSol = adjusted * walletBalanceSol;

  // Floor: never below minimum viable trade
  if (recommendedSol < minimumTrade) {
    recommendedSol = minimumTrade;
    reasons.push(`Floored to min ${minimumTrade.toFixed(4)} SOL`);
  }

  // Ceiling: never exceed max position
  const maxSol = maxPositionPct * walletBalanceSol;
  if (recommendedSol > maxSol) {
    recommendedSol = maxSol;
    reasons.push(`Capped at ${maxSol.toFixed(4)} SOL`);
  }

  // Never exceed wallet balance
  if (recommendedSol > walletBalanceSol) {
    recommendedSol = walletBalanceSol;
  }

  return {
    recommendedSol: Math.round(recommendedSol * 1e6) / 1e6, // 6 decimal precision
    kellyFraction,
    adjustedFraction: adjusted,
    reasoning: reasons.join('; '),
  };
}
