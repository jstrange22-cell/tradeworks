import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TradeService } from '../services/trade-service.js';
import { executionHistory } from './solana-sniper/state.js';

/**
 * Trade routes.
 * GET /api/v1/trades - Paginated list of trades with filters
 */

export const tradesRouter: RouterType = Router();
const tradeService = new TradeService();

/**
 * Query schema for trade listing.
 */
const TradeQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  instrument: z.string().optional(),
  side: z.enum(['buy', 'sell']).optional(),
  status: z.enum(['filled', 'partial', 'pending', 'cancelled', 'failed', 'simulated']).optional(),
  exchange: z.enum(['coinbase', 'alpaca', 'polymarket']).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  sortBy: z.enum(['timestamp', 'instrument', 'pnl', 'quantity']).default('timestamp'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /api/v1/trades
 * Get a paginated list of trades with optional filters.
 */
tradesRouter.get('/', async (req, res) => {
  try {
    const query = TradeQuerySchema.parse(req.query);

    // Fetch DB trades (may be empty if DB unavailable)
    let dbTrades: unknown[] = [];
    let dbTotal = 0;
    try {
      const result = await tradeService.listTrades({
        userId: req.user!.id,
        page: 1,
        limit: 500,
        filters: {
          instrument: query.instrument,
          side: query.side,
          status: query.status,
          exchange: query.exchange,
          startDate: query.startDate,
          endDate: query.endDate,
        },
        sort: { field: query.sortBy, order: query.sortOrder },
      });
      dbTrades = result.trades as unknown[];
      dbTotal = result.total;
    } catch {
      // DB unavailable — fall through to sniper-only response
    }

    // Merge in-memory sniper executions (only when no exchange filter)
    const dbIds = new Set((dbTrades as Array<{ id: string }>).map((t) => t.id));
    const sniperTrades = (query.exchange == null)
      ? executionHistory
          .filter((e) => e.status === 'success')
          .filter((e) => !query.instrument || e.symbol === query.instrument)
          .filter((e) => !query.side || e.action === query.side)
          .map((e) => ({
            id: e.id,
            instrument: e.symbol,
            market: 'crypto' as const,
            side: e.action,
            quantity: e.amountTokens ?? 0,
            price: e.priceUsd ?? 0,
            pnl: e.pnlSol ?? 0,
            strategyId: e.templateId,
            executedAt: e.timestamp,
            exchange: 'solana',
            paperMode: e.paperMode ?? false,
          }))
          .filter((e) => !dbIds.has(e.id))
      : [];

    type Row = { executedAt: string };
    // Combine and sort by executedAt desc
    const combined = [...(dbTrades as Row[]), ...sniperTrades].sort((a, b) =>
      new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
    );

    // Apply pagination
    const offset = (query.page - 1) * query.limit;
    const paginated = combined.slice(offset, offset + query.limit);
    const total = dbTotal + sniperTrades.length;

    res.json({
      data: paginated,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
        hasNext: query.page * query.limit < total,
        hasPrev: query.page > 1,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: error.errors,
      });
      return;
    }
    console.error('[Trades] Error listing trades:', error);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

/**
 * GET /api/v1/trades/:id
 * Get a single trade by ID.
 */
tradesRouter.get('/:id', async (req, res) => {
  try {
    const trade = await tradeService.getTradeById(req.params.id, req.user!.id);

    if (!trade) {
      res.status(404).json({ error: 'Trade not found' });
      return;
    }

    res.json({ data: trade });
  } catch (error) {
    console.error('[Trades] Error fetching trade:', error);
    res.status(500).json({ error: 'Failed to fetch trade' });
  }
});

/**
 * GET /api/v1/trades/stats/summary
 * Get trade statistics summary.
 */
tradesRouter.get('/stats/summary', async (req, res) => {
  try {
    const period = (req.query.period as string) ?? '30d';
    const stats = await tradeService.getTradeStats(req.user!.id, period);

    res.json({ data: stats });
  } catch (error) {
    console.error('[Trades] Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch trade statistics' });
  }
});
