import rateLimit, { type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request } from 'express';
import { getRedisClient } from '@tradeworks/db';

/**
 * Rate limiting configuration using express-rate-limit.
 * Uses Redis as a backing store when available (production / multi-instance),
 * falls back to the built-in in-memory store for local development.
 */

/**
 * Try to build a RedisStore backed by the shared ioredis singleton.
 * Returns `undefined` when Redis is unavailable so callers can fall back
 * to the default in-memory store.
 */
function tryCreateRedisStore(prefix: string): RedisStore | undefined {
  try {
    const client = getRedisClient();

    return new RedisStore({
      // `rate-limit-redis` expects a sendCommand function
      sendCommand: async (...args: string[]) =>
        client.call(args[0], ...args.slice(1)) as Promise<string>,
      prefix: `rl:${prefix}:`,
    });
  } catch (error) {
    console.warn('[rate-limit] Redis unavailable, using in-memory store:', (error as Error).message);
    return undefined;
  }
}

/**
 * Build an express-rate-limit options object with an optional Redis store.
 * Shared logic extracted so every limiter gets the same store behaviour.
 */
function buildOptions(
  prefix: string,
  overrides: Partial<Options>,
): Partial<Options> {
  const store = tryCreateRedisStore(prefix);
  return {
    standardHeaders: true,
    legacyHeaders: false,
    ...(store ? { store } : {}),
    ...overrides,
  };
}

/**
 * Create the default rate limiter for all API routes.
 */
export function createRateLimiter() {
  return rateLimit(
    buildOptions('global', {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10), // 1 minute
      max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10), // 100 requests per window
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: 60,
      },
      keyGenerator: (req: Request): string => {
        // Use user ID if authenticated, otherwise use IP
        return req.user?.id ?? req.ip ?? 'unknown';
      },
      skip: (req: Request): boolean => {
        // Skip rate limiting for health checks
        return req.path === '/api/v1/health';
      },
    }) as Options,
  );
}

/**
 * Stricter rate limiter for trade execution endpoints.
 */
export function createTradeRateLimiter() {
  return rateLimit(
    buildOptions('trade', {
      windowMs: 60_000, // 1 minute
      max: 10, // 10 trade requests per minute
      message: {
        error: 'Trade rate limit exceeded',
        message: 'Maximum 10 trade requests per minute.',
        retryAfter: 60,
      },
      keyGenerator: (req: Request): string => {
        return req.user?.id ?? req.ip ?? 'unknown';
      },
    }) as Options,
  );
}

/**
 * Rate limiter for backtest endpoints (resource-intensive).
 */
export function createBacktestRateLimiter() {
  return rateLimit(
    buildOptions('backtest', {
      windowMs: 5 * 60_000, // 5 minutes
      max: 5, // 5 backtests per 5 minutes
      message: {
        error: 'Backtest rate limit exceeded',
        message: 'Maximum 5 backtest requests per 5 minutes.',
        retryAfter: 300,
      },
      keyGenerator: (req: Request): string => {
        return req.user?.id ?? req.ip ?? 'unknown';
      },
    }) as Options,
  );
}

/**
 * Rate limiter for WebSocket connections.
 */
export function createWsRateLimiter() {
  return rateLimit(
    buildOptions('ws', {
      windowMs: 60_000,
      max: 5, // 5 WebSocket connections per minute
      message: {
        error: 'WebSocket connection rate limit exceeded',
      },
    }) as Options,
  );
}
