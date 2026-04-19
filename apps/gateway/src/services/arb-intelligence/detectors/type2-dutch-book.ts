/**
 * Type 2 Detector: Dutch Book (Multi-Outcome)
 *
 * For events with N mutually exclusive outcomes, the sum of all YES prices
 * should equal $1.00. When sum < $1.00, buy ALL outcomes = guaranteed profit.
 * Edge: 3-8¢. The IMDEA paper found this is chronic on prediction markets.
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedEvent, DetectorResult, ArbLeg } from '../models.js';

const DETECTOR_TYPE = 'type2_dutch_book' as const;

export async function scanType2(events: NormalizedEvent[], minCents = 3.0): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  for (const event of events) {
    if (event.markets.length < 2) continue;

    // Check if markets are mutually exclusive conditions of the same event
    // Sum YES prices across all conditions
    const validMarkets = event.markets.filter(
      m => m.yesAsk > 0 && m.yesAsk < 1 && (m.status === 'open' || m.status === 'active'),
    );
    if (validMarkets.length < 2) continue;

    const totalYes = validMarkets.reduce((sum, m) => sum + (m.yesAsk || m.yesPrice), 0);
    const spreadCents = (1.0 - totalYes) * 100;

    if (spreadCents < minCents) continue;
    if (totalYes >= 1.0) continue; // No arb if sum >= $1.00

    // Buy YES on every condition → one must win → payout $1.00
    const qty = Math.min(50, Math.floor(200 / totalYes));
    const cost = totalYes * qty;
    const payout = 1.0 * qty;
    const netProfit = payout - cost; // Fees are minimal for single-venue dutch book

    if (netProfit <= 0) continue;

    const legs: ArbLeg[] = validMarkets.map(m => ({
      venue: m.venue,
      ticker: m.ticker,
      side: 'yes' as const,
      price: m.yesAsk || m.yesPrice,
      quantity: qty,
    }));

    opportunities.push({
      id: randomUUID(),
      arbType: DETECTOR_TYPE,
      venue_a: event.venue,
      ticker_a: event.eventTicker,
      title_a: event.title,
      side_a: 'yes',
      price_a: totalYes,
      venue_b: event.venue,
      ticker_b: event.eventTicker,
      title_b: event.title,
      side_b: 'yes',
      price_b: 0,
      totalCost: totalYes,
      grossProfitPerContract: 1.0 - totalYes,
      netProfitPerContract: netProfit / qty,
      fillableQuantity: qty,
      confidence: 0.92,
      urgency: spreadCents > 5 ? 'critical' : 'high',
      category: event.category,
      description: `Dutch Book: ${validMarkets.length} outcomes sum to $${totalYes.toFixed(3)} < $1.00. Buy ALL = $${(1.0 - totalYes).toFixed(3)} guaranteed.`,
      reasoning: `${validMarkets.length} mutually exclusive conditions. Sum=$${totalYes.toFixed(3)}, spread=${spreadCents.toFixed(1)}¢.`,
      detectedAt: new Date().toISOString(),
      sizeMultiplier: 1.0,
      legs,
      eventTicker: event.eventTicker,
      conditionsCount: validMarkets.length,
    });
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: events.reduce((s, e) => s + e.markets.length, 0),
    durationMs: Date.now() - start,
  };
}
