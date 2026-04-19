/**
 * Type 4 Detector: Combinatorial / Logical Dependency (LLM-Powered)
 *
 * Logically related markets are inconsistently priced.
 * "Trump wins" at 55% but "Republican wins" at 50% = impossible.
 * The LLM detects the dependency. Top 3 wallets made $4.2M on this.
 * Edge: 5-15¢. Risk: LLM could be wrong.
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedMarket, DetectorResult } from '../models.js';

const DETECTOR_TYPE = 'type4_combinatorial' as const;

export interface DependencyResult {
  relationship: 'implies' | 'implied_by' | 'mutually_exclusive' | 'equivalent' | 'independent';
  confidence: number;
  reasoning: string;
  edgeCases: string[];
}

/**
 * Detect logical dependency between two markets WITHOUT LLM (rule-based fast path).
 * Returns null if no rule-based detection — caller should escalate to LLM.
 */
function ruleBasedDependency(a: NormalizedMarket, b: NormalizedMarket): DependencyResult | null {
  const aTitle = a.title.toLowerCase();
  const bTitle = b.title.toLowerCase();

  // Check for numerical threshold implications
  // "BTC above $100K" implies "BTC above $90K"
  const numPattern = /(?:above|over|exceed|greater than|at least|reach)\s*\$?([\d,.]+)/;
  const aMatch = aTitle.match(numPattern);
  const bMatch = bTitle.match(numPattern);

  if (aMatch && bMatch && a.category === b.category) {
    const aVal = parseFloat(aMatch[1].replace(/,/g, ''));
    const bVal = parseFloat(bMatch[1].replace(/,/g, ''));

    if (aVal > bVal) {
      // "above $100K" implies "above $90K"
      return {
        relationship: 'implies',
        confidence: 0.90,
        reasoning: `"${a.title}" (threshold $${aVal}) implies "${b.title}" (threshold $${bVal}) — higher threshold includes lower.`,
        edgeCases: ['Different measurement periods could invalidate'],
      };
    }
  }

  // Check for "below" threshold implications (reversed)
  const belowPattern = /(?:below|under|less than|drop to)\s*\$?([\d,.]+)/;
  const aBelowMatch = aTitle.match(belowPattern);
  const bBelowMatch = bTitle.match(belowPattern);

  if (aBelowMatch && bBelowMatch && a.category === b.category) {
    const aVal = parseFloat(aBelowMatch[1].replace(/,/g, ''));
    const bVal = parseFloat(bBelowMatch[1].replace(/,/g, ''));

    if (aVal < bVal) {
      // "below $80K" implies "below $90K"
      return {
        relationship: 'implies',
        confidence: 0.90,
        reasoning: `"${a.title}" (threshold $${aVal}) implies "${b.title}" (threshold $${bVal}) — lower threshold includes higher.`,
        edgeCases: ['Different measurement periods could invalidate'],
      };
    }
  }

  return null;
}

/**
 * Scan for combinatorial arb opportunities.
 * Groups markets by category, checks pairs for logical dependencies.
 * Rule-based first, LLM escalation handled by reasoner.ts in the brain pipeline.
 */
export async function scanType4(
  markets: NormalizedMarket[],
  minCents = 5.0,
): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  // Group by category
  const byCategory: Record<string, NormalizedMarket[]> = {};
  for (const m of markets) {
    if (m.status !== 'open' && m.status !== 'active') continue;
    const cat = m.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(m);
  }

  for (const [_category, catMarkets] of Object.entries(byCategory)) {
    if (catMarkets.length < 2) continue;

    // Sort by volume (high volume = more reliable prices)
    catMarkets.sort((a, b) => (b.volume || 0) - (a.volume || 0));

    // Check pairs (limit to top 10 by volume to avoid combinatorial explosion)
    const topMarkets = catMarkets.slice(0, 10);
    for (let i = 0; i < topMarkets.length; i++) {
      for (let j = i + 1; j < topMarkets.length; j++) {
        const a = topMarkets[i];
        const b = topMarkets[j];

        const dep = ruleBasedDependency(a, b);
        if (!dep || dep.relationship === 'independent') continue;
        if (dep.confidence < 0.80) continue;

        const pa = a.yesPrice;
        const pb = b.yesPrice;

        // "A implies B" means P(A) ≤ P(B).
        // If P(A) > P(B) + threshold → arb: sell A, buy B
        if (dep.relationship === 'implies' && pa - pb > minCents / 100) {
          const edge = pa - pb;
          opportunities.push({
            id: randomUUID(),
            arbType: DETECTOR_TYPE,
            venue_a: a.venue,
            ticker_a: a.ticker,
            title_a: a.title,
            side_a: 'no',  // sell A (it's overpriced)
            price_a: 1.0 - pa,
            venue_b: b.venue,
            ticker_b: b.ticker,
            title_b: b.title,
            side_b: 'yes', // buy B (it's underpriced)
            price_b: pb,
            totalCost: (1.0 - pa) + pb,
            grossProfitPerContract: edge,
            netProfitPerContract: edge - 0.02, // rough fee estimate
            fillableQuantity: Math.min(50, Math.floor(200 / ((1.0 - pa) + pb))),
            confidence: dep.confidence * 0.9,
            urgency: edge > 0.10 ? 'critical' : 'high',
            category: a.category,
            description: `Logical: "${a.title}" implies "${b.title}" but P(A)=${(pa * 100).toFixed(0)}% > P(B)=${(pb * 100).toFixed(0)}%`,
            reasoning: dep.reasoning,
            detectedAt: new Date().toISOString(),
            sizeMultiplier: 1.0,
            legs: [
              { venue: a.venue, ticker: a.ticker, side: 'no', price: 1.0 - pa, quantity: 50 },
              { venue: b.venue, ticker: b.ticker, side: 'yes', price: pb, quantity: 50 },
            ],
            marketATitle: a.title,
            marketBTitle: b.title,
            edgeCases: dep.edgeCases,
          });
        }

        // Mutually exclusive: P(A) + P(B) should ≤ 1.0
        if (dep.relationship === 'mutually_exclusive' && pa + pb > 1.0 + minCents / 100) {
          const edge = pa + pb - 1.0;
          opportunities.push({
            id: randomUUID(),
            arbType: 'type4_combinatorial_mutex',
            venue_a: a.venue,
            ticker_a: a.ticker,
            title_a: a.title,
            side_a: 'no',
            price_a: 1.0 - pa,
            venue_b: b.venue,
            ticker_b: b.ticker,
            title_b: b.title,
            side_b: 'no',
            price_b: 1.0 - pb,
            totalCost: (1.0 - pa) + (1.0 - pb),
            grossProfitPerContract: edge,
            netProfitPerContract: edge - 0.02,
            fillableQuantity: 50,
            confidence: dep.confidence * 0.85,
            urgency: 'high',
            category: a.category,
            description: `Mutex: "${a.title}" + "${b.title}" sum to ${((pa + pb) * 100).toFixed(0)}% > 100%`,
            reasoning: dep.reasoning,
            detectedAt: new Date().toISOString(),
            sizeMultiplier: 1.0,
            legs: [
              { venue: a.venue, ticker: a.ticker, side: 'no', price: 1.0 - pa, quantity: 50 },
              { venue: b.venue, ticker: b.ticker, side: 'no', price: 1.0 - pb, quantity: 50 },
            ],
            marketATitle: a.title,
            marketBTitle: b.title,
            edgeCases: dep.edgeCases,
          });
        }
      }
    }
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: markets.length,
    durationMs: Date.now() - start,
  };
}
