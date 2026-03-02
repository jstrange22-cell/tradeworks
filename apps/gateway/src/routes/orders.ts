import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { routeOrder } from '../services/order-routing-service.js';

/**
 * Order routes.
 * POST /api/v1/orders      - Place a new order
 * GET  /api/v1/orders/:id  - Get order status (delegated to trades route)
 */

export const ordersRouter: RouterType = Router();

const OrderSchema = z.object({
  instrument: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']).default('market'),
  price: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  market: z.enum(['crypto', 'equities', 'prediction']).optional(),
});

/**
 * POST /
 * Place a new order.
 */
ordersRouter.post('/', async (req, res) => {
  try {
    const body = OrderSchema.parse(req.body);

    // Validate limit/stop orders have price
    if ((body.orderType === 'limit' || body.orderType === 'stop_limit') && !body.price) {
      res.status(400).json({ error: 'Price is required for limit orders' });
      return;
    }
    if ((body.orderType === 'stop' || body.orderType === 'stop_limit') && !body.stopPrice) {
      res.status(400).json({ error: 'Stop price is required for stop orders' });
      return;
    }

    const result = await routeOrder(body);

    const statusCode = result.status === 'rejected' ? 422 : 201;
    res.status(statusCode).json({
      data: result,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid order',
        details: error.errors,
      });
      return;
    }
    console.error('[Orders] Error placing order:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});
