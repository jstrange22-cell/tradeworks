/**
 * S3: Live In-Play — Stale Line Detection During Live Games
 *
 * During live games, some books update lines slower than others.
 * Detects stale lines vs market consensus.
 * Paper trade only for now — live execution requires sub-second speed.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getOdds, extractSoftBookOdds } from '../odds-api-client.js';
import { decimalToImpliedProb } from '../ev-calculator.js';
import type { SportsOpportunity } from '../sports-models.js';

export async function scanLiveInPlay(sports: string[]): Promise<SportsOpportunity[]> {
  const opportunities: SportsOpportunity[] = [];

  for (const sport of sports.slice(0, 2)) { // Limit to save API credits
    try {
      // Fetch live odds (games currently in progress)
      const events = await getOdds({ sport, regions: 'us', markets: 'h2h' });

      // Filter to live games (commence_time in the past)
      const now = new Date();
      const liveEvents = events.filter(e => new Date(e.commence_time) < now);

      for (const event of liveEvents) {
        const books = extractSoftBookOdds(event);
        if (books.length < 3) continue; // Need multiple books to detect stale lines

        // Calculate consensus implied probability
        const homeProbs = books.map(b => decimalToImpliedProb(b.homeDecimal));
        const avgHomeProb = homeProbs.reduce((s, p) => s + p, 0) / homeProbs.length;

        // Find outliers (books significantly different from consensus)
        for (const book of books) {
          const bookHomeProb = decimalToImpliedProb(book.homeDecimal);
          const deviation = Math.abs(bookHomeProb - avgHomeProb);

          if (deviation > 0.05) { // 5% deviation = potential stale line
            const side = bookHomeProb < avgHomeProb ? 'home' : 'away';
            const edgePct = deviation;

            opportunities.push({
              id: randomUUID(),
              engine: 'S3',
              type: 'live_inplay',
              sport,
              eventId: event.id,
              homeTeam: event.home_team,
              awayTeam: event.away_team,
              commenceTime: event.commence_time,
              market: 'h2h',
              side,
              softBookOdds: side === 'home' ? book.homeOdds : book.awayOdds,
              softBookDecimal: side === 'home' ? book.homeDecimal : book.awayDecimal,
              softBook: book.book,
              trueProb: side === 'home' ? avgHomeProb : 1 - avgHomeProb,
              evPct: edgePct,
              suggestedSize: 0,
              maxSize: 200,
              confidence: Math.min(80, 40 + edgePct * 500),
              reasoning: `Live stale line: ${book.book} ${side} prob ${(bookHomeProb * 100).toFixed(0)}% vs consensus ${(avgHomeProb * 100).toFixed(0)}% — ${(deviation * 100).toFixed(1)}% deviation`,
              detectedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), // Expires in 5 min (live)
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ sport, err: err instanceof Error ? err.message : err }, '[S3] Live scan failed');
    }
  }

  return opportunities;
}
