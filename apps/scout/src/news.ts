/**
 * News fetcher for the AI scout.
 *
 * Uses Finnhub's free tier (60 req/min, no card required) to pull recent
 * company-specific news headlines for each candidate ticker. Headlines are
 * fed to Claude during the rerank step so qualitative catalysts (earnings
 * beats, FDA, M&A, analyst upgrades) influence which tickers make the
 * watchlist.
 *
 * Key handling: requires FINNHUB_API_KEY env var. If unset, this module
 * returns empty news for every ticker — Claude rerank still works but
 * loses the news axis.
 */

import type { Logger } from 'pino';

export interface NewsHeadline {
  ticker: string;
  datetime: number; // unix seconds
  headline: string;
  summary: string;
  source: string;
}

const API_BASE = 'https://finnhub.io/api/v1';
const LOOKBACK_DAYS = 3;
// Minimum gap between calls — Finnhub free tier is 60/min = ~1/sec.
// Buffer at 1100ms to avoid edge-case throttling.
const MIN_REQUEST_GAP_MS = 1100;

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

function dateString(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function fetchNewsForTicker(
  ticker: string,
  apiKey: string,
  log: Logger,
): Promise<NewsHeadline[]> {
  await throttle();
  const today = new Date();
  const fromDate = new Date(today.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const url = `${API_BASE}/company-news?symbol=${encodeURIComponent(ticker)}&from=${dateString(fromDate)}&to=${dateString(today)}&token=${apiKey}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      log.debug({ ticker, status: res.status }, 'finnhub non-OK');
      return [];
    }
    const arr = (await res.json()) as Array<{
      datetime: number;
      headline?: string;
      summary?: string;
      source?: string;
    }>;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((n) => typeof n.headline === 'string' && n.headline.length > 0)
      .slice(0, 5) // top 5 most recent per ticker — keeps prompt small
      .map((n) => ({
        ticker,
        datetime: n.datetime ?? 0,
        headline: (n.headline ?? '').slice(0, 200),
        summary: (n.summary ?? '').slice(0, 300),
        source: n.source ?? '',
      }));
  } catch (err) {
    log.debug({ ticker, err: err instanceof Error ? err.message : err }, 'finnhub fetch failed');
    return [];
  }
}

/**
 * Fetch news for a list of tickers sequentially (respects free-tier rate limit).
 * Returns a per-ticker headline map. Tickers with no news map to empty array.
 *
 * Cap the input to top-N candidates to keep total elapsed time reasonable
 * (~1s per ticker × N).
 */
export async function fetchNewsForTickers(
  tickers: string[],
  log: Logger,
): Promise<Record<string, NewsHeadline[]>> {
  const apiKey = process.env['FINNHUB_API_KEY'];
  if (!apiKey) {
    log.debug('FINNHUB_API_KEY not set — skipping news layer');
    return {};
  }
  log.info({ tickers: tickers.length, lookbackDays: LOOKBACK_DAYS }, 'fetching news (sequential, ~1s/ticker)');
  const out: Record<string, NewsHeadline[]> = {};
  const startedAt = Date.now();
  for (const t of tickers) {
    out[t] = await fetchNewsForTicker(t, apiKey, log);
  }
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  const totalHeadlines = Object.values(out).reduce((s, arr) => s + arr.length, 0);
  log.info({ tickers: tickers.length, totalHeadlines, elapsedSec }, 'news fetch complete');
  return out;
}

/**
 * Render a per-ticker news block for inclusion in the Claude rerank prompt.
 * Compact format — 2 lines per headline max, capped count keeps the prompt
 * under 6KB even with 60 candidates × 3 headlines each.
 */
export function formatNewsForPrompt(news: Record<string, NewsHeadline[]>): string {
  const lines: string[] = [];
  for (const [ticker, headlines] of Object.entries(news)) {
    if (headlines.length === 0) continue;
    lines.push(`${ticker}:`);
    for (const h of headlines.slice(0, 3)) {
      const ts = new Date(h.datetime * 1000).toISOString().slice(0, 10);
      lines.push(`  [${ts}] ${h.headline}`);
    }
  }
  if (lines.length === 0) return '';
  return 'Recent news (last 3 days):\n' + lines.join('\n');
}
