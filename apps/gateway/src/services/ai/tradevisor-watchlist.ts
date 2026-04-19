/**
 * Tradevisor Watchlist — Staging Area for Agent Discoveries
 *
 * Agents discover tickers → add to watchlist → Tradevisor analyzes →
 * only confirmed signals (4+ confluence) get traded.
 *
 * NO auto-trading from agent discoveries. Everything goes through TA first.
 */

import { logger } from '../../lib/logger.js';
import { runTradevisorScan, recordScanStats, type TradevisorResult } from './tradevisor-engine.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface WatchlistItem {
  ticker: string;
  chain: 'crypto' | 'stock' | 'solana';
  source: string;          // 'apex_scout' | 'moonshot_hunter' | 'twitter' | 'manual' | etc.
  addedAt: string;
  expiresAt: string;       // 72h from add
  lastAnalysis: TradevisorResult | null;
  analysisCount: number;
}

// ── State ────────────────────────────────────────────────────────────────

const watchlist = new Map<string, WatchlistItem>();
const MAX_WATCHLIST = 50;
const WATCHLIST_TTL_MS = 72 * 60 * 60_000; // 72 hours

// ── Watchlist Management ────────────────────────────────────────────────

// Only block stablecoins and wrapped tokens from the watchlist.
// Blue chips are allowed — asset protection in the CEX engine gates live trades.
const WATCHLIST_BLOCKED = new Set([
  // Stablecoins — no point trading these
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FRAX', 'UST',
  // Wrapped tokens
  'WBTC', 'WETH', 'WSOL',
]);

// ── Top 30 Coinbase Tickers (seeded on startup) ──────────────────────────
// These are the most liquid crypto assets on Coinbase.
// They get auto-added to the watchlist so Tradevisor always monitors them.
const TOP_30_TICKERS: Array<{ ticker: string; chain: 'crypto' }> = [
  'BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOGE', 'ADA', 'DOT',
  'NEAR', 'SUI', 'MATIC', 'UNI', 'AAVE', 'MKR', 'LDO',
  'ARB', 'OP', 'FIL', 'ATOM', 'APT', 'SEI', 'INJ', 'TIA',
  'RENDER', 'FET', 'JASMY', 'PEPE', 'SHIB', 'WIF', 'BONK',
].map(ticker => ({ ticker, chain: 'crypto' as const }));

export function addToWatchlist(ticker: string, source: string, chain: 'crypto' | 'stock' | 'solana'): boolean {
  // Block blue chips from even entering the watchlist
  if (WATCHLIST_BLOCKED.has(ticker.toUpperCase())) {
    return false;
  }

  const key = `${ticker.toUpperCase()}_${chain}`;

  // Already watching — update source
  if (watchlist.has(key)) {
    const existing = watchlist.get(key)!;
    if (!existing.source.includes(source)) {
      existing.source += `, ${source}`;
    }
    return false; // Not new
  }

  // Max watchlist size
  if (watchlist.size >= MAX_WATCHLIST) {
    // Remove oldest expired first
    cleanupExpired();
    if (watchlist.size >= MAX_WATCHLIST) {
      // Remove least recently analyzed
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [k, item] of watchlist) {
        const addedTime = new Date(item.addedAt).getTime();
        if (addedTime < oldestTime) {
          oldestTime = addedTime;
          oldest = k;
        }
      }
      if (oldest) watchlist.delete(oldest);
    }
  }

  watchlist.set(key, {
    ticker: ticker.toUpperCase(),
    chain,
    source,
    addedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + WATCHLIST_TTL_MS).toISOString(),
    lastAnalysis: null,
    analysisCount: 0,
  });

  logger.info(
    { ticker, chain, source, watchlistSize: watchlist.size },
    `[Tradevisor] Added ${ticker} to watchlist from ${source}`,
  );

  return true;
}

export function removeFromWatchlist(ticker: string, chain: string): void {
  const key = `${ticker.toUpperCase()}_${chain}`;
  watchlist.delete(key);
}

export function getWatchlist(): WatchlistItem[] {
  cleanupExpired();
  return [...watchlist.values()];
}

export function getWatchlistForScan(): Array<{ ticker: string; chain: 'crypto' | 'stock' | 'solana' }> {
  cleanupExpired();
  return [...watchlist.values()].map(w => ({ ticker: w.ticker, chain: w.chain }));
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, item] of watchlist) {
    if (new Date(item.expiresAt).getTime() < now) {
      watchlist.delete(key);
    }
  }
}

