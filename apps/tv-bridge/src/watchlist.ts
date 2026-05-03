/**
 * Watchlist client — pulls the AI scout's current watchlist from the gateway.
 *
 * Falls back gracefully: if the endpoint is unreachable or returns 503,
 * the bridge keeps using the most recent successful response (cached). Only
 * the very first run on a fresh install requires the watchlist endpoint
 * to be live.
 */

import type { Logger } from 'pino';

export interface WatchlistEntry {
  ticker: string;
  tvSymbol: string; // e.g. "AAPL" or "COINBASE:BTCUSD" — what we pass to chart_set_symbol
  kind: 'stock' | 'crypto';
}

let cached: { entries: WatchlistEntry[]; fetchedAt: number } | null = null;

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — refetch periodically; bridge tolerates stale

export async function getWatchlist(
  endpointUrl: string,
  log: Logger,
): Promise<WatchlistEntry[]> {
  // Return cached if still fresh
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.entries;
  }
  try {
    const res = await fetch(endpointUrl, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      log.warn({ status: res.status, endpoint: endpointUrl }, 'watchlist endpoint returned non-OK');
      return cached?.entries ?? [];
    }
    const json = (await res.json()) as { data?: { entries?: unknown[] } };
    const entries = json.data?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      log.warn('watchlist endpoint returned no entries');
      return cached?.entries ?? [];
    }
    const parsed: WatchlistEntry[] = [];
    for (const e of entries) {
      if (
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Record<string, unknown>)['ticker'] === 'string' &&
        typeof (e as Record<string, unknown>)['tvSymbol'] === 'string' &&
        ((e as Record<string, unknown>)['kind'] === 'stock' ||
          (e as Record<string, unknown>)['kind'] === 'crypto')
      ) {
        const r = e as Record<string, unknown>;
        parsed.push({
          ticker: r['ticker'] as string,
          tvSymbol: r['tvSymbol'] as string,
          kind: r['kind'] as 'stock' | 'crypto',
        });
      }
    }
    if (parsed.length === 0) {
      log.warn('watchlist endpoint returned entries but none parseable');
      return cached?.entries ?? [];
    }
    cached = { entries: parsed, fetchedAt: Date.now() };
    log.info({ count: parsed.length }, 'watchlist refreshed from scout');
    return parsed;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err, endpoint: endpointUrl },
      'watchlist fetch failed — using cached if available',
    );
    return cached?.entries ?? [];
  }
}
