/**
 * Pre-built Strategy Templates — v2 (Redesigned for Profitability)
 *
 * Four focused strategies, each optimized for a different trading style.
 * All templates use the improved fee settings (lower slippage, proper
 * priority fees) and accurate P&L tracking with wallet delta measurement.
 *
 * Key changes from v1:
 * - Position size: 0.01 SOL (was 0.005) — better fee-to-position ratio
 * - Slippage: 5-10% (was 15%) — stop overpaying on entries/exits
 * - Stricter entry filters across all templates
 * - Tighter stop losses — meme coins that drop 12%+ don't recover
 */

import type { SniperConfigFields } from '../../routes/solana-sniper/types.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface StrategyPreset {
  name: string;
  description: string;
  category: 'aggressive' | 'moderate' | 'conservative' | 'ai';
  config: Partial<SniperConfigFields>;
  expectedWinRate: string;
  riskLevel: 'high' | 'medium' | 'low';
  bestFor: string;
}

// ── Presets ──────────────────────────────────────────────────────────────

export const STRATEGY_PRESETS: readonly StrategyPreset[] = [
  {
    name: 'Quick Flip',
    description: 'Fast entries on pump.fun tokens, sell within seconds. Tight stops, no tiered exits — sell 100% at target.',
    category: 'aggressive',
    riskLevel: 'high',
    expectedWinRate: '35-45%',
    bestFor: 'Quick flips on newly launched meme coins during US market hours',
    config: {
      buyAmountSol: 0.01,
      slippageBps: 800,                // 8% — lowered from 15%
      priorityFee: 500_000,            // Faster execution
      momentumWindowMs: 5_000,         // 5 sec — buy fast
      minUniqueBuyers: 3,
      minBuySellRatio: 2.5,            // Strong buy dominance
      minBuyVolumeSol: 0.3,
      stopLossPercent: -12,            // Tight stop
      takeProfitPercent: 50,           // Take at +50%
      enableTieredExits: false,        // Sell 100% at target
      maxPositionAgeMs: 180_000,       // 3 min max hold
      stalePriceTimeoutMs: 60_000,     // 1 min dead coin exit
      trailingStopActivatePercent: 15, // Trail early
      trailingStopPercent: -8,         // Tight trail
      autoBuyPumpFun: true,
      autoBuyTrending: false,
      enableRugCheck: true,
      minRugCheckScore: 600,
      maxTopHolderPct: 30,
      buyCooldownMs: 15_000,           // 15 sec between buys
      maxOpenPositions: 5,
      consecutiveLossPauseThreshold: 5,
      consecutiveLossPauseMs: 300_000,
      maxDailyLossSol: 0.1,
      enableAntiRug: true,
      enableJito: false,
      useAiSignals: false,
      enableDynamicSizing: false,
    },
  },

  {
    name: 'Moonshot Hunter',
    description: 'Highly selective entries, wide stops, let winners run to 10-50x. Accepts frequent small losses for rare massive gains.',
    category: 'aggressive',
    riskLevel: 'high',
    expectedWinRate: '15-25%',
    bestFor: 'Catching rare moonshots — one 10x covers twenty losses',
    config: {
      buyAmountSol: 0.01,
      slippageBps: 1000,               // 10%
      priorityFee: 300_000,
      momentumWindowMs: 15_000,        // 15 sec — sustained buying
      minUniqueBuyers: 8,              // High bar — real community
      minBuySellRatio: 3.0,            // Strong conviction
      minBuyVolumeSol: 1.5,            // Serious interest
      stopLossPercent: -30,            // Wide stop — give moonshots room
      takeProfitPercent: 1000,         // 10x target
      enableTieredExits: true,
      exitTier1PctGain: 100,           // First take at 2x
      exitTier1SellPct: 20,            // Only sell 20%
      exitTier2PctGain: 300,           // Second at 4x
      exitTier2SellPct: 25,
      exitTier3PctGain: 1000,          // Third at 10x
      exitTier3SellPct: 25,
      exitTier4PctGain: 5000,          // Final at 50x
      exitTier4SellPct: 100,
      maxPositionAgeMs: 1_800_000,     // 30 min
      stalePriceTimeoutMs: 300_000,    // 5 min patience
      trailingStopActivatePercent: 50, // Trail only after +50%
      trailingStopPercent: -20,        // Wide trail
      autoBuyPumpFun: true,
      autoBuyTrending: false,
      enableRugCheck: true,
      minRugCheckScore: 700,           // Strict quality
      maxTopHolderPct: 20,             // No whale risk
      buyCooldownMs: 60_000,           // 60 sec — selective
      maxOpenPositions: 5,
      consecutiveLossPauseThreshold: 8, // Higher threshold — losses are expected
      consecutiveLossPauseMs: 300_000,
      maxDailyLossSol: 0.15,           // Higher daily limit
      enableAntiRug: true,
      enableJito: false,
      useAiSignals: false,
      enableDynamicSizing: false,
    },
  },

  {
    name: 'Steady Grinder',
    description: 'Extreme selectivity, tight stops, quick profits. Only enters on the strongest setups. Capital preservation first.',
    category: 'conservative',
    riskLevel: 'low',
    expectedWinRate: '50-60%',
    bestFor: 'Consistent small gains with minimal drawdown',
    config: {
      buyAmountSol: 0.01,
      slippageBps: 500,                // 5% — tight fills only
      priorityFee: 300_000,
      momentumWindowMs: 20_000,        // 20 sec — sustained momentum
      minUniqueBuyers: 10,             // Very high bar
      minBuySellRatio: 4.0,            // Almost no sellers
      minBuyVolumeSol: 2.0,            // Heavy volume
      stopLossPercent: -10,            // Tight stop
      takeProfitPercent: 30,           // Take at +30%
      enableTieredExits: false,        // Sell 100% at target
      maxPositionAgeMs: 120_000,       // 2 min max
      stalePriceTimeoutMs: 45_000,     // 45 sec no dead weight
      trailingStopActivatePercent: 10, // Trail early at +10%
      trailingStopPercent: -5,         // Very tight trail
      autoBuyPumpFun: true,
      autoBuyTrending: false,
      enableRugCheck: true,
      minRugCheckScore: 700,           // Strict
      maxTopHolderPct: 20,
      maxMarketCapUsd: 50_000,         // Lower cap = more upside
      minBondingCurveSol: 3.0,         // Stronger liquidity
      buyCooldownMs: 45_000,           // Patient
      maxOpenPositions: 3,             // Only best setups
      consecutiveLossPauseThreshold: 3,
      consecutiveLossPauseMs: 300_000,
      maxDailyLossSol: 0.05,           // Low daily limit — protect capital
      enableAntiRug: true,
      enableJito: false,
      useAiSignals: false,
      enableDynamicSizing: false,
    },
  },

  {
    name: 'AI Balanced',
    description: 'AI signal gating with dynamic position sizing. Only buys on 60%+ confidence. Jito MEV protection on larger positions.',
    category: 'ai',
    riskLevel: 'medium',
    expectedWinRate: '40-50%',
    bestFor: 'Smart, adaptive trading that scales with signal quality',
    config: {
      buyAmountSol: 0.01,
      slippageBps: 700,                // 7%
      priorityFee: 400_000,
      momentumWindowMs: 12_000,        // 12 sec for AI scoring
      minUniqueBuyers: 6,
      minBuySellRatio: 2.0,
      minBuyVolumeSol: 1.0,
      stopLossPercent: -15,
      takeProfitPercent: 200,          // +200% — AI picks should run
      enableTieredExits: true,
      exitTier1PctGain: 50,
      exitTier1SellPct: 25,
      exitTier2PctGain: 150,
      exitTier2SellPct: 30,
      exitTier3PctGain: 500,
      exitTier3SellPct: 30,
      exitTier4PctGain: 2000,
      exitTier4SellPct: 100,
      maxPositionAgeMs: 600_000,       // 10 min
      stalePriceTimeoutMs: 90_000,     // 90 sec
      trailingStopActivatePercent: 20,
      trailingStopPercent: -10,
      autoBuyPumpFun: true,
      autoBuyTrending: false,
      enableRugCheck: true,
      minRugCheckScore: 650,
      maxTopHolderPct: 25,
      buyCooldownMs: 20_000,
      maxOpenPositions: 5,
      consecutiveLossPauseThreshold: 5,
      consecutiveLossPauseMs: 300_000,
      maxDailyLossSol: 0.10,
      enableAntiRug: true,
      useAiSignals: true,              // CORE: AI gating
      minSignalConfidence: 60,         // Only 60%+ confidence
      enableDynamicSizing: true,       // CORE: scales with confidence
      maxPositionPct: 0.15,            // Up to 15% wallet
      enableJito: true,                // Protect larger positions
      jitoTipLamports: 500_000,        // 0.0005 SOL tip
    },
  },
] as const;

// ── Public API ──────────────────────────────────────────────────────────

/** Get a single preset by name (case-insensitive) */
export function getPreset(name: string): StrategyPreset | undefined {
  const lower = name.toLowerCase().replace(/[_-]/g, ' ');
  return STRATEGY_PRESETS.find(
    (preset) => preset.name.toLowerCase().replace(/[_-]/g, ' ') === lower,
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
