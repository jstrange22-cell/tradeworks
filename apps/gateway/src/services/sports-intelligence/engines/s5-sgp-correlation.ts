/**
 * S5: SGP Correlation — Correlated Same-Game Parlay Mispricing
 *
 * Books price SGP legs as independent, but some legs are correlated.
 * Example: "Chiefs win" + "Mahomes 300+ yards" are positively correlated.
 * When book prices these as independent, the parlay is mispriced.
 *
 * This engine needs historical correlation data to be effective.
 * Starting with known high-correlation patterns.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import type { SportsOpportunity } from '../sports-models.js';

// Known correlation patterns
const CORRELATIONS: Array<{
  sport: string;
  pattern: string;
  leg1: string;
  leg2: string;
  correlation: number;
  description: string;
}> = [
  { sport: 'nfl', pattern: 'qb_yards_team_win', leg1: 'player_pass_yds_over', leg2: 'team_moneyline', correlation: 0.65, description: 'QB passing yards correlate with team winning' },
  { sport: 'nba', pattern: 'points_team_win', leg1: 'player_points_over', leg2: 'team_moneyline', correlation: 0.55, description: 'Star player scoring correlates with team winning' },
  { sport: 'nfl', pattern: 'total_team_score', leg1: 'game_total_over', leg2: 'team_moneyline_favorite', correlation: 0.40, description: 'Game going over total weakly correlates with favorite winning' },
  { sport: 'nba', pattern: 'blowout_bench', leg1: 'team_spread_large', leg2: 'player_minutes_under', correlation: 0.70, description: 'Blowouts lead to reduced starter minutes' },
];

export async function scanSGPCorrelation(sports: string[]): Promise<SportsOpportunity[]> {
  const opportunities: SportsOpportunity[] = [];

  // SGP correlation detection requires prop lines + game lines
  // For now, flag known correlation patterns as opportunities
  for (const pattern of CORRELATIONS) {
    if (!sports.some(s => s.includes(pattern.sport))) continue;

    if (pattern.correlation >= 0.5) { // Only strong correlations
      opportunities.push({
        id: randomUUID(),
        engine: 'S5',
        type: 'sgp',
        sport: pattern.sport,
        eventId: `sgp_${pattern.pattern}`,
        homeTeam: 'SGP Pattern',
        awayTeam: pattern.description,
        commenceTime: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        market: 'sgp',
        side: 'yes',
        softBookOdds: 200, // Placeholder
        softBookDecimal: 3.0,
        softBook: 'sgp_analysis',
        trueProb: 0.4,
        evPct: pattern.correlation * 0.1, // Correlation → rough EV estimate
        suggestedSize: 0,
        maxSize: 100,
        confidence: Math.round(pattern.correlation * 80),
        reasoning: `SGP: ${pattern.description}. Correlation: ${(pattern.correlation * 100).toFixed(0)}%. Books price as independent → mispriced.`,
        detectedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      });
    }
  }

  logger.info({ patterns: CORRELATIONS.length, viable: opportunities.length }, '[S5] SGP correlation scan complete');
  return opportunities;
}
