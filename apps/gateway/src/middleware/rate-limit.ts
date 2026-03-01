import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Rate limiting configuration using express-rate-limit.
 * Protects the API from abuse and excessive requests.
 */

/**
 * Create the default rate limiter for all API routes.
 */
export function createRateLimiter() {
  return rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10), // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10), // 100 requests per window
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
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
  });
}

/**
 * Stricter rate limiter for trade execution endpoints.
 */
export function createTradeRateLimiter() {
  return rateLimit({
    windowMs: 60_000, // 1 minute
    max: 10, // 10 trade requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Trade rate limit exceeded',
      message: 'Maximum 10 trade requests per minute.',
      retryAfter: 60,
    },
    keyGenerator: (req: Request): string => {
      return req.user?.id ?? req.ip ?? 'unknown';
    },
  });
}

/**
 * Rate limiter for backtest endpoints (resource-intensive).
 */
export function createBacktestRateLimiter() {
  return rateLimit({
    windowMs: 5 * 60_000, // 5 minutes
    max: 5, // 5 backtests per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Backtest rate limit exceeded',
      message: 'Maximum 5 backtest requests per 5 minutes.',
      retryAfter: 300,
    },
    keyGenerator: (req: Request): string => {
      return req.user?.id ?? req.ip ?? 'unknown';
    },
  });
}

/**
 * Rate limiter for WebSocket connections.
 */
export function createWsRateLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: 5, // 5 WebSocket connections per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'WebSocket connection rate limit exceeded',
    },
  });
}
