import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from monorepo root (pnpm --filter sets CWD to apps/gateway/)
config({ path: resolve(process.cwd(), '../../.env') });
// Also load local .env if it exists (won't override root values)
config();
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi.js';
import { createServer } from 'http';
import { logger } from './lib/logger.js';
import { setupWebSocket } from './websocket/server.js';
import { authMiddleware } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { healthRouter } from './routes/health.js';
import { tradesRouter } from './routes/trades.js';
import { positionsRouter } from './routes/positions.js';
import { strategiesRouter } from './routes/strategies.js';
import { riskRouter } from './routes/risk.js';
import { agentsRouter } from './routes/agents.js';
import { backtestRouter } from './routes/backtest.js';
import { marketDataRouter } from './routes/market-data.js';
import { instrumentsRouter } from './routes/instruments.js';
import { portfolioRouter } from './routes/portfolio.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { ordersRouter } from './routes/orders.js';
import { advancedOrdersRouter } from './routes/advanced-orders.js';
import { engineRouter, initEngine } from './routes/engine.js';
import { settingsRouter } from './routes/settings.js';
import { balancesRouter } from './routes/balances.js';
import { assetProtectionRouter } from './routes/asset-protection.js';
import { authRouter } from './routes/auth.js';
import { solanaBalancesRouter } from './routes/solana-balances.js';
import { solanaSwapRouter } from './routes/solana-swap.js';
import { solanaScannerRouter } from './routes/solana-scanner.js';
import { pumpFunRouter, initPumpFunMonitor } from './routes/solana-pumpfun.js';
import { sniperRouter, autoStartSniper } from './routes/solana-sniper/index.js';
import { whaleRouter } from './routes/solana-whales.js';
import { moonshotRouter, initMoonshotScanner } from './routes/solana-moonshot.js';
import { launchpadRouter, initLaunchpadMonitors } from './routes/solana-launchpads.js';
import { robinhoodRouter } from './routes/robinhood.js';
import { polymarketRouter } from './routes/polymarket.js';
import { journalRouter } from './routes/journal.js';
import { arbitrageRouter } from './routes/arbitrage.js';
import { notificationsRouter } from './routes/notifications.js';
import { tradingviewWebhookRouter } from './routes/webhooks-tradingview.js';
import { sportsRouter } from './routes/sports.js';
import { stocksRouter } from './routes/stocks.js';
import { allocationRouter } from './routes/allocation.js';
import { intelligenceRouter } from './routes/intelligence.js';
import { apexChatRouter } from './routes/apex-chat.js';
import { cryptoAgentRouter } from './routes/crypto-agent.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { metricsMiddleware, metricsRouter } from './middleware/metrics.js';
import { startKalshiTrading } from './services/predictions/kalshi-intelligence.js';
import { arbIntelRouter } from './routes/arb-intelligence.js';
import { startArbEngine } from './services/arb-intelligence/orchestrator.js';
import { startApexBridge } from './services/ai/apex-bridge.js';
import { startTwitterScraper } from './services/sentiment/twitter-scraper.js';
import { startMoonshotHunter } from './services/apex/agents/moonshot-hunter/moonshot-hunter-agent.js';
import { stockTradingRouter } from './routes/stock-trading.js';
import { startStockEngine } from './services/stock-intelligence/stock-orchestrator.js';
import { startTradevisorLoop, setOnTradevisorSignal } from './services/ai/tradevisor-watchlist.js';
import { sportsBettingRouter } from './routes/sports-betting.js';
import { startSportsEngine } from './services/sports-intelligence/sports-orchestrator.js';
import { startCEXEngine, startDEXMomentumScanner } from './routes/crypto-agent.js';
import { launchCoachRouter } from './routes/token-launch-coach.js';
import { startArbAgent } from './services/ai/arb-agent.js';

const app: Express = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// --- Global Middleware ---

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(createRateLimiter());

// Request logging
app.use(pinoHttp({ logger }));

// Prometheus metrics
app.use(metricsMiddleware);

