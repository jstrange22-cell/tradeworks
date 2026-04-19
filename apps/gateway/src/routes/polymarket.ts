import { Router, type Router as RouterType } from 'express';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { ClobClient, Chain, Side, OrderType } from '@polymarket/clob-client';
import type { ApiKeyCreds } from '@polymarket/clob-client';
import { encryptApiKey, decryptApiKey } from '@tradeworks/db';
import { z } from 'zod';
import { getMemoryKeysByService, upsertMemoryKey } from './api-keys.js';

/**
 * Polymarket CLOB integration routes.
 *
 * POST   /api/v1/polymarket/setup         — Store private key, derive API creds
 * GET    /api/v1/polymarket/status        — Check connection status
 * GET    /api/v1/polymarket/balance       — USDC balance (COLLATERAL)
 * GET    /api/v1/polymarket/positions     — Open positions via Gamma API
 * GET    /api/v1/polymarket/markets       — Browse/search prediction markets
 * GET    /api/v1/polymarket/orders        — Open orders
 * POST   /api/v1/polymarket/order         — Place a limit order
 * DELETE /api/v1/polymarket/order/:id     — Cancel an order
 */

export const polymarketRouter: RouterType = Router();

const CLOB_HOST = 'https://clob.polymarket.com';

// ── Internal helpers ────────────────────────────────────────────────────

interface PolymarketContext {
  client: ClobClient;
  funderAddress: string;
}

function loadPolymarketCreds(): { privateKey: string; creds: ApiKeyCreds; funderAddress: string } | null {
  const keys = getMemoryKeysByService('polymarket');
  if (keys.length === 0) return null;

  const keyRecord = keys[0];
  const privateKey = decryptApiKey(keyRecord.encryptedKey as Buffer);
  const credsRaw = keyRecord.encryptedSecret
    ? decryptApiKey(keyRecord.encryptedSecret as Buffer)
    : null;

  if (!credsRaw) return null;

  const creds = JSON.parse(credsRaw) as ApiKeyCreds;
  const funderAddress = keyRecord.keyName;

  return { privateKey, creds, funderAddress };
}

function createSigner(privateKey: string) {
  const key = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: polygon, transport: http() });
}

async function getPolymarketClient(): Promise<PolymarketContext | null> {
  const stored = loadPolymarketCreds();
  if (!stored) return null;

  const signer = createSigner(stored.privateKey);
  const client = new ClobClient(CLOB_HOST, Chain.POLYGON, signer, stored.creds);
  return { client, funderAddress: stored.funderAddress };
}

// ── POST /setup ─────────────────────────────────────────────────────────

const SetupSchema = z.object({
  privateKey: z.string().min(60, 'Must be a valid EVM private key'),
});

polymarketRouter.post('/setup', async (req, res) => {
  try {
    const { privateKey } = SetupSchema.parse(req.body);
    const normalizedKey = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;

    const signer = createSigner(normalizedKey);
    const account = privateKeyToAccount(normalizedKey);
    const funderAddress = account.address;

    // Create L1-only client to derive API credentials
    const l1Client = new ClobClient(CLOB_HOST, Chain.POLYGON, signer);
    const creds = await l1Client.createOrDeriveApiKey();

    // Encrypt and store
    const encKey = encryptApiKey(normalizedKey);
    const encCreds = encryptApiKey(JSON.stringify(creds));
    upsertMemoryKey('polymarket', funderAddress, encKey, 'production', encCreds);

    res.json({
      data: { connected: true, funderAddress },
      message: 'Polymarket connected successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid private key', details: error.errors });
      return;
    }
    console.error('[Polymarket] Setup failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Setup failed' });
  }
});

// ── GET /status ─────────────────────────────────────────────────────────

polymarketRouter.get('/status', (_req, res) => {
  const keys = getMemoryKeysByService('polymarket');
  if (keys.length === 0) {
    res.json({ data: { connected: false } });
    return;
  }
  res.json({ data: { connected: true, funderAddress: keys[0].keyName } });
});

// ── GET /balance ────────────────────────────────────────────────────────

