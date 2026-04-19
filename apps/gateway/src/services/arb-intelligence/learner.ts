/**
 * Arb Learner — Post-Trade Analysis + Parameter Optimization
 *
 * Tracks win/loss/PnL by arb type.
 * Auto-adjusts thresholds based on performance.
 * After 5 consecutive losses on any type → pause 1 hour.
 */

import { logger } from '../../lib/logger.js';
import type { ArbType, ArbTypeStats, LearnerReport, ArbConfig } from './models.js';

interface TradeRecord {
  arbType: ArbType;
  pnl: number;
  timestamp: string;
}

const tradeHistory: TradeRecord[] = [];
const typeStats = new Map<ArbType, { wins: number; losses: number; totalPnl: number; consecutiveLosses: number; pausedUntil: number }>();
const thresholdAdjustments = new Map<ArbType, number>();

export function recordTradeResult(arbType: ArbType, pnl: number): void {
  tradeHistory.push({ arbType, pnl, timestamp: new Date().toISOString() });

  let stats = typeStats.get(arbType);
  if (!stats) {
    stats = { wins: 0, losses: 0, totalPnl: 0, consecutiveLosses: 0, pausedUntil: 0 };
    typeStats.set(arbType, stats);
  }

  stats.totalPnl += pnl;

  if (pnl > 0) {
    stats.wins++;
    stats.consecutiveLosses = 0;
  } else {
    stats.losses++;
    stats.consecutiveLosses++;

    // Pause after 5 consecutive losses
    if (stats.consecutiveLosses >= 5) {
      stats.pausedUntil = Date.now() + 60 * 60 * 1000; // 1 hour
      logger.warn({ arbType, consecutiveLosses: stats.consecutiveLosses }, '[ArbLearner] Pausing detector for 1 hour after 5 consecutive losses');
    }
  }
}

export function isDetectorPaused(arbType: ArbType): boolean {
  const stats = typeStats.get(arbType);
  if (!stats) return false;
  if (stats.pausedUntil > Date.now()) return true;
  if (stats.pausedUntil > 0 && stats.pausedUntil <= Date.now()) {
    stats.pausedUntil = 0;
    stats.consecutiveLosses = 0;
    logger.info({ arbType }, '[ArbLearner] Detector unpaused');
  }
  return false;
}

/**
 * Auto-adjust thresholds based on performance.
 * >85% win rate → decrease threshold (be more aggressive)
 * <50% win rate → increase threshold (be more selective)
 */
export function updateThresholds(config: ArbConfig): string[] {
  const adjustments: string[] = [];
  const thresholdKeys: Record<ArbType, keyof ArbConfig['thresholds']> = {
    type1_single_rebalance: 'type1MinCents',
    type2_dutch_book: 'type2MinCents',
    type3_cross_platform: 'type3MinCents',
    type4_combinatorial: 'type4MinCents',
    type4_combinatorial_mutex: 'type4MinCents',
    type5_settlement: 'type5MinCents',
    type6_latency: 'type6MinCents',
    type8_exchange_spread: 'type7MinEdgePct',
    type7_options_implied: 'type7MinEdgePct',
    type9_stock_crypto_spread: 'type7MinEdgePct',
  };

  for (const [arbType, stats] of typeStats) {
    const total = stats.wins + stats.losses;
    if (total < 10) continue; // Need at least 10 trades for meaningful adjustment

    const winRate = stats.wins / total;
    const key = thresholdKeys[arbType];
    if (!key) continue;

    const currentThreshold = config.thresholds[key];
    let newThreshold = currentThreshold;

    if (winRate > 0.85) {
      // Very profitable — can be slightly more aggressive
      newThreshold = currentThreshold * 0.9;
      adjustments.push(`${arbType}: lowered threshold from ${currentThreshold.toFixed(1)} to ${newThreshold.toFixed(1)} (win rate ${(winRate * 100).toFixed(0)}%)`);
    } else if (winRate < 0.50) {
      // Losing money — raise threshold
      newThreshold = currentThreshold * 1.2;
      adjustments.push(`${arbType}: raised threshold from ${currentThreshold.toFixed(1)} to ${newThreshold.toFixed(1)} (win rate ${(winRate * 100).toFixed(0)}%)`);
    }

    if (newThreshold !== currentThreshold) {
      (config.thresholds as Record<string, number>)[key] = Math.round(newThreshold * 10) / 10;
      thresholdAdjustments.set(arbType, newThreshold);
    }
  }

  return adjustments;
}

export function getMemoryMultiplier(arbType: ArbType): number {
  const stats = typeStats.get(arbType);
  if (!stats || (stats.wins + stats.losses) < 5) return 1.0;

  const winRate = stats.wins / (stats.wins + stats.losses);
  if (winRate < 0.40) return 0.5; // Half size if winning < 40%
  if (winRate > 0.80) return 1.2; // Slight increase if winning > 80%
  return 1.0;
}

export function getLearnerReport(): LearnerReport {
  const stats: ArbTypeStats[] = [];
  let totalTrades = 0;
  let totalPnl = 0;

  for (const [arbType, s] of typeStats) {
    const total = s.wins + s.losses;
    totalTrades += total;
    totalPnl += s.totalPnl;

    stats.push({
      arbType,
      totalTrades: total,
      wins: s.wins,
      losses: s.losses,
      winRate: total > 0 ? Math.round((s.wins / total) * 100) : 0,
      totalPnl: Math.round(s.totalPnl * 100) / 100,
      avgPnl: total > 0 ? Math.round((s.totalPnl / total) * 100) / 100 : 0,
      currentThreshold: thresholdAdjustments.get(arbType) ?? 0,
    });
  }

  return {
    stats,
    totalTrades,
    totalPnl: Math.round(totalPnl * 100) / 100,
    overallWinRate: totalTrades > 0 ? Math.round((stats.reduce((s, st) => s + st.wins, 0) / totalTrades) * 100) : 0,
    adjustments: [],
    generatedAt: new Date().toISOString(),
  };
}
