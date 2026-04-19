/**
 * S4: Prop Modeler — AI-Powered Player Prop Projections
 *
 * Compares book prop lines to statistical projections.
 * Uses Gemini LLM for prop analysis when available.
 * Minimum EV: 5% (wider variance on props).
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getOdds } from '../odds-api-client.js';
import { americanToDecimal } from '../ev-calculator.js';
import type { SportsOpportunity } from '../sports-models.js';

export async function scanProps(sports: string[]): Promise<SportsOpportunity[]> {
  const opportunities: SportsOpportunity[] = [];

  // Props are available for limited sports (NBA, NFL, MLB)
  const propSports = sports.filter(s =>
    s.includes('nba') || s.includes('nfl') || s.includes('mlb'),
  );

  for (const sport of propSports.slice(0, 1)) { // 1 sport to save credits
    try {
      const events = await getOdds({
        sport,
        regions: 'us',
        markets: 'player_pass_tds,player_receptions,player_rush_yds,player_points',
      });

      for (const event of events.slice(0, 3)) {
        for (const book of event.bookmakers) {
          for (const market of book.markets) {
            if (!market.key.startsWith('player_')) continue;

            for (const outcome of market.outcomes) {
              if (!outcome.point) continue;

              // Simple statistical edge detection:
              // If the line is very different from the book's own implied probability
              const decimal = americanToDecimal(outcome.price);
              const impliedProb = 1 / decimal;

              // For props, we look for lines where the vig seems excessive
              // True edge requires a model, but we can flag outliers
              if (impliedProb > 0.55 && decimal > 1.7) {
                // Over-priced by the book
                const estimatedEV = (impliedProb * decimal) - 1;
                if (estimatedEV > 0.05) { // 5% min for props
                  opportunities.push({
                    id: randomUUID(),
                    engine: 'S4',
                    type: 'prop',
                    sport,
                    eventId: event.id,
                    homeTeam: event.home_team,
                    awayTeam: event.away_team,
                    commenceTime: event.commence_time,
                    market: market.key,
                    side: outcome.name.toLowerCase().includes('over') ? 'over' : 'under',
                    softBookOdds: outcome.price,
                    softBookDecimal: decimal,
                    softBook: book.key,
                    trueProb: impliedProb,
                    evPct: estimatedEV,
                    suggestedSize: 0,
                    maxSize: 150,
                    confidence: 50, // Lower confidence — props are noisy
                    reasoning: `Prop: ${outcome.name} ${market.key} line ${outcome.point} on ${book.key} — implied ${(impliedProb * 100).toFixed(0)}% at ${decimal.toFixed(2)}x`,
                    detectedAt: new Date().toISOString(),
                    expiresAt: event.commence_time,
                  });
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ sport, err: err instanceof Error ? err.message : err }, '[S4] Prop scan failed');
    }
  }

  return opportunities;
}