// ── Scan Watchlist (called every 2 min by orchestrator) ─────────────────

export async function scanWatchlist(): Promise<{
  buys: TradevisorResult[];
  sells: TradevisorResult[];
  holds: number;
}> {
  const items = getWatchlistForScan();
  if (items.length === 0) {
    return { buys: [], sells: [], holds: 0 };
  }

  // Run Tradevisor analysis on all watched tickers
  const results = await runTradevisorScan(items);

  const buys: TradevisorResult[] = [];
  const sells: TradevisorResult[] = [];
  let holds = 0;

  for (const result of results) {
    // Update watchlist item with analysis result
    const key = `${result.ticker}_${result.chain}`;
    const item = watchlist.get(key);
    if (item) {
      item.lastAnalysis = result;
      item.analysisCount++;
    }

    // Multi-TF aware threshold:
    // - Solana (DexScreener) tokens: 3/6 (less history, noisier indicators)
    // - Crypto WITH multi-TF alignment: 3/6 (1h + 4h + 1D confirmed, high quality signal)
    // - Crypto WITHOUT multi-TF (fell back to CoinGecko/DexScreener): 4/6 (strict)
    const hasMultiTFAlignment = result.signalStrength === 'strong' || result.signalStrength === 'standard';
    const minConfluence = result.chain === 'solana'
      ? 3
      : (hasMultiTFAlignment ? 3 : 4);

    const isBuy = result.action === 'buy';
    const isSell = result.action === 'sell';

    if (isBuy && result.confluenceScore >= minConfluence) {
      buys.push(result);
    } else if (isSell && result.confluenceScore >= minConfluence) {
      sells.push(result);
    } else {
      holds++;
    }
  }

  recordScanStats(buys.length + sells.length);

  logger.info(
    { watched: items.length, analyzed: results.length, buys: buys.length, sells: sells.length, holds },
    `[Tradevisor] Scan: ${items.length} tickers → ${buys.length} BUY, ${sells.length} SELL, ${holds} HOLD`,
  );

  return { buys, sells, holds };
}

// ── Autonomous Scan Loop ────────────────────────────────────────────────

let scanInterval: ReturnType<typeof setInterval> | null = null;
let onSignalCallback: ((result: TradevisorResult) => void) | null = null;

export function setOnTradevisorSignal(cb: (result: TradevisorResult) => void): void {
  onSignalCallback = cb;
}

/** Seed the watchlist with the top 30 Coinbase tickers if not already present. */
export function seedWatchlist(): void {
  let added = 0;
  for (const { ticker, chain } of TOP_30_TICKERS) {
    if (addToWatchlist(ticker, 'seed:top30', chain)) {
      added++;
    }
  }
  if (added > 0) {
    logger.info({ added, total: watchlist.size }, `[Tradevisor] Seeded ${added} top-30 tickers into watchlist`);
  }
}

export function startTradevisorLoop(): void {
  if (scanInterval) return;

  // Seed top-30 tickers on first start
  seedWatchlist();

  logger.info('[Tradevisor] Starting autonomous scan loop (2 min cycle)');

  scanInterval = setInterval(async () => {
    try {
      const { buys, sells } = await scanWatchlist();

      // Fire callbacks for confirmed signals
      if (onSignalCallback) {
        for (const result of [...buys, ...sells]) {
          onSignalCallback(result);
        }
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[Tradevisor] Scan loop failed');
    }
  }, 2 * 60_000); // Every 2 minutes

  // First scan after 30s
  setTimeout(async () => {
    try {
      const { buys, sells } = await scanWatchlist();
      if (onSignalCallback) {
        for (const result of [...buys, ...sells]) {
          onSignalCallback(result);
        }
      }
    } catch { /* silent */ }
  }, 30_000);
}

export function stopTradevisorLoop(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

// ── Status ──────────────────────────────────────────────────────────────

export function getTradevisorStatus() {
  const items = getWatchlist();
  return {
    running: scanInterval !== null,
    watchlistSize: items.length,
    watchlist: items.map(w => ({
      ticker: w.ticker,
      chain: w.chain,
      source: w.source,
      lastGrade: w.lastAnalysis?.grade ?? 'pending',
      lastAction: w.lastAnalysis?.action ?? 'pending',
      lastScore: w.lastAnalysis?.confluenceScore ?? 0,
      analyses: w.analysisCount,
    })),
  };
}