polymarketRouter.get('/balance', async (_req, res) => {
  try {
    const ctx = await getPolymarketClient();
    if (!ctx) {
      res.status(400).json({ error: 'Polymarket not connected. Run setup first.' });
      return;
    }

    // COLLATERAL = USDC cash balance available to trade
    const result = await ctx.client.getBalanceAllowance({ asset_type: 'COLLATERAL' } as Parameters<typeof ctx.client.getBalanceAllowance>[0]);
    // Balance is in USDC (6 decimals on Polygon)
    const usdc = parseFloat(result.balance) / 1e6;

    res.json({ data: { usdc, raw: result.balance, funderAddress: ctx.funderAddress } });
  } catch (error) {
    console.error('[Polymarket] Balance fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch balance' });
  }
});

// ── GET /positions ──────────────────────────────────────────────────────

polymarketRouter.get('/positions', async (_req, res) => {
  try {
    const stored = loadPolymarketCreds();
    if (!stored) {
      res.status(400).json({ error: 'Polymarket not connected. Run setup first.' });
      return;
    }

    // Gamma data API returns positions with current market prices — no auth needed
    const response = await fetch(
      `https://data-api.polymarket.com/positions?user=${stored.funderAddress}&sizeThreshold=.01`,
    );

    if (!response.ok) {
      res.json({ data: [] });
      return;
    }

    const positions = await response.json();
    res.json({ data: Array.isArray(positions) ? positions : [] });
  } catch (error) {
    console.error('[Polymarket] Positions fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch positions' });
  }
});

// ── GET /markets ────────────────────────────────────────────────────────

polymarketRouter.get('/markets', async (req, res) => {
  try {
    const ctx = await getPolymarketClient();
    if (!ctx) {
      res.status(400).json({ error: 'Polymarket not connected. Run setup first.' });
      return;
    }

    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : '';
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const result = await ctx.client.getSimplifiedMarkets(cursor);
    let markets = Array.isArray(result.data) ? result.data : [];

    if (search) {
      markets = markets.filter((m: Record<string, unknown>) => {
        const question = typeof m.question === 'string' ? m.question.toLowerCase() : '';
        const slug = typeof m.market_slug === 'string' ? m.market_slug.toLowerCase() : '';
        return question.includes(search) || slug.includes(search);
      });
    }

    res.json({ data: markets, next_cursor: result.next_cursor, count: result.count });
  } catch (error) {
    console.error('[Polymarket] Markets fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch markets' });
  }
});

// ── GET /orders ─────────────────────────────────────────────────────────

polymarketRouter.get('/orders', async (_req, res) => {
  try {
    const ctx = await getPolymarketClient();
    if (!ctx) {
      res.status(400).json({ error: 'Polymarket not connected. Run setup first.' });
      return;
    }

    const orders = await ctx.client.getOpenOrders();
    res.json({ data: Array.isArray(orders) ? orders : [] });
  } catch (error) {
    console.error('[Polymarket] Orders fetch failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch orders' });
  }
});

// ── POST /order ─────────────────────────────────────────────────────────

const OrderSchema = z.object({
  tokenID: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  price: z.number().min(0.01).max(0.99),
  size: z.number().positive(),
  orderType: z.enum(['GTC', 'GTD']).optional().default('GTC'),
});

polymarketRouter.post('/order', async (req, res) => {
  try {
    const body = OrderSchema.parse(req.body);
    const ctx = await getPolymarketClient();
    if (!ctx) {
      res.status(400).json({ error: 'Polymarket not connected. Run setup first.' });
      return;
    }

    const [tickSize, negRisk] = await Promise.all([
      ctx.client.getTickSize(body.tokenID),
      ctx.client.getNegRisk(body.tokenID),
    ]);

    const orderTypeEnum = body.orderType === 'GTD' ? OrderType.GTD : OrderType.GTC;
    const sideEnum = body.side === 'BUY' ? Side.BUY : Side.SELL;

    const order = await ctx.client.createAndPostOrder(
      { tokenID: body.tokenID, price: body.price, size: body.size, side: sideEnum },
      { tickSize, negRisk },
      orderTypeEnum,
    );

    res.json({ data: order });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid order params', details: error.errors });
      return;
    }
    console.error('[Polymarket] Order failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Order failed' });
  }
});

// ── DELETE /order/:orderId ───────────────────────────────────────────────

