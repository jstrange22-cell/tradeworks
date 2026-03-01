import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { PortfolioService } from '../services/portfolio-service.js';

/**
 * Position routes.
 * GET /api/v1/positions - Get all open positions
 * POST /api/v1/positions/:id/close - Close a specific position
 */

export const positionsRouter: RouterType = Router();
const portfolioService = new PortfolioService();

/**
 * GET /api/v1/positions
 * Get all open positions across all exchanges.
 */
positionsRouter.get('/', async (req, res) => {
  try {
    const exchange = req.query.exchange as string | undefined;

    const positions = await portfolioService.getPositions(req.user!.id, exchange);

    const summary = {
      totalValue: positions.reduce((sum, p) => sum + (p.quantity * p.currentPrice), 0),
      totalUnrealizedPnl: positions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0),
      positionCount: positions.length,
    };

    res.json({
      data: positions,
      summary,
    });
  } catch (error) {
    console.error('[Positions] Error fetching positions:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

/**
 * GET /api/v1/positions/:instrument
 * Get a specific position by instrument.
 */
positionsRouter.get('/:instrument', async (req, res) => {
  try {
    const position = await portfolioService.getPosition(req.user!.id, req.params.instrument);

    if (!position) {
      res.status(404).json({ error: `No open position for ${req.params.instrument}` });
      return;
    }

    res.json({ data: position });
  } catch (error) {
    console.error('[Positions] Error fetching position:', error);
    res.status(500).json({ error: 'Failed to fetch position' });
  }
});

/**
 * Close position request schema.
 */
const ClosePositionSchema = z.object({
  quantity: z.number().positive().optional(), // If not provided, close entire position
  type: z.enum(['market', 'limit']).default('market'),
  price: z.number().positive().optional(), // Required for limit orders
});

/**
 * POST /api/v1/positions/:id/close
 * Close a specific position (fully or partially).
 */
positionsRouter.post('/:id/close', async (req, res) => {
  try {
    const body = ClosePositionSchema.parse(req.body);

    const result = await portfolioService.closePosition(req.user!.id, req.params.id, {
      quantity: body.quantity,
      orderType: body.type,
      limitPrice: body.price,
    });

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      data: result.execution,
      message: `Position ${body.quantity ? 'partially' : 'fully'} closed`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid request body',
        details: error.errors,
      });
      return;
    }
    console.error('[Positions] Error closing position:', error);
    res.status(500).json({ error: 'Failed to close position' });
  }
});

/**
 * GET /api/v1/positions/history/closed
 * Get recently closed positions.
 */
positionsRouter.get('/history/closed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const closedPositions = await portfolioService.getClosedPositions(req.user!.id, limit);

    res.json({ data: closedPositions });
  } catch (error) {
    console.error('[Positions] Error fetching closed positions:', error);
    res.status(500).json({ error: 'Failed to fetch closed positions' });
  }
});
