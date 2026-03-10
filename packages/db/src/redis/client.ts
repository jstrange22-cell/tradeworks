import Redis from 'ioredis';

let _redis: Redis | null = null;
let _loggedDisconnect = false;

/**
 * Returns a singleton Redis client.
 * Gracefully degrades when Redis is unavailable — the gateway won't crash.
 */
export function getRedisClient(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,        // Never throw on pending commands
      retryStrategy(times: number) {
        // Exponential backoff capped at 30s. Never stop retrying.
        return Math.min(times * 500, 30_000);
      },
      lazyConnect: true,                 // Don't block startup
      enableOfflineQueue: false,         // Drop commands when disconnected (prevents memory leak)
      reconnectOnError() { return true; },
    });

    _redis.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        if (!_loggedDisconnect) {
          console.warn('[redis] Not available — features requiring Redis will be degraded');
          _loggedDisconnect = true;
        }
      } else {
        console.error('[redis] Error:', err.message);
      }
    });

    _redis.on('connect', () => {
      _loggedDisconnect = false;
      console.info('[redis] Connected');
    });

    // Attempt connection but don't crash if it fails
    _redis.connect().catch(() => {});
  }

  return _redis;
}

/**
 * Create a new, independent Redis connection.
 * Useful for subscribers that need a dedicated connection.
 */
export function createRedisClient(): Redis {
  const client = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryStrategy(times: number) {
      return Math.min(times * 500, 30_000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
    reconnectOnError() { return true; },
  });

  client.on('error', () => {
    // Silently handled — singleton client logs once
  });

  client.connect().catch(() => {});

  return client;
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
