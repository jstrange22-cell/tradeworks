/**
 * Type 1 Detector: Single-Condition Rebalancing
 *
 * YES + NO < $1.00 on the SAME market, SAME platform.
 * Buy both sides → guaranteed profit on settlement.
 * Edge: 1-3¢. Frequency: Common in thin/new markets. Risk: Very low.
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedMarket, DetectorResult } from '../models.js';
import { calculateNetProfit } from '../fee-calculator.js';

const DETECTOR_TYPE = 'type1_single_rebalance' as const;

export async function scanType1(markets: NormalizedMarket[], minCents = 1.5): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  for (const market of markets) {
    if (market.status !== 'open' && market.status !== 'active') continue;

    const yesPrice = market.yesAsk || market.yesPrice;
    const noPrice = market.noAsk || market.noPrice;
    if (yesPrice <= 0 || noPrice <= 0) continue;
    if (yesPrice >= 1 || noPrice >= 1) continue;

    const totalCost = yesPrice + noPrice;
    const grossSpreadCents = (1.0 - totalCost) * 100;

    if (grossSpreadCents < minCents) continue;

    // Calculate net profit after fees
    const qty = Math.min(100, Math.floor(200 / totalCost));
    const validation = calculateNetProfit({
      venue_a: market.venue,
      price_a: yesPrice,
      venue_b: market.venue,
      price_b: noPrice,
      quantity: qty,
    });

    if (!validation.profitable) continue;

    opportunities.push({
      id: randomUUID(),
      arbType: DETECTOR_TYPE,
      venue_a: market.venue,
      ticker_a: market.ticker,
      title_a: market.title,
      side_a: 'yes',
      price_a: yesPrice,
      venue_b: market.venue,
      ticker_b: market.ticker,
      title_b: market.title,
      side_b: 'no',
      price_b: noPrice,
      totalCost,
      grossProfitPerContract: 1.0 - totalCost,
      netProfitPerContract: validation.netProfit / qty,
      fillableQuantity: qty,
      confidence: 0.95,
      urgency: grossSpreadCents > 3 ? 'critical' : 'high',
      category: market.category,
      description: `Buy YES ($${yesPrice.toFixed(3)}) + NO ($${noPrice.toFixed(3)}) = $${totalCost.toFixed(3)}. Guaranteed $${(1 - totalCost).toFixed(3)}/contract.`,
      reasoning: `Internal arb: total cost $${totalCost.toFixed(3)} < $1.00. Net profit $${validation.netProfit.toFixed(2)} after fees.`,
      detectedAt: new Date().toISOString(),
      sizeMultiplier: 1.0,
      legs: [
        { venue: market.venue, ticker: market.ticker, side: 'yes', price: yesPrice, quantity: qty },
        { venue: market.venue, ticker: market.ticker, side: 'no', price: noPrice, quantity: qty },
      ],
    });
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: markets.length,
    durationMs: Date.now() - start,
  };
}
