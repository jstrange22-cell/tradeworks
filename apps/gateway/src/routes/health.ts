import { Router, type Router as RouterType } from 'express';

/**
 * Health check endpoint.
 * GET /api/v1/health
 */

export const healthRouter: RouterType = Router();

healthRouter.get('/', (_req, res) => {
  const uptime = process.uptime();

  res.json({
    status: 'healthy',
    version: process.env.npm_package_version ?? '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptime),
      formatted: formatUptime(uptime),
    },
    environment: process.env.NODE_ENV ?? 'development',
    services: {
      gateway: 'running',
      engine: 'unknown', // TODO: Check engine health via internal call
      ingest: 'unknown', // TODO: Check ingest health
      database: 'unknown', // TODO: Check DB connection
      redis: 'unknown', // TODO: Check Redis connection
    },
  });
});

/**
 * Detailed health check for internal monitoring.
 * GET /api/v1/health/detailed
 */
healthRouter.get('/detailed', async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Check database connectivity
  try {
    const start = Date.now();
    // TODO: Ping database
    checks.database = { status: 'healthy', latencyMs: Date.now() - start };
  } catch (error) {
    checks.database = { status: 'unhealthy', error: String(error) };
  }

  // Check Redis connectivity
  try {
    const start = Date.now();
    // TODO: Ping Redis
    checks.redis = { status: 'healthy', latencyMs: Date.now() - start };
  } catch (error) {
    checks.redis = { status: 'unhealthy', error: String(error) };
  }

  // Memory usage
  const memUsage = process.memoryUsage();

  res.json({
    status: Object.values(checks).every((c) => c.status === 'healthy') ? 'healthy' : 'degraded',
    checks,
    memory: {
      rss: formatBytes(memUsage.rss),
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal),
      external: formatBytes(memUsage.external),
    },
    uptime: formatUptime(process.uptime()),
  });
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}
