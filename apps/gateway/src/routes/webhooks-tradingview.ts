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
tradingviewWebhookRouter.post('/', async (req, res) => {
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

  // ── Feed signal to TradingView APEX Agent (distributes to ALL bots) ──
  try {
    const { ingestWebhookSignal } = await import('../services/ai/tradingview-agent.js');
    ingestWebhookSignal({
      symbol: alert.symbol,
      action: alert.action,
      price: alert.price ?? 0,
      timeframe: alert.timeframe,
    });
  } catch { /* TV agent not loaded yet */ }

  // ── CEX BLUE CHIP TRADE: TV signal on top 20 → CEX engine executes directly ──
  const CEX_BLUE_CHIPS = new Set([
    'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'LINK', 'AVAX',
    'MATIC', 'ATOM', 'UNI', 'AAVE', 'LTC', 'DOGE', 'SHIB',
    'NEAR', 'SUI', 'ARB', 'OP', 'FIL',
  ]);
  const cleanSymbol = alert.symbol.replace('USDT', '').replace('-USD', '').replace('USD', '').toUpperCase();
  const normalizedAction = alert.action.includes('sell') ? 'sell' : 'buy';

  if (CEX_BLUE_CHIPS.has(cleanSymbol)) {
    try {
      const { executeCEXTradeFromTV } = await import('./crypto-agent.js');
      executeCEXTradeFromTV(cleanSymbol, normalizedAction as 'buy' | 'sell', alert.price ?? 0,
        `Tradevisor TV ${normalizedAction.toUpperCase()}: ${cleanSymbol} @ $${alert.price ?? 0} (TF:${alert.timeframe})`);
      logger.info({ symbol: cleanSymbol, action: normalizedAction, price: alert.price },
        `[TradingView→CEX] ${normalizedAction.toUpperCase()} ${cleanSymbol} — routed to CEX engine`);
    } catch { /* CEX not loaded */ }
  }

  // ── DEX TRADE: TV signal on non-blue-chip → crypto agent DEX execution ──
  try {
    const { executeSignalTrade } = await import('./crypto-agent.js');
    if (!CEX_BLUE_CHIPS.has(cleanSymbol)) {
      executeSignalTrade({
        symbol: cleanSymbol,
        action: normalizedAction as 'buy' | 'sell',
        price: alert.price ?? 0,
        source: 'tradingview',
        confidence: 80,
        reason: `Tradevisor ${normalizedAction.toUpperCase()}: ${alert.symbol} @ $${alert.price ?? 0}`,
      });
    }
  } catch { /* executeSignalTrade not loaded */ }

  // ── DIRECT TRADE: TV signal triggers stock engine paper trade ────────
  // Detect if this is a stock symbol (no USDT/USD suffix, 1-5 chars)
  try {
    const cleanSymbol = alert.symbol.replace('USDT', '').replace('USD', '');
    const isLikelyStock = /^[A-Z]{1,5}$/.test(cleanSymbol) && !cleanSymbol.match(/^(BTC|ETH|SOL|AVAX|LINK|DOGE|ADA|DOT|XRP|MATIC|NEAR|SUI)$/);
    if (isLikelyStock) {
      logger.info({ symbol: cleanSymbol, action: alert.action }, `[TradingView] Stock signal detected: ${cleanSymbol} — will execute on next stock scan cycle`);
      // For now, the signal goes through APEX Bridge → stock orchestrator on next scan
      // Direct stock paper trade execution will use Alpaca paper API
    }
  } catch { /* stock engine not loaded */ }

  // ── Feed signal to Crypto Agent (ALL assets) ───────────────────────
  try {
    const { injectTradingViewSignal } = await import('./crypto-agent.js');
    injectTradingViewSignal({
      symbol: alert.symbol,
      action: alert.action,
      price: alert.price ?? 0,
      confidence: (raw as Record<string, unknown>).confidence as number | undefined,
      grade: (raw as Record<string, unknown>).grade as string | undefined,
      timeframe: alert.timeframe,
      receivedAt: new Date().toISOString(),
    });
  } catch { /* crypto agent not loaded yet */ }

  // ── Execute Solana Trades ──────────────────────────────────────────
  // If this is a Solana token, resolve symbol → mint and trigger sniper
  let execution: { status: string; mint?: string } | null = null;

  if (alert.action === 'buy') {
    try {
      // Resolve symbol to Solana mint via Jupiter strict token list
      const jupRes = await fetch(`https://api.jup.ag/tokens/v1/strict`, { signal: AbortSignal.timeout(5_000) });
      if (jupRes.ok) {
        const tokens = await jupRes.json() as Array<{ symbol: string; address: string; name: string }>;
        const match = tokens.find(t => t.symbol.toUpperCase() === alert.symbol.replace('-USD', '').replace('USDT', '').toUpperCase());

        if (match) {
          logger.info({ symbol: alert.symbol, mint: match.address.slice(0, 12) }, '[TradingView] Resolved to Solana mint — executing buy');

          const { executeBuySnipe } = await import('./solana-sniper/execution.js');
          const result = await executeBuySnipe({
            mint: match.address,
            symbol: match.symbol,
            name: match.name,
            trigger: 'tradingview',
          });
          execution = { status: result?.status ?? 'unknown', mint: match.address };
        }
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[TradingView] Execution failed');
    }
  }

  res.status(200).json({
    ok: true,
    symbol: alert.symbol,
    action: alert.action,
    execution: execution ?? undefined,
  });
});
