/**
 * Price fetcher for the unified exit monitor.
 *
 * One job: given a batch of OpenPositions, return current bar quotes
 * (close + best-effort high/low) per symbol. Caches per-symbol for
 * EXIT_PRICE_CACHE_TTL_MS so a single tick that sees the same symbol on
 * three positions only hits the upstream once.
 *
 * Routing:
 *   - equity     → Alpaca getSnapshots (latestTrade.p, dailyBar.h/.l)
 *   - option     → Robinhood getOptionQuote (mid; high/low default to mid)
 *   - crypto-cex → Coinbase public products endpoint
 *
 * Failures are logged but never thrown — a tick that can't price one
 * symbol still evaluates the others.
 */
import { logger } from '../../lib/logger.js';
import type { ExitBar, OpenPosition } from './types.js';

const CACHE_TTL_MS = 5_000;

interface CachedQuote {
  bar: ExitBar;
  fetchedAt: number;
}

const cache = new Map<string, CachedQuote>();

function cacheKey(assetClass: string, symbol: string): string {
  return `${assetClass}:${symbol.toUpperCase()}`;
}

function fromCache(key: string): ExitBar | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.bar;
}

function intoCache(key: string, bar: ExitBar): void {
  cache.set(key, { bar, fetchedAt: Date.now() });
}

// ── Equity (Alpaca) ────────────────────────────────────────────────────

async function fetchEquityBars(symbols: string[]): Promise<Map<string, ExitBar>> {
  const out = new Map<string, ExitBar>();
  if (symbols.length === 0) return out;

  try {
    const { getSnapshots } = await import('../stocks/alpaca-client.js');
    const snapshots = await getSnapshots(symbols);
    const ts = new Date().toISOString();
    for (const sym of symbols) {
      const snap = (snapshots as Record<string, unknown>)[sym] as
        | { latestTrade?: { p: number }; dailyBar?: { h?: number; l?: number; c?: number } }
        | undefined;
      const close = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
      if (!close || !Number.isFinite(close) || close <= 0) continue;
      const high = snap?.dailyBar?.h ?? close;
      const low = snap?.dailyBar?.l ?? close;
      out.set(sym, { close, high, low, ts });
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, symbols: symbols.length },
      '[exits.price] equity fetch failed',
    );
  }
  return out;
}

// ── Option (Robinhood) ─────────────────────────────────────────────────

async function fetchOptionBars(positions: OpenPosition[]): Promise<Map<string, ExitBar>> {
  const out = new Map<string, ExitBar>();
  if (positions.length === 0) return out;

  try {
    const { getOptionQuote } = await import('../stocks/robinhood-options.js');
    const ts = new Date().toISOString();
    for (const p of positions) {
      // OCC symbol comes from position-adapters; we encode it here as
      // "option:<occ>". We don't have OCC on OpenPosition (intentional —
      // generic shape), so the option adapter stores it in symbol when
      // OCC is the natural identifier. Fall back to symbol here.
      const occ = p.symbol; // adapter may pass underlying; quote will fail and we'll skip
      try {
        const quote = await getOptionQuote(occ);
        const mid = quote?.mid;
        if (mid && Number.isFinite(mid) && mid > 0) {
          out.set(p.symbol, { close: mid, high: mid, low: mid, ts });
        }
      } catch {
        // single-quote failure — log once below in batch terms
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, options: positions.length },
      '[exits.price] option fetch failed',
    );
  }
  return out;
}

// ── CEX (Coinbase public) ──────────────────────────────────────────────

const CEX_PRODUCT_MAP: Record<string, string> = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD',
  ADA: 'ADA-USD', DOT: 'DOT-USD', LINK: 'LINK-USD', AVAX: 'AVAX-USD',
  MATIC: 'MATIC-USD', ATOM: 'ATOM-USD', UNI: 'UNI-USD', AAVE: 'AAVE-USD',
  LTC: 'LTC-USD', DOGE: 'DOGE-USD', SHIB: 'SHIB-USD', NEAR: 'NEAR-USD',
  SUI: 'SUI-USD', ARB: 'ARB-USD', OP: 'OP-USD', FIL: 'FIL-USD',
  APT: 'APT-USD', INJ: 'INJ-USD', SEI: 'SEI-USD', RENDER: 'RENDER-USD',
  FET: 'FET-USD', TAO: 'TAO-USD', PEPE: 'PEPE-USD', BONK: 'BONK-USD',
  WIF: 'WIF-USD', JUP: 'JUP-USD',
};

async function fetchCexBars(symbols: string[]): Promise<Map<string, ExitBar>> {
  const out = new Map<string, ExitBar>();
  if (symbols.length === 0) return out;

  const ts = new Date().toISOString();
  for (const sym of symbols) {
    const productId = CEX_PRODUCT_MAP[sym] ?? `${sym}-USD`;
    try {
      const res = await fetch(
        `https://api.coinbase.com/api/v3/brokerage/market/products/${productId}`,
        { signal: AbortSignal.timeout(3_000) },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { price?: string };
      const price = parseFloat(data.price ?? '0');
      if (price > 0) {
        out.set(sym, { close: price, high: price, low: price, ts });
      }
    } catch {
      // single-fetch failure
    }
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────

export interface PriceFetchResult {
  bars: Map<string /* trackerId */, ExitBar>;
  /** Symbols we couldn't price — caller skips these positions this tick. */
  missing: string[];
}

/**
 * Fetch bars for every position. Returns a map keyed by `trackerId` so the
 * monitor can join back without re-deriving keys.
 */
export async function fetchBarsFor(positions: OpenPosition[]): Promise<PriceFetchResult> {
  const bars = new Map<string, ExitBar>();
  const missing: string[] = [];

  // Group by asset class for batched upstream calls.
  const equitySymbols = new Set<string>();
  const optionPositions: OpenPosition[] = [];
  const cexSymbols = new Set<string>();
  for (const p of positions) {
    const key = cacheKey(p.assetClass, p.symbol);
    const cached = fromCache(key);
    if (cached) {
      bars.set(p.trackerId, cached);
      continue;
    }
    switch (p.assetClass) {
      case 'equity':       equitySymbols.add(p.symbol); break;
      case 'option':       optionPositions.push(p); break;
      case 'crypto-cex':   cexSymbols.add(p.symbol); break;
      case 'crypto-dex':
        // DEX pricing not wired here yet — v3.
        missing.push(p.symbol);
        break;
    }
  }

  const [equityMap, optionMap, cexMap] = await Promise.all([
    fetchEquityBars([...equitySymbols]),
    fetchOptionBars(optionPositions),
    fetchCexBars([...cexSymbols]),
  ]);

  for (const p of positions) {
    if (bars.has(p.trackerId)) continue; // already cached
    let bar: ExitBar | undefined;
    if (p.assetClass === 'equity')      bar = equityMap.get(p.symbol);
    else if (p.assetClass === 'option') bar = optionMap.get(p.symbol);
    else if (p.assetClass === 'crypto-cex') bar = cexMap.get(p.symbol);

    if (bar) {
      bars.set(p.trackerId, bar);
      intoCache(cacheKey(p.assetClass, p.symbol), bar);
    } else {
      missing.push(p.symbol);
    }
  }

  return { bars, missing };
}

// Test hook — clears the in-memory cache.
export function _resetPriceCache(): void {
  cache.clear();
}
