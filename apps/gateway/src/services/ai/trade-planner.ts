/**
 * AI Trade Planner — Phase 7
 *
 * Generates structured, human-readable trade plans from TradeSignal data.
 * Pure template-based text generation — NO external LLM API calls.
 */

import type { TradeSignal } from './signal-generator.js';

// ── Public Types ──────────────────────────────────────────────────────

export interface TradePlan {
  mint: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  summary: string;
  analysis: string[];
  riskAssessment: string;
  recommendation: string;
  timestamp: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function qualityLabel(quality: string): string {
  const labels: Record<string, string> = {
    PRIME: 'PRIME',
    STANDARD: 'STANDARD',
    SPECULATIVE: 'SPECULATIVE',
    REJECTED: 'REJECTED',
  };
  return labels[quality] ?? quality;
}

function regimeLabel(regime: string): string {
  const labels: Record<string, string> = {
    trending_up: 'Trending Up',
    trending_down: 'Trending Down',
    ranging: 'Ranging / Sideways',
    high_volatility: 'High Volatility',
    low_volatility: 'Low Volatility',
  };
  return labels[regime] ?? regime;
}

function riskLevel(confidence: number): string {
  if (confidence >= 75) return 'LOW';
  if (confidence >= 55) return 'MODERATE';
  if (confidence >= 35) return 'HIGH';
  return 'EXTREME';
}

function formatPrice(price: number): string {
  if (price === 0) return '$0';
  if (price < 0.000001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(8)}`;
  if (price < 1) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(4)}`;
}

function slChangePercent(entry: number, target: number): string {
  if (entry <= 0) return '0%';
  const pct = ((target - entry) / entry) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

// ── Main Generator ────────────────────────────────────────────────────

export function generateTradePlan(signal: TradeSignal): TradePlan {
  const { mint, symbol, confidence, quality, direction, entry } = signal;
  const { stopLoss, takeProfits, riskRewardRatio } = signal;
  const [tp1, tp2, tp3] = takeProfits;

  // Summary line
  const actionUpper = direction.toUpperCase();
  const summary =
    `${actionUpper} Signal for ${symbol} — confidence ${confidence}/100 (${qualityLabel(quality)}). ` +
    `${buildSummaryDetail(signal)}`;

  // Detailed analysis bullets
  const analysis = buildAnalysisBullets(signal);

  // Risk assessment
  const risk = riskLevel(confidence);
  const riskAssessment =
    `Risk Level: ${risk}. ` +
    `Stop loss at ${formatPrice(stopLoss)} (${slChangePercent(entry, stopLoss)}), ` +
    `TP1 at ${formatPrice(tp1)} (${slChangePercent(entry, tp1)}), ` +
    `TP2 at ${formatPrice(tp2)} (${slChangePercent(entry, tp2)}), ` +
    `TP3 at ${formatPrice(tp3)} (${slChangePercent(entry, tp3)}). ` +
    `R:R ratio ${riskRewardRatio.toFixed(1)}.`;

  // Recommendation
  const recommendation = buildRecommendation(signal);

  return {
    mint,
    symbol,
    action: direction,
    summary,
    analysis,
    riskAssessment,
    recommendation,
    timestamp: new Date().toISOString(),
  };
}

// ── Template Builders ─────────────────────────────────────────────────

function buildSummaryDetail(signal: TradeSignal): string {
  const parts: string[] = [];

  if (signal.taScore >= 60) parts.push('strong TA indicators');
  else if (signal.taScore >= 40) parts.push('moderate TA signals');
  else parts.push('weak TA signals');

  if (signal.securityScore >= 70) parts.push('clean security profile');
  else if (signal.securityScore >= 40) parts.push('mixed security flags');
  else parts.push('security concerns detected');

  if (signal.sentimentScore > 20) parts.push('positive sentiment');
  else if (signal.sentimentScore > -20) parts.push('neutral sentiment');
  else parts.push('negative sentiment');

  return parts.join(', ') + '.';
}

function buildAnalysisBullets(signal: TradeSignal): string[] {
  const bullets: string[] = [];

  // TA analysis
  const taDetail = signal.reasoning.find((r) => r.startsWith('TA score') || r.startsWith('TA unavailable'));
  bullets.push(
    `Technical Analysis (${signal.taScore}/100): ${taDetail ?? `Score ${signal.taScore}/100`}. ` +
    `Market regime: ${signal.regime}.`,
  );

  // Security analysis
  const secDetail = signal.reasoning.find((r) => r.startsWith('Security score') || r.startsWith('Security check'));
  bullets.push(
    `Security (${signal.securityScore}/100): ${secDetail ?? `Score ${signal.securityScore}/100`}.`,
  );

  // Momentum analysis
  const momDetail = signal.reasoning.find((r) => r.startsWith('Momentum score'));
  bullets.push(
    `Momentum (${signal.momentumScore}/100): ${momDetail ?? `Score ${signal.momentumScore}/100`}.`,
  );

  // Sentiment analysis
  const sentDetail = signal.reasoning.find((r) => r.startsWith('Sentiment score') || r.startsWith('Sentiment analysis'));
  bullets.push(
    `Sentiment (${signal.sentimentScore}): ${sentDetail ?? `Score ${signal.sentimentScore}`}.`,
  );

  // Risk line
  const [tp1, tp2, tp3] = signal.takeProfits;
  bullets.push(
    `Risk: Stop loss at ${formatPrice(signal.stopLoss)} (${slChangePercent(signal.entry, signal.stopLoss)}), ` +
    `TP1 at ${formatPrice(tp1)} (${slChangePercent(signal.entry, tp1)}), ` +
    `TP2 at ${formatPrice(tp2)} (${slChangePercent(signal.entry, tp2)}), ` +
    `TP3 at ${formatPrice(tp3)} (${slChangePercent(signal.entry, tp3)}). ` +
    `R:R ratio ${signal.riskRewardRatio.toFixed(1)}.`,
  );

  return bullets;
}

function buildRecommendation(signal: TradeSignal): string {
  if (signal.quality === 'REJECTED') {
    return `SKIP ${signal.symbol} — signal rejected (confidence ${signal.confidence}/100). Do not enter this trade.`;
  }

  if (signal.direction === 'hold') {
    return `HOLD on ${signal.symbol} — conditions unclear (confidence ${signal.confidence}/100). Wait for stronger confirmation.`;
  }

  if (signal.direction === 'sell') {
    return `SELL pressure on ${signal.symbol} — confidence ${signal.confidence}/100. Consider reducing or exiting position.`;
  }

  const regimeStr = regimeLabel(signal.regime);
  if (signal.quality === 'PRIME') {
    return `STRONG BUY ${signal.symbol} — prime quality signal (${signal.confidence}/100) in ${regimeStr} regime. Full position recommended.`;
  }

  if (signal.quality === 'STANDARD') {
    return `BUY ${signal.symbol} — standard quality signal (${signal.confidence}/100) in ${regimeStr} regime. Partial position recommended.`;
  }

  return `SPECULATIVE BUY ${signal.symbol} — confidence ${signal.confidence}/100 in ${regimeStr} regime. Small position only, tight stops.`;
}