// --- Public Routes ---

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/metrics', metricsRouter);

// --- Internal-only sell endpoint (no auth, localhost only) ---
app.post('/api/internal/force-sell/:mint', async (req, res) => {
  // Only allow from localhost
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  if (!ip.includes('127.0.0.1') && !ip.includes('::1') && !ip.includes('::ffff:127.0.0.1')) {
    res.status(403).json({ error: 'Internal endpoint — localhost only' });
    return;
  }
  try {
    const { mint } = req.params;
    const { executeSellSnipe, fetchTokenBalance } = await import('./routes/solana-sniper/execution.js');
    const { getTemplatePositions, sniperTemplates, syncActivePositionsMap } = await import('./routes/solana-sniper/state.js');

    const balance = await fetchTokenBalance(mint);
    if (balance <= 0) {
      res.json({ message: `No tokens found for ${mint.slice(0, 12)}...`, balance: 0 });
      return;
    }

    // Find which template has this position, or use default
    let templateId = 'default';
    for (const [tId] of sniperTemplates) {
      const pos = getTemplatePositions(tId);
      if (pos.has(mint)) { templateId = tId; break; }
    }

    // Create temp position if needed
    const positions = getTemplatePositions(templateId);
    if (!positions.has(mint)) {
      positions.set(mint, {
        mint,
        symbol: (req.body?.symbol as string) ?? mint.slice(0, 8),
        name: 'Force Sell',
        buyPrice: 0, currentPrice: 0,
        amountTokens: balance, pnlPercent: 0,
        buySignature: 'force-sell',
        boughtAt: new Date().toISOString(),
        templateId, templateName: 'Internal',
        priceFetchFailCount: 0, highWaterMarkPrice: 0, buyCostSol: 0,
      } as never);
      syncActivePositionsMap();
    }

    const result = await executeSellSnipe(mint, 'manual', templateId, true);
    res.json({
      message: result?.status === 'success'
        ? `Sold ${mint.slice(0, 12)}... — ${result.amountSol?.toFixed(6)} SOL received`
        : `Sell attempted — ${result?.status ?? 'unknown'}`,
      execution: result ? { status: result.status, amountSol: result.amountSol, signature: result.signature } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Force sell failed' });
  }
});
app.use('/api/v1/market', marketDataRouter);
app.use('/api/v1/market/instruments', instrumentsRouter);
// TradingView webhook — public, no JWT (TV can't send auth headers); optional secret via ?secret=
app.use('/api/v1/webhooks/tradingview', tradingviewWebhookRouter);

// --- Development Routes (no auth for local dashboard) ---
// TODO: Add authMiddleware back when JWT auth is configured
const devAuth = process.env.NODE_ENV === 'production'
  ? authMiddleware
  : (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      // Inject a dev user so requireRole() passes in development
      req.user = { id: 'dev-user', email: 'dev@tradeworks.local', role: 'admin', iat: 0, exp: 0 };
      next();
    };

app.use('/api/v1/portfolio', devAuth, portfolioRouter);
app.use('/api/v1/trades', devAuth, tradesRouter);
app.use('/api/v1/positions', devAuth, positionsRouter);
app.use('/api/v1/strategies', devAuth, strategiesRouter);
app.use('/api/v1/risk', devAuth, riskRouter);
app.use('/api/v1/agents', devAuth, agentsRouter);
app.use('/api/v1/backtest', devAuth, backtestRouter);
app.use('/api/v1/settings/api-keys', devAuth, apiKeysRouter);
app.use('/api/v1/orders', devAuth, ordersRouter);
app.use('/api/v1/orders/advanced', devAuth, advancedOrdersRouter);
app.use('/api/v1/engine', devAuth, engineRouter);
app.use('/api/v1/settings', devAuth, settingsRouter);
app.use('/api/v1/portfolio/balances', devAuth, balancesRouter);
app.use('/api/v1/settings/asset-protection', devAuth, assetProtectionRouter);

// --- Robinhood Crypto Route ---
app.use('/api/v1/robinhood', devAuth, robinhoodRouter);

// --- Polymarket Prediction Markets ---
app.use('/api/v1/polymarket', devAuth, polymarketRouter);

// --- Sports Betting ---
app.use('/api/v1/sports', devAuth, sportsRouter);

// --- Stock Trading (Alpaca) ---
app.use('/api/v1/stocks', devAuth, stocksRouter);

// --- Cross-Market Capital Allocation ---
app.use('/api/v1/allocation', devAuth, allocationRouter);

// --- APEX Intelligence (Agent Swarm) ---
app.use('/api/v1/intel', devAuth, intelligenceRouter);

// --- APEX Chat (AI Trading Assistant) ---
app.use('/api/v1/apex', devAuth, apexChatRouter);

// --- Crypto Agent (General Crypto — BTC, ETH, all blockchains) ---
app.use('/api/v1/crypto', devAuth, cryptoAgentRouter);

// --- Arb Intelligence (7-Detector Arbitrage Engine) ---
app.use('/api/v1/arb-intel', devAuth, arbIntelRouter);

// --- Sports Intelligence (6-Engine Sports Betting) ---
app.use('/api/v1/sports', devAuth, sportsBettingRouter);

// --- Token Launch Coach (APEX Coaching Module) ---
app.use('/api/v1/launch-coach', devAuth, launchCoachRouter);

// --- Stock Intelligence (14-Engine Equities/Options/Macro) ---
app.use('/api/v1/stocks-intel', devAuth, stockTradingRouter);

// --- Global Safety (Kill Switch + Drawdown Protection) ---
import {
  getSafetyStatus, halt as safetyHalt, resume as safetyResume,
  setMasterSwitch, setPaperMode, setSystemEnabled,
} from './services/risk/global-safety.js';

app.get('/api/v1/safety/status', devAuth, (_req, res) => { res.json({ data: getSafetyStatus() }); });
app.post('/api/v1/safety/halt', devAuth, (req, res) => { safetyHalt(req.body?.reason ?? 'Manual halt'); res.json({ message: 'All trading halted' }); });
app.post('/api/v1/safety/resume', devAuth, (_req, res) => { safetyResume(); res.json({ message: 'Trading resumed' }); });
app.post('/api/v1/safety/master', devAuth, (req, res) => { setMasterSwitch(req.body?.enabled ?? true); res.json({ message: `Master switch: ${req.body?.enabled ? 'ON' : 'OFF'}` }); });
app.post('/api/v1/safety/paper-mode', devAuth, (req, res) => { setPaperMode(req.body?.enabled ?? true); res.json({ message: `Paper mode: ${req.body?.enabled ? 'ON' : 'OFF'}` }); });
app.post('/api/v1/safety/system', devAuth, (req, res) => { setSystemEnabled(req.body?.system, req.body?.enabled ?? true); res.json({ message: `${req.body?.system}: ${req.body?.enabled ? 'enabled' : 'disabled'}` }); });

// --- Trade Journal ---
app.use('/api/v1/journal', devAuth, journalRouter);

// --- Cross-Exchange Arbitrage ---
app.use('/api/v1/arbitrage', devAuth, arbitrageRouter);

// --- Notifications ---
app.use('/api/v1/notifications', devAuth, notificationsRouter);

// --- Solana Routes ---
app.use('/api/v1/solana', devAuth, solanaBalancesRouter);
app.use('/api/v1/solana', devAuth, solanaSwapRouter);
app.use('/api/v1/solana', devAuth, solanaScannerRouter);
app.use('/api/v1/solana', devAuth, pumpFunRouter);
app.use('/api/v1/solana', devAuth, sniperRouter);
app.use('/api/v1/solana', devAuth, whaleRouter);
app.use('/api/v1/solana', devAuth, moonshotRouter);
app.use('/api/v1/solana', devAuth, launchpadRouter);

// --- API Documentation ---

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'TradeWorks API Docs',
}));

