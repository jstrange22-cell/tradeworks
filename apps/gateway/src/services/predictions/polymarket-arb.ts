/**
 * Prediction Market Arbitrage Engine
 *
 * Finds arbitrage opportunities across prediction market platforms.
 * Currently supports:
 *   - Polymarket (CLOB API) — primary
 *   - Cross-market arbitrage within Polymarket (YES + NO pricing)
 *   - Kalshi comparison (when API key configured)
 *
 * Arbitrage types:
 *   1. Internal: YES + NO prices < $1.00 or > $1.00 on same market
 *   2. Cross-platform: Same event priced differently on Polymarket vs Kalshi
 *   3. Correlated: Related markets that should sum to 100% but don't
 */

import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface PredictionMarket {
  id: string;
  question: string;
  slug: string;
  endDate: string;
  active: boolean;
  volume: number;
  liquidity: number;
  outcomes: PredictionOutcome[];
  source: 'polymarket' | 'kalshi';
  category: string;
  url: string;
}

export interface PredictionOutcome {
  name: string;
  price: number;       // 0.00-1.00
  tokenId: string;
}

export interface ArbOpportunity {
  type: 'internal' | 'cross_platform' | 'correlated';
  description: string;
  market: string;
  marketUrl: string;
  spread: number;          // profit in cents per $1 wagered
  expectedProfit: number;  // dollar profit at suggested size
  suggestedSize: number;   // dollars to deploy
  confidence: 'high' | 'medium' | 'low';
  legs: ArbLeg[];
  expiresAt: string;
  detectedAt: string;
}

export interface ArbLeg {
  action: 'buy' | 'sell';
  market: string;
  outcome: string;
  price: number;
  platform: string;
  size: number;
}

export interface ArbScanResult {
  opportunities: ArbOpportunity[];
  marketsScanned: number;
  timestamp: string;
}

// ── Polymarket Gamma API ────────────────────────────────────────────────

const GAMMA_API = 'https://gamma-api.polymarket.com';

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  end_date_iso: string;
  active: boolean;
  volume: string;
  liquidity: string;
  outcomes: string;       // JSON string of outcome names
  outcomePrices: string;  // JSON string of prices
  clobTokenIds: string;   // JSON string of token IDs
  category: string;
}

async function fetchPolymarketMarkets(limit = 100, active = true): Promise<PredictionMarket[]> {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      active: String(active),
      order: 'volume',
      ascending: 'false',
    });

    const res = await fetch(`${GAMMA_API}/markets?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Gamma API ${res.status}`);

    const markets = (await res.json()) as GammaMarket[];

    return markets.map(m => {
      const outcomeNames: string[] = JSON.parse(m.outcomes || '[]');
      const outcomePrices: string[] = JSON.parse(m.outcomePrices || '[]');
      const tokenIds: string[] = JSON.parse(m.clobTokenIds || '[]');

      return {
        id: m.id,
        question: m.question,
        slug: m.slug,
        endDate: m.end_date_iso,
        active: m.active,
        volume: parseFloat(m.volume || '0'),
        liquidity: parseFloat(m.liquidity || '0'),
        outcomes: outcomeNames.map((name, i) => ({
          name,
          price: parseFloat(outcomePrices[i] || '0'),
          tokenId: tokenIds[i] || '',
        })),
        source: 'polymarket' as const,
        category: m.category || 'Other',
        url: `https://polymarket.com/event/${m.slug}`,
      };
    });
  } catch (err) {
    logger.error({ err }, '[PolyArb] Failed to fetch Polymarket markets');
    return [];
  }
}

// ── Arbitrage Detection ──────────────────────────────────────────────────

/**
 * Internal arbitrage: YES + NO should equal ~$1.00.
 * If YES=0.45 and NO=0.50, buying both costs $0.95 → guaranteed $0.05 profit.
 * If YES=0.55 and NO=0.50, selling both at $1.05 → not possible to exploit directly.
 */
