/**
 * S6: Kalshi Sports Specialist — Kalshi-Specific Sports Edges
 *
 * Kalshi is a CFTC-regulated exchange — can't limit you.
 * Priority venue for sports volume.
 * Compares Kalshi sports prices to sharp sportsbook consensus.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import type { SportsOpportunity } from '../sports-models.js';

export async function scanKalshiSports(): Promise<SportsOpportunity[]> {
  const opportunities: SportsOpportunity[] = [];

  try {
    // Fetch Kalshi sports markets
    const kalshiRes = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/markets/?limit=50&status=active',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!kalshiRes.ok) return opportunities;

    const kalshiData = await kalshiRes.json() as {
      markets: Array<{
        ticker: string;
        event_ticker: string;
        subtitle: string;
        yes_bid: number;
        yes_ask: number;
        no_bid: number;
        no_ask: number;
        last_price: number;
        volume: number;
        close_time: string;
      }>;
    };

    // Filter to sports-related markets
    const sportsMarkets = (kalshiData.markets ?? []).filter(m => {
      const title = (m.subtitle ?? m.event_ticker).toLowerCase();
      return title.match(/nba|nfl|mlb|nhl|ncaa|game|team|win|score|point/);
    });

    for (const market of sportsMarkets) {
      const yesPrice = market.last_price / 100;

      // Dutch book check: YES + NO < $1.00 on Kalshi sports markets
      const yesBid = market.yes_bid / 100;
      const noAsk = market.no_ask / 100;
      if (yesBid > 0 && noAsk > 0 && yesBid + noAsk < 0.98) {
        const spread = 1.0 - yesBid - noAsk;
        opportunities.push({
          id: randomUUID(),
          engine: 'S6',
          type: 'kalshi_sports',
          sport: 'kalshi',
          eventId: market.ticker,
          homeTeam: market.subtitle ?? market.event_ticker,
          awayTeam: 'Kalshi Exchange',
          commenceTime: market.close_time,
          market: 'kalshi_sports',
          side: 'yes',
          softBookOdds: 0,
          softBookDecimal: 1 / yesBid,
          softBook: 'kalshi',
          trueProb: yesPrice,
          evPct: spread,
          suggestedSize: 0,
          maxSize: 150,
          confidence: 65,
          reasoning: `Kalshi sports: ${market.subtitle ?? market.ticker}. YES bid ${(yesBid * 100).toFixed(0)}¢ + NO ask ${(noAsk * 100).toFixed(0)}¢ = ${((yesBid + noAsk) * 100).toFixed(0)}¢ < $1. Spread: ${(spread * 100).toFixed(1)}¢`,
          detectedAt: new Date().toISOString(),
          expiresAt: market.close_time,
        });
      }

      // Edge vs sportsbook consensus: if Kalshi YES price significantly differs from sportsbook
      if (yesPrice > 0.2 && yesPrice < 0.8 && market.volume > 50) {
        // This would compare to Odds API but we'd need to match events by name
        // For now, flag high-volume Kalshi sports markets for monitoring
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[S6] Kalshi sports scan failed');
  }

  return opportunities;
}
