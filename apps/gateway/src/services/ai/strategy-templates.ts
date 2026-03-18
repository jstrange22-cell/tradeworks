/**
 * Pre-built Strategy Templates — Phase 9
 *
 * Ready-to-deploy strategy configurations for the sniper engine.
 * Users can instantly apply a preset to create a new template
 * without manually configuring dozens of parameters.
 */

import type { SniperConfigFields } from '../../routes/solana-sniper/types.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface StrategyPreset {
  name: string;
  description: string;
  category: 'aggressive' | 'moderate' | 'conservative' | 'copy';
  config: Partial<SniperConfigFields>;
  expectedWinRate: string;
  riskLevel: 'high' | 'medium' | 'low';
  bestFor: string;
}

// ── Presets ──────────────────────────────────────────────────────────────

export const STRATEGY_PRESETS: readonly StrategyPreset[] = [
  {
    name: 'Meme Sniper',
    description: 'High risk, fast entries on newly launched pump.fun tokens. Aggressive tiered exits for quick flips.',
    category: 'aggressive',
    riskLevel: 'high',
    expectedWinRate: '30-40%',
    bestFor: 'Quick flips on newly launched meme coins',
    config: {
      buyAmountSol: 0.005,
      takeProfitPercent: 100,
      stopLossPercent: -25,
      maxPositionAgeMs: 1_800_000, // 30 min max hold
      minMoonshotScore: 30,
      minUniqueBuyers: 3,
      minBuySellRatio: 1.2,
      autoBuyPumpFun: true,
      autoBuyTrending: false,
      useAiSignals: true,
      minSignalConfidence: 30,
      enableTieredExits: true,
      exitTier1PctGain: 30,
      exitTier1SellPct: 25,
      exitTier2PctGain: 75,
      exitTier2SellPct: 30,
      exitTier3PctGain: 150,
      exitTier3SellPct: 30,
      exitTier4PctGain: 300,
      exitTier4SellPct: 100,
      momentumWindowMs: 8_000,
      minBuyVolumeSol: 0.3,
      buyCooldownMs: 20_000,
      maxOpenPositions: 10,
      stalePriceTimeoutMs: 180_000,
      trailingStopActivatePercent: 40,
      trailingStopPercent: -20,
      consecutiveLossPauseThreshold: 6,
      maxDailyLossSol: 0.15,
    },
  },
  {
    name: 'Momentum Rider',
    description: 'Medium risk, waits for confirmed momentum before entering. Dynamic sizing adjusts to wallet health.',
    category: 'moderate',
    riskLevel: 'medium',
    expectedWinRate: '40-55%',
    bestFor: 'Riding confirmed trends with moderate risk',
    config: {
      buyAmountSol: 0.01,
      takeProfitPercent: 50,
      stopLossPercent: -15,
      maxPositionAgeMs: 3_600_000, // 1 hour
      minMoonshotScore: 50,
      minUniqueBuyers: 8,
      minBuySellRatio: 2.0,
      momentumWindowMs: 15_000,
      minBuyVolumeSol: 1.0,
      autoBuyPumpFun: true,
      autoBuyTrending: true,
      useAiSignals: true,
      minSignalConfidence: 55,
      enableDynamicSizing: true,
      maxPositionPct: 0.08,
      enableTieredExits: true,
      exitTier1PctGain: 25,
      exitTier1SellPct: 20,
      exitTier2PctGain: 50,
      exitTier2SellPct: 30,
      exitTier3PctGain: 100,
      exitTier3SellPct: 30,
      exitTier4PctGain: 200,
      exitTier4SellPct: 100,
      maxOpenPositions: 8,
      buyCooldownMs: 45_000,
      stalePriceTimeoutMs: 300_000,
      trailingStopActivatePercent: 25,
      trailingStopPercent: -12,
      enableRugCheck: true,
      minRugCheckScore: 550,
      consecutiveLossPauseThreshold: 4,
      maxDailyLossSol: 0.12,
    },
  },
  {
    name: 'Conservative Scout',
    description: 'Low risk, strict filters, longer hold times. Only acts on high-confidence AI signals with strong rug check scores.',
    category: 'conservative',
    riskLevel: 'low',
    expectedWinRate: '55-70%',
    bestFor: 'Minimal losses, quality over quantity',
    config: {
      buyAmountSol: 0.003,
      takeProfitPercent: 30,
      stopLossPercent: -10,
      maxPositionAgeMs: 7_200_000, // 2 hours
      minMoonshotScore: 65,
      minUniqueBuyers: 12,
      minBuySellRatio: 3.0,
      momentumWindowMs: 20_000,
      minBuyVolumeSol: 2.0,
      autoBuyPumpFun: true,
      autoBuyTrending: false,
      useAiSignals: true,
      minSignalConfidence: 70,
      enableDynamicSizing: true,
      maxPositionPct: 0.05,
      enableRugCheck: true,
      minRugCheckScore: 700,
      maxTopHolderPct: 20,
      enableTieredExits: true,
      exitTier1PctGain: 15,
      exitTier1SellPct: 20,
      exitTier2PctGain: 30,
      exitTier2SellPct: 30,
      exitTier3PctGain: 60,
      exitTier3SellPct: 30,
      exitTier4PctGain: 100,
      exitTier4SellPct: 100,
      maxOpenPositions: 5,
      buyCooldownMs: 60_000,
      stalePriceTimeoutMs: 600_000,
      trailingStopActivatePercent: 15,
      trailingStopPercent: -8,
      consecutiveLossPauseThreshold: 3,
      maxDailyLossSol: 0.05,
      maxMarketCapUsd: 80_000,
      minBondingCurveSol: 2.0,
    },
  },
  {
    name: 'Whale Watcher',
    description: 'Follows smart money and trending token activity. Focuses on tokens already gaining traction on DEX aggregators.',
    category: 'copy',
    riskLevel: 'medium',
    expectedWinRate: '40-50%',
    bestFor: 'Following tokens that smart money and trending lists pick up',
    config: {
      buyAmountSol: 0.008,
      takeProfitPercent: 75,
      stopLossPercent: -20,
      autoBuyPumpFun: false,
      autoBuyTrending: true,
      maxTrendingMarketCapUsd: 1_000_000,
      minTrendingMomentumPercent: 30,
      minMoonshotScore: 40,
      minUniqueBuyers: 5,
      minBuySellRatio: 1.5,
      useAiSignals: true,
      minSignalConfidence: 50,
      enableTieredExits: true,
      exitTier1PctGain: 40,
      exitTier1SellPct: 25,
      exitTier2PctGain: 75,
      exitTier2SellPct: 30,
      exitTier3PctGain: 150,
      exitTier3SellPct: 30,
      exitTier4PctGain: 300,
      exitTier4SellPct: 100,
      maxPositionAgeMs: 3_600_000, // 1 hour
      maxOpenPositions: 6,
      buyCooldownMs: 30_000,
      stalePriceTimeoutMs: 300_000,
      trailingStopActivatePercent: 35,
      trailingStopPercent: -15,
      enableRugCheck: true,
      minRugCheckScore: 500,
      consecutiveLossPauseThreshold: 5,
      maxDailyLossSol: 0.10,
    },
  },
] as const;

// ── Public API ──────────────────────────────────────────────────────────

/** Get a single preset by name (case-insensitive) */
export function getPreset(name: string): StrategyPreset | undefined {
  const lower = name.toLowerCase();
  return STRATEGY_PRESETS.find(
    (preset) => preset.name.toLowerCase() === lower,
  );
}

/** Get all available presets */
export function getAllPresets(): readonly StrategyPreset[] {
  return STRATEGY_PRESETS;
}

/** Get a preset's config overrides by name (case-insensitive). Returns null if not found. */
export function applyPreset(presetName: string): Partial<SniperConfigFields> | null {
  const preset = getPreset(presetName);
  if (!preset) return null;
  return { ...preset.config };
}
