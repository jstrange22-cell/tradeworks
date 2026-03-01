import { getRedisClient, closeRedisClient, REDIS_CHANNELS } from '@tradeworks/db';

interface NormalizedTick {
  exchange: string;
  instrument: string;
  market: 'crypto' | 'equity' | 'prediction';
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  tradeId: string;
  timestamp: Date;
}

interface CandleData {
  instrument: string;
  market: string;
  exchange: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
}

export class RedisPublisher {
  private redis: ReturnType<typeof getRedisClient> | null = null;
  private initialized = false;
  private tickCount = 0;
  private logInterval: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    try {
      this.redis = getRedisClient();
      this.initialized = true;
    } catch (err) {
      console.warn('[Redis Publisher] Failed to connect, running in silent mode:', err);
      this.initialized = true;
    }

    // Log throughput every 30s
    this.logInterval = setInterval(() => {
      if (this.tickCount > 0) {
        console.log(`[Redis Publisher] Throughput: ${this.tickCount} ticks in last 30s`);
        this.tickCount = 0;
      }
    }, 30000);

    console.log('[Redis Publisher] Initialized.');
  }

  publishTick(tick: NormalizedTick): void {
    if (!this.initialized || !this.redis) return;

    this.tickCount++;

    this.redis
      .publish(
        REDIS_CHANNELS.MARKET_DATA,
        JSON.stringify({
          type: 'tick',
          instrument: tick.instrument,
          market: tick.market,
          price: tick.price,
          quantity: tick.quantity,
          side: tick.side,
          timestamp: tick.timestamp.toISOString(),
        }),
      )
      .catch(() => {
        // Swallow publish errors — non-critical path
      });
  }

  publishCandle(candle: CandleData): void {
    if (!this.initialized || !this.redis) return;

    this.redis
      .publish(
        REDIS_CHANNELS.MARKET_DATA,
        JSON.stringify({
          type: 'candle',
          instrument: candle.instrument,
          market: candle.market,
          timestamp: candle.timestamp.toISOString(),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          tradeCount: candle.tradeCount,
        }),
      )
      .catch(() => {
        // Swallow publish errors — non-critical path
      });
  }

  async close(): Promise<void> {
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
    await closeRedisClient();
    console.log('[Redis Publisher] Closed.');
  }
}
