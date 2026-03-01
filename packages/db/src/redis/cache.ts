import { getRedisClient } from './client.js';

// ---------------------------------------------------------------------------
// Default TTL (seconds)
// ---------------------------------------------------------------------------

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

/**
 * Get a cached value by key.
 * Returns the parsed value, or `null` if the key does not exist.
 */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  const raw = await redis.get(key);
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    // If the value was stored as a plain string, return it as-is
    return raw as unknown as T;
  }
}

/**
 * Set a cached value with an optional TTL.
 *
 * @param key   - cache key
 * @param value - value to store (will be JSON-serialized)
 * @param ttl   - time-to-live in seconds (defaults to 300s / 5 min)
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttl: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const redis = getRedisClient();
  const serialized = JSON.stringify(value);
  await redis.set(key, serialized, 'EX', ttl);
}

/**
 * Delete one or more keys from the cache.
 *
 * @param keys - one or more cache keys to remove
 * @returns the number of keys that were deleted
 */
export async function cacheDel(...keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const redis = getRedisClient();
  return redis.del(...keys);
}
