import Redis from 'ioredis';

let _redis: Redis | null = null;

/**
 * Returns a singleton Redis client.
 * Connection parameters are read from environment variables.
 */
export function getRedisClient(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5_000);
        return delay;
      },
      lazyConnect: false,
    });

    _redis.on('error', (err) => {
      console.error('[redis] Connection error:', err);
    });
  }

  return _redis;
}

/**
 * Create a new, independent Redis connection.
 * Useful for subscribers that need a dedicated connection.
 */
export function createRedisClient(): Redis {
  return new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5_000);
      return delay;
    },
    lazyConnect: false,
  });
}

/**
 * Gracefully disconnect the singleton Redis client.
 */
export async function closeRedisClient(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

export { Redis };
