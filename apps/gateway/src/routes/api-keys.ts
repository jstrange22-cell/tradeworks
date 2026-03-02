import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  getApiKeys,
  getApiKey,
  createApiKey,
  deleteApiKey,
  encryptApiKey,
  decryptApiKey,
} from '@tradeworks/db';

/**
 * API Key management routes.
 * GET    /api/v1/settings/api-keys          - List all API keys (masked)
 * POST   /api/v1/settings/api-keys          - Add a new API key
 * DELETE /api/v1/settings/api-keys/:id      - Delete an API key
 * POST   /api/v1/settings/api-keys/:id/test - Test exchange connection
 */

export const apiKeysRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// In-memory fallback store (used when PostgreSQL is unavailable)
// ---------------------------------------------------------------------------
interface MemoryApiKey {
  id: string;
  service: string;
  keyName: string;
  encryptedKey: ReturnType<typeof encryptApiKey>;
  encryptedSecret?: ReturnType<typeof encryptApiKey>;
  environment: string;
  createdAt: string;
}

const memoryApiKeys = new Map<string, MemoryApiKey>();

/**
 * API Key creation schema.
 */
const ApiKeySchema = z.object({
  service: z.enum(['coinbase', 'alpaca', 'polymarket']),
  keyName: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  environment: z.enum(['production', 'sandbox', 'testnet']).default('sandbox'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a key name for display: first 8 chars + '...' + last 4 chars.
 * If the value is too short, mask what we can.
 */
function maskKey(value: string): string {
  if (value.length <= 12) {
    return value.slice(0, 4) + '...';
  }
  return value.slice(0, 8) + '...' + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /
 * List all API keys (masked — never return raw key values).
 */
apiKeysRouter.get('/', async (_req, res) => {
  try {
    let keys: Awaited<ReturnType<typeof getApiKeys>> = [];
    try {
      keys = await getApiKeys();
    } catch {
      // DB unavailable — use in-memory store
      keys = [...memoryApiKeys.values()] as unknown as Awaited<ReturnType<typeof getApiKeys>>;
    }

    // Merge in-memory keys not already in DB results
    const dbIds = new Set(keys.map(k => k.id));
    for (const memKey of memoryApiKeys.values()) {
      if (!dbIds.has(memKey.id)) {
        keys.push(memKey as unknown as (typeof keys)[number]);
      }
    }

    const masked = keys.map((key) => ({
      id: key.id,
      service: key.service,
      keyName: key.keyName,
      maskedKey: maskKey(key.keyName),
      environment: key.environment,
      createdAt: key.createdAt,
    }));

    res.json({ data: masked, total: masked.length });
  } catch (error) {
    console.error('[ApiKeys] Error listing API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

/**
 * POST /
 * Add a new API key. Encrypts the key before storing.
 */
apiKeysRouter.post('/', async (req, res) => {
  try {
    const body = ApiKeySchema.parse(req.body);

    const encryptedKey = encryptApiKey(body.apiKey);
    const encryptedSecret = body.apiSecret ? encryptApiKey(body.apiSecret) : undefined;

    let created;
    try {
      created = await createApiKey({
        service: body.service,
        keyName: body.keyName,
        encryptedKey,
        encryptedSecret,
        environment: body.environment,
      });
    } catch {
      console.warn('[ApiKeys] DB unavailable, saving to in-memory store');
      const memKey: MemoryApiKey = {
        id: `key-${Date.now()}`,
        service: body.service,
        keyName: body.keyName,
        encryptedKey: encryptedKey,
        encryptedSecret: encryptedSecret,
        environment: body.environment,
        createdAt: new Date().toISOString(),
      };
      memoryApiKeys.set(memKey.id, memKey);
      created = memKey;
    }

    res.status(201).json({
      data: {
        id: created.id,
        service: created.service,
        keyName: created.keyName,
        maskedKey: maskKey(created.keyName),
        environment: created.environment,
        createdAt: created.createdAt,
      },
      message: 'API key created successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid API key data',
        details: error.errors,
      });
      return;
    }
    console.error('[ApiKeys] Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

/**
 * DELETE /:id
 * Delete an API key.
 */
apiKeysRouter.delete('/:id', async (req, res) => {
  try {
    try {
      await deleteApiKey(req.params.id as string);
    } catch {
      // DB unavailable
    }
    memoryApiKeys.delete(req.params.id as string);

    res.status(204).send();
  } catch (error) {
    console.error('[ApiKeys] Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

/**
 * POST /:id/test
 * Test exchange connection by making a lightweight API call.
 */
apiKeysRouter.post('/:id/test', async (req, res) => {
  try {
    let key;
    try {
      key = await getApiKey(req.params.id as string);
    } catch {
      // DB unavailable — check in-memory store
      key = memoryApiKeys.get(req.params.id as string) as unknown as Awaited<ReturnType<typeof getApiKey>> | undefined;
    }

    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    const decryptedKey = decryptApiKey(key.encryptedKey);
    const decryptedSecret = key.encryptedSecret
      ? decryptApiKey(key.encryptedSecret)
      : undefined;

    let success = false;
    let message = '';

    try {
      switch (key.service) {
        case 'coinbase': {
          const response = await fetch('https://api.coinbase.com/api/v3/brokerage/accounts', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${decryptedKey}`,
              'Content-Type': 'application/json',
            },
          });
          success = response.ok;
          message = success
            ? 'Coinbase connection successful'
            : `Coinbase returned ${response.status}: ${response.statusText}`;
          break;
        }

        case 'alpaca': {
          const baseUrl = key.environment === 'production'
            ? 'https://api.alpaca.markets/v2/account'
            : 'https://paper-api.alpaca.markets/v2/account';
          const response = await fetch(baseUrl, {
            method: 'GET',
            headers: {
              'APCA-API-KEY-ID': decryptedKey,
              'APCA-API-SECRET-KEY': decryptedSecret ?? '',
            },
          });
          success = response.ok;
          message = success
            ? 'Alpaca connection successful'
            : `Alpaca returned ${response.status}: ${response.statusText}`;
          break;
        }

        case 'polymarket': {
          const response = await fetch('https://clob.polymarket.com/time', {
            method: 'GET',
          });
          success = response.ok;
          message = success
            ? 'Polymarket endpoint reachable'
            : `Polymarket returned ${response.status}: ${response.statusText}`;
          break;
        }

        default:
          message = `Unknown service: ${key.service}`;
      }
    } catch (fetchError) {
      success = false;
      message = `Connection failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
    }

    res.json({ success, message });
  } catch (error) {
    console.error('[ApiKeys] Error testing API key:', error);
    res.status(500).json({ error: 'Failed to test API key connection' });
  }
});
