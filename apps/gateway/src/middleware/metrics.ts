import { type Request, type Response, type NextFunction, Router, type Router as RouterType } from 'express';
import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// --- Custom Metrics ---

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const wsConnectionsGauge = new client.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

export const engineCycleDuration = new client.Histogram({
  name: 'engine_cycle_duration_seconds',
  help: 'Duration of trading engine cycles in seconds',
  labelNames: ['status'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const tradeExecutionCounter = new client.Counter({
  name: 'trades_executed_total',
  help: 'Total number of trades executed',
  labelNames: ['market', 'side', 'status'] as const,
  registers: [register],
});

export const circuitBreakerGauge = new client.Gauge({
  name: 'circuit_breaker_active',
  help: 'Whether the circuit breaker is currently active (1=active, 0=inactive)',
  registers: [register],
});

export const portfolioEquityGauge = new client.Gauge({
  name: 'portfolio_equity_usd',
  help: 'Current portfolio equity in USD',
  registers: [register],
});

/**
 * Express middleware that records HTTP request duration and counts.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = req.route?.path ?? req.path;
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });

  next();
}

/**
 * Router that exposes /metrics endpoint for Prometheus scraping.
 */
export const metricsRouter: RouterType = Router();

metricsRouter.get('/', async (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
