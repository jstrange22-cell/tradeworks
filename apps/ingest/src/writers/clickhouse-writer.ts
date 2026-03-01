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
    // TODO: Initialize ClickHouse client from @tradeworks/db
    // const { getClickHouseClient } = await import('@tradeworks/db');
    // this.client = getClickHouseClient();
    this.initialized = true;
    console.log('[ClickHouse Writer] Initialized. Batch size:', this.batchSize, 'Flush interval:', this.flushMs, 'ms');
  }

  buffer(tick: NormalizedTick): void {
    this.tickBuffer.push(tick);

    // Auto-flush if buffer exceeds batch size
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
    await Promise.allSettled([
      this.flushTicks(),
      this.flushCandles(),
    ]);
  }

  private async flushTicks(): Promise<void> {
    if (this.tickBuffer.length === 0) return;

    const batch = this.tickBuffer.splice(0, this.tickBuffer.length);

    try {
      // TODO: Use ClickHouse client to insert batch
      // await this.client.insert({
      //   table: 'market_trades',
      //   values: batch.map(t => ({
      //     exchange: t.exchange,
      //     instrument: t.instrument,
      //     market: t.market,
      //     trade_time: t.timestamp.toISOString(),
      //     price: t.price,
      //     quantity: t.quantity,
      //     side: t.side,
      //     trade_id: t.tradeId,
      //   })),
      //   format: 'JSONEachRow',
      // });
      console.log(`[ClickHouse Writer] Flushed ${batch.length} ticks`);
    } catch (err) {
      console.error('[ClickHouse Writer] Tick flush failed:', err);
      // Re-buffer failed ticks at the front
      this.tickBuffer.unshift(...batch);
    }
  }

  private async flushCandles(): Promise<void> {
    if (this.candleBuffer.length === 0) return;

    const batch = this.candleBuffer.splice(0, this.candleBuffer.length);

    try {
      // TODO: Use ClickHouse client to insert OHLCV data
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
    // TODO: Close ClickHouse client
    console.log('[ClickHouse Writer] Closed.');
  }
}
