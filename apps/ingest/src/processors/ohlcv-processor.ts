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

type CandleHandler = (candle: CandleData) => void;

interface ActiveCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  exchange: string;
  market: string;
  minuteKey: number;
}

export class OHLCVProcessor {
  private candles = new Map<string, ActiveCandle>();
  private candleHandler: CandleHandler | null = null;
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Flush completed candles every 5 seconds
    this.flushInterval = setInterval(() => this.flushCompletedCandles(), 5000);
  }

  onCandle(handler: CandleHandler): void {
    this.candleHandler = handler;
  }

  processTick(tick: NormalizedTick): void {
    const minuteKey = Math.floor(tick.timestamp.getTime() / 60000);
    const key = `${tick.instrument}:${minuteKey}`;

    const existing = this.candles.get(key);

    if (existing) {
      existing.high = Math.max(existing.high, tick.price);
      existing.low = Math.min(existing.low, tick.price);
      existing.close = tick.price;
      existing.volume += tick.quantity;
      existing.tradeCount += 1;
    } else {
      this.candles.set(key, {
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.quantity,
        tradeCount: 1,
        exchange: tick.exchange,
        market: tick.market,
        minuteKey,
      });
    }
  }

  private flushCompletedCandles(): void {
    if (!this.candleHandler) return;

    const currentMinute = Math.floor(Date.now() / 60000);

    for (const [key, candle] of this.candles) {
      // Emit candles from previous minutes (completed)
      if (candle.minuteKey < currentMinute) {
        const instrument = key.split(':')[0];
        this.candleHandler({
          instrument,
          market: candle.market,
          exchange: candle.exchange,
          timestamp: new Date(candle.minuteKey * 60000),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          tradeCount: candle.tradeCount,
        });
        this.candles.delete(key);
      }
    }
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }
}

export type { CandleData, NormalizedTick };