polymarketRouter.delete('/order/:orderId', async (req, res) => {
  try {
    const ctx = await getPolymarketClient();
    if (!ctx) {
      res.status(400).json({ error: 'Polymarket not connected. Run setup first.' });
      return;
    }

    const result = await ctx.client.cancelOrder({ orderID: req.params.orderId as string });
    res.json({ data: result });
  } catch (error) {
    console.error('[Polymarket] Cancel failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Cancel failed' });
  }
});

// ── Prediction Market Intelligence ─────────────────────────────────────

import {
  scanPredictionArbitrage,
  getTrendingMarkets,
  analyzeMarket,
} from '../services/predictions/polymarket-arb.js';

// GET /arb — Scan for prediction market arbitrage opportunities
polymarketRouter.get('/arb', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || '200', 10);
    const result = await scanPredictionArbitrage(limit);
    res.json({
      data: result.opportunities,
      count: result.opportunities.length,
      marketsScanned: result.marketsScanned,
      timestamp: result.timestamp,
    });
  } catch (err) {
    res.status(502).json({ error: 'Arbitrage scan failed', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /trending — Top markets by volume
polymarketRouter.get('/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || '20', 10);
    const markets = await getTrendingMarkets(limit);
    res.json({ data: markets, count: markets.length });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch trending markets', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /analyze/:slug — Deep analysis of a specific market
polymarketRouter.get('/analyze/:slug', async (req, res) => {
  try {
    const result = await analyzeMarket(req.params.slug);
    if (!result.market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    res.json({ data: result });
  } catch (err) {
    res.status(502).json({ error: 'Analysis failed', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// ── Kalshi Intelligence (APEX Predator) ─────────────────────────────────

import {
  scanPredictionMarkets,
  getWeatherForecasts,
  getCrypto15MinSignals,
  getAllCategoryScores,
} from '../services/predictions/kalshi-intelligence.js';

// GET /intelligence — Full APEX Predator scan (all 5 engines)
polymarketRouter.get('/intelligence', async (_req, res) => {
  try {
    const intel = await scanPredictionMarkets();
    res.json({ data: intel });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Intelligence scan failed' });
  }
});

// GET /weather — Weather forecasts from GFS ensemble
polymarketRouter.get('/weather', async (_req, res) => {
  try {
    const forecasts = await getWeatherForecasts();
    res.json({ data: forecasts, count: forecasts.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Weather forecast failed' });
  }
});

// GET /crypto-signals — Crypto 15-min sniper signals
polymarketRouter.get('/crypto-signals', async (_req, res) => {
  try {
    const signals = await getCrypto15MinSignals();
    res.json({ data: signals, count: signals.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Crypto signals failed' });
  }
});

// GET /categories — Category scoring (what's tradeable vs blocked)
polymarketRouter.get('/categories', (_req, res) => {
  const scores = getAllCategoryScores();
  res.json({ data: scores, count: scores.length });
});

// ── Kalshi Live Markets + Paper Trading ──────────────────────────────────

import {
  getEvents,
  getMarkets,
  getActiveMarketsByCategory,
  getKalshiPaperPortfolio,
} from '../services/predictions/kalshi-client.js';

// GET /kalshi/events — Active Kalshi events
polymarketRouter.get('/kalshi/events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string ?? '20', 10);
    const events = await getEvents({ limit, status: 'open' });
    res.json({ data: events, count: events.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /kalshi/markets — Active Kalshi markets
polymarketRouter.get('/kalshi/markets', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string ?? '20', 10);
    const series = req.query.series as string | undefined;
    const markets = await getMarkets({ limit, series_ticker: series, status: 'open' });
    res.json({ data: markets, count: markets.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /kalshi/categories — Markets grouped by category
polymarketRouter.get('/kalshi/categories-live', async (_req, res) => {
  try {
    const byCategory = await getActiveMarketsByCategory();
    const summary = Object.entries(byCategory).map(([cat, events]) => ({
      category: cat,
      eventCount: events.length,
      events: events.slice(0, 5),
    }));
    res.json({ data: summary });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// GET /kalshi/paper — Kalshi paper portfolio
polymarketRouter.get('/kalshi/paper', (_req, res) => {
  res.json({ data: getKalshiPaperPortfolio() });
});
