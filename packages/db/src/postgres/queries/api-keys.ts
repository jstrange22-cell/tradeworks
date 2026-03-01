import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { apiKeys, type ApiKey, type NewApiKey } from '../schema.js';

/**
 * Retrieve all API keys.
 */
export async function getApiKeys(): Promise<ApiKey[]> {
  return db.select().from(apiKeys);
}

/**
 * Retrieve an API key by its ID.
 */
export async function getApiKey(id: string): Promise<ApiKey | undefined> {
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);
  return key;
}

/**
 * Retrieve all API keys for a given service.
 */
export async function getApiKeysByService(service: string): Promise<ApiKey[]> {
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.service, service));
}

/**
 * Insert a new API key.
 */
export async function createApiKey(data: NewApiKey): Promise<ApiKey> {
  const [inserted] = await db.insert(apiKeys).values(data).returning();
  return inserted!;
}

/**
 * Delete an API key by ID.
 */
export async function deleteApiKey(id: string): Promise<void> {
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
}