// --- Error Handling ---

app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Not found' },
    status: 404,
    timestamp: new Date().toISOString(),
  });
});

app.use(globalErrorHandler);

// --- Server Start ---

const server = createServer(app);

// Set up WebSocket server
setupWebSocket(server);

// Handle port-in-use gracefully so tsx watch restarts cleanly without EADDRINUSE noise
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use — another instance may be running. Exiting so tsx watch can retry.`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, `TradeWorks Gateway running on http://${HOST}:${PORT}`);
  logger.info({ env: process.env.NODE_ENV ?? 'development' }, `Environment: ${process.env.NODE_ENV ?? 'development'}`);
  logger.info({ ws: `ws://${HOST}:${PORT}/ws` }, `WebSocket available at ws://${HOST}:${PORT}/ws`);

  // Auto-register API keys from .env so Settings page shows them as connected
  void (async () => {
    try {
      const { upsertMemoryKey, getMemoryKeysByService } = await import('./routes/api-keys.js');
      const { encryptApiKey } = await import('@tradeworks/db');

      // Alpaca
      if (process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET && getMemoryKeysByService('alpaca').length === 0) {
        upsertMemoryKey('alpaca', 'Alpaca (auto)', encryptApiKey(process.env.ALPACA_API_KEY), process.env.ALPACA_PAPER === 'true' ? 'sandbox' : 'production', encryptApiKey(process.env.ALPACA_API_SECRET));
        logger.info('[Startup] Auto-registered Alpaca API key from .env');
      }

      // Kalshi
      const kalshiKey = process.env.KALSHI_API_KEY_ID ?? process.env.KALSHI_API_KEY;
      if (kalshiKey && getMemoryKeysByService('kalshi').length === 0) {
        upsertMemoryKey('kalshi', 'Kalshi (auto)', encryptApiKey(kalshiKey), 'sandbox');
        logger.info('[Startup] Auto-registered Kalshi API key from .env');
      }
    } catch { /* encryption lib or api-keys not available yet */ }
  })();

  // Auto-start the AI trading engine — runs 24/7 with zero intervention
  initEngine();

  // Auto-start Solana monitors — pump.fun and moonshot run on public APIs (no wallet needed)
  initPumpFunMonitor();
  initMoonshotScanner();
  initLaunchpadMonitors();

  // Auto-start the sniper engine so incoming tokens get evaluated immediately
  autoStartSniper();

  // Start wallet discovery — watches pump.fun trades to find profitable traders in real-time
  import('./routes/solana-sniper/wallet-discovery.js').then(({ startWalletDiscovery, recordWalletBuy }) => {
    startWalletDiscovery();
    // Wire into pump.fun trade feed
    import('./routes/solana-pumpfun.js').then(({ setWalletDiscoveryCallback }) => {
      setWalletDiscoveryCallback(recordWalletBuy);
      logger.info('[Startup] Wallet Discovery wired to pump.fun trade feed');
    }).catch(() => { /* pumpfun not loaded */ });
    logger.info('[Startup] Wallet Discovery engine STARTED');
  }).catch(() => { /* module not ready */ });

  // ── PHASE 1 STABILIZATION: All engines disabled by default ──
  // Set ENABLE_<ENGINE>=true in .env to re-enable one at a time after proving stability.
  // DO NOT enable all at once — each engine adds memory, CPU, and API calls.

  if (process.env.ENABLE_KALSHI === 'true') {
    startKalshiTrading();
    logger.info('[Startup] Kalshi engine ENABLED');
  } else {
    logger.info('[Startup] Kalshi engine DISABLED (set ENABLE_KALSHI=true to enable)');
  }

  if (process.env.ENABLE_ARB === 'true') {
    startArbEngine();
    startArbAgent();
    logger.info('[Startup] Arb Intelligence ENABLED');
  } else {
    logger.info('[Startup] Arb Intelligence DISABLED (set ENABLE_ARB=true to enable)');
  }

  if (process.env.ENABLE_APEX_BRIDGE === 'true') {
    startApexBridge();
    logger.info('[Startup] APEX Bridge ENABLED');
  } else {
    logger.info('[Startup] APEX Bridge DISABLED');
  }

  if (process.env.ENABLE_TWITTER === 'true') {
    startTwitterScraper();
    logger.info('[Startup] Twitter scraper ENABLED');
  } else {
    logger.info('[Startup] Twitter scraper DISABLED (set ENABLE_TWITTER=true to enable)');
  }

  if (process.env.ENABLE_MOONSHOT_HUNTER === 'true') {
    startMoonshotHunter();
    logger.info('[Startup] Moonshot Hunter ENABLED');
  } else {
    logger.info('[Startup] Moonshot Hunter DISABLED');
  }

  if (process.env.ENABLE_SPORTS === 'true') {
    startSportsEngine();
    logger.info('[Startup] Sports engine ENABLED');
  } else {
    logger.info('[Startup] Sports engine DISABLED (set ENABLE_SPORTS=true to enable)');
  }

  if (process.env.ENABLE_STOCKS === 'true') {
    startStockEngine();
    logger.info('[Startup] Stock engine ENABLED');
  } else {
    logger.info('[Startup] Stock engine DISABLED (set ENABLE_STOCKS=true to enable)');
  }

  if (process.env.ENABLE_TRADEVISOR === 'true') {
    setOnTradevisorSignal(async (result) => {
      if (result.action !== 'buy' && result.action !== 'sell') return;
      logger.info(
        { ticker: result.ticker, chain: result.chain, action: result.action, score: result.confluenceScore, grade: result.grade },
        `[Tradevisor] CONFIRMED SIGNAL → ${result.action.toUpperCase()} ${result.ticker} (${result.grade}, ${result.chain})`,
      );
      if (result.chain !== 'stock') {
        try {
          const { executeSignalTrade } = await import('./routes/crypto-agent.js');
          // Map TradeVisor chain ('crypto' | 'solana') → TradeSignal chain ('coinbase' | 'solana')
          // so the router doesn't fall into DexScreener lookup for major-cap CEX-listed coins.
          const signalChain = result.chain === 'crypto' ? 'coinbase' : 'solana';
          executeSignalTrade({
            symbol: result.ticker, action: result.action, price: result.currentPrice,
            source: `tradevisor_${result.grade}`, confidence: result.confidence,
            reason: `Tradevisor ${result.action.toUpperCase()}: ${result.ticker} — ${result.confluenceScore}/6 (${result.grade})`,
            chain: signalChain,
          });
        } catch { /* crypto agent not loaded */ }
      }
    });
    startTradevisorLoop();
    logger.info('[Startup] Tradevisor ENABLED');
  } else {
    logger.info('[Startup] Tradevisor DISABLED');
  }

  if (process.env.ENABLE_CEX === 'true') {
    startCEXEngine();
    logger.info('[Startup] CEX engine ENABLED');
  } else {
    logger.info('[Startup] CEX engine DISABLED (set ENABLE_CEX=true to enable)');
  }

  if (process.env.ENABLE_DEX_SCANNER === 'true') {
    startDEXMomentumScanner();
    logger.info('[Startup] DEX Momentum Scanner ENABLED');
  } else {
    logger.info('[Startup] DEX Momentum Scanner DISABLED');
  }

  if (process.env.ENABLE_TOKEN_FACTORY === 'true') {
    void (async () => {
      try {
        const { startTokenFactory } = await import('./services/token-factory/auto-launcher.js');
        startTokenFactory();
        logger.info('[Startup] Token Factory ENABLED');
      } catch { /* factory not loaded */ }
    })();
  } else {
    logger.info('[Startup] Token Factory DISABLED (set ENABLE_TOKEN_FACTORY=true to enable)');
  }
});

// Graceful shutdown
function shutdown(signal: string): void {
  logger.info({ signal }, `Received ${signal}. Shutting down...`);

  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
