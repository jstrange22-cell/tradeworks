import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * JWT authentication middleware.
 * Validates Bearer token from Authorization header and attaches user to request.
 */

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'trader' | 'viewer';
  iat: number;
  exp: number;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'tradeworks-dev-secret-change-in-production';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid authorization format. Expected: Bearer <token>' });
    return;
  }

  const token = authHeader.slice(7);

  if (!token) {
    res.status(401).json({ error: 'Token is required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

    // Validate required fields
    if (!decoded.id || !decoded.email || !decoded.role) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token has expired' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Role-based authorization middleware factory.
 */
export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: req.user.role,
      });
      return;
    }

    next();
  };
}

/**
 * Generate a JWT token for a user.
 * Utility for testing and internal use.
 */
export function generateToken(user: { id: string; email: string; role: AuthUser['role'] }): string {
  const expiresIn = process.env.JWT_EXPIRY ?? '24h';
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn } as jwt.SignOptions,
  );
}
