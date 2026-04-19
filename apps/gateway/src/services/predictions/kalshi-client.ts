/**
 * Kalshi API Client — Prediction Market Trading
 *
 * Connects to Kalshi's public API for market data and paper trading.
 * Live trading requires RSA key auth (added later).
 *
 * Base URL: https://api.elections.kalshi.com/trade-api/v2
 * Demo URL: https://demo-api.kalshi.co/trade-api/v2
 */

import { logger } from '../../lib/logger.js';

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

// ── Types ────────────────────────────────────────────────────────────────

export interface KalshiEvent {
  event_ticker: string;
  title: string;
  sub_title: string;
  category: string;
  series_ticker: string;
  mutually_exclusive: boolean;
}

export interface KalshiMarket {
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
  result: string;
  close_time: string;
}

// ── Public API (no auth needed) ──────────────────────────────────────────

async function kalshiFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${KALSHI_BASE}${path}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, '[Kalshi] API error');
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, path }, '[Kalshi] Fetch failed');
    return null;
  }
}

export async function getEvents(params?: {
  limit?: number;
  status?: string;
  series_ticker?: string;
  category?: string;
}): Promise<KalshiEvent[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.status) qs.set('status', params.status);
  if (params?.series_ticker) qs.set('series_ticker', params.series_ticker);
  const data = await kalshiFetch<{ events: KalshiEvent[] }>(`/events/?${qs}`);
  return data?.events ?? [];
}

export async function getMarkets(params?: {
  limit?: number;
  event_ticker?: string;
  series_ticker?: string;
  status?: string;
}): Promise<KalshiMarket[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.event_ticker) qs.set('event_ticker', params.event_ticker);
  if (params?.series_ticker) qs.set('series_ticker', params.series_ticker);
  if (params?.status) qs.set('status', params.status);
  const data = await kalshiFetch<{ markets: KalshiMarket[] }>(`/markets/?${qs}`);
  return data?.markets ?? [];
}

export async function getMarket(ticker: string): Promise<KalshiMarket | null> {
  const data = await kalshiFetch<{ market: KalshiMarket }>(`/markets/${ticker}/`);
  return data?.market ?? null;
}

// ── Market Discovery (for APEX intelligence) ─────────────────────────────

export async function getActiveMarketsByCategory(): Promise<Record<string, KalshiEvent[]>> {
  const events = await getEvents({ limit: 100, status: 'open' });
  const byCategory: Record<string, KalshiEvent[]> = {};
  for (const event of events) {
    const cat = event.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(event);
  }
  return byCategory;
}

export async function getCryptoMarkets(): Promise<KalshiMarket[]> {
  return getMarkets({ series_ticker: 'KXBTC', limit: 20, status: 'open' });
}

export async function getWeatherMarkets(): Promise<KalshiMarket[]> {
  return getMarkets({ series_ticker: 'KXHIGH', limit: 20, status: 'open' });
}

export async function getSportsMarkets(): Promise<KalshiEvent[]> {
  return getEvents({ limit: 20, status: 'open' });
}

// ── Paper Trading ────────────────────────────────────────────────────────

interface KalshiPaperPosition {
  ticker: string;
  title: string;
  side: 'yes' | 'no';
  qty: number;
  avgEntry: number;
  currentPrice: number;
  category: string;
}

interface KalshiPaperTrade {
  ticker: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  qty: number;
  price: number;
  pnlUsd: number;
  timestamp: string;
}

const KALSHI_PAPER_CAPITAL = 1000;

const kalshiPaper = {
  cashUsd: KALSHI_PAPER_CAPITAL,
  positions: new Map<string, KalshiPaperPosition>(),
  trades: [] as KalshiPaperTrade[],
  totalPnlUsd: 0,
  wins: 0,
  losses: 0,
};

const KALSHI_MAX_POSITIONS = 10;       // Max open positions (was 15 — too many)
const KALSHI_MAX_BET_SIZE = 15;        // Max $15 per bet (was $25 — too aggressive)
const KALSHI_MIN_CASH_RESERVE = 200;   // Keep $200 cash reserve
const KALSHI_MAX_DAILY_TRADES = 30;    // Max trades per day
let kalshiDailyTradeCount = 0;
let kalshiDailyResetDate = new Date().toISOString().slice(0, 10);

