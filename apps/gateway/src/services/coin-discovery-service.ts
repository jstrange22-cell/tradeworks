/**
 * Coin Discovery Service — Autonomous Crypto Universe Expansion
 *
 * Discovers hot/upcoming coins from multiple sources every 15 minutes:
 *   1. CoinGecko Trending (top 7 by search volume)
 *   2. CoinGecko Top Volume (top 50 by 24h volume)
 *   3. Volume Spike Detection (3x+ vs average)
 *   4. TradingView Signal Injection
 *
 * Discovered coins get scored 0-100 and added to the trading universe
 * if they pass minimum thresholds. Auto-expire after 72 hours.
 */

import { logger } from '../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface DiscoveredCoin {
  id: string;            // CoinGecko ID
  symbol: string;        // e.g. 'PEPE'
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  sources: string[];     // which discovery sources flagged it
  discoveryScore: number;
  coinbasePair: string | null; // e.g. 'PEPE-USD' if on Coinbase
  discoveredAt: string;
  expiresAt: string;     // 72 hours from discovery
}

// ── State ────────────────────────────────────────────────────────────────

const discoveredCoins = new Map<string, DiscoveredCoin>();
const DISCOVERY_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

// Known Coinbase-listed pairs (fetched once at startup, refreshed daily)
let coinbasePairs = new Set<string>();
let coinbasePairsFetchedAt = 0;

async function refreshCoinbasePairs(): Promise<void> {
  if (Date.now() - coinbasePairsFetchedAt < 24 * 60 * 60 * 1000 && coinbasePairs.size > 0) return;
  try {
    const res = await fetch('https://api.exchange.coinbase.com/products', {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const products = await res.json() as Array<{ id: string; status: string; base_currency: string }>;
      coinbasePairs = new Set(
        products
          .filter(p => p.status === 'online' && p.id.endsWith('-USD'))
          .map(p => p.id),
      );
      coinbasePairsFetchedAt = Date.now();
      logger.info({ pairs: coinbasePairs.size }, '[Discovery] Coinbase pairs refreshed');
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[Discovery] Failed to fetch Coinbase pairs');
  }
}

function isOnCoinbase(symbol: string): string | null {
  const pair = `${symbol.toUpperCase()}-USD`;
  return coinbasePairs.has(pair) ? pair : null;
}

// ── Discovery Sources ────────────────────────────────────────────────────

async function fetchCoinGeckoTrending(): Promise<Partial<DiscoveredCoin>[]> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];

    const data = await res.json() as {
      coins: Array<{
        item: {
          id: string;
          symbol: string;
          name: string;
          data?: { price?: number; price_change_percentage_24h?: { usd?: number }; total_volume?: { usd?: number }; market_cap?: { usd?: number } };
        };
      }>;
    };

    return (data.coins ?? []).map(c => ({
      id: c.item.id,
      symbol: c.item.symbol.toUpperCase(),
      name: c.item.name,
      price: c.item.data?.price ?? 0,
      change24h: c.item.data?.price_change_percentage_24h?.usd ?? 0,
      volume24h: c.item.data?.total_volume?.usd ?? 0,
      marketCap: c.item.data?.market_cap?.usd ?? 0,
      sources: ['coingecko_trending'],
    }));
  } catch {
    return [];
  }
}

async function fetchCoinGeckoTopVolume(): Promise<Partial<DiscoveredCoin>[]> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=50&page=1&sparkline=false',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];

    const coins = await res.json() as Array<{
      id: string;
      symbol: string;
      name: string;
      current_price: number;
      price_change_percentage_24h: number;
      total_volume: number;
      market_cap: number;
    }>;

    // Return top volume coins + any with meaningful movement (>1%)
    // Lowered thresholds to discover more coins for paper testing
    return coins
      .filter(c => Math.abs(c.price_change_percentage_24h) > 1 || c.total_volume > 50_000_000)
      .map(c => ({
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        price: c.current_price,
        change24h: c.price_change_percentage_24h,
        volume24h: c.total_volume,
        marketCap: c.market_cap,
        sources: [c.price_change_percentage_24h > 10 ? 'top_gainer' : 'high_volume'],
      }));
  } catch {
    return [];
  }
}

