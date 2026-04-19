/**
 * Self-Learning Engine — Trade Outcome Analysis & Strategy Optimization
 *
 * Analyzes completed trades to identify patterns and automatically adjust
 * strategy parameters. Runs after every N trades or on a schedule.
 *
 * Learning signals:
 *   1. Win rate by exit type → adjust exit triggers
 *   2. P&L distribution → adjust position sizing
 *   3. Hold time vs outcome → adjust timeouts
 *   4. Momentum gate effectiveness → adjust buyer/volume thresholds
 *   5. Time-of-day performance → adjust active hours
 *   6. Token characteristics → adjust filters
 *
 * All adjustments are bounded (min/max) to prevent runaway optimization.
 */

import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TradeOutcome {
  id: string;
  symbol: string;
  trigger: string;
  pnlSol: number;
  pnlPercent: number;
  holdTimeMs: number;
  buyAmountSol: number;
  templateId: string;
  templateName: string;
  timestamp: string;
  // Momentum gate data at buy time
  uniqueBuyers?: number;
  buySellRatio?: number;
  buyVolumeSol?: number;
  bondingCurveProgress?: number;
  // Sell quality
  fillPercent?: number;
  wasOnBondingCurve?: boolean;
}

export interface LearningInsight {
  parameter: string;
  currentValue: number;
  suggestedValue: number;
  reason: string;
  confidence: number;  // 0-100
  basedOnTrades: number;
}

export interface LearningReport {
  insights: LearningInsight[];
  tradesSinceLastAnalysis: number;
  overallWinRate: number;
  avgPnlPerTrade: number;
  bestExitType: string;
  worstExitType: string;
  optimalHoldTimeMs: number;
  peakTradingHours: number[];
  generatedAt: string;
}

export interface ParameterAdjustment {
  parameter: string;
  oldValue: number;
  newValue: number;
  reason: string;
}

// ── Analysis Functions ───────────────────────────────────────────────────

function analyzeExitTypes(trades: TradeOutcome[]): Map<string, {
  count: number;
  wins: number;
  avgPnl: number;
  totalPnl: number;
}> {
  const byExit = new Map<string, { count: number; wins: number; totalPnl: number }>();

  for (const t of trades) {
    const stats = byExit.get(t.trigger) ?? { count: 0, wins: 0, totalPnl: 0 };
    stats.count++;
    if (t.pnlSol > 0) stats.wins++;
    stats.totalPnl += t.pnlSol;
    byExit.set(t.trigger, stats);
  }

  const result = new Map<string, { count: number; wins: number; avgPnl: number; totalPnl: number }>();
  for (const [exit, stats] of byExit) {
    result.set(exit, {
      ...stats,
      avgPnl: stats.totalPnl / stats.count,
    });
  }
  return result;
}

function analyzeHoldTimes(trades: TradeOutcome[]): {
  optimalHoldMs: number;
  winsByHoldBucket: Map<string, { wins: number; total: number }>;
} {
  const buckets = new Map<string, { wins: number; total: number }>();
  const winHoldTimes: number[] = [];

  for (const t of trades) {
    if (t.holdTimeMs <= 0) continue;

    // Bucket by hold time
    let bucket: string;
    if (t.holdTimeMs < 5_000) bucket = '0-5s';
    else if (t.holdTimeMs < 15_000) bucket = '5-15s';
    else if (t.holdTimeMs < 60_000) bucket = '15-60s';
    else if (t.holdTimeMs < 300_000) bucket = '1-5m';
    else bucket = '5m+';

    const stats = buckets.get(bucket) ?? { wins: 0, total: 0 };
    stats.total++;
    if (t.pnlSol > 0) {
      stats.wins++;
      winHoldTimes.push(t.holdTimeMs);
    }
    buckets.set(bucket, stats);
  }

  const optimalHoldMs = winHoldTimes.length > 0
    ? winHoldTimes.sort((a, b) => a - b)[Math.floor(winHoldTimes.length / 2)]
    : 30_000;

  return { optimalHoldMs, winsByHoldBucket: buckets };
}

