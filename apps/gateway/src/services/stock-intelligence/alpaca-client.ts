/**
 * Minimal Alpaca paper-API client for v2 stock execution.
 *
 * Why this exists:
 *   The previous `executeEquitySignal` only wrote to v2's local
 *   data/stocks/paper-state.json ledger — no orders ever reached Alpaca's
 *   paper API. This module submits real paper orders so we get realistic
 *   fill behavior (slippage, market hours, halts), visible in the Alpaca
 *   dashboard alongside the local cockpit view.
 *
 * Design:
 *   - Always uses the paper endpoint when ALPACA_PAPER=true (the default).
 *   - Live endpoint only used if ENABLE_LIVE_EQUITIES=true AND ALPACA_PAPER=false.
 *   - All errors are returned in the result object — callers fall back to
 *     local-only behavior on Alpaca failures (logged as warnings, not errors).
 *   - decisionId is sent as `client_order_id` for end-to-end traceability.
 *
 * No SDK — single fetch call per endpoint, fewer dependencies.
 */
import { logger } from '../../lib/logger.js';

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const LIVE_BASE_URL = 'https://api.alpaca.markets';

function getBaseUrl(): string {
  const usePaper = process.env['ALPACA_PAPER'] !== 'false'; // default to paper
  const liveAllowed = process.env['ENABLE_LIVE_EQUITIES'] === 'true';
  return usePaper || !liveAllowed ? PAPER_BASE_URL : LIVE_BASE_URL;
}

function getCredentials(): { apiKey: string; apiSecret: string } | null {
  const apiKey = process.env['ALPACA_API_KEY'];
  const apiSecret = process.env['ALPACA_API_SECRET'];
  if (!apiKey || !apiSecret) {
    logger.warn('[alpaca] ALPACA_API_KEY / ALPACA_API_SECRET not set — skipping');
    return null;
  }
  return { apiKey, apiSecret };
}

function buildHeaders(creds: { apiKey: string; apiSecret: string }): Record<string, string> {
  return {
    'APCA-API-KEY-ID': creds.apiKey,
    'APCA-API-SECRET-KEY': creds.apiSecret,
    'Content-Type': 'application/json',
  };
}

export interface AlpacaOrderRequest {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  /** Caller-supplied UUID (we use decisionId) for traceability. */
  clientOrderId: string;
  type?: 'market' | 'limit';
  /** Required when type='limit'. */
  limitPrice?: number;
  timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
}

export interface AlpacaOrderResult {
  ok: boolean;
  /** Alpaca's order id (server-side) when ok. */
  orderId?: string;
  /** Echoed client_order_id for verification. */
  clientOrderId?: string;
  status?: string;
  /** Filled qty (string per Alpaca convention). */
  filledQty?: string;
  /** Average fill price (string per Alpaca convention). */
  filledAvgPrice?: string;
  /** Error message when !ok. */
  error?: string;
  /** HTTP status when applicable. */
  httpStatus?: number;
}

/**
 * Submit a paper-mode market order to Alpaca. Returns a result object
 * (never throws) so callers can fall back to local-only behavior if
 * Alpaca is unreachable or rejects the request.
 */
export async function submitOrder(req: AlpacaOrderRequest): Promise<AlpacaOrderResult> {
  const creds = getCredentials();
  if (!creds) {
    return { ok: false, error: 'no_credentials' };
  }

  const baseUrl = getBaseUrl();
  const body = {
    symbol: req.symbol.toUpperCase(),
    qty: String(req.qty),
    side: req.side,
    type: req.type ?? 'market',
    time_in_force: req.timeInForce ?? 'day',
    client_order_id: req.clientOrderId,
    ...(req.type === 'limit' && req.limitPrice !== undefined ? { limit_price: String(req.limitPrice) } : {}),
  };

  try {
    const resp = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: buildHeaders(creds),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn(
        { symbol: req.symbol, side: req.side, qty: req.qty, status: resp.status, body: errText.slice(0, 200) },
        '[alpaca] order submission rejected',
      );
      return { ok: false, error: errText.slice(0, 200) || resp.statusText, httpStatus: resp.status };
    }

    const data = await resp.json() as {
      id?: string;
      client_order_id?: string;
      status?: string;
      filled_qty?: string;
      filled_avg_price?: string;
    };

    logger.info(
      {
        symbol: req.symbol,
        side: req.side,
        qty: req.qty,
        alpacaOrderId: data.id,
        clientOrderId: data.client_order_id,
        status: data.status,
        baseUrl: baseUrl.includes('paper') ? 'paper' : 'live',
      },
      `[alpaca] order submitted`,
    );

    return {
      ok: true,
      orderId: data.id,
      clientOrderId: data.client_order_id,
      status: data.status,
      filledQty: data.filled_qty,
      filledAvgPrice: data.filled_avg_price,
      httpStatus: resp.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, symbol: req.symbol }, '[alpaca] submitOrder threw');
    return { ok: false, error: msg };
  }
}

/**
 * Close an open Alpaca paper position by symbol. Uses DELETE
 * /v2/positions/{symbol} which liquidates at market. Returns a result
 * object (never throws) — callers can fall back to local-only on failure.
 */
export async function closePosition(symbol: string): Promise<AlpacaOrderResult> {
  const creds = getCredentials();
  if (!creds) {
    return { ok: false, error: 'no_credentials' };
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v2/positions/${encodeURIComponent(symbol.toUpperCase())}`;

  try {
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: buildHeaders(creds),
    });

    if (!resp.ok) {
      // 404 is common — position not present at Alpaca (e.g., entry never made
      // it through). Log info, not warn, in that case.
      const errText = await resp.text().catch(() => '');
      const log = resp.status === 404 ? logger.info : logger.warn;
      log(
        { symbol, status: resp.status, body: errText.slice(0, 200) },
        '[alpaca] close position rejected',
      );
      return { ok: false, error: errText.slice(0, 200) || resp.statusText, httpStatus: resp.status };
    }

    const data = await resp.json() as {
      id?: string;
      client_order_id?: string;
      status?: string;
      filled_qty?: string;
      filled_avg_price?: string;
    };

    logger.info(
      { symbol, alpacaOrderId: data.id, status: data.status },
      `[alpaca] close-position submitted`,
    );

    return {
      ok: true,
      orderId: data.id,
      clientOrderId: data.client_order_id,
      status: data.status,
      filledQty: data.filled_qty,
      filledAvgPrice: data.filled_avg_price,
      httpStatus: resp.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, symbol }, '[alpaca] closePosition threw');
    return { ok: false, error: msg };
  }
}
