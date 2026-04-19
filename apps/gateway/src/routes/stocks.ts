/**
 * Stock Trading Routes — Alpaca Markets Integration
 *
 * Swing trading engine with multi-timeframe TA, DCA support,
 * and bracket order automation.
 *
 * GET  /api/v1/stocks/account         — Alpaca account info
 * GET  /api/v1/stocks/positions       — Current positions
 * GET  /api/v1/stocks/orders          — Order history
 * POST /api/v1/stocks/orders          — Place order (bracket supported)
 * DEL  /api/v1/stocks/orders/:id      — Cancel order
 * GET  /api/v1/stocks/scan            — Scan watchlist for swing setups
 * GET  /api/v1/stocks/bars/:symbol    — Historical bars
 * GET  /api/v1/stocks/snapshot        — Latest price snapshots
 * GET  /api/v1/stocks/config          — Alpaca config status
 */

import { Router, type Router as RouterType } from 'express';
import {
  getAccount,
  getPositions,
  getPosition,
  closePosition,
  createOrder,
  getOrders,
  cancelOrder,
  placeBracketOrder,
  getBars,
  getSnapshots,
  getAlpacaConfig,
  type CreateOrderParams,
} from '../services/stocks/alpaca-client.js';
import { scanForSwingTrades, DEFAULT_WATCHLIST } from '../services/stocks/swing-scanner.js';

export const stocksRouter: RouterType = Router();

// GET /account — Alpaca account info (buying power, equity, etc.)
stocksRouter.get('/account', async (_req, res) => {
  try {
    const config = getAlpacaConfig();
    if (!config.configured) {
      res.status(400).json({
        error: 'Alpaca not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET.',
        setup: 'Sign up at alpaca.markets (free) for commission-free stock trading.',
      });
      return;
    }
    const account = await getAccount();
    res.json({
      data: {
        ...account,
        paper: config.paper,
      },
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch Alpaca account', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /positions — All open stock positions
stocksRouter.get('/positions', async (_req, res) => {
  try {
    const positions = await getPositions();
    res.json({ data: positions, count: positions.length });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch positions', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /positions/:symbol — Single position
stocksRouter.get('/positions/:symbol', async (req, res) => {
  try {
    const position = await getPosition(req.params.symbol);
    res.json({ data: position });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch position', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// DELETE /positions/:symbol — Close position
stocksRouter.delete('/positions/:symbol', async (req, res) => {
  try {
    const qty = req.query.qty as string | undefined;
    const order = await closePosition(req.params.symbol, qty);
    res.json({ data: order });
  } catch (err) {
    res.status(502).json({ error: 'Failed to close position', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /orders — Order history
stocksRouter.get('/orders', async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);
    const orders = await getOrders(status, limit);
    res.json({ data: orders, count: orders.length });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch orders', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// POST /orders — Place an order
stocksRouter.post('/orders', async (req, res) => {
  try {
    const body = req.body as CreateOrderParams;
    if (!body.symbol || !body.side || !body.type) {
      res.status(400).json({ error: 'symbol, side, and type are required' });
      return;
    }
    const order = await createOrder(body);
    res.json({ data: order });
  } catch (err) {
    res.status(502).json({ error: 'Failed to place order', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// POST /orders/bracket — Place a bracket order (entry + TP + SL)
stocksRouter.post('/orders/bracket', async (req, res) => {
  try {
    const { symbol, qty, side, type, time_in_force, limit_price, take_profit_price, stop_loss_price } = req.body;
    if (!symbol || !qty || !take_profit_price || !stop_loss_price) {
      res.status(400).json({
        error: 'Required: symbol, qty, take_profit_price, stop_loss_price',
      });
      return;
    }
    const order = await placeBracketOrder({
      symbol,
      qty: String(qty),
      side: side ?? 'buy',
      type: type ?? 'market',
      time_in_force: time_in_force ?? 'gtc',
      limit_price: limit_price ? String(limit_price) : undefined,
      take_profit_price: String(take_profit_price),
      stop_loss_price: String(stop_loss_price),
    });
    res.json({ data: order });
  } catch (err) {
    res.status(502).json({ error: 'Failed to place bracket order', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// DELETE /orders/:id — Cancel order
stocksRouter.delete('/orders/:id', async (req, res) => {
  try {
    await cancelOrder(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to cancel order', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /scan — Scan watchlist for swing trade setups
stocksRouter.get('/scan', async (req, res) => {
  try {
    const config = getAlpacaConfig();
    if (!config.configured) {
      res.status(400).json({
        error: 'Alpaca not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET.',
      });
      return;
    }

    const watchlistParam = req.query.watchlist as string | undefined;
    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => s.trim().toUpperCase())
      : undefined;

    const result = await scanForSwingTrades(watchlist);
    res.json({
      data: result.signals,
      count: result.signals.length,
      macroRegime: result.macroRegime,
      positionSizeMultiplier: result.positionSizeMultiplier,
      scannedAt: result.scannedAt,
      watchlistSize: result.watchlistSize,
    });
  } catch (err) {
    res.status(502).json({ error: 'Scan failed', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /bars/:symbol — Historical bars for a symbol
stocksRouter.get('/bars/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const timeframe = (req.query.timeframe as string) || '1Day';
    const limit = parseInt(req.query.limit as string || '100', 10);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (limit * 2)); // rough estimate

    const result = await getBars({
      symbols: [symbol.toUpperCase()],
      timeframe,
      start: startDate.toISOString(),
      limit,
    });

    res.json({
      data: result.bars[symbol.toUpperCase()] ?? [],
      symbol: symbol.toUpperCase(),
      timeframe,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch bars', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /snapshot — Latest snapshots for symbols
stocksRouter.get('/snapshot', async (req, res) => {
  try {
    const symbolsParam = (req.query.symbols as string) || 'SPY,QQQ,AAPL';
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());
    const snapshots = await getSnapshots(symbols);
    res.json({ data: snapshots });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch snapshots', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /watchlist — Default watchlist
stocksRouter.get('/watchlist', (_req, res) => {
  res.json({ data: DEFAULT_WATCHLIST, count: DEFAULT_WATCHLIST.length });
});

// GET /config — Alpaca configuration status
stocksRouter.get('/config', (_req, res) => {
  const config = getAlpacaConfig();
  res.json({
    data: {
      ...config,
      marketOpen: true, // Will be dynamic once isMarketOpen() is refined
      defaultWatchlistSize: DEFAULT_WATCHLIST.length,
    },
  });
});
