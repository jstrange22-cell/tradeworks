/**
 * Sports Betting Routes
 *
 * Integrates with The Odds API (free tier: 500 req/month) for:
 * - Live odds from 20+ sportsbooks
 * - Line shopping (find best odds across books)
 * - Expected value calculation
 * - Sports/events listing
 *
 * GET /api/v1/sports/sports          — Available sports
 * GET /api/v1/sports/odds/:sport     — Odds for a sport
 * GET /api/v1/sports/ev/:sport       — Expected value analysis
 */

import { Router, type Router as RouterType } from 'express';

export const sportsRouter: RouterType = Router();

const ODDS_API_KEY = process.env.ODDS_API_KEY ?? '';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
      }>;
    }>;
  }>;
}

interface EVOpportunity {
  event: string;
  team: string;
  bestOdds: number;
  bestBook: string;
  impliedProb: number;
  consensusProb: number;
  edge: number;
  ev: number;
}

// Convert American odds to implied probability
function oddsToProb(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

// Convert American odds to decimal
function oddsToDecimal(americanOdds: number): number {
  if (americanOdds > 0) return (americanOdds / 100) + 1;
  return (100 / Math.abs(americanOdds)) + 1;
}

// GET /sports — Available sports
sportsRouter.get('/sports', async (_req, res) => {
  if (!ODDS_API_KEY) {
    res.status(400).json({ error: 'ODDS_API_KEY not configured. Get a free key at the-odds-api.com' });
    return;
  }

  try {
    const apiRes = await fetch(`${ODDS_API_BASE}/sports?apiKey=${ODDS_API_KEY}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!apiRes.ok) throw new Error(`Odds API error: ${apiRes.status}`);
    const sports = await apiRes.json();
    res.json({ data: sports });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch sports', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /odds/:sport — Odds from all bookmakers
sportsRouter.get('/odds/:sport', async (req, res) => {
  if (!ODDS_API_KEY) {
    res.status(400).json({ error: 'ODDS_API_KEY not configured' });
    return;
  }

  const { sport } = req.params;
  const markets = (req.query.markets as string) || 'h2h';
  const regions = (req.query.regions as string) || 'us';

  try {
    const apiRes = await fetch(
      `${ODDS_API_BASE}/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&oddsFormat=american`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!apiRes.ok) throw new Error(`Odds API error: ${apiRes.status}`);
    const events = (await apiRes.json()) as OddsEvent[];

    // Add line shopping data — find best odds for each outcome
    const enriched = events.map(event => {
      const bestOdds: Record<string, { odds: number; book: string }> = {};

      for (const book of event.bookmakers) {
        for (const market of book.markets) {
          for (const outcome of market.outcomes) {
            const current = bestOdds[outcome.name];
            if (!current || outcome.price > current.odds) {
              bestOdds[outcome.name] = { odds: outcome.price, book: book.title };
            }
          }
        }
      }

      return {
        ...event,
        bestOdds,
        bookmakerCount: event.bookmakers.length,
      };
    });

    res.json({ data: enriched, count: enriched.length });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch odds', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /ev/:sport — Expected value analysis
sportsRouter.get('/ev/:sport', async (req, res) => {
  if (!ODDS_API_KEY) {
    res.status(400).json({ error: 'ODDS_API_KEY not configured' });
    return;
  }

  const { sport } = req.params;
  const minEdge = parseFloat((req.query.minEdge as string) || '3');

  try {
    const apiRes = await fetch(
      `${ODDS_API_BASE}/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!apiRes.ok) throw new Error(`Odds API error: ${apiRes.status}`);
    const events = (await apiRes.json()) as OddsEvent[];

    const opportunities: EVOpportunity[] = [];

    for (const event of events) {
      // Collect all odds per outcome
      const outcomeOdds: Record<string, number[]> = {};
      const bestByOutcome: Record<string, { odds: number; book: string }> = {};

      for (const book of event.bookmakers) {
        for (const market of book.markets) {
          if (market.key !== 'h2h') continue;
          for (const outcome of market.outcomes) {
            if (!outcomeOdds[outcome.name]) outcomeOdds[outcome.name] = [];
            outcomeOdds[outcome.name].push(outcome.price);

            const current = bestByOutcome[outcome.name];
            if (!current || outcome.price > current.odds) {
              bestByOutcome[outcome.name] = { odds: outcome.price, book: book.title };
            }
          }
        }
      }

      // Calculate consensus probability and find +EV opportunities
      for (const [team, odds] of Object.entries(outcomeOdds)) {
        if (odds.length < 3) continue; // Need at least 3 books for consensus

        // Consensus probability = average of all implied probabilities
        const probs = odds.map(o => oddsToProb(o));
        const consensusProb = probs.reduce((s, p) => s + p, 0) / probs.length;

        // Best available odds
        const best = bestByOutcome[team];
        if (!best) continue;

        const bestImpliedProb = oddsToProb(best.odds);
        const bestDecimal = oddsToDecimal(best.odds);

        // Edge = consensus probability - implied probability of best odds
        const edge = (consensusProb - bestImpliedProb) * 100;

        // EV = (prob × payout) - (1 - prob)
        const ev = (consensusProb * (bestDecimal - 1)) - (1 - consensusProb);

        if (edge >= minEdge / 100) {
          opportunities.push({
            event: `${event.away_team} @ ${event.home_team}`,
            team,
            bestOdds: best.odds,
            bestBook: best.book,
            impliedProb: bestImpliedProb,
            consensusProb,
            edge: edge,
            ev: ev * 100, // as percentage
          });
        }
      }
    }

    // Sort by EV descending
    opportunities.sort((a, b) => b.ev - a.ev);

    res.json({
      data: opportunities,
      count: opportunities.length,
      minEdge: `${minEdge}%`,
      sport,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to calculate EV', message: err instanceof Error ? err.message : 'Unknown' });
  }
});
