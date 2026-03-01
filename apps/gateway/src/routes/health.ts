import { Router, type Router as RouterType } from 'express';
import { db, pool, getRedisClient } from '@tradeworks/db';
import { sql } from 'drizzle-orm';

/**
 * Health check endpoint.
 * GET /api/v1/health
 * GET /api/v1/health/detailed
 */

export const healthRouter: RouterType = Router();

healthRouter.get('/', async (_req, res) => {
  const uptime = process.uptime();

  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  let redisStatus: 'connected' | 'disconnected' = 'disconnected';

  // Check database connectivity
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  // Check Redis connectivity
  try {
    const redis = getRedisClient();
    await redis.ping();
    redisStatus = 'connected';
  } catch {
    redisStatus = 'disconnected';
  }

  const allHealthy = dbStatus === 'connected' && redisStatus === 'connected';

  res.json({
    status: allHealthy ? 'healthy' : 'degraded',
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
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

/**
 * Detailed health check for internal monitoring.
 * GET /api/v1/health/detailed
 */
healthRouter.get('/detailed', async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Check database connectivity with latency measurement
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = { status: 'healthy', latencyMs: Date.now() - start };
  } catch (error) {
    checks.database = { status: 'unhealthy', error: String(error) };
  }

  // Check Redis connectivity with latency measurement
  try {
    const start = Date.now();
    const redis = getRedisClient();
    await redis.ping();
    checks.redis = { status: 'healthy', latencyMs: Date.now() - start };
  } catch (error) {
    checks.redis = { status: 'unhealthy', error: String(error) };
  }

  // Postgres pool stats
  const poolStats = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };

  // Memory usage
  const memUsage = process.memoryUsage();

  res.json({
    status: Object.values(checks).every((c) => c.status === 'healthy') ? 'healthy' : 'degraded',
    checks,
    pool: poolStats,
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
