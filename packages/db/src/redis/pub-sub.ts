import { createRedisClient, getRedisClient, type Redis } from './client.js';

// ---------------------------------------------------------------------------
// Channel constants
// ---------------------------------------------------------------------------
// These mirror the REDIS_CHANNELS from @tradeworks/shared.
// Once @tradeworks/shared exports them, swap the import.

export const REDIS_CHANNELS = {
  MARKET_DATA: 'tw:market-data',
  ORDERS: 'tw:orders',
  POSITIONS: 'tw:positions',
  SIGNALS: 'tw:signals',
  RISK_ALERTS: 'tw:risk-alerts',
  AGENT_EVENTS: 'tw:agent-events',
  SYSTEM: 'tw:system',
} as const;

export type RedisChannel = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

/**
 * Publish a JSON-serializable message to a Redis channel.
 * Uses the shared singleton connection.
 */
export async function publish<T>(channel: RedisChannel, message: T): Promise<number> {
  const redis = getRedisClient();
  return redis.publish(channel, JSON.stringify(message));
}

// ---------------------------------------------------------------------------
// Subscriber
// ---------------------------------------------------------------------------

export interface Subscription {
  /** Unsubscribe and close the dedicated connection. */
  unsubscribe(): Promise<void>;
}

/**
 * Subscribe to one or more Redis channels.
 * Each subscription gets its own dedicated Redis connection
 * (required by the Redis protocol for SUBSCRIBE mode).
 *
 * @param channels  - channels to subscribe to
 * @param handler   - callback invoked with (channel, parsed message)
 * @returns a Subscription handle to unsubscribe later
 */
export function subscribe<T = unknown>(
  channels: RedisChannel | RedisChannel[],
  handler: (channel: RedisChannel, message: T) => void,
): Subscription {
  const sub: Redis = createRedisClient();
  const channelList = Array.isArray(channels) ? channels : [channels];

  sub.subscribe(...channelList).catch((err) => {
    console.error('[redis:pub-sub] Subscribe error:', err);
  });

  sub.on('message', (ch: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw) as T;
      handler(ch as RedisChannel, parsed);
    } catch (err) {
      console.error('[redis:pub-sub] Failed to parse message:', err);
    }
  });

  return {
    async unsubscribe() {
      await sub.unsubscribe(...channelList);
      await sub.quit();
    },
  };
}