export function kalshiPaperBuy(ticker: string, title: string, side: 'yes' | 'no', qty: number, price: number, category: string): boolean {
  // Reject invalid inputs upfront — prevents ghost positions with qty=0 or price=0
  if (qty <= 0 || price <= 0 || price > 1) {
    logger.warn({ ticker, qty, price }, '[Kalshi] PAPER BUY rejected: invalid qty or price');
    return false;
  }

  // Daily reset
  const today = new Date().toISOString().slice(0, 10);
  if (today !== kalshiDailyResetDate) { kalshiDailyTradeCount = 0; kalshiDailyResetDate = today; }

  // Cap bet size FIRST
  qty = Math.min(qty, Math.floor(KALSHI_MAX_BET_SIZE / Math.max(price, 0.01)));
  if (qty <= 0) return false;

  const cost = qty * price;
  if (cost < 0.01) return false; // Reject dust trades
  if (kalshiPaper.cashUsd < cost) return false;

  // Enforce max positions — no new positions if at limit
  if (kalshiPaper.positions.size >= KALSHI_MAX_POSITIONS && !kalshiPaper.positions.has(`${ticker}-${side}`)) {
    return false;
  }

  // Enforce cash reserve — don't trade below $400
  if (kalshiPaper.cashUsd - cost < KALSHI_MIN_CASH_RESERVE) return false;

  // Daily trade limit
  if (kalshiDailyTradeCount >= KALSHI_MAX_DAILY_TRADES) return false;
  kalshiDailyTradeCount++;

  const existing = kalshiPaper.positions.get(`${ticker}-${side}`);
  if (existing) {
    const totalQty = existing.qty + qty;
    existing.avgEntry = ((existing.avgEntry * existing.qty) + (price * qty)) / totalQty;
    existing.qty = totalQty;
  } else {
    kalshiPaper.positions.set(`${ticker}-${side}`, {
      ticker, title, side, qty, avgEntry: price, currentPrice: price, category,
    });
  }

  kalshiPaper.cashUsd -= cost;
  kalshiPaper.trades.push({ ticker, side, action: 'buy', qty, price, pnlUsd: 0, timestamp: new Date().toISOString() });
  logger.info({ ticker, side, qty, price, cash: kalshiPaper.cashUsd.toFixed(2) }, `[Kalshi] PAPER BUY ${ticker} ${side.toUpperCase()}`);
  return true;
}

export function kalshiPaperSell(ticker: string, side: 'yes' | 'no', qty: number, price: number): boolean {
  const key = `${ticker}-${side}`;
  const pos = kalshiPaper.positions.get(key);
  if (!pos) return false;

  // Ghost position cleanup — if pos.qty is 0, just delete it without recording
  if (pos.qty <= 0) {
    kalshiPaper.positions.delete(key);
    logger.warn({ ticker, side }, '[Kalshi] Removed ghost position with qty=0');
    return true;
  }

  const sellQty = Math.min(qty, pos.qty);
  const pnl = (price - pos.avgEntry) * sellQty;
  kalshiPaper.totalPnlUsd += pnl;
  kalshiPaper.cashUsd += sellQty * price;

  // Record W/L based on whether we made or lost money
  if (pnl > 0) {
    kalshiPaper.wins++;
  } else {
    kalshiPaper.losses++;
  }

  kalshiPaper.trades.push({ ticker, side, action: 'sell', qty: sellQty, price, pnlUsd: pnl, timestamp: new Date().toISOString() });

  if (sellQty >= pos.qty) {
    kalshiPaper.positions.delete(key);
  } else {
    pos.qty -= sellQty;
  }

  const result = pnl > 0 ? 'WIN' : 'LOSS';
  logger.info({ ticker, side, pnl: pnl.toFixed(2), result, cash: kalshiPaper.cashUsd.toFixed(2) }, `[Kalshi] PAPER SELL ${ticker} ${result} P&L: $${pnl.toFixed(2)}`);
  return true;
}

/** Remove ghost positions (qty=0) and positions for invalid/non-existent tickers */
export function purgeGhostPositions(invalidTickers?: string[]): number {
  let purged = 0;
  for (const [key, pos] of kalshiPaper.positions) {
    const isGhost = pos.qty <= 0 || pos.avgEntry <= 0;
    const isInvalid = invalidTickers?.some(t => pos.ticker.startsWith(t)) ?? false;
    if (isGhost || isInvalid) {
      kalshiPaper.positions.delete(key);
      purged++;
      logger.info({ ticker: pos.ticker, qty: pos.qty, avgEntry: pos.avgEntry, reason: isGhost ? 'ghost' : 'invalid_ticker' }, `[Kalshi] Purged position: ${pos.ticker}`);
    }
  }
  return purged;
}

/** Update a position's current price (called by monitor cycle) */
export function updateKalshiPositionPrice(ticker: string, side: 'yes' | 'no', newPrice: number): void {
  const key = `${ticker}-${side}`;
  const pos = kalshiPaper.positions.get(key);
  if (pos) pos.currentPrice = newPrice;
}

export function getKalshiPaperPortfolio() {
  let positionsValue = 0;
  const openPositions = [];
  for (const [, pos] of kalshiPaper.positions) {
    const value = pos.qty * pos.currentPrice;
    positionsValue += value;
    openPositions.push({
      ...pos,
      value,
      pnlUsd: (pos.currentPrice - pos.avgEntry) * pos.qty,
      pnlPct: pos.avgEntry > 0 ? ((pos.currentPrice - pos.avgEntry) / pos.avgEntry) * 100 : 0,
    });
  }

  const totalValue = kalshiPaper.cashUsd + positionsValue;
  const derivedPnl = totalValue - KALSHI_PAPER_CAPITAL;

  return {
    startingCapital: KALSHI_PAPER_CAPITAL,
    cashUsd: Math.round(kalshiPaper.cashUsd * 100) / 100,
    positionsValue: Math.round(positionsValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnlUsd: Math.round(derivedPnl * 100) / 100,
    trades: kalshiPaper.trades.length,
    wins: kalshiPaper.wins,
    losses: kalshiPaper.losses,
    winRate: kalshiPaper.trades.length > 0 ? Math.round((kalshiPaper.wins / kalshiPaper.trades.filter(t => t.action === 'sell').length) * 100) : 0,
    openPositions,
    recentTrades: kalshiPaper.trades.slice(-20),
    derivedPnlMatch: Math.abs(derivedPnl - kalshiPaper.totalPnlUsd) < 1.0,
  };
}
