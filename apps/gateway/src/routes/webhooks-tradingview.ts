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
  // TradeVisor-specific quality fields. User sets these in the TV alert
  // message body so the bot knows signal grade for sizing decisions.
  score: z.number().int().min(0).max(6).optional(),
  grade: z.enum(['standard', 'strong', 'prime', 'reject']).optional(),
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
    // Phase 2: route to FreqTrade when ENABLE_FREQTRADE_BRIDGE=true; else
    // legacy crypto-agent paper engine. Both can run in parallel during the
    // 30-day cutover validation window (set both flags true to compare ledgers).
    const useFreqtrade = process.env['ENABLE_FREQTRADE_BRIDGE'] === 'true';
    const useLegacyCex = process.env['ENABLE_LEGACY_CEX'] !== 'false'; // default on

    // Reasoning gate (same agent as the stock path) — applies to BOTH FreqTrade
    // and legacy CEX. In gate mode, an agent veto/escalate skips both engines.
    const cexGrade: 'standard' | 'strong' | 'prime' =
      raw.grade === 'strong' ? 'strong'
      : raw.grade === 'prime' ? 'prime'
      : 'standard';
    const cexScore = raw.score ?? 4;
    let cexAgentDecision: { verdict: 'approve' | 'veto' | 'escalate'; reasoning: string; id: string } | null = null;
    let cexAgentMode: 'disabled' | 'shadow' | 'gate' = 'disabled';
    try {
      const { evaluateSignal, getAgentMode } = await import('../services/ai/tradevisor-agent/index.js');
      cexAgentMode = getAgentMode();
      const decision = await evaluateSignal({
        symbol: cleanSymbol,
        action: normalizedAction as 'buy' | 'sell',
        price: alert.price ?? 0,
        score: cexScore,
        grade: cexGrade,
        timeframe: alert.timeframe,
        exchange: alert.exchange,
        sourceLabel: (raw as Record<string, unknown>)['source_label'] as string | undefined,
        receivedAt: alert.time,
        assetClass: 'crypto-cex',
      });
      cexAgentDecision = { verdict: decision.verdict, reasoning: decision.reasoning, id: decision.id };
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, symbol: cleanSymbol }, '[TradingView→CEX] agent evaluate failed; proceeding without gate');
    }
    const cexShouldExecute =
      cexAgentMode !== 'gate' || (cexAgentDecision?.verdict ?? 'approve') === 'approve';
    if (!cexShouldExecute && cexAgentDecision) {
      logger.info(
        { symbol: cleanSymbol, action: normalizedAction, verdict: cexAgentDecision.verdict, decisionId: cexAgentDecision.id, reasoning: cexAgentDecision.reasoning.slice(0, 200) },
        `[TradingView→CEX] ${normalizedAction.toUpperCase()} ${cleanSymbol} — SKIPPED by agent`,
      );
    } else if (useFreqtrade) {
      const apiUrl = process.env['FREQTRADE_API_URL'] ?? 'http://localhost:8090';
      const username = process.env['FREQTRADE_USERNAME'] ?? 'tradeworks';
      const password = process.env['FREQTRADE_PASSWORD'];
      if (!password) {
        logger.warn('[TradingView→FreqTrade] FREQTRADE_PASSWORD not set — skipping FreqTrade route');
      } else {
        const pair = `${cleanSymbol}/USD`;
        // FreqTrade /forceenter for buy, /forceexit for sell. Per-grade sizing
        // is handled by the strategy's custom_stake_amount() via entry_tag.
        const grade = (raw.grade ?? 'standard').toString();
        const entryTag = `tradevisor_${grade}`;
        try {
          const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
          if (normalizedAction === 'buy') {
            const ftRes = await fetch(`${apiUrl}/api/v1/forceenter`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: auth },
              body: JSON.stringify({
                pair,
                side: 'long',
                price: alert.price ?? null,
                entry_tag: entryTag,
              }),
              signal: AbortSignal.timeout(8_000),
            });
            const body = await ftRes.text();
            logger.info(
              { symbol: cleanSymbol, pair, status: ftRes.status, grade, entryTag, body: body.slice(0, 200) },
              `[TradingView→FreqTrade] ${normalizedAction.toUpperCase()} ${pair}`,
            );
          } else {
            // SELL: look up the open trade for THIS pair, then /forceexit by id.
            // Avoids the 'all' wildcard which would close every open trade.
            const statusRes = await fetch(`${apiUrl}/api/v1/status`, {
              method: 'GET',
              headers: { Authorization: auth },
              signal: AbortSignal.timeout(8_000),
            });
            if (!statusRes.ok) {
              logger.warn({ pair, status: statusRes.status }, '[TradingView→FreqTrade] /status lookup failed before SELL');
            } else {
              const trades = (await statusRes.json()) as Array<{ trade_id: number; pair: string; is_open: boolean }>;
              const match = Array.isArray(trades) ? trades.find((t) => t.pair === pair && t.is_open) : null;
              if (!match) {
                logger.info({ pair }, `[TradingView→FreqTrade] SELL ${pair} — no open trade to close`);
              } else {
                const ftRes = await fetch(`${apiUrl}/api/v1/forceexit`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: auth },
                  body: JSON.stringify({ tradeid: String(match.trade_id) }),
                  signal: AbortSignal.timeout(8_000),
                });
                const body = await ftRes.text();
                logger.info(
                  { symbol: cleanSymbol, pair, tradeId: match.trade_id, status: ftRes.status, body: body.slice(0, 200) },
                  `[TradingView→FreqTrade] SELL ${pair} (trade ${match.trade_id}) — forceexit`,
                );
              }
            }
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : err, pair, action: normalizedAction },
            '[TradingView→FreqTrade] dispatch failed',
          );
        }
      }
    }

    if (cexShouldExecute && useLegacyCex) {
      try {
        const { executeCEXTradeFromTV } = await import('./crypto-agent.js');
        executeCEXTradeFromTV(cleanSymbol, normalizedAction as 'buy' | 'sell', alert.price ?? 0,
          `Tradevisor TV ${normalizedAction.toUpperCase()}: ${cleanSymbol} @ $${alert.price ?? 0} (TF:${alert.timeframe})`);
        logger.info(
          { symbol: cleanSymbol, action: normalizedAction, price: alert.price, agentVerdict: cexAgentDecision?.verdict, agentMode: cexAgentMode },
          `[TradingView→CEX] ${normalizedAction.toUpperCase()} ${cleanSymbol} — legacy CEX engine [agent: ${cexAgentDecision?.verdict ?? 'n/a'}/${cexAgentMode}]`,
        );
      } catch { /* CEX not loaded */ }
    }
  }

  // DEX path REMOVED 2026-05-03 — the in-house Solana DEX sniper produced
  // 18% WR / -91% drawdown and is staying offline until rebuilt with proper
  // rate-limiting + validated strategy (Phase 3 backlog). Webhook signals
  // for non-blue-chip symbols now no-op on the crypto side; only equity
  // (stock-agent) and CEX-blue-chip routing remains.

  // ── PHASE 1: TradingView TradeVisor → stock-agent direct execution ────
  // The user runs the actual TradeVisor Pine Script on TradingView. Alerts
  // fire here. We route to stock-agent which handles sizing/exits/persistence
  // exactly like our other signal sources, but the SOURCE OF TRUTH is the
  // user's paid Pine indicator — not our JS reimplementation.
  //
  // PHASE 2 ADDITION: every signal flows through the TradeVisor reasoning
  // agent first. In `shadow` mode (default) the agent reasons + logs but
  // execution proceeds with original parameters. In `gate` mode the agent's
  // verdict actually drives whether/how the trade fires. See
  // services/ai/tradevisor-agent for full architecture.
  //
  // Stock symbols: alphabetic 1-5 chars, NOT in the crypto blue-chip list above.
  try {
    const stockSymbol = alert.symbol.replace('USDT', '').replace('USD', '').replace('-', '');
    const isLikelyStock = /^[A-Z]{1,5}$/.test(stockSymbol) && !CEX_BLUE_CHIPS.has(stockSymbol);
    if (isLikelyStock) {
      const score = raw.score ?? 4;
      const rawGrade = raw.grade ?? 'standard';
      // The webhook schema also accepts 'reject' but the agent + executor
      // operate over the actionable trio. Fall back to 'standard' for it.
      const grade: 'standard' | 'strong' | 'prime' =
        rawGrade === 'strong' ? 'strong'
        : rawGrade === 'prime' ? 'prime'
        : 'standard';

      // Reasoning gate
      const { evaluateSignal, getAgentMode } = await import('../services/ai/tradevisor-agent/index.js');
      const decision = await evaluateSignal({
        symbol: stockSymbol,
        action: alert.action,
        price: alert.price ?? 0,
        score,
        grade,
        timeframe: alert.timeframe,
        exchange: alert.exchange,
        sourceLabel: (raw as Record<string, unknown>)['source_label'] as string | undefined,
        receivedAt: alert.time,
        assetClass: 'stock',
      });
      const mode = getAgentMode();

      // Decide whether to actually execute based on mode + verdict.
      const shouldExecute =
        mode !== 'gate' || decision.verdict === 'approve';
      const skipReason =
        mode === 'gate' && decision.verdict !== 'approve'
          ? `agent ${decision.verdict}: ${decision.reasoning.slice(0, 120)}`
          : null;

      if (!shouldExecute) {
        logger.info(
          {
            symbol: stockSymbol, action: alert.action, verdict: decision.verdict,
            reasoning: decision.reasoning.slice(0, 200), decisionId: decision.id,
          },
          `[TradingView→Stock] ${alert.action.toUpperCase()} ${stockSymbol} — SKIPPED by agent (${skipReason ?? 'unknown'})`,
        );
      } else {
        const { executeEquitySignal, executeEquitySellSignal } = await import('../services/stock-intelligence/stock-agent.js');
        const tvSignal = {
          ticker: stockSymbol,
          action: alert.action,
          price: alert.price ?? 0,
          score,
          grade,
        };
        const fired = alert.action === 'sell'
          ? await executeEquitySellSignal(tvSignal)
          : await executeEquitySignal(tvSignal);
        logger.info(
          {
            symbol: stockSymbol, action: alert.action, price: alert.price, score, grade, fired,
            agentVerdict: decision.verdict, agentMode: mode, decisionId: decision.id,
          },
          `[TradingView→Stock] ${alert.action.toUpperCase()} ${stockSymbol} (${grade}/${score}) — ${fired ? 'EXECUTED' : 'rejected by gates'} [agent: ${decision.verdict}/${mode}]`,
        );
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[TradingView→Stock] dispatch failed');
  }

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

  // Solana sniper execution REMOVED 2026-05-03 (Phase 2 cleanup, see comment
  // at the DEX-path strip above). The in-house Jupiter-resolve + sniper
  // engine stays offline pending a rebuild.

  res.status(200).json({
    ok: true,
    symbol: alert.symbol,
    action: alert.action,
  });
});
