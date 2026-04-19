/**
 * Type 6 Detector: Latency Arbitrage
 *
 * Same event on two platforms, one updates faster.
 * Buy on the slow one before it catches up.
 * Edge: 2-5¢ closing within seconds. Requires fast execution.
 *
 * Implementation: Track price divergence timestamps between Kalshi and Polymarket
 * for matched markets. When one moves and the other hasn't, signal opportunity.
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedMarket, DetectorResult } from '../models.js';

const DETECTOR_TYPE = 'type6_latency' as const;

// Price history for divergence detection
const priceHistory = new Map<string, { price: number; timestamp: number }[]>();
const MAX_HISTORY = 20;

function recordPrice(key: string, price: number): void {
  if (!priceHistory.has(key)) priceHistory.set(key, []);
  const history = priceHistory.get(key)!;
  history.push({ price, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) history.shift();
}

function getRecentDelta(key: string): { delta: number; ageMs: number } | null {
  const history = priceHistory.get(key);
  if (!history || history.length < 2) return null;
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  return {
    delta: latest.price - prev.price,
    ageMs: latest.timestamp - prev.timestamp,
  };
}

/**
 * Detect latency arbs by comparing recent price movements.
 * If Kalshi moved +5¢ on event X in last scan but Polymarket hasn't,
 * Polymarket is lagging — buy YES on Polymarket before it catches up.
 */
export async function scanType6(
  kalshiMarkets: NormalizedMarket[],
  polyMarkets: NormalizedMarket[],
  minCents = 3.0,
): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  // Record current prices
  for (const m of kalshiMarkets) {
    recordPrice(`kalshi:${m.ticker}`, m.yesPrice);
  }
  for (const m of polyMarkets) {
    recordPrice(`poly:${m.ticker}`, m.yesPrice);
  }

  // Match markets across platforms (simplified — reuses title matching)
  const polyByTitle = new Map<string, NormalizedMarket>();
  for (const p of polyMarkets) {
    const key = p.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    polyByTitle.set(key, p);
  }

  for (const k of kalshiMarkets) {
    const kKey = k.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);

    // Try to find matching polymarket market
    let matchedPoly: NormalizedMarket | undefined;
    for (const [pKey, p] of polyByTitle) {
      // Simple overlap check
      const overlap = [...kKey].filter((c, i) => pKey[i] === c).length / Math.max(kKey.length, 1);
      if (overlap > 0.5) {
        matchedPoly = p;
        break;
      }
    }

    if (!matchedPoly) continue;

    const kalshiDelta = getRecentDelta(`kalshi:${k.ticker}`);
    const polyDelta = getRecentDelta(`poly:${matchedPoly.ticker}`);

    if (!kalshiDelta || !polyDelta) continue;

    // Kalshi moved significantly but Poly didn't
    if (Math.abs(kalshiDelta.delta) > minCents / 100 && Math.abs(polyDelta.delta) < 0.01) {
      const direction = kalshiDelta.delta > 0 ? 'yes' : 'no';
      const buyPrice = direction === 'yes' ? matchedPoly.yesPrice : (1.0 - matchedPoly.yesPrice);
      const expectedMove = Math.abs(kalshiDelta.delta);

      if (expectedMove * 100 >= minCents) {
        opportunities.push({
          id: randomUUID(),
          arbType: DETECTOR_TYPE,
          venue_a: 'polymarket',
          ticker_a: matchedPoly.ticker,
          title_a: matchedPoly.title,
          side_a: direction,
          price_a: buyPrice,
          venue_b: 'kalshi',
          ticker_b: k.ticker,
          title_b: k.title,
          side_b: direction,
          price_b: direction === 'yes' ? k.yesPrice : (1.0 - k.yesPrice),
          totalCost: buyPrice,
          grossProfitPerContract: expectedMove,
          netProfitPerContract: expectedMove - 0.02,
          fillableQuantity: Math.min(100, Math.floor(200 / buyPrice)),
          confidence: 0.70,
          urgency: 'critical', // latency arbs expire fast
          category: k.category,
          description: `Latency: Kalshi moved ${kalshiDelta.delta > 0 ? '+' : ''}${(kalshiDelta.delta * 100).toFixed(1)}¢ but Polymarket hasn't caught up.`,
          reasoning: `Kalshi ${k.ticker} delta=${(kalshiDelta.delta * 100).toFixed(1)}¢ in ${kalshiDelta.ageMs}ms. Polymarket lagging.`,
          detectedAt: new Date().toISOString(),
          sizeMultiplier: 1.0,
          legs: [
            { venue: 'polymarket', ticker: matchedPoly.ticker, side: direction, price: buyPrice, quantity: 50 },
          ],
        });
      }
    }

    // Poly moved but Kalshi didn't (reverse direction)
    if (Math.abs(polyDelta.delta) > minCents / 100 && Math.abs(kalshiDelta.delta) < 0.01) {
      const direction = polyDelta.delta > 0 ? 'yes' : 'no';
      const buyPrice = direction === 'yes' ? k.yesPrice : (1.0 - k.yesPrice);
      const expectedMove = Math.abs(polyDelta.delta);

      if (expectedMove * 100 >= minCents) {
        opportunities.push({
          id: randomUUID(),
          arbType: DETECTOR_TYPE,
          venue_a: 'kalshi',
          ticker_a: k.ticker,
          title_a: k.title,
          side_a: direction,
          price_a: buyPrice,
          venue_b: 'polymarket',
          ticker_b: matchedPoly.ticker,
          title_b: matchedPoly.title,
          side_b: direction,
          price_b: direction === 'yes' ? matchedPoly.yesPrice : (1.0 - matchedPoly.yesPrice),
          totalCost: buyPrice,
          grossProfitPerContract: expectedMove,
          netProfitPerContract: expectedMove - 0.02,
          fillableQuantity: Math.min(100, Math.floor(200 / buyPrice)),
          confidence: 0.70,
          urgency: 'critical',
          category: k.category,
          description: `Latency: Polymarket moved ${polyDelta.delta > 0 ? '+' : ''}${(polyDelta.delta * 100).toFixed(1)}¢ but Kalshi hasn't caught up.`,
          reasoning: `Polymarket ${matchedPoly.ticker} delta=${(polyDelta.delta * 100).toFixed(1)}¢. Kalshi lagging.`,
          detectedAt: new Date().toISOString(),
          sizeMultiplier: 1.0,
          legs: [
            { venue: 'kalshi', ticker: k.ticker, side: direction, price: buyPrice, quantity: 50 },
          ],
        });
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