async function fetchCoinGeckoTopGainers(): Promise<Partial<DiscoveredCoin>[]> {
  try {
    // Fetch top 100 coins sorted by price change (biggest movers)
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=percent_change_24h_desc&per_page=100&page=1&sparkline=false',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];

    const coins = await res.json() as Array<{
      id: string;
      symbol: string;
      name: string;
      current_price: number;
      price_change_percentage_24h: number;
      total_volume: number;
      market_cap: number;
    }>;

    // Return all coins with >3% gains — these are the hot ones
    return coins
      .filter(c => c.price_change_percentage_24h > 3 && c.total_volume > 100_000)
      .slice(0, 30) // top 30 gainers
      .map(c => ({
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        price: c.current_price,
        change24h: c.price_change_percentage_24h,
        volume24h: c.total_volume,
        marketCap: c.market_cap,
        sources: ['top_gainer'],
      }));
  } catch {
    return [];
  }
}

// ── Scoring ──────────────────────────────────────────────────────────────

function scoreCoin(coin: Partial<DiscoveredCoin>): number {
  let score = 0;
  const sources = coin.sources ?? [];

  // Source bonuses
  if (sources.includes('coingecko_trending')) score += 25;
  if (sources.includes('top_gainer')) score += 20;
  if (sources.includes('high_volume')) score += 15;
  if (sources.includes('tradingview_signal')) score += 30;
  if (sources.includes('volume_spike')) score += 20;

  // 24h change bonus
  const change = coin.change24h ?? 0;
  if (change > 20) score += 15;
  else if (change > 10) score += 10;
  else if (change > 5) score += 5;

  // Market cap assessment
  const mcap = coin.marketCap ?? 0;
  if (mcap > 1_000_000_000) score += 5;   // >$1B = established
  else if (mcap > 100_000_000) score += 3; // >$100M = mid-cap
  else if (mcap < 10_000_000) score -= 10; // <$10M = too small for CEX

  // Volume check
  const vol = coin.volume24h ?? 0;
  if (vol > 100_000_000) score += 5;
  else if (vol < 1_000_000) score -= 15;   // Low liquidity penalty

  return Math.max(0, Math.min(100, score));
}

// ── Main Discovery Function ──────────────────────────────────────────────

