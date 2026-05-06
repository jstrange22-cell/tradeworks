/**
 * Alpaca Markets API Client
 *
 * Handles authentication and all REST API calls for stock trading.
 * Supports both paper and live trading via environment config.
 *
 * Free tier: unlimited paper trading, commission-free live trading
 * Rate limits: 200 req/min
 *
 * Required env vars:
 *   ALPACA_API_KEY    — API key ID
 *   ALPACA_API_SECRET — API secret key
 *   ALPACA_PAPER      — "true" for paper trading (default)
 */

import { logger } from '../../lib/logger.js';

const ALPACA_API_KEY = process.env.ALPACA_API_KEY ?? '';
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET ?? '';
const IS_PAPER = (process.env.ALPACA_PAPER ?? 'true') === 'true';

const BASE_URL = IS_PAPER
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets';

const DATA_URL = 'https://data.alpaca.markets';

// ── Types ────────────────────────────────────────────────────────────────

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  daytrade_count: number;
  daytrading_buying_power: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  extended_hours: boolean;
  legs: AlpacaOrder[] | null;
}

export interface AlpacaBar {
  t: string;  // timestamp
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  n: number;  // number of trades
  vw: number; // volume-weighted average price
}

export interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]>;
  next_page_token: string | null;
}

export interface AlpacaSnapshot {
  latestTrade: { p: number; s: number; t: string };
  latestQuote: { ap: number; as: number; bp: number; bs: number; t: string };
  minuteBar: AlpacaBar;
  dailyBar: AlpacaBar;
  prevDailyBar: AlpacaBar;
}

export interface AlpacaAsset {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TimeInForce = 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';

export interface CreateOrderParams {
  symbol: string;
  qty?: string;
  notional?: string;  // dollar amount instead of qty
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price?: string;
  stop_price?: string;
  extended_hours?: boolean;
  order_class?: 'bracket' | 'oco' | 'oto';
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string; limit_price?: string };
}

// ── HTTP Client ──────────────────────────────────────────────────────────

async function alpacaFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  if (!ALPACA_API_KEY || !ALPACA_API_SECRET) {
    throw new Error('ALPACA_API_KEY and ALPACA_API_SECRET required. Sign up at alpaca.markets');
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      'APCA-API-KEY-ID': ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': ALPACA_API_SECRET,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Alpaca API ${res.status}: ${body}`);
  }

  // DELETE requests may return 204 No Content
  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

// ── Account ──────────────────────────────────────────────────────────────

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaFetch<AlpacaAccount>(`${BASE_URL}/v2/account`);
}

// ── Positions ────────────────────────────────────────────────────────────

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaFetch<AlpacaPosition[]>(`${BASE_URL}/v2/positions`);
}

export async function getPosition(symbol: string): Promise<AlpacaPosition> {
  return alpacaFetch<AlpacaPosition>(`${BASE_URL}/v2/positions/${symbol}`);
}

export async function closePosition(symbol: string, qty?: string): Promise<AlpacaOrder> {
  const params = qty ? `?qty=${qty}` : '';
  return alpacaFetch<AlpacaOrder>(`${BASE_URL}/v2/positions/${symbol}${params}`, {
    method: 'DELETE',
  });
}

export async function closeAllPositions(): Promise<AlpacaOrder[]> {
  return alpacaFetch<AlpacaOrder[]>(`${BASE_URL}/v2/positions`, {
    method: 'DELETE',
  });
}

// ── Orders ───────────────────────────────────────────────────────────────

