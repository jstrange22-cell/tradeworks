/**
 * Type 3 Detector: Cross-Platform Arbitrage
 *
 * Same event priced differently on Kalshi vs Polymarket.
 * Buy YES on cheap venue + buy NO on expensive venue → guaranteed profit.
 * Edge: 3-6¢ during volatility. Risk: Settlement rule mismatch.
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedMarket, DetectorResult } from '../models.js';
import { calculateNetProfit } from '../fee-calculator.js';

const DETECTOR_TYPE = 'type3_cross_platform' as const;

interface MatchedPair {
  kalshi: NormalizedMarket;
  polymarket: NormalizedMarket;
  matchConfidence: number;
}

/**
 * Match Kalshi and Polymarket markets that cover the same event.
 * Uses title similarity — market-matcher.ts handles the heavy lifting.
 */
function findMatchedPairs(
  kalshiMarkets: NormalizedMarket[],
  polyMarkets: NormalizedMarket[],
): MatchedPair[] {
  const pairs: MatchedPair[] = [];

  for (const k of kalshiMarkets) {
    const kTitle = k.title.toLowerCase();
    for (const p of polyMarkets) {
      const pTitle = p.title.toLowerCase();

      // Simple keyword overlap scoring
      const kWords = new Set(kTitle.split(/\s+/).filter(w => w.length > 3));
      const pWords = new Set(pTitle.split(/\s+/).filter(w => w.length > 3));
      const overlap = [...kWords].filter(w => pWords.has(w)).length;
      const maxWords = Math.max(kWords.size, pWords.size, 1);
      const similarity = overlap / maxWords;

      // Also check category match
      const sameCategory = k.category.toLowerCase() === p.category.toLowerCase();

      if (similarity > 0.4 || (sameCategory && similarity > 0.25)) {
        pairs.push({
          kalshi: k,
          polymarket: p,
          matchConfidence: Math.min(similarity + (sameCategory ? 0.2 : 0), 1.0),
        });
      }
    }
  }

  return pairs;
}

export async function scanType3(
  kalshiMarkets: NormalizedMarket[],
  polyMarkets: NormalizedMarket[],
  minCents = 5.0,
): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  const pairs = findMatchedPairs(kalshiMarkets, polyMarkets);

  for (const pair of pairs) {
    const { kalshi: k, polymarket: p } = pair;

    // Direction 1: Kalshi YES + Polymarket NO
    const cost1 = (k.yesAsk || k.yesPrice) + (1.0 - (p.yesPrice));
    // Direction 2: Polymarket YES + Kalshi NO
    const cost2 = (p.yesPrice) + (k.noAsk || k.noPrice);

    // Check direction 1
    if (cost1 < 1.0) {
      const spreadCents = (1.0 - cost1) * 100;
      if (spreadCents >= minCents) {
        const qty = Math.min(50, Math.floor(200 / cost1));
        const validation = calculateNetProfit({
          venue_a: 'kalshi',
          price_a: k.yesAsk || k.yesPrice,
          venue_b: 'polymarket',
          price_b: 1.0 - p.yesPrice,
          quantity: qty,
        });

        if (validation.profitable) {
          opportunities.push({
            id: randomUUID(),
            arbType: DETECTOR_TYPE,
            venue_a: 'kalshi',
            ticker_a: k.ticker,
            title_a: k.title,
            side_a: 'yes',
            price_a: k.yesAsk || k.yesPrice,
            venue_b: 'polymarket',
            ticker_b: p.ticker,
            title_b: p.title,
            side_b: 'no',
            price_b: 1.0 - p.yesPrice,
            totalCost: cost1,
            grossProfitPerContract: 1.0 - cost1,
            netProfitPerContract: validation.netProfit / qty,
            fillableQuantity: qty,
            confidence: 0.85 * pair.matchConfidence,
            urgency: spreadCents > 5 ? 'high' : 'medium',
            category: k.category,
            description: `Cross-platform: Kalshi YES $${(k.yesAsk || k.yesPrice).toFixed(3)} + Poly NO $${(1.0 - p.yesPrice).toFixed(3)} = $${cost1.toFixed(3)}`,
            reasoning: `${k.title} vs ${p.title}. Spread ${spreadCents.toFixed(1)}¢. Match conf: ${(pair.matchConfidence * 100).toFixed(0)}%.`,
            detectedAt: new Date().toISOString(),
            sizeMultiplier: 1.0,
            legs: [
              { venue: 'kalshi', ticker: k.ticker, side: 'yes', price: k.yesAsk || k.yesPrice, quantity: qty },
              { venue: 'polymarket', ticker: p.ticker, side: 'no', price: 1.0 - p.yesPrice, quantity: qty },
            ],
          });
        }
      }
    }

    // Check direction 2
    if (cost2 < 1.0) {
      const spreadCents = (1.0 - cost2) * 100;
      if (spreadCents >= minCents) {
        const qty = Math.min(50, Math.floor(200 / cost2));
        const validation = calculateNetProfit({
          venue_a: 'polymarket',
          price_a: p.yesPrice,
          venue_b: 'kalshi',
          price_b: k.noAsk || k.noPrice,
          quantity: qty,
        });

        if (validation.profitable) {
          opportunities.push({
            id: randomUUID(),
            arbType: DETECTOR_TYPE,
            venue_a: 'polymarket',
            ticker_a: p.ticker,
            title_a: p.title,
            side_a: 'yes',
            price_a: p.yesPrice,
            venue_b: 'kalshi',
            ticker_b: k.ticker,
            title_b: k.title,
            side_b: 'no',
            price_b: k.noAsk || k.noPrice,
            totalCost: cost2,
            grossProfitPerContract: 1.0 - cost2,
            netProfitPerContract: validation.netProfit / qty,
            fillableQuantity: qty,
            confidence: 0.85 * pair.matchConfidence,
            urgency: spreadCents > 5 ? 'high' : 'medium',
            category: k.category,
            description: `Cross-platform: Poly YES $${p.yesPrice.toFixed(3)} + Kalshi NO $${(k.noAsk || k.noPrice).toFixed(3)} = $${cost2.toFixed(3)}`,
            reasoning: `${p.title} vs ${k.title}. Spread ${spreadCents.toFixed(1)}¢. Match conf: ${(pair.matchConfidence * 100).toFixed(0)}%.`,
            detectedAt: new Date().toISOString(),
            sizeMultiplier: 1.0,
            legs: [
              { venue: 'polymarket', ticker: p.ticker, side: 'yes', price: p.yesPrice, quantity: qty },
              { venue: 'kalshi', ticker: k.ticker, side: 'no', price: k.noAsk || k.noPrice, quantity: qty },
            ],
          });
        }
      }
    }
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: kalshiMarkets.length + polyMarkets.length,
    durationMs: Date.now() - start,
  };
}