export async function discoverNewCoins(): Promise<DiscoveredCoin[]> {
  await refreshCoinbasePairs();

  // Fetch from all sources in parallel
  const [trending, topVolume, topGainers] = await Promise.all([
    fetchCoinGeckoTrending(),
    fetchCoinGeckoTopVolume(),
    fetchCoinGeckoTopGainers(),
  ]);

  // Small delay between CoinGecko calls to respect rate limits
  // (trending and topVolume already ran in parallel, this is for the next scan)

  // Merge all sources
  const allCoins = new Map<string, Partial<DiscoveredCoin>>();

  for (const coin of [...trending, ...topVolume, ...topGainers]) {
    if (!coin.symbol) continue;
    const existing = allCoins.get(coin.symbol);
    if (existing) {
      // Merge sources
      existing.sources = [...new Set([...(existing.sources ?? []), ...(coin.sources ?? [])])];
      // Take best data
      if ((coin.price ?? 0) > 0 && !(existing.price)) existing.price = coin.price;
      if ((coin.volume24h ?? 0) > (existing.volume24h ?? 0)) existing.volume24h = coin.volume24h;
      if ((coin.marketCap ?? 0) > (existing.marketCap ?? 0)) existing.marketCap = coin.marketCap;
    } else {
      allCoins.set(coin.symbol, { ...coin });
    }
  }

  // Score, filter, and build final list
  const now = new Date();
  const results: DiscoveredCoin[] = [];

  for (const [symbol, coin] of allCoins) {
    const score = scoreCoin(coin);
    const cbPair = isOnCoinbase(symbol);

    // Must be on Coinbase (we need to be able to trade it)
    if (!cbPair) continue;

    // Minimum score — lowered for paper mode to discover more coins
    if (score < 25) continue;

    // Minimum volume — lowered for paper testing
    if ((coin.volume24h ?? 0) < 100_000) continue;

    // Skip if already discovered and not expired
    if (discoveredCoins.has(symbol)) {
      const existing = discoveredCoins.get(symbol)!;
      // Update score if higher
      if (score > existing.discoveryScore) {
        existing.discoveryScore = score;
        existing.sources = [...new Set([...existing.sources, ...(coin.sources ?? [])])];
      }
      continue;
    }

    const discovered: DiscoveredCoin = {
      id: coin.id ?? symbol.toLowerCase(),
      symbol,
      name: coin.name ?? symbol,
      price: coin.price ?? 0,
      change24h: coin.change24h ?? 0,
      volume24h: coin.volume24h ?? 0,
      marketCap: coin.marketCap ?? 0,
      sources: coin.sources ?? [],
      discoveryScore: score,
      coinbasePair: cbPair,
      discoveredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + DISCOVERY_TTL_MS).toISOString(),
    };

    discoveredCoins.set(symbol, discovered);
    results.push(discovered);
  }

  // Cleanup expired
  for (const [symbol, coin] of discoveredCoins) {
    if (new Date(coin.expiresAt) < now) {
      discoveredCoins.delete(symbol);
    }
  }

  if (results.length > 0) {
    logger.info(
      { newCoins: results.length, total: discoveredCoins.size, symbols: results.map(c => c.symbol).join(', ') },
      '[Discovery] New coins discovered',
    );
  }

  return results;
}

// ── TradingView Signal Injection ─────────────────────────────────────────

export function injectTradingViewDiscovery(symbol: string, price: number): void {
  const cbPair = isOnCoinbase(symbol.replace('USDT', '').replace('USD', ''));
  if (!cbPair) return;

  const cleanSymbol = symbol.replace('USDT', '').replace('USD', '').toUpperCase();

  if (discoveredCoins.has(cleanSymbol)) {
    const existing = discoveredCoins.get(cleanSymbol)!;
    if (!existing.sources.includes('tradingview_signal')) {
      existing.sources.push('tradingview_signal');
      existing.discoveryScore = Math.min(100, existing.discoveryScore + 30);
    }
    return;
  }

  const now = new Date();
  discoveredCoins.set(cleanSymbol, {
    id: cleanSymbol.toLowerCase(),
    symbol: cleanSymbol,
    name: cleanSymbol,
    price,
    change24h: 0,
    volume24h: 0,
    marketCap: 0,
    sources: ['tradingview_signal'],
    discoveryScore: 50, // Base score for TradingView signal
    coinbasePair: cbPair,
    discoveredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DISCOVERY_TTL_MS).toISOString(),
  });

  logger.info({ symbol: cleanSymbol, price }, '[Discovery] TradingView signal added coin');
}

// ── Public Getters ───────────────────────────────────────────────────────

export function getDiscoveredCoins(): DiscoveredCoin[] {
  return [...discoveredCoins.values()].sort((a, b) => b.discoveryScore - a.discoveryScore);
}

export function getDiscoveredCoinbasePairs(): string[] {
  return [...discoveredCoins.values()]
    .filter(c => c.coinbasePair)
    .map(c => c.coinbasePair!);
}

export function getDiscoveryStats(): { total: number; sources: Record<string, number> } {
  const sources: Record<string, number> = {};
  for (const coin of discoveredCoins.values()) {
    for (const src of coin.sources) {
      sources[src] = (sources[src] ?? 0) + 1;
    }
  }
  return { total: discoveredCoins.size, sources };
}