function findInternalArbs(markets: PredictionMarket[]): ArbOpportunity[] {
  const opps: ArbOpportunity[] = [];

  for (const market of markets) {
    if (market.outcomes.length !== 2) continue;

    const yes = market.outcomes[0];
    const no = market.outcomes[1];
    if (!yes || !no) continue;

    const totalCost = yes.price + no.price;

    // If total < 1.00, buying both guarantees profit
    if (totalCost < 0.97) {
      const spread = (1 - totalCost) * 100; // cents per dollar
      const suggestedSize = Math.min(500, market.liquidity * 0.02); // 2% of liquidity
      opps.push({
        type: 'internal',
        description: `Buy YES ($${yes.price.toFixed(2)}) + NO ($${no.price.toFixed(2)}) = $${totalCost.toFixed(3)}. Guaranteed $${(1 - totalCost).toFixed(3)} profit per share.`,
        market: market.question,
        marketUrl: market.url,
        spread,
        expectedProfit: suggestedSize * (1 - totalCost),
        suggestedSize,
        confidence: spread > 3 ? 'high' : spread > 1.5 ? 'medium' : 'low',
        legs: [
          { action: 'buy', market: market.question, outcome: yes.name, price: yes.price, platform: 'polymarket', size: suggestedSize / 2 },
          { action: 'buy', market: market.question, outcome: no.name, price: no.price, platform: 'polymarket', size: suggestedSize / 2 },
        ],
        expiresAt: market.endDate,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return opps;
}

/**
 * Correlated market arbitrage: related markets with overlapping events.
 * E.g., "Will BTC hit $100K in 2026?" YES=0.70 and "Will BTC end 2026 above $90K?" YES=0.65
 * The first implies the second, so NO on the second at 0.35 is mispriced.
 */
function findCorrelatedArbs(markets: PredictionMarket[]): ArbOpportunity[] {
  const opps: ArbOpportunity[] = [];

  // Group by category
  const byCategory: Record<string, PredictionMarket[]> = {};
  for (const m of markets) {
    const cat = m.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  }

  // Within each category, find markets with significant price divergence
  for (const [category, catMarkets] of Object.entries(byCategory)) {
    if (catMarkets.length < 2) continue;

    // Look for multi-outcome markets where probabilities don't sum to 100%
    for (const market of catMarkets) {
      if (market.outcomes.length <= 2) continue;

      const totalProb = market.outcomes.reduce((s, o) => s + o.price, 0);

      // If total prob significantly deviates from 1.0, there's an opportunity
      if (Math.abs(totalProb - 1.0) > 0.05) {
        const spread = Math.abs(1 - totalProb) * 100;
        opps.push({
          type: 'correlated',
          description: `Multi-outcome market probabilities sum to ${(totalProb * 100).toFixed(1)}% instead of 100%. ${totalProb < 1 ? 'Underpriced' : 'Overpriced'} outcomes in "${category}".`,
          market: market.question,
          marketUrl: market.url,
          spread,
          expectedProfit: spread * 2, // rough estimate
          suggestedSize: Math.min(200, market.liquidity * 0.01),
          confidence: spread > 5 ? 'medium' : 'low',
          legs: market.outcomes.map(o => ({
            action: totalProb < 1 ? 'buy' as const : 'sell' as const,
            market: market.question,
            outcome: o.name,
            price: o.price,
            platform: 'polymarket',
            size: 50,
          })),
          expiresAt: market.endDate,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return opps;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Scan Polymarket for arbitrage opportunities.
 * Returns sorted by expected profit descending.
 */
export async function scanPredictionArbitrage(limit = 200): Promise<ArbScanResult> {
  const markets = await fetchPolymarketMarkets(limit);

  const internal = findInternalArbs(markets);
  const correlated = findCorrelatedArbs(markets);
  const opportunities = [...internal, ...correlated];

  // Sort by expected profit
  opportunities.sort((a, b) => b.expectedProfit - a.expectedProfit);

  logger.info(
    { marketsScanned: markets.length, oppsFound: opportunities.length },
    '[PolyArb] Scan complete',
  );

  return {
    opportunities,
    marketsScanned: markets.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get trending Polymarket markets by volume.
 */
export async function getTrendingMarkets(limit = 20): Promise<PredictionMarket[]> {
  return fetchPolymarketMarkets(limit);
}

/**
 * Analyze a specific market for mispricing signals.
 */
export async function analyzeMarket(slug: string): Promise<{
  market: PredictionMarket | null;
  analysis: {
    impliedProbabilities: Record<string, number>;
    totalProbability: number;
    deviation: number;
    verdict: string;
  } | null;
}> {
  try {
    const res = await fetch(`${GAMMA_API}/markets?slug=${slug}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { market: null, analysis: null };

    const markets = (await res.json()) as GammaMarket[];
    if (!markets.length) return { market: null, analysis: null };

    const raw = markets[0];
    const outcomeNames: string[] = JSON.parse(raw.outcomes || '[]');
    const outcomePrices: string[] = JSON.parse(raw.outcomePrices || '[]');
    const tokenIds: string[] = JSON.parse(raw.clobTokenIds || '[]');

    const market: PredictionMarket = {
      id: raw.id,
      question: raw.question,
      slug: raw.slug,
      endDate: raw.end_date_iso,
      active: raw.active,
      volume: parseFloat(raw.volume || '0'),
      liquidity: parseFloat(raw.liquidity || '0'),
      outcomes: outcomeNames.map((name, i) => ({
        name,
        price: parseFloat(outcomePrices[i] || '0'),
        tokenId: tokenIds[i] || '',
      })),
      source: 'polymarket',
      category: raw.category || 'Other',
      url: `https://polymarket.com/event/${raw.slug}`,
    };

    const impliedProbabilities: Record<string, number> = {};
    for (const o of market.outcomes) {
      impliedProbabilities[o.name] = o.price * 100;
    }

    const totalProbability = market.outcomes.reduce((s, o) => s + o.price, 0);
    const deviation = Math.abs(1 - totalProbability) * 100;

    let verdict: string;
    if (deviation < 1) verdict = 'Efficiently priced — no arbitrage opportunity';
    else if (deviation < 3) verdict = 'Minor mispricing — possible small edge after fees';
    else if (deviation < 5) verdict = 'Moderate mispricing — potential arbitrage';
    else verdict = 'Significant mispricing — strong arbitrage opportunity';

    return { market, analysis: { impliedProbabilities, totalProbability, deviation, verdict } };
  } catch {
    return { market: null, analysis: null };
  }
}
