/**
 * Enhanced Odds API Client — The Odds API v4
 *
 * Fetches real-time odds from 40+ sportsbooks.
 * Supports: moneyline (h2h), spreads, totals, props.
 * Free tier: 500 credits/month.
 */

import { logger } from '../../lib/logger.js';

const BASE_URL = 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY ?? '';

// ── Types ────────────────────────────────────────────────────────────────

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface Market {
  key: string;           // 'h2h', 'spreads', 'totals'
  last_update: string;
  outcomes: Outcome[];
}

export interface Outcome {
  name: string;
  price: number;         // American odds
  point?: number;        // Spread/total line
}

// ── Fetch Functions ─────────────────────────────────────────────────────

async function oddsApiFetch<T>(path: string): Promise<T | null> {
  if (!API_KEY) {
    logger.warn('[OddsAPI] No API key configured');
    return null;
  }

  const separator = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${separator}apiKey=${API_KEY}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, '[OddsAPI] API error');
      return null;
    }

    // Track remaining credits
    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    if (remaining) {
      logger.info({ remaining, used }, '[OddsAPI] Credits');
    }

    return await res.json() as T;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[OddsAPI] Fetch failed');
    return null;
  }
}

// ── Sports List ─────────────────────────────────────────────────────────

export async function getSports(): Promise<Array<{ key: string; title: string; active: boolean }>> {
  const data = await oddsApiFetch<Array<{ key: string; title: string; active: boolean }>>('/sports');
  return data ?? [];
}

// ── Odds (Moneyline / H2H) ─────────────────────────────────────────────

export async function getOdds(params: {
  sport: string;
  regions?: string;        // 'us', 'eu', 'uk', 'au'
  markets?: string;        // 'h2h', 'spreads', 'totals'
  bookmakers?: string;     // Comma-separated: 'pinnacle,draftkings,fanduel'
}): Promise<OddsEvent[]> {
  const { sport, regions = 'us', markets = 'h2h', bookmakers } = params;
  let path = `/sports/${sport}/odds?regions=${regions}&markets=${markets}&oddsFormat=american`;
  if (bookmakers) path += `&bookmakers=${bookmakers}`;

  const data = await oddsApiFetch<OddsEvent[]>(path);
  return data ?? [];
}

// ── Convenience: Get Odds with Pinnacle + US Soft Books ─────────────────

export async function getOddsWithPinnacle(sport: string, market = 'h2h'): Promise<OddsEvent[]> {
  return getOdds({
    sport,
    regions: 'us,eu',
    markets: market,
    bookmakers: 'pinnacle,draftkings,fanduel,betmgm,bovada,betonlineag,mybookieag,betrivers,unibet_us',
  });
}

// ── Extract Pinnacle Odds for an Event ──────────────────────────────────

export function extractPinnacleOdds(event: OddsEvent, market = 'h2h'): {
  homeOdds: number;
  awayOdds: number;
} | null {
  const pinnacle = event.bookmakers.find(b => b.key === 'pinnacle');
  if (!pinnacle) return null;

  const mkt = pinnacle.markets.find(m => m.key === market);
  if (!mkt || mkt.outcomes.length < 2) return null;

  const home = mkt.outcomes.find(o => o.name === event.home_team);
  const away = mkt.outcomes.find(o => o.name === event.away_team);
  if (!home || !away) return null;

  return { homeOdds: home.price, awayOdds: away.price };
}

// ── Extract All Soft Book Odds ──────────────────────────────────────────

export function extractSoftBookOdds(event: OddsEvent, market = 'h2h'): Array<{
  book: string;
  homeOdds: number;
  awayOdds: number;
  homeDecimal: number;
  awayDecimal: number;
}> {
  const results: Array<{ book: string; homeOdds: number; awayOdds: number; homeDecimal: number; awayDecimal: number }> = [];

  for (const bk of event.bookmakers) {
    if (bk.key === 'pinnacle') continue; // Skip sharp book

    const mkt = bk.markets.find(m => m.key === market);
    if (!mkt || mkt.outcomes.length < 2) continue;

    const home = mkt.outcomes.find(o => o.name === event.home_team);
    const away = mkt.outcomes.find(o => o.name === event.away_team);
    if (!home || !away) continue;

    const americanToDecimal = (a: number) => a > 0 ? (a / 100) + 1 : (100 / Math.abs(a)) + 1;

    results.push({
      book: bk.key,
      homeOdds: home.price,
      awayOdds: away.price,
      homeDecimal: americanToDecimal(home.price),
      awayDecimal: americanToDecimal(away.price),
    });
  }

  return results;
}

// ── Scores (Game Results) ───────────────────────────────────────────────

export async function getScores(sport: string, daysFrom = 1): Promise<Array<{
  id: string;
  home_team: string;
  away_team: string;
  completed: boolean;
  scores: Array<{ name: string; score: string }> | null;
}>> {
  const data = await oddsApiFetch<Array<{
    id: string; home_team: string; away_team: string;
    completed: boolean; scores: Array<{ name: string; score: string }> | null;
  }>>(`/sports/${sport}/scores?daysFrom=${daysFrom}`);
  return data ?? [];
}
