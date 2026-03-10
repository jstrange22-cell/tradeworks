import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createServiceLogger } from '../lib/logger.js';

const errorLogger = createServiceLogger('Gateway');

/**
 * Standard API error class with status code and error code.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'INTERNAL_ERROR',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, 'BAD_REQUEST', details);
  }
  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, message, 'UNAUTHORIZED');
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(403, message, 'FORBIDDEN');
  }
  static notFound(message = 'Not found') {
    return new AppError(404, message, 'NOT_FOUND');
  }
  static conflict(message: string) {
    return new AppError(409, message, 'CONFLICT');
  }
  static unprocessable(message: string, details?: unknown) {
    return new AppError(422, message, 'UNPROCESSABLE_ENTITY', details);
  }
  static internal(message = 'Internal server error') {
    return new AppError(500, message, 'INTERNAL_ERROR');
  }
}

/**
 * Global error handler middleware — must be registered LAST.
 */
export function globalErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      status: err.statusCode,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (err as any).errors,
      },
      status: 400,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Unknown errors
  errorLogger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    },
    status: 500,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Wrap an async route handler to catch rejected promises.
 * Express 4 does NOT catch async errors — this wrapper does.
 */
export function wrapAsync(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
