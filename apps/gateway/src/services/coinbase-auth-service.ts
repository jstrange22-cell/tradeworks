import { SignJWT, importJWK, importPKCS8 } from 'jose';
import { randomBytes } from 'node:crypto';
import { createServiceLogger } from '../lib/logger.js';
import { getMemoryKeysByService } from '../routes/api-keys.js';
import { decryptApiKey } from '@tradeworks/db';

const authLogger = createServiceLogger('CoinbaseAuth');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionResult {
  connected: boolean;
  status?: number;
  accounts?: number;
  error?: string;
  keyPrefix?: string;
  environment?: string;
}

// ---------------------------------------------------------------------------
// Key Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a CDP secret is an Ed25519 key (base64, 64 bytes)
 * vs an ECDSA PEM key (has BEGIN marker).
 */
export function isEd25519Secret(secret: string): boolean {
  if (secret.includes('BEGIN')) return false;
  try {
    const decoded = Buffer.from(secret.trim(), 'base64');
    return decoded.length === 64; // 32-byte seed + 32-byte pubkey
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT Construction
// ---------------------------------------------------------------------------

/**
 * Build a JWT for Coinbase CDP API authentication.
 *
 * Supports two signing algorithms:
 *   - Ed25519 (EdDSA) -- default for new CDP keys since Feb 2025
 *   - ECDSA (ES256) -- older CDP keys with PEM private key
 *
 * JWT structure:
 *   Header: { alg: "ES256"|"EdDSA", typ: "JWT", kid: keyName, nonce: randomHex }
 *   Payload: { iss: "cdp", sub: keyName, nbf: now, exp: now+120, uri: "METHOD host+path" }
 */
export async function buildCoinbaseJwt(
  keyName: string,
  secretRaw: string,
  method: string,
  path: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  const uri = `${method} api.coinbase.com${path}`;

  if (isEd25519Secret(secretRaw)) {
    // -- Ed25519 (EdDSA) signing --
    const keyBytes = Buffer.from(secretRaw.trim(), 'base64');
    const seed = keyBytes.subarray(0, 32);
    const pub = keyBytes.subarray(32, 64);

    const jwk = {
      kty: 'OKP' as const,
      crv: 'Ed25519' as const,
      d: Buffer.from(seed).toString('base64url'),
      x: Buffer.from(pub).toString('base64url'),
    };
    const key = await importJWK(jwk, 'EdDSA');

    authLogger.info('Building JWT with EdDSA (Ed25519)');
    return new SignJWT({ iss: 'cdp', sub: keyName, nbf: now, exp: now + 120, uri })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: keyName, nonce })
      .sign(key);
  } else {
    // -- ECDSA (ES256) signing --
    const pem = secretRaw.replace(/\\n/g, '\n');
    const key = await importPKCS8(pem, 'ES256');

    authLogger.info('Building JWT with ES256 (ECDSA)');
    return new SignJWT({ iss: 'cdp', sub: keyName, nbf: now, exp: now + 120, uri })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: keyName, nonce })
      .sign(key);
  }
}

// ---------------------------------------------------------------------------
// Signed Requests
// ---------------------------------------------------------------------------

/**
 * Make an authenticated request to the Coinbase Advanced Trade API.
 *
 * All CDP keys use JWT Bearer auth. Key type (Ed25519 vs ECDSA) is
 * auto-detected from the secret format by buildCoinbaseJwt().
 */
export async function coinbaseSignedRequest(
  method: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  body?: string,
): Promise<Response> {
  const token = await buildCoinbaseJwt(apiKey, apiSecret, method, path.split('?')[0]);

  return fetch(`https://api.coinbase.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body } : {}),
  });
}

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

/**
 * Decrypt and return Coinbase API keys from the in-memory/persisted store.
 * Returns null if no keys are found or decryption fails.
 */
export function getCoinbaseKeys(): { apiKey: string; apiSecret: string } | null {
  const keys = getMemoryKeysByService('coinbase');
  if (keys.length === 0) return null;
  const k = keys[0];
  try {
    const apiKey = decryptApiKey(k.encryptedKey as Buffer);
    const apiSecret = k.encryptedSecret
      ? decryptApiKey(k.encryptedSecret as Buffer)
      : '';

    // Debug logging -- masked values for troubleshooting
    const sigType = isEd25519Secret(apiSecret) ? 'Ed25519' : apiSecret.includes('BEGIN') ? 'ECDSA-PEM' : 'unknown';
    authLogger.info({ keyPrefix: apiKey.slice(0, 12), keyLength: apiKey.length }, `Key decrypted: ${apiKey.slice(0, 12)}..., length: ${apiKey.length}`);
    authLogger.info({ secretLength: apiSecret.length, sigType }, `Secret decrypted: length: ${apiSecret.length}, sigType: ${sigType}`);

    if (!apiKey || !apiSecret) return null;
    return { apiKey, apiSecret };
  } catch (err) {
    authLogger.error({ err }, 'Failed to decrypt Coinbase keys');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connection Test
// ---------------------------------------------------------------------------

/**
 * Test the Coinbase API connection using stored keys.
 *
 * Returns connection status, account count, and key metadata.
 * Does NOT mutate any engine state -- the caller is responsible
 * for updating engine state based on the result.
 */
export async function testCoinbaseConnection(): Promise<ConnectionResult> {
  const environment = getCoinbaseKeyEnvironment();
  const keys = getCoinbaseKeys();

  if (!keys) {
    authLogger.info('NOT connected -- no API keys found');
    return { connected: false, error: 'No API keys found', environment };
  }

  try {
    const res = await coinbaseSignedRequest(
      'GET',
      '/api/v3/brokerage/accounts',
      keys.apiKey,
      keys.apiSecret,
    );

    const bodyText = await res.text();
    let data: { accounts?: unknown[] } = {};
    try { data = JSON.parse(bodyText); } catch { /* non-JSON response */ }

    if (res.ok) {
      const accountCount = data.accounts?.length ?? 0;
      authLogger.info({ accountCount }, `CONNECTED -- ${accountCount} account(s) found`);
      return {
        connected: true,
        status: res.status,
        accounts: accountCount,
        keyPrefix: keys.apiKey.slice(0, 8) + '...',
        environment,
      };
    } else {
      const errMsg = bodyText.slice(0, 300);
      authLogger.warn({ status: res.status, statusText: res.statusText }, `Connection failed: ${res.status} ${res.statusText} -- ${errMsg}`);
      return {
        connected: false,
        status: res.status,
        error: `${res.status} ${res.statusText}: ${errMsg}`,
        keyPrefix: keys.apiKey.slice(0, 8) + '...',
        environment,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    authLogger.error({ err }, 'Connection test error');
    return {
      connected: false,
      error: errMsg,
      keyPrefix: keys.apiKey.slice(0, 8) + '...',
      environment,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

function getCoinbaseKeyEnvironment(): string {
  const keys = getMemoryKeysByService('coinbase');
  if (keys.length === 0) return 'none';
  return (keys[0] as unknown as { environment?: string }).environment ?? 'unknown';
}
