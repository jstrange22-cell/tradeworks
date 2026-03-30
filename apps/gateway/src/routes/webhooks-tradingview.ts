import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { broadcast } from '../websocket/server.js';
import { logger } from '../lib/logger.js';

export const tradingviewWebhookRouter: IRouter = Router();

/**
 * TradingView alert payload.
 * Users configure this JSON in the TradingView alert "Message" field:
 *
 *   {
 *     "symbol": "{{ticker}}",
 *     "action": "{{strategy.order.action}}",
 *     "price": {{close}},
 *     "quantity": {{strategy.order.contracts}},
 *     "message": "{{strategy.order.comment}}"
 *   }
 */
const AlertSchema = z.object({
  symbol: z.string().min(1),
  action: z.enum(['buy', 'sell', 'long', 'short', 'close_long', 'close_short']),
  price: z.number().positive().optional(),
  close: z.number().positive().optional(),
  quantity: z.number().positive().optional(),
  message: z.string().optional(),
  time: z.string().optional(),
  exchange: z.string().optional(),
  timeframe: z.string().optional(),
});

type NormalizedAlert = {
  symbol: string;
  action: 'buy' | 'sell';
  price: number | null;
  quantity: number | null;
  message: string;
  time: string;
  exchange: string;
  timeframe: string;
  raw: z.infer<typeof AlertSchema>;
};

function normalizeAction(action: z.infer<typeof AlertSchema>['action']): 'buy' | 'sell' {
  return action === 'buy' || action === 'long' ? 'buy' : 'sell';
}

/**
 * POST /api/v1/webhooks/tradingview
 *
 * Receives TradingView strategy alerts and broadcasts them to all dashboard
 * clients subscribed to the `tradingview:alerts` WebSocket channel.
 *
 * Optional shared-secret protection: set TRADINGVIEW_WEBHOOK_SECRET in .env
 * and add ?secret=<value> to the alert URL in TradingView.
 */
tradingviewWebhookRouter.post('/', (req, res) => {
  // Optional secret validation
  const expectedSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.query['secret'] as string | undefined;
    if (provided !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const parsed = AlertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid payload',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const raw = parsed.data;
  const alert: NormalizedAlert = {
    symbol: raw.symbol.replace(/[:/]/, '-').toUpperCase(),
    action: normalizeAction(raw.action),
    price: raw.price ?? raw.close ?? null,
    quantity: raw.quantity ?? null,
    message: raw.message ?? '',
    time: raw.time ?? new Date().toISOString(),
    exchange: raw.exchange ?? 'TradingView',
    timeframe: raw.timeframe ?? '',
    raw,
  };

  broadcast('tradingview:alerts', alert);

  logger.info(
    { symbol: alert.symbol, action: alert.action, price: alert.price },
    '[TradingView] Alert received and broadcast',
  );

  res.status(200).json({ ok: true, symbol: alert.symbol, action: alert.action });
});
