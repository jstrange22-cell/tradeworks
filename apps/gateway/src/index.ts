import 'dotenv/config';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
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
import { engineRouter, initEngine } from './routes/engine.js';
import { settingsRouter } from './routes/settings.js';
import { balancesRouter } from './routes/balances.js';
import { assetProtectionRouter } from './routes/asset-protection.js';
import { solanaBalancesRouter } from './routes/solana-balances.js';
import { solanaSwapRouter } from './routes/solana-swap.js';
import { solanaScannerRouter } from './routes/solana-scanner.js';
import { pumpFunRouter } from './routes/solana-pumpfun.js';
import { sniperRouter } from './routes/solana-sniper.js';
import { whaleRouter } from './routes/solana-whales.js';
import { moonshotRouter } from './routes/solana-moonshot.js';

const app: Express = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// --- Global Middleware ---

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(createRateLimiter());

// Request logging
app.use((req, _res, next) => {
  console.log(`[Gateway] ${req.method} ${req.path}`);
  next();
});

// --- Public Routes ---

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/market', marketDataRouter);
app.use('/api/v1/market/instruments', instrumentsRouter);

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
app.use('/api/v1/engine', devAuth, engineRouter);
app.use('/api/v1/settings', devAuth, settingsRouter);
app.use('/api/v1/portfolio/balances', devAuth, balancesRouter);
app.use('/api/v1/settings/asset-protection', devAuth, assetProtectionRouter);

// --- Solana Routes ---
app.use('/api/v1/solana', devAuth, solanaBalancesRouter);
app.use('/api/v1/solana', devAuth, solanaSwapRouter);
app.use('/api/v1/solana', devAuth, solanaScannerRouter);
app.use('/api/v1/solana', devAuth, pumpFunRouter);
app.use('/api/v1/solana', devAuth, sniperRouter);
app.use('/api/v1/solana', devAuth, whaleRouter);
app.use('/api/v1/solana', devAuth, moonshotRouter);

// --- Error Handling ---

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Gateway] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// --- Server Start ---

const server = createServer(app);

// Set up WebSocket server
setupWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`[TradeWorks Gateway] Running on http://${HOST}:${PORT}`);
  console.log(`[TradeWorks Gateway] Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[TradeWorks Gateway] WebSocket available at ws://${HOST}:${PORT}/ws`);

  // Auto-start the AI trading engine — runs 24/7 with zero intervention
  initEngine();
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n[TradeWorks Gateway] Received ${signal}. Shutting down...`);

  server.close(() => {
    console.log('[TradeWorks Gateway] HTTP server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[TradeWorks Gateway] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
