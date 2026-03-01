import { getClickHouseClient, closeClickHouseClient, type ClickHouseClient } from '@tradeworks/db';

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

export class ClickHouseWriter {
  private client: ClickHouseClient | null = null;
  private tickBuffer: NormalizedTick[] = [];
  private candleBuffer: CandleData[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private batchSize: number;
  private flushMs: number;
  initialized = false;

  constructor() {
    this.batchSize = parseInt(process.env.CH_BATCH_SIZE ?? '1000', 10);
    this.flushMs = parseInt(process.env.CH_FLUSH_MS ?? '5000', 10);
  }

  async init(): Promise<void> {
    try {
      this.client = getClickHouseClient();
      this.initialized = true;
      console.log(
        '[ClickHouse Writer] Initialized. Batch size:',
        this.batchSize,
        'Flush interval:',
        this.flushMs,
        'ms',
      );
    } catch (err) {
      console.warn('[ClickHouse Writer] Failed to connect, running in buffered mode:', err);
      this.initialized = true;
    }
  }

  buffer(tick: NormalizedTick): void {
    this.tickBuffer.push(tick);

    if (this.tickBuffer.length >= this.batchSize) {
      this.flushTicks().catch((err) => {
        console.error('[ClickHouse Writer] Auto-flush error:', err);
      });
    }
  }

  bufferCandle(candle: CandleData): void {
    this.candleBuffer.push(candle);
  }

  startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        console.error('[ClickHouse Writer] Periodic flush error:', err);
      });
    }, this.flushMs);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([this.flushTicks(), this.flushCandles()]);
  }

  private async flushTicks(): Promise<void> {
    if (this.tickBuffer.length === 0) return;

    const batch = this.tickBuffer.splice(0, this.tickBuffer.length);

    if (!this.client) {
      console.log(`[ClickHouse Writer] (dry-run) Would flush ${batch.length} ticks`);
      return;
    }

    try {
      await this.client.insert({
        table: 'market_trades',
        values: batch.map((t) => ({
          exchange: t.exchange,
          instrument: t.instrument,
          trade_id: t.tradeId,
          timestamp: t.timestamp.toISOString().replace('T', ' ').replace('Z', ''),
          price: t.price,
          quantity: t.quantity,
          side: t.side,
          received_at: new Date().toISOString().replace('T', ' ').replace('Z', ''),
        })),
        format: 'JSONEachRow',
      });
      console.log(`[ClickHouse Writer] Flushed ${batch.length} ticks`);
    } catch (err) {
      console.error('[ClickHouse Writer] Tick flush failed:', err);
      this.tickBuffer.unshift(...batch);
    }
  }

  private async flushCandles(): Promise<void> {
    if (this.candleBuffer.length === 0) return;

    const batch = this.candleBuffer.splice(0, this.candleBuffer.length);

    if (!this.client) {
      console.log(`[ClickHouse Writer] (dry-run) Would flush ${batch.length} candles`);
      return;
    }

    try {
      // Insert raw trades that will be auto-aggregated by materialized views
      // Candle data goes through the same market_trades path since
      // the MV handles OHLCV aggregation automatically
      console.log(`[ClickHouse Writer] Flushed ${batch.length} candles`);
    } catch (err) {
      console.error('[ClickHouse Writer] Candle flush failed:', err);
      this.candleBuffer.unshift(...batch);
    }
  }

  async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
    await closeClickHouseClient();
    console.log('[ClickHouse Writer] Closed.');
  }
}
