import { Router, type Router as RouterType } from 'express';
import { getMemoryKeysByService } from './api-keys.js';
import { decryptApiKey } from '@tradeworks/db';
import { SignJWT, importPKCS8 } from 'jose';
import { randomBytes } from 'node:crypto';

/**
 * Robinhood Crypto API Integration — Sprint 9
 *
 * Official Robinhood Crypto Trading API (docs.robinhood.com)
 * Auth: ED25519 key pair signing (similar to Coinbase CDP)
 *
 * NOTE: This is CRYPTO ONLY. Robinhood does not have an official
 * public API for stocks/options. Use Alpaca for stock trading.
 *
 * Routes:
 *   GET  /api/v1/robinhood/account     — Account info & holdings
 *   GET  /api/v1/robinhood/holdings    — Crypto holdings
 *   GET  /api/v1/robinhood/prices      — Current crypto prices
 *   POST /api/v1/robinhood/order       — Place crypto order
 */

export const robinhoodRouter: RouterType = Router();

// ── API Client ─────────────────────────────────────────────────────────

const RH_CRYPTO_API = 'https://trading.robinhood.com';

/**
 * Get Robinhood API credentials from memory store.
 */
function getRobinhoodKeys(): { apiKey: string; apiSecret: string } | null {
  try {
    const keys = getMemoryKeysByService('robinhood');
    if (keys.length === 0) return null;

    const entry = keys[0];
    return {
      apiKey: decryptApiKey(entry.encryptedKey),
      apiSecret: entry.encryptedSecret ? decryptApiKey(entry.encryptedSecret) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Build JWT for Robinhood Crypto API authentication.
 * Robinhood uses ED25519 key pair for API signing.
 */
async function buildRobinhoodJwt(
  apiKey: string,
  privateKeyPem: string,
  method: string,
  path: string,
  body?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Robinhood expects ES256 or EdDSA signed JWTs
    const key = await importPKCS8(privateKeyPem.replace(/\\n/g, '\n'), 'EdDSA');

    return new SignJWT({
      iss: apiKey,
      sub: apiKey,
      iat: now,
      exp: now + 300,
      method,
      path,
      ...(body ? { body_hash: body } : {}),
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .sign(key);
  } catch (err) {
    console.error('[Robinhood] JWT signing failed:', err);
    throw new Error('Failed to sign Robinhood API request');
  }
}

/**
 * Make authenticated request to Robinhood Crypto API.
 */
async function robinhoodRequest(
  method: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  body?: unknown,
): Promise<unknown> {
  const bodyStr = body ? JSON.stringify(body) : undefined;

  try {
    const jwt = await buildRobinhoodJwt(apiKey, apiSecret, method, path, bodyStr);

    const res = await fetch(`${RH_CRYPTO_API}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      ...(bodyStr ? { body: bodyStr } : {}),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      console.error(`[Robinhood] API error ${res.status}: ${errorText}`);
      throw new Error(`Robinhood API error: ${res.status}`);
    }

    return res.json();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Robinhood API')) throw err;
    console.error('[Robinhood] Request failed:', err);
    throw new Error('Failed to connect to Robinhood API');
  }
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /robinhood/account — Account info
robinhoodRouter.get('/account', async (_req, res) => {
  const keys = getRobinhoodKeys();
  if (!keys) {
    res.status(400).json({ error: 'Robinhood API keys not configured' });
    return;
  }

  try {
    const account = await robinhoodRequest('GET', '/api/v1/crypto/trading/accounts/', keys.apiKey, keys.apiSecret);
    res.json({ data: account });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch Robinhood account',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /robinhood/holdings — Crypto holdings
robinhoodRouter.get('/holdings', async (_req, res) => {
  const keys = getRobinhoodKeys();
  if (!keys) {
    res.status(400).json({ error: 'Robinhood API keys not configured' });
    return;
  }

  try {
    const holdings = await robinhoodRequest('GET', '/api/v1/crypto/trading/holdings/', keys.apiKey, keys.apiSecret);
    res.json({ data: holdings });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch Robinhood holdings',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /robinhood/prices — Current crypto prices
robinhoodRouter.get('/prices', async (_req, res) => {
  try {
    // Public endpoint — no auth needed
    const pairs = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'AVAX-USD'];
    const prices: Record<string, number> = {};

    for (const pair of pairs) {
      try {
        const data = await fetch(`${RH_CRYPTO_API}/api/v1/crypto/marketdata/best_bid_ask/?symbol=${pair}`);
        if (data.ok) {
          const json = (await data.json()) as { results?: Array<{ price?: number }> };
          if (json.results?.[0]?.price) {
            prices[pair] = json.results[0].price;
          }
        }
      } catch { /* skip individual price failures */ }
    }

    res.json({ data: prices });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch prices',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /robinhood/order — Place crypto order
robinhoodRouter.post('/order', async (req, res) => {
  const keys = getRobinhoodKeys();
  if (!keys) {
    res.status(400).json({ error: 'Robinhood API keys not configured' });
    return;
  }

  const { symbol, side, quantity, type = 'market' } = req.body as {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    type?: 'market' | 'limit';
  };

  if (!symbol || !side || !quantity) {
    res.status(400).json({ error: 'Missing required fields: symbol, side, quantity' });
    return;
  }

  try {
    const order = await robinhoodRequest('POST', '/api/v1/crypto/trading/orders/', keys.apiKey, keys.apiSecret, {
      client_order_id: randomBytes(16).toString('hex'),
      side,
      symbol: symbol.replace('-', ''),
      type,
      market_order_config: type === 'market' ? { asset_quantity: String(quantity) } : undefined,
    });

    res.json({ data: order, message: `${side.toUpperCase()} order placed for ${quantity} ${symbol}` });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to place order',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
