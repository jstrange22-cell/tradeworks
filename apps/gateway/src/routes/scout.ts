/**
 * Scout HTTP API.
 *   GET /api/v1/scout/watchlist — current watchlist as picked by the scout
 *   GET /api/v1/scout/status    — refresh metadata only (no entries)
 *
 * Reads from scout's persisted JSON file. The scout daemon (apps/scout)
 * writes this file on each refresh; the gateway just exposes it.
 */

import { Router, type Router as RouterType } from 'express';
import { readFileSync, statSync, existsSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../lib/logger.js';

export const scoutRouter: RouterType = Router();

// Where the scout daemon writes its watchlist. Override per-environment via
// SCOUT_WATCHLIST_FILE env var. Default points at the scout app's data dir
// when both are deployed under /opt/tradeworks/.
const WATCHLIST_FILE = resolve(
  process.env['SCOUT_WATCHLIST_FILE'] ?? './apps/scout/data/watchlist.json',
);

interface WatchlistEntry {
  ticker: string;
  tvSymbol: string;
  kind: 'stock' | 'crypto';
  score?: number;
  rs5d?: number;
  rs20d?: number;
  atrExpansion?: number;
  reason?: string;
}

interface WatchlistFile {
  refreshedAt: string;
  refreshSource: 'deterministic' | 'claude-reranked';
  rationale?: string;
  marketContext: string;
  totalTickers: number;
  entries: WatchlistEntry[];
}

function loadWatchlist(): WatchlistFile | null {
  if (!existsSync(WATCHLIST_FILE)) return null;
  try {
    const raw = readFileSync(WATCHLIST_FILE, 'utf8');
    return JSON.parse(raw) as WatchlistFile;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, file: WATCHLIST_FILE },
      '[scout] failed to parse watchlist file',
    );
    return null;
  }
}

scoutRouter.get('/watchlist', (req, res) => {
  const wl = loadWatchlist();
  if (!wl) {
    res.status(503).json({
      error: 'Watchlist not yet generated',
      hint: `Run the scout daemon (apps/scout) — expected file at ${WATCHLIST_FILE}`,
    });
    return;
  }
  // Optional ?kind=stock|crypto filter
  const kindFilter = req.query['kind'] as 'stock' | 'crypto' | undefined;
  const entries = kindFilter ? wl.entries.filter((e) => e.kind === kindFilter) : wl.entries;
  res.json({
    data: {
      refreshedAt: wl.refreshedAt,
      refreshSource: wl.refreshSource,
      rationale: wl.rationale ?? null,
      marketContext: wl.marketContext,
      totalTickers: entries.length,
      entries,
    },
  });
});

scoutRouter.get('/status', (_req, res) => {
  const wl = loadWatchlist();
  if (!wl) {
    res.status(503).json({
      error: 'Watchlist not yet generated',
      file: WATCHLIST_FILE,
    });
    return;
  }
  let fileAgeSeconds: number | null = null;
  try {
    fileAgeSeconds = Math.round((Date.now() - statSync(WATCHLIST_FILE).mtimeMs) / 1000);
  } catch {
    fileAgeSeconds = null;
  }
  res.json({
    data: {
      refreshedAt: wl.refreshedAt,
      refreshSource: wl.refreshSource,
      rationale: wl.rationale ?? null,
      totalTickers: wl.totalTickers,
      stockCount: wl.entries.filter((e) => e.kind === 'stock').length,
      cryptoCount: wl.entries.filter((e) => e.kind === 'crypto').length,
      fileAgeSeconds,
    },
  });
});
