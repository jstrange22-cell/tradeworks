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
import { loadPaperLedger, savePaperLedger } from '../services/stock-intelligence/stock-orchestrator.js';
import { executeEquitySignal, executeOptionsSignal } from '../services/stock-intelligence/stock-agent.js';
import { MAX_EQUITY_POSITIONS, MAX_OPTION_POSITIONS } from '../services/stock-intelligence/stock-models.js';
import { getOptionQuote } from '../services/stocks/robinhood-options.js';

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
      optionsEnabled: process.env.ENABLE_OPTIONS === 'true',
      liveEquities: process.env.ENABLE_LIVE_EQUITIES === 'true',
      liveOptions: process.env.ENABLE_LIVE_OPTIONS === 'true',
      maxEquityPositions: MAX_EQUITY_POSITIONS,
      maxOptionPositions: MAX_OPTION_POSITIONS,
    },
  });
});

// ── TradeVisor Paper Ledger (equity + options) ─────────────────────────────

// GET /portfolio — Unified portfolio snapshot for dashboard
stocksRouter.get('/portfolio', (_req, res) => {
  try {
    const ledger = loadPaperLedger();
    const equityValue = ledger.equityPositions.reduce(
      (sum, p) => sum + p.shares * p.currentPrice, 0,
    );
    const optionValue = ledger.optionPositions.reduce(
      (sum, p) => sum + p.contracts * p.currentMid * 100, 0,
    );
    res.json({
      data: {
        paperCashUsd: ledger.paperCashUsd,
        equityPositions: ledger.equityPositions,
        optionPositions: ledger.optionPositions,
        equityCount: ledger.equityPositions.length,
        optionCount: ledger.optionPositions.length,
        maxEquityPositions: MAX_EQUITY_POSITIONS,
        maxOptionPositions: MAX_OPTION_POSITIONS,
        equityValueUsd: equityValue,
        optionValueUsd: optionValue,
        totalValueUsd: ledger.paperCashUsd + equityValue + optionValue,
        stats: ledger.stats,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load portfolio', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /equity-positions — Open equity positions (N/10)
stocksRouter.get('/equity-positions', (_req, res) => {
  try {
    const ledger = loadPaperLedger();
    res.json({
      data: ledger.equityPositions,
      count: ledger.equityPositions.length,
      max: MAX_EQUITY_POSITIONS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load equity positions', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// GET /option-positions — Open option positions (N/10)
stocksRouter.get('/option-positions', (_req, res) => {
  try {
    const ledger = loadPaperLedger();
    res.json({
      data: ledger.optionPositions,
      count: ledger.optionPositions.length,
      max: MAX_OPTION_POSITIONS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load option positions', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// POST /close/:kind/:id — Manual close of a paper position (kind = equity | option)
stocksRouter.post('/close/:kind/:id', async (req, res) => {
  try {
    const kind = req.params.kind;
    const id = req.params.id;
    const ledger = loadPaperLedger();

    if (kind === 'equity') {
      const idx = ledger.equityPositions.findIndex(p => p.id === id);
      if (idx === -1) { res.status(404).json({ error: 'Equity position not found' }); return; }
      const pos = ledger.equityPositions[idx];
      const exitPrice = typeof req.body?.exitPrice === 'number' && req.body.exitPrice > 0
        ? req.body.exitPrice
        : pos.currentPrice;
      const pnlUsd = (exitPrice - pos.entryPrice) * pos.shares;
      const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
      ledger.paperCashUsd += pos.shares * exitPrice;
      ledger.equityClosed.unshift({
        ...pos,
        exitPrice,
        exitAt: new Date().toISOString(),
        pnlUsd,
        pnlPct,
      });
      ledger.equityPositions.splice(idx, 1);
      ledger.stats.totalTrades += 1;
      if (pnlUsd >= 0) ledger.stats.wins += 1; else ledger.stats.losses += 1;
      savePaperLedger(ledger);
      res.json({ data: { closed: ledger.equityClosed[0], pnlUsd, pnlPct } });
      return;
    }

    if (kind === 'option') {
      const idx = ledger.optionPositions.findIndex(p => p.id === id);
      if (idx === -1) { res.status(404).json({ error: 'Option position not found' }); return; }
      const pos = ledger.optionPositions[idx];
      let exitMid = typeof req.body?.exitMid === 'number' && req.body.exitMid > 0
        ? req.body.exitMid
        : pos.currentMid;
      if (!exitMid || exitMid <= 0) {
        try {
          const quote = await getOptionQuote(pos.occSymbol);
          exitMid = quote.mid;
        } catch { exitMid = pos.entryMid; }
      }
      const pnlUsd = (exitMid - pos.entryMid) * pos.contracts * 100;
      const pnlPct = ((exitMid - pos.entryMid) / pos.entryMid) * 100;
      ledger.paperCashUsd += pos.contracts * exitMid * 100;
      ledger.optionClosed.unshift({
        ...pos,
        exitMid,
        exitAt: new Date().toISOString(),
        pnlUsd,
        pnlPct,
      });
      ledger.optionPositions.splice(idx, 1);
      ledger.stats.totalTrades += 1;
      if (pnlUsd >= 0) ledger.stats.wins += 1; else ledger.stats.losses += 1;
      savePaperLedger(ledger);
      res.json({ data: { closed: ledger.optionClosed[0], pnlUsd, pnlPct } });
      return;
    }

    res.status(400).json({ error: 'kind must be "equity" or "option"' });
  } catch (err) {
    res.status(500).json({ error: 'Close failed', message: err instanceof Error ? err.message : 'Unknown' });
  }
});

// POST /signal/test — Dev hook: manually fire a TradeVisor-style stock signal
// Body: { ticker, action: 'buy'|'sell', price, score?, grade?, route?: 'equity'|'options'|'both' }
stocksRouter.post('/signal/test', async (req, res) => {
  try {
    const { ticker, action, price, score, grade, route } = req.body ?? {};
    if (!ticker || !action || typeof price !== 'number') {
      res.status(400).json({ error: 'ticker, action, price required' });
      return;
    }
    const validGrades = new Set(['prime', 'strong', 'standard', 'reject'] as const);
    const g = typeof grade === 'string' && validGrades.has(grade as 'prime' | 'strong' | 'standard' | 'reject')
      ? (grade as 'prime' | 'strong' | 'standard' | 'reject')
      : 'standard';
    const signal = {
      ticker: String(ticker).toUpperCase(),
      action: action === 'sell' ? 'sell' as const : 'buy' as const,
      price,
      score: typeof score === 'number' ? score : 4,
      grade: g,
    };
    const which = route ?? 'both';
    const results: Record<string, boolean> = {};
    if (which === 'equity' || which === 'both') {
      results.equity = await executeEquitySignal(signal);
    }
    if ((which === 'options' || which === 'both') && process.env.ENABLE_OPTIONS === 'true') {
      results.options = await executeOptionsSignal(signal);
    }
    res.json({ data: { signal, results } });
  } catch (err) {
    res.status(500).json({ error: 'Signal test failed', message: err instanceof Error ? err.message : 'Unknown' });
  }
});
