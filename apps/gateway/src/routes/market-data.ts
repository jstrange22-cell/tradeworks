import { Router, type Router as RouterType } from 'express';
import { getMacroRegime } from '../services/ai/macro-regime.js';

/**
 * Market data proxy routes.
 * Proxies requests to Crypto.com Exchange public API.
 * No authentication required - all endpoints are public market data.
 *
 * GET /api/v1/market/tickers?instrument_name=BTC_USDT
 * GET /api/v1/market/candlestick?instrument_name=BTC_USDT&timeframe=1h
 * GET /api/v1/market/book?instrument_name=BTC_USDT&depth=10
 * GET /api/v1/market/trades?instrument_name=BTC_USDT&count=20
 */

const CRYPTO_API_BASE = 'https://api.crypto.com/exchange/v1/public';

export const marketDataRouter: RouterType = Router();

async function proxyCryptoApi(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${CRYPTO_API_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Crypto.com API error: ${res.status}`);
  return res.json();
}

marketDataRouter.get('/tickers', async (req, res) => {
  try {
    const instrument_name = req.query.instrument_name as string | undefined;
    const params: Record<string, string> = {};
    if (instrument_name) params.instrument_name = instrument_name;

    const data = await proxyCryptoApi('get-tickers', params);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch tickers', message: String(err) });
  }
});

marketDataRouter.get('/candlestick', async (req, res) => {
  try {
    const { instrument_name, timeframe } = req.query as Record<string, string>;
    if (!instrument_name) {
      res.status(400).json({ error: 'instrument_name is required' });
      return;
    }

    const data = await proxyCryptoApi('get-candlestick', {
      instrument_name,
      timeframe: timeframe || '1h',
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch candlestick', message: String(err) });
  }
});

marketDataRouter.get('/book', async (req, res) => {
  try {
    const { instrument_name, depth } = req.query as Record<string, string>;
    if (!instrument_name) {
      res.status(400).json({ error: 'instrument_name is required' });
      return;
    }

    const data = await proxyCryptoApi('get-book', {
      instrument_name,
      depth: depth || '10',
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch order book', message: String(err) });
  }
});

marketDataRouter.get('/trades', async (req, res) => {
  try {
    const { instrument_name, count } = req.query as Record<string, string>;
    if (!instrument_name) {
      res.status(400).json({ error: 'instrument_name is required' });
      return;
    }

    const data = await proxyCryptoApi('get-trades', {
      instrument_name,
      count: count || '20',
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch trades', message: String(err) });
  }
});

// ── Macro Regime ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/market/regime
 * Returns the current macro market regime (risk_on, risk_off, transitioning, crisis)
 * with signals breakdown, confidence score, and position size multiplier.
 * Cached for 5 minutes to avoid excessive API calls.
 */
marketDataRouter.get('/regime', async (_req, res) => {
  try {
    const regime = await getMacroRegime();
    res.json({ data: regime });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to classify macro regime',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
