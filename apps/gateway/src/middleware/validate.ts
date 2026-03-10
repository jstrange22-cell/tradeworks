import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Express middleware that validates request body, query, and params
 * against Zod schemas. Parsed (and coerced) values replace the originals
 * so downstream handlers receive typed, validated data.
 *
 * Validation errors are forwarded to `next()` and caught by the
 * global error handler's ZodError branch.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (error) {
      next(error); // Caught by globalErrorHandler's ZodError handling
    }
  };
}
