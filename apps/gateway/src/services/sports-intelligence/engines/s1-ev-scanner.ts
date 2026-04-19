/**
 * S1: +EV Scanner — Primary Sports Money Maker
 *
 * De-vigs Pinnacle (sharpest book) to get true probabilities.
 * Compares against soft books (DraftKings, FanDuel, BetMGM, etc.)
 * If EV > 3% → signal for paper trade.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getOddsWithPinnacle, extractPinnacleOdds, extractSoftBookOdds } from '../odds-api-client.js';
import { deVig2Way, americanToDecimal, calculateEV } from '../ev-calculator.js';
import type { SportsOpportunity } from '../sports-models.js';

export async function scanEV(sports: string[], minEvPct = 0.03): Promise<SportsOpportunity[]> {
  const opportunities: SportsOpportunity[] = [];

  for (const sport of sports) {
    try {
      const events = await getOddsWithPinnacle(sport, 'h2h');

      for (const event of events) {
        const pinnacle = extractPinnacleOdds(event, 'h2h');
        if (!pinnacle) continue; // No Pinnacle line — can't benchmark

        const deVigged = deVig2Way(pinnacle.homeOdds, pinnacle.awayOdds);
        const softBooks = extractSoftBookOdds(event, 'h2h');

        for (const book of softBooks) {
          // Check home side
          const homeEV = calculateEV(deVigged.trueHome, book.homeDecimal);
          if (homeEV >= minEvPct) {
            opportunities.push({
              id: randomUUID(),
              engine: 'S1',
              type: 'sports_ev',
              sport,
              eventId: event.id,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              commenceTime: event.commence_time,
              market: 'h2h',
              side: 'home',
              softBookOdds: book.homeOdds,
              softBookDecimal: book.homeDecimal,
              softBook: book.book,
              pinnacleOdds: pinnacle.homeOdds,
              pinnacleDecimal: americanToDecimal(pinnacle.homeOdds),
              trueProb: deVigged.trueHome,
              evPct: homeEV,
              suggestedSize: 0, // Calculated by Kelly sizer
              maxSize: 200,
              confidence: Math.min(90, 50 + homeEV * 500),
              reasoning: `+EV ${(homeEV * 100).toFixed(1)}%: ${event.home_team} ML on ${book.book} (${book.homeOdds > 0 ? '+' : ''}${book.homeOdds}) vs Pinnacle true ${(deVigged.trueHome * 100).toFixed(0)}%`,
              detectedAt: new Date().toISOString(),
              expiresAt: event.commence_time,
            });
          }

          // Check away side
          const awayEV = calculateEV(deVigged.trueAway, book.awayDecimal);
          if (awayEV >= minEvPct) {
            opportunities.push({
              id: randomUUID(),
              engine: 'S1',
              type: 'sports_ev',
              sport,
              eventId: event.id,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              commenceTime: event.commence_time,
              market: 'h2h',
              side: 'away',
              softBookOdds: book.awayOdds,
              softBookDecimal: book.awayDecimal,
              softBook: book.book,
              pinnacleOdds: pinnacle.awayOdds,
              pinnacleDecimal: americanToDecimal(pinnacle.awayOdds),
              trueProb: deVigged.trueAway,
              evPct: awayEV,
              suggestedSize: 0,
              maxSize: 200,
              confidence: Math.min(90, 50 + awayEV * 500),
              reasoning: `+EV ${(awayEV * 100).toFixed(1)}%: ${event.away_team} ML on ${book.book} (${book.awayOdds > 0 ? '+' : ''}${book.awayOdds}) vs Pinnacle true ${(deVigged.trueAway * 100).toFixed(0)}%`,
              detectedAt: new Date().toISOString(),
              expiresAt: event.commence_time,
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ sport, err: err instanceof Error ? err.message : err }, '[S1] Scan failed for sport');
    }
  }

  // Sort by EV descending
  opportunities.sort((a, b) => b.evPct - a.evPct);

  logger.info(
    { sports: sports.length, opportunities: opportunities.length },
    `[S1 +EV] Found ${opportunities.length} +EV opportunities across ${sports.length} sports`,
  );

  return opportunities;
}
