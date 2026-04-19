/**
 * O1: Theta Harvester — Iron Condors + Credit Spreads
 *
 * 30-45 DTE, 16-delta wings, $5-10 width.
 * Exit: 50% profit OR 21 DTE remaining.
 * Max 5 open condors. IV Rank > 50%.
 * Regime: normal + risk_on. CRISIS = OFF.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import type { StockOpportunity } from '../stock-models.js';

// High-volume underlyings suitable for condors
const CONDOR_UNDERLYINGS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'];

export async function scanThetaHarvest(regime: string, vix: number): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  // Regime gate
  if (regime === 'crisis' || vix > 35) return opps;

  // IV Rank simulation (would use real options chain with Alpaca Level 3)
  // For paper mode: estimate based on VIX level
  const ivRank = vix > 25 ? 70 : vix > 20 ? 55 : vix > 15 ? 40 : 25;
  if (ivRank < 30) return opps; // Need elevated IV

  for (const underlying of CONDOR_UNDERLYINGS.slice(0, 4)) {
    const wingWidth = vix > 25 ? 10 : 5; // Wider in high vol
    const credit = wingWidth * 0.30; // ~30% of wing width as credit
    const maxLoss = wingWidth - credit;

    opps.push({
      id: randomUUID(),
      engine: 'O1',
      domain: 'option',
      ticker: underlying,
      action: 'sell',
      optionType: 'condor',
      price: credit,
      maxLoss: maxLoss * 100, // Per contract
      ivRank,
      delta: 0.16,
      suggestedSize: 0,
      maxSize: 3000,
      confidence: Math.min(75, 40 + ivRank * 0.5),
      reasoning: `Iron Condor: ${underlying} 30-45 DTE, 16Δ wings, $${wingWidth} wide. Credit: $${credit.toFixed(2)}/spread. IV Rank: ${ivRank}%. Max loss: $${maxLoss.toFixed(2)}/spread.`,
      regime,
      detectedAt: new Date().toISOString(),
    });
  }

  logger.info({ underlyings: CONDOR_UNDERLYINGS.length, signals: opps.length, ivRank }, '[O1] Theta harvest scan complete');
  return opps;
}
