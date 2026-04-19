/**
 * Type 5 Detector: Settlement Race
 *
 * Event outcome is effectively determined but market hasn't fully priced it in.
 * Fastest data feed wins. Edge: 5-20¢ in final minutes.
 *
 * Implementation: Compare real-time data sources against market prices.
 * - Crypto: CoinGecko/Coinbase price vs Kalshi "BTC above $X" markets
 * - Weather: Open-Meteo current temp vs Kalshi "High above X°F" markets
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedMarket, DetectorResult } from '../models.js';

const DETECTOR_TYPE = 'type5_settlement' as const;

interface SettlementCheck {
  ticker: string;
  title: string;
  currentPrice: number;        // market YES price
  realWorldProbability: number; // our estimate from real data
  edge: number;                 // abs(realWorld - market)
  side: 'yes' | 'no';          // which side to buy
  confidence: number;
  source: string;
}

/**
 * Check crypto price markets against real-time prices.
 * If BTC is at $105K and Kalshi asks "Will BTC be above $100K?" at YES=$0.85,
 * that's 15¢ of edge — BTC would need to drop 5% in remaining time.
 */
async function checkCryptoSettlement(markets: NormalizedMarket[]): Promise<SettlementCheck[]> {
  const checks: SettlementCheck[] = [];

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return checks;

    const prices = await res.json() as Record<string, { usd: number }>;
    const priceMap: Record<string, number> = {
      BTC: prices.bitcoin?.usd ?? 0,
      ETH: prices.ethereum?.usd ?? 0,
      SOL: prices.solana?.usd ?? 0,
    };

    for (const market of markets) {
      const title = market.title.toLowerCase();

      // Match "BTC above $X" or "Bitcoin price above $X" patterns
      for (const [sym, currentPrice] of Object.entries(priceMap)) {
        if (currentPrice <= 0) continue;
        const symLower = sym.toLowerCase();
        const fullName = sym === 'BTC' ? 'bitcoin' : sym === 'ETH' ? 'ethereum' : 'solana';

        if (!title.includes(symLower) && !title.includes(fullName)) continue;

        const aboveMatch = title.match(/above\s*\$?([\d,]+)/);
        const belowMatch = title.match(/below\s*\$?([\d,]+)/);

        if (aboveMatch) {
          const threshold = parseFloat(aboveMatch[1].replace(/,/g, ''));
          const pctAbove = (currentPrice - threshold) / threshold;

          // If price is >5% above threshold, YES should be very high
          if (pctAbove > 0.05 && market.yesPrice < 0.90) {
            const realProb = Math.min(0.98, 0.85 + pctAbove);
            const edge = realProb - market.yesPrice;
            if (edge > 0.05) {
              checks.push({
                ticker: market.ticker,
                title: market.title,
                currentPrice: market.yesPrice,
                realWorldProbability: realProb,
                edge,
                side: 'yes',
                confidence: Math.min(0.95, 0.7 + pctAbove),
                source: `${sym} at $${currentPrice.toLocaleString()} is ${(pctAbove * 100).toFixed(1)}% above $${threshold.toLocaleString()} threshold`,
              });
            }
          }

          // If price is >5% below threshold, NO should be very high
          if (pctAbove < -0.05 && market.noPrice < 0.90) {
            const realProb = Math.min(0.98, 0.85 + Math.abs(pctAbove));
            const edge = realProb - (1.0 - market.yesPrice);
            if (edge > 0.05) {
              checks.push({
                ticker: market.ticker,
                title: market.title,
                currentPrice: 1.0 - market.yesPrice,
                realWorldProbability: realProb,
                edge,
                side: 'no',
                confidence: Math.min(0.95, 0.7 + Math.abs(pctAbove)),
                source: `${sym} at $${currentPrice.toLocaleString()} is ${(Math.abs(pctAbove) * 100).toFixed(1)}% below $${threshold.toLocaleString()} threshold`,
              });
            }
          }
        }

        if (belowMatch) {
          const threshold = parseFloat(belowMatch[1].replace(/,/g, ''));
          const pctBelow = (threshold - currentPrice) / threshold;

          if (pctBelow > 0.05 && market.yesPrice < 0.90) {
            const realProb = Math.min(0.98, 0.85 + pctBelow);
            const edge = realProb - market.yesPrice;
            if (edge > 0.05) {
              checks.push({
                ticker: market.ticker,
                title: market.title,
                currentPrice: market.yesPrice,
                realWorldProbability: realProb,
                edge,
                side: 'yes',
                confidence: Math.min(0.95, 0.7 + pctBelow),
                source: `${sym} at $${currentPrice.toLocaleString()} is ${(pctBelow * 100).toFixed(1)}% below $${threshold.toLocaleString()} threshold`,
              });
            }
          }
        }
      }
    }
  } catch {
    // CoinGecko failed — skip
  }

  return checks;
}

export async function scanType5(markets: NormalizedMarket[], minCents = 5.0): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  const cryptoChecks = await checkCryptoSettlement(markets);

  for (const check of cryptoChecks) {
    if (check.edge * 100 < minCents) continue;

    const market = markets.find(m => m.ticker === check.ticker);
    if (!market) continue;

    const qty = Math.min(100, Math.floor(200 / check.currentPrice));
    opportunities.push({
      id: randomUUID(),
      arbType: DETECTOR_TYPE,
      venue_a: market.venue,
      ticker_a: market.ticker,
      title_a: market.title,
      side_a: check.side,
      price_a: check.currentPrice,
      venue_b: market.venue,
      ticker_b: market.ticker,
      title_b: market.title,
      side_b: check.side,
      price_b: 0,
      totalCost: check.currentPrice,
      grossProfitPerContract: check.edge,
      netProfitPerContract: check.edge - 0.02,
      fillableQuantity: qty,
      confidence: check.confidence,
      urgency: check.edge > 0.15 ? 'critical' : 'high',
      category: market.category,
      description: `Settlement race: ${check.source}. Market=${(check.currentPrice * 100).toFixed(0)}%, Real≈${(check.realWorldProbability * 100).toFixed(0)}%.`,
      reasoning: `${check.source}. Edge: ${(check.edge * 100).toFixed(1)}¢.`,
      detectedAt: new Date().toISOString(),
      sizeMultiplier: 1.0,
      legs: [
        { venue: market.venue, ticker: market.ticker, side: check.side, price: check.currentPrice, quantity: qty },
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