function analyzeTimeOfDay(trades: TradeOutcome[]): number[] {
  const hourlyPnl = new Array(24).fill(0);
  const hourlyCounts = new Array(24).fill(0);

  for (const t of trades) {
    const hour = new Date(t.timestamp).getUTCHours();
    hourlyPnl[hour] += t.pnlSol;
    hourlyCounts[hour]++;
  }

  // Find hours with positive average P&L and enough volume
  const peakHours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (hourlyCounts[h] >= 5 && hourlyPnl[h] / hourlyCounts[h] > 0) {
      peakHours.push(h);
    }
  }

  return peakHours.length > 0 ? peakHours : Array.from({ length: 24 }, (_, i) => i);
}

function analyzeMomentumGate(trades: TradeOutcome[]): {
  optimalMinBuyers: number;
  optimalMinRatio: number;
} {
  const withMomentum = trades.filter(t => t.uniqueBuyers !== undefined);
  if (withMomentum.length < 20) {
    return { optimalMinBuyers: 7, optimalMinRatio: 3.0 };
  }

  // Find the buyer count threshold that maximizes win rate
  const buyerThresholds = [3, 5, 7, 10, 15, 20];
  let bestBuyers = 7;
  let bestWinRate = 0;

  for (const threshold of buyerThresholds) {
    const above = withMomentum.filter(t => (t.uniqueBuyers ?? 0) >= threshold);
    if (above.length < 10) continue;
    const winRate = above.filter(t => t.pnlSol > 0).length / above.length;
    if (winRate > bestWinRate) {
      bestWinRate = winRate;
      bestBuyers = threshold;
    }
  }

  // Find optimal buy/sell ratio
  const ratioThresholds = [2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
  let bestRatio = 3.0;
  let bestRatioWr = 0;

  for (const threshold of ratioThresholds) {
    const above = withMomentum.filter(t => (t.buySellRatio ?? 0) >= threshold);
    if (above.length < 10) continue;
    const winRate = above.filter(t => t.pnlSol > 0).length / above.length;
    if (winRate > bestRatioWr) {
      bestRatioWr = winRate;
      bestRatio = threshold;
    }
  }

  return { optimalMinBuyers: bestBuyers, optimalMinRatio: bestRatio };
}

// ── Main Learning Engine ─────────────────────────────────────────────────

export function generateLearningReport(trades: TradeOutcome[]): LearningReport {
  if (trades.length < 10) {
    return {
      insights: [],
      tradesSinceLastAnalysis: trades.length,
      overallWinRate: 0,
      avgPnlPerTrade: 0,
      bestExitType: 'none',
      worstExitType: 'none',
      optimalHoldTimeMs: 30_000,
      peakTradingHours: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const exitAnalysis = analyzeExitTypes(trades);
  const holdAnalysis = analyzeHoldTimes(trades);
  const peakHours = analyzeTimeOfDay(trades);
  const momentumAnalysis = analyzeMomentumGate(trades);

  const wins = trades.filter(t => t.pnlSol > 0).length;
  const overallWinRate = (wins / trades.length) * 100;
  const avgPnlPerTrade = trades.reduce((s, t) => s + t.pnlSol, 0) / trades.length;

  // Find best/worst exit types
  let bestExitType = 'none';
  let bestExitPnl = -Infinity;
  let worstExitType = 'none';
  let worstExitPnl = Infinity;

  for (const [exit, stats] of exitAnalysis) {
    if (stats.count >= 5) {
      if (stats.avgPnl > bestExitPnl) { bestExitPnl = stats.avgPnl; bestExitType = exit; }
      if (stats.avgPnl < worstExitPnl) { worstExitPnl = stats.avgPnl; worstExitType = exit; }
    }
  }

  // Generate insights
  const insights: LearningInsight[] = [];

  // Insight: no_pump exit is too costly → tighten timeout
  const noPumpStats = exitAnalysis.get('no_pump');
  if (noPumpStats && noPumpStats.avgPnl < -0.02 && noPumpStats.count >= 5) {
    insights.push({
      parameter: 'noPumpExitMs',
      currentValue: 180_000,
      suggestedValue: 120_000,
      reason: `no_pump exits average ${noPumpStats.avgPnl.toFixed(4)} SOL loss over ${noPumpStats.count} trades. Tighter timeout reduces exposure.`,
      confidence: Math.min(90, noPumpStats.count * 3),
      basedOnTrades: noPumpStats.count,
    });
  }

  // Insight: stale_price exits → reduce stale timeout
  const staleStats = exitAnalysis.get('stale_price');
  if (staleStats && staleStats.avgPnl < -0.03 && staleStats.count >= 3) {
    insights.push({
      parameter: 'stalePriceTimeoutMs',
      currentValue: 600_000,
      suggestedValue: 120_000,
      reason: `stale_price exits average ${staleStats.avgPnl.toFixed(4)} SOL loss. Faster stale detection reduces losses on dead tokens.`,
      confidence: Math.min(85, staleStats.count * 5),
      basedOnTrades: staleStats.count,
    });
  }

  // Insight: momentum gate optimization
  insights.push({
    parameter: 'minUniqueBuyers',
    currentValue: 7,
    suggestedValue: momentumAnalysis.optimalMinBuyers,
    reason: `Optimal buyer threshold is ${momentumAnalysis.optimalMinBuyers} based on win rate analysis of ${trades.length} trades.`,
    confidence: trades.length >= 100 ? 75 : 50,
    basedOnTrades: trades.length,
  });

  insights.push({
    parameter: 'minBuySellRatio',
    currentValue: 3.0,
    suggestedValue: momentumAnalysis.optimalMinRatio,
    reason: `Optimal buy/sell ratio is ${momentumAnalysis.optimalMinRatio} based on win rate analysis.`,
    confidence: trades.length >= 100 ? 70 : 45,
    basedOnTrades: trades.length,
  });

  // Insight: take profit level
  const tpStats = exitAnalysis.get('take_profit');
  if (tpStats && tpStats.avgPnl < 0) {
    insights.push({
      parameter: 'takeProfitPercent',
      currentValue: 100,
      suggestedValue: 50,
      reason: `Take profit exits are net negative (avg ${tpStats.avgPnl.toFixed(4)} SOL). Lower TP target to take profits faster before slippage erodes gains.`,
      confidence: Math.min(80, tpStats.count),
      basedOnTrades: tpStats.count,
    });
  }

  // Insight: stop loss level
  const slStats = exitAnalysis.get('stop_loss');
  if (slStats && slStats.count > wins * 0.3) {
    insights.push({
      parameter: 'stopLossPercent',
      currentValue: -35,
      suggestedValue: -25,
      reason: `Stop losses account for ${slStats.count}/${trades.length} trades. Tighter stops reduce per-trade losses.`,
      confidence: 60,
      basedOnTrades: slStats.count,
    });
  }

  return {
    insights,
    tradesSinceLastAnalysis: trades.length,
    overallWinRate,
    avgPnlPerTrade,
    bestExitType,
    worstExitType,
    optimalHoldTimeMs: holdAnalysis.optimalHoldMs,
    peakTradingHours: peakHours,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Apply learning insights to a template config.
 * Returns the adjustments made (for logging/review).
 * Only applies high-confidence insights (>60%).
 */
export function applyInsights(
  insights: LearningInsight[],
  currentConfig: Record<string, number>,
  autoApplyThreshold = 70,
): ParameterAdjustment[] {
  const adjustments: ParameterAdjustment[] = [];

  for (const insight of insights) {
    if (insight.confidence < autoApplyThreshold) continue;
    if (insight.suggestedValue === insight.currentValue) continue;

    // Bounded adjustments — never change more than 30% at once
    const maxChange = insight.currentValue * 0.3;
    const delta = insight.suggestedValue - insight.currentValue;
    const boundedDelta = Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(maxChange));
    const newValue = insight.currentValue + boundedDelta;

    const current = currentConfig[insight.parameter];
    if (current === undefined) continue;

    adjustments.push({
      parameter: insight.parameter,
      oldValue: current,
      newValue: Math.round(newValue * 100) / 100,
      reason: insight.reason,
    });

    currentConfig[insight.parameter] = Math.round(newValue * 100) / 100;
  }

  if (adjustments.length > 0) {
    logger.info(
      { adjustments: adjustments.length },
      `[SelfLearning] Applied ${adjustments.length} parameter adjustments`,
    );
  }

  return adjustments;
}
