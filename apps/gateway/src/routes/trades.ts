import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TradeService } from '../services/trade-service.js';

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
  limit: z.coerce.number().int().min(1).max(100).default(20),
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

    const result = await tradeService.listTrades({
      userId: req.user!.id,
      page: query.page,
      limit: query.limit,
      filters: {
        instrument: query.instrument,
        side: query.side,
        status: query.status,
        exchange: query.exchange,
        startDate: query.startDate,
        endDate: query.endDate,
      },
      sort: {
        field: query.sortBy,
        order: query.sortOrder,
      },
    });

    res.json({
      data: result.trades,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
        hasNext: query.page * query.limit < result.total,
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
