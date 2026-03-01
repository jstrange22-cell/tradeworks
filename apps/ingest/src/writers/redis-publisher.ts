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
  private initialized = false;
  private tickCount = 0;
  private logInterval: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    // TODO: Initialize Redis client from @tradeworks/db
    // const { getRedisClient } = await import('@tradeworks/db');
    // this.redis = getRedisClient();
    this.initialized = true;

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
    if (!this.initialized) return;

    this.tickCount++;

    // TODO: Publish to Redis channel
    // const channel = `tw:market-data`;
    // this.redis.publish(channel, JSON.stringify({
    //   type: 'tick',
    //   data: tick,
    // }));
    void tick;
  }

  publishCandle(candle: CandleData): void {
    if (!this.initialized) return;

    // TODO: Publish to Redis channel
    // const channel = `tw:market-data`;
    // this.redis.publish(channel, JSON.stringify({
    //   type: 'candle',
    //   data: candle,
    // }));
    void candle;
  }

  async close(): Promise<void> {
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
    // TODO: Close Redis client
    console.log('[Redis Publisher] Closed.');
  }
}