export async function createOrder(params: CreateOrderParams): Promise<AlpacaOrder> {
  logger.info({ service: 'Alpaca', action: 'createOrder', ...params }, `[Alpaca] ${params.side} ${params.symbol}`);
  return alpacaFetch<AlpacaOrder>(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getOrders(status?: string, limit = 50): Promise<AlpacaOrder[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set('status', status);
  return alpacaFetch<AlpacaOrder[]>(`${BASE_URL}/v2/orders?${params}`);
}

export async function getOrder(orderId: string): Promise<AlpacaOrder> {
  return alpacaFetch<AlpacaOrder>(`${BASE_URL}/v2/orders/${orderId}`);
}

export async function cancelOrder(orderId: string): Promise<void> {
  await alpacaFetch<void>(`${BASE_URL}/v2/orders/${orderId}`, { method: 'DELETE' });
}

export async function cancelAllOrders(): Promise<void> {
  await alpacaFetch<void>(`${BASE_URL}/v2/orders`, { method: 'DELETE' });
}

/**
 * Place a bracket order: entry + take profit + stop loss in one call.
 * This is the primary order type for swing trading.
 */
export async function placeBracketOrder(params: {
  symbol: string;
  qty: string;
  side: OrderSide;
  type: OrderType;
  time_in_force: TimeInForce;
  limit_price?: string;
  take_profit_price: string;
  stop_loss_price: string;
}): Promise<AlpacaOrder> {
  return createOrder({
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: params.type,
    time_in_force: params.time_in_force,
    limit_price: params.limit_price,
    order_class: 'bracket',
    take_profit: { limit_price: params.take_profit_price },
    stop_loss: { stop_price: params.stop_loss_price },
  });
}

// ── Market Data ──────────────────────────────────────────────────────────

/**
 * Get historical bars for one or more symbols.
 * Timeframe: 1Min, 5Min, 15Min, 30Min, 1Hour, 4Hour, 1Day, 1Week, 1Month
 */
export async function getBars(params: {
  symbols: string[];
  timeframe: string;
  start?: string;   // RFC 3339
  end?: string;      // RFC 3339
  limit?: number;
  feed?: 'iex' | 'sip';  // iex = free, sip = paid
}): Promise<AlpacaBarsResponse> {
  const searchParams = new URLSearchParams({
    symbols: params.symbols.join(','),
    timeframe: params.timeframe,
    feed: params.feed ?? 'iex',
    limit: String(params.limit ?? 200),
  });
  if (params.start) searchParams.set('start', params.start);
  if (params.end) searchParams.set('end', params.end);

  return alpacaFetch<AlpacaBarsResponse>(
    `${DATA_URL}/v2/stocks/bars?${searchParams}`,
  );
}

/**
 * Get latest snapshots for multiple symbols (quote + trade + bars).
 */
export async function getSnapshots(
  symbols: string[],
  feed: 'iex' | 'sip' = 'iex',
): Promise<Record<string, AlpacaSnapshot>> {
  const params = new URLSearchParams({
    symbols: symbols.join(','),
    feed,
  });
  return alpacaFetch<Record<string, AlpacaSnapshot>>(
    `${DATA_URL}/v2/stocks/snapshots?${params}`,
  );
}

/**
 * Get tradable assets with optional filters.
 */
export async function getAssets(params?: {
  status?: 'active' | 'inactive';
  asset_class?: 'us_equity' | 'crypto';
  exchange?: string;
}): Promise<AlpacaAsset[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.asset_class) searchParams.set('asset_class', params.asset_class);
  if (params?.exchange) searchParams.set('exchange', params.exchange);
  return alpacaFetch<AlpacaAsset[]>(`${BASE_URL}/v2/assets?${searchParams}`);
}

// ── Utilities ────────────────────────────────────────────────────────────

/**
 * Is the US equity regular session open right now?
 *
 * DST-safe: uses `Intl.DateTimeFormat` with the `America/New_York` timezone,
 * which handles EST/EDT transitions automatically. Previous version
 * hardcoded UTC-4 (EDT) — broke for ~5 months/year in EST.
 *
 * Limitations:
 *   - Does NOT account for half-days (early close 1:00 PM ET on holidays)
 *   - Does NOT account for full market holidays (NYSE calendar)
 *   For tighter accuracy, swap to Alpaca's GET /v2/clock endpoint, which
 *   returns the canonical "is_open" flag + next_open / next_close.
 */
export function isMarketOpen(): boolean {
  const now = new Date();
  // Use the en-US locale `weekday` long form — robust to runtime locale.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minStr = parts.find((p) => p.type === 'minute')?.value ?? '0';

  if (weekday === 'Saturday' || weekday === 'Sunday') return false;

  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);
  const etTime = hour * 60 + minute;

  return etTime >= 9 * 60 + 30 && etTime <= 16 * 60; // 9:30 → 16:00 ET
}

export function getAlpacaConfig() {
  return {
    configured: Boolean(ALPACA_API_KEY && ALPACA_API_SECRET),
    paper: IS_PAPER,
    baseUrl: BASE_URL,
  };
}
