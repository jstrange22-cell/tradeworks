/**
 * Market Matcher — Cross-Platform Market Identification
 *
 * Matches Kalshi tickers to Polymarket slugs for cross-platform arb detection.
 * Uses keyword overlap + category matching + known mappings.
 */

import type { NormalizedMarket, NormalizedEvent } from './models.js';
import { logger } from '../../lib/logger.js';

// ── Kalshi API Data Fetcher ─────────────────────────────────────────────

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA_API = 'https://gamma-api.polymarket.com';

interface KalshiMarketRaw {
  ticker: string;
  event_ticker: string;
  subtitle: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  status: string;
  close_time: string;
}

interface KalshiEventRaw {
  event_ticker: string;
  title: string;
  sub_title: string;
  category: string;
  series_ticker: string;
  markets?: KalshiMarketRaw[];
}

interface GammaMarketRaw {
  id: string;
  question: string;
  slug: string;
  end_date_iso: string;
  active: boolean;
  volume: string;
  liquidity: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds: string;
  category: string;
}

export async function fetchKalshiMarkets(limit = 100): Promise<{ markets: NormalizedMarket[]; events: NormalizedEvent[] }> {
  const markets: NormalizedMarket[] = [];
  const events: NormalizedEvent[] = [];

  try {
    // Fetch events with their markets
    const evRes = await fetch(`${KALSHI_BASE}/events/?limit=${limit}&status=open`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!evRes.ok) return { markets, events };

    const evData = await evRes.json() as { events: KalshiEventRaw[] };

    for (const ev of evData.events ?? []) {
      const eventMarkets: NormalizedMarket[] = [];

      // Fetch markets for this event
      try {
        const mkRes = await fetch(`${KALSHI_BASE}/markets/?event_ticker=${ev.event_ticker}&limit=20`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        if (mkRes.ok) {
          const mkData = await mkRes.json() as { markets: KalshiMarketRaw[] };
          for (const m of mkData.markets ?? []) {
            const normalized: NormalizedMarket = {
              venue: 'kalshi',
              ticker: m.ticker,
              eventTicker: m.event_ticker,
              title: m.subtitle || ev.title,
              category: ev.category || 'Other',
              yesPrice: m.last_price / 100,
              noPrice: 1.0 - m.last_price / 100,
              yesBid: m.yes_bid / 100,
              yesAsk: m.yes_ask / 100,
              noBid: m.no_bid / 100,
              noAsk: m.no_ask / 100,
              volume: m.volume,
              liquidity: m.open_interest,
              expiresAt: m.close_time,
              status: m.status === 'active' ? 'open' : m.status,
            };
            markets.push(normalized);
            eventMarkets.push(normalized);
          }
        }
      } catch { /* skip */ }

      if (eventMarkets.length > 0) {
        events.push({
          venue: 'kalshi',
          eventTicker: ev.event_ticker,
          title: ev.title,
          category: ev.category || 'Other',
          markets: eventMarkets,
        });
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[MarketMatcher] Kalshi fetch failed');
  }

  return { markets, events };
}

export async function fetchPolymarketMarkets(limit = 100): Promise<{ markets: NormalizedMarket[]; events: NormalizedEvent[] }> {
  const markets: NormalizedMarket[] = [];
  const events: NormalizedEvent[] = [];

  try {
    const res = await fetch(`${GAMMA_API}/markets?limit=${limit}&active=true&order=volume&ascending=false`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { markets, events };

    const rawMarkets = await res.json() as GammaMarketRaw[];

    for (const m of rawMarkets) {
      const outcomeNames: string[] = JSON.parse(m.outcomes || '[]');
      const outcomePrices: string[] = JSON.parse(m.outcomePrices || '[]');

      const yesPrice = parseFloat(outcomePrices[0] || '0');
      const noPrice = parseFloat(outcomePrices[1] || '0');

      const normalized: NormalizedMarket = {
        venue: 'polymarket',
        ticker: m.id,
        eventTicker: m.slug,
        title: m.question,
        category: m.category || 'Other',
        yesPrice,
        noPrice,
        yesBid: yesPrice,
        yesAsk: yesPrice,
        noBid: noPrice,
        noAsk: noPrice,
        volume: parseFloat(m.volume || '0'),
        liquidity: parseFloat(m.liquidity || '0'),
        expiresAt: m.end_date_iso,
        status: m.active ? 'open' : 'closed',
        outcomes: outcomeNames.map((name, i) => ({
          name,
          price: parseFloat(outcomePrices[i] || '0'),
          tokenId: (JSON.parse(m.clobTokenIds || '[]') as string[])[i],
        })),
      };
      markets.push(normalized);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[MarketMatcher] Polymarket fetch failed');
  }

  return { markets, events };
}

/**
 * Fetch all market data from both venues.
 */
export async function fetchAllMarkets(): Promise<{
  kalshiMarkets: NormalizedMarket[];
  kalshiEvents: NormalizedEvent[];
  polyMarkets: NormalizedMarket[];
  polyEvents: NormalizedEvent[];
}> {
  const [kalshi, poly] = await Promise.all([
    fetchKalshiMarkets(50),
    fetchPolymarketMarkets(100),
  ]);

  return {
    kalshiMarkets: kalshi.markets,
    kalshiEvents: kalshi.events,
    polyMarkets: poly.markets,
    polyEvents: poly.events,
  };
}
