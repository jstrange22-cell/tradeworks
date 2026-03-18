/**
 * AI Market Briefing — Phase 7
 *
 * Generates daily market briefings from bot state data.
 * Pure template-based text generation — NO external LLM API calls.
 */

import {
  getAllActivePositions,
  executionHistory,
  sniperTemplates,
} from '../../routes/solana-sniper/state.js';
import { recentSignals } from '../../routes/solana-sniper/monitoring.js';
import type { TradeSignal } from './signal-generator.js';

// ── Public Types ──────────────────────────────────────────────────────

export interface MarketBriefing {
  date: string;
  summary: string;
  portfolio: {
    totalPositions: number;
    totalPnlSol: number;
    totalPnlPercent: number;
    bestPerformer: { symbol: string; pnl: number } | null;
    worstPerformer: { symbol: string; pnl: number } | null;
  };
  tradingActivity: {
    tradesLast24h: number;
    wins: number;
    losses: number;
    winRate: number;
  };
  signalSummary: {
    signalsGenerated: number;
    primeSignals: number;
    standardSignals: number;
    rejectedSignals: number;
  };
  regime: string;
  timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function getRecentSignals(): TradeSignal[] {
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  return recentSignals.filter(
    (s) => new Date(s.timestamp).getTime() > cutoff,
  );
}

function getDominantRegime(signals: TradeSignal[]): string {
  if (signals.length === 0) return 'unknown';

  const counts: Record<string, number> = {};
  for (const signal of signals) {
    const regime = signal.regime;
    counts[regime] = (counts[regime] ?? 0) + 1;
  }

  let maxCount = 0;
  let dominant = 'ranging';
  for (const [regime, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = regime;
    }
  }
  return dominant;
}

// ── Main Generator ────────────────────────────────────────────────────

export function generateBriefing(): MarketBriefing {
  const now = new Date();
  const cutoff = now.getTime() - TWENTY_FOUR_HOURS_MS;

  // Portfolio data
  const positions = getAllActivePositions();
  let totalPnlSol = 0;
  let totalCostSol = 0;
  let bestPerformer: { symbol: string; pnl: number } | null = null;
  let worstPerformer: { symbol: string; pnl: number } | null = null;

  for (const pos of positions) {
    const pnl = pos.pnlPercent;
    totalPnlSol += (pos.buyCostSol ?? 0.005) * (pnl / 100);
    totalCostSol += pos.buyCostSol ?? 0.005;

    if (bestPerformer === null || pnl > bestPerformer.pnl) {
      bestPerformer = { symbol: pos.symbol, pnl };
    }
    if (worstPerformer === null || pnl < worstPerformer.pnl) {
      worstPerformer = { symbol: pos.symbol, pnl };
    }
  }

  const totalPnlPercent = totalCostSol > 0
    ? (totalPnlSol / totalCostSol) * 100
    : 0;

  // Trading activity (last 24h from execution history)
  const recentExecs = executionHistory.filter(
    (e) => new Date(e.timestamp).getTime() > cutoff && e.status === 'success',
  );
  const tradesLast24h = recentExecs.length;

  // Aggregate wins/losses from template stats
  let totalWins = 0;
  let totalLosses = 0;
  for (const template of sniperTemplates.values()) {
    totalWins += template.stats.wins;
    totalLosses += template.stats.losses;
  }
  const totalTrades = totalWins + totalLosses;
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

  // Signal summary (last 24h)
  const recent24hSignals = getRecentSignals();
  const primeSignals = recent24hSignals.filter((s) => s.quality === 'PRIME').length;
  const standardSignals = recent24hSignals.filter((s) => s.quality === 'STANDARD').length;
  const rejectedSignals = recent24hSignals.filter((s) => s.quality === 'REJECTED').length;

  // Dominant regime
  const regime = getDominantRegime(recent24hSignals);

  // Build summary string
  const bestStr = bestPerformer
    ? `Best: ${bestPerformer.symbol} (${bestPerformer.pnl >= 0 ? '+' : ''}${bestPerformer.pnl.toFixed(0)}%)`
    : 'No positions';
  const worstStr = worstPerformer
    ? `Worst: ${worstPerformer.symbol} (${worstPerformer.pnl >= 0 ? '+' : ''}${worstPerformer.pnl.toFixed(0)}%)`
    : '';

  const summary =
    `24h Trading Summary: ${tradesLast24h} trades (${totalWins}W/${totalLosses}L, ${winRate.toFixed(0)}% win rate). ` +
    `Portfolio: ${positions.length} open positions, ${totalPnlSol >= 0 ? '+' : ''}${totalPnlSol.toFixed(4)} SOL unrealized. ` +
    `${bestStr}${worstStr ? `, ${worstStr}` : ''}. ` +
    `Market regime: ${regime}. ` +
    `Generated ${recent24hSignals.length} signals (${primeSignals} PRIME, ${standardSignals} STANDARD, ${rejectedSignals} REJECTED).`;

  return {
    date: now.toISOString().split('T')[0] ?? now.toISOString(),
    summary,
    portfolio: {
      totalPositions: positions.length,
      totalPnlSol,
      totalPnlPercent,
      bestPerformer,
      worstPerformer,
    },
    tradingActivity: {
      tradesLast24h,
      wins: totalWins,
      losses: totalLosses,
      winRate,
    },
    signalSummary: {
      signalsGenerated: recent24hSignals.length,
      primeSignals,
      standardSignals,
      rejectedSignals,
    },
    regime,
    timestamp: now.toISOString(),
  };
}
