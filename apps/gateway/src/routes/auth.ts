import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';

/**
 * Authentication routes.
 * POST /api/v1/auth/register  — Create user, return JWT
 * POST /api/v1/auth/login     — Validate credentials, return JWT
 * POST /api/v1/auth/google    — Google Sign-In, verify ID token, return JWT
 * GET  /api/v1/auth/me        — Return current user from JWT
 */

export const authRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'trader' | 'viewer';
  authProvider: 'local' | 'google';
  avatarUrl?: string;
  createdAt: string;
}

interface AuthTokenPayload {
  id: string;
  email: string;
  name: string;
  role: string;
}

// ---------------------------------------------------------------------------
// File-based user store (follows existing api-keys.json pattern)
// ---------------------------------------------------------------------------

const __filename_auth = fileURLToPath(import.meta.url);
const __dirname_auth = dirname(__filename_auth);
const DATA_DIR = join(__dirname_auth, '..', '..', 'data');
const USERS_FILE = join(DATA_DIR, 'users.json');

const JWT_SECRET = process.env.JWT_SECRET ?? 'tradeworks-dev-secret-change-in-production';
const JWT_EXPIRY = '7d';

// Google OAuth — verify ID tokens via Google's JWKS endpoint
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

interface GoogleIdTokenPayload {
  iss: string;
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  aud: string;
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsers(): StoredUser[] {
  try {
    ensureDataDir();
    if (!existsSync(USERS_FILE)) return [];
    const raw = readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(raw) as StoredUser[];
  } catch {
    logger.warn('[Auth] Failed to load users from disk');
    return [];
  }
}

function saveUsers(users: StoredUser[]): void {
  try {
    ensureDataDir();
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    logger.error({ error }, '[Auth] Failed to save users to disk');
  }
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt — no external dependency needed)
// ---------------------------------------------------------------------------

function hashPassword(password: string, salt: string): string {
  const hash = scryptSync(password, salt, 64);
  return hash.toString('hex');
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const hash = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(hash, storedBuffer);
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

function generateAuthToken(user: StoredUser): string {
  const payload: AuthTokenPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY } as jwt.SignOptions);
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = loginSchema.extend({
  name: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /register
 * Create a new user account.
 */
authRouter.post('/register', (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const users = loadUsers();

    // Check for existing user
    const existing = users.find((u) => u.email.toLowerCase() === body.email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    // Hash password
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(body.password, salt);

    // Create user
    const newUser: StoredUser = {
      id: `user-${randomBytes(8).toString('hex')}`,
      email: body.email.toLowerCase(),
      name: body.name,
      passwordHash,
      salt,
      role: 'admin',
      authProvider: 'local',
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers(users);

    const token = generateAuthToken(newUser);

    logger.info({ userId: newUser.id, email: newUser.email }, '[Auth] User registered');

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid registration data', details: error.errors });
      return;
    }
    logger.error({ error }, '[Auth] Registration failed');
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /login
 * Authenticate with email and password.
 */
authRouter.post('/login', (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const users = loadUsers();

    const user = users.find((u) => u.email.toLowerCase() === body.email.toLowerCase());
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValid = verifyPassword(body.password, user.salt, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateAuthToken(user);

    logger.info({ userId: user.id, email: user.email }, '[Auth] User logged in');

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid login data', details: error.errors });
      return;
    }
    logger.error({ error }, '[Auth] Login failed');
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /google
 * Authenticate via Google Sign-In.
 * Receives a Google ID token (credential), verifies it, creates or finds user.
 */
authRouter.post('/google', async (req, res) => {
  try {
    const { credential } = z.object({ credential: z.string().min(1) }).parse(req.body);

    if (!GOOGLE_CLIENT_ID) {
      res.status(500).json({ error: 'Google Sign-In is not configured on the server' });
      return;
    }

    // Verify the Google ID token against Google's JWKS
    const { payload } = await jwtVerify(credential, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: GOOGLE_CLIENT_ID,
    });

    const googleUser = payload as unknown as GoogleIdTokenPayload;

    if (!googleUser.email || !googleUser.email_verified) {
      res.status(400).json({ error: 'Google account email is not verified' });
      return;
    }

    const users = loadUsers();
    let user = users.find((u) => u.email.toLowerCase() === googleUser.email.toLowerCase());

    if (!user) {
      // Auto-register on first Google sign-in
      user = {
        id: `user-${randomBytes(8).toString('hex')}`,
        email: googleUser.email.toLowerCase(),
        name: googleUser.name ?? googleUser.email.split('@')[0],
        passwordHash: '',
        salt: '',
        role: 'admin',
        authProvider: 'google',
        avatarUrl: googleUser.picture,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      saveUsers(users);
      logger.info({ userId: user.id, email: user.email }, '[Auth] Google user auto-registered');
    } else if (!user.avatarUrl && googleUser.picture) {
      // Update avatar if user exists but had no avatar
      user.avatarUrl = googleUser.picture;
      saveUsers(users);
    }

    const token = generateAuthToken(user);

    logger.info({ userId: user.id, email: user.email }, '[Auth] Google sign-in');

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Missing Google credential' });
      return;
    }
    logger.error({ error }, '[Auth] Google sign-in failed');
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

/**
 * GET /me
 * Return the current authenticated user from JWT.
 */
authRouter.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload & { iat: number; exp: number };

    res.json({
      user: {
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
        role: decoded.role,
      },
    });
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
});
