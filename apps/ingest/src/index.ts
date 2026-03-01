import 'dotenv/config';
import { CryptoConnector } from './connectors/crypto-connector.js';
import { AlpacaConnector } from './connectors/alpaca-connector.js';
import { PolymarketConnector } from './connectors/polymarket-connector.js';
import { OHLCVProcessor } from './processors/ohlcv-processor.js';
import { ClickHouseWriter } from './writers/clickhouse-writer.js';
import { RedisPublisher } from './writers/redis-publisher.js';

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

class IngestService {
  private cryptoConnector: CryptoConnector;
  private alpacaConnector: AlpacaConnector;
  private polymarketConnector: PolymarketConnector;
  private ohlcvProcessor: OHLCVProcessor;
  private clickhouseWriter: ClickHouseWriter;
  private redisPublisher: RedisPublisher;
  running = false;

  constructor() {
    this.clickhouseWriter = new ClickHouseWriter();
    this.redisPublisher = new RedisPublisher();
    this.ohlcvProcessor = new OHLCVProcessor();

    this.cryptoConnector = new CryptoConnector();
    this.alpacaConnector = new AlpacaConnector();
    this.polymarketConnector = new PolymarketConnector();
  }

  async start(): Promise<void> {
    console.log('[Ingest] Starting data ingestion service...');
    this.running = true;

    // Initialize writers
    await this.clickhouseWriter.init();
    await this.redisPublisher.init();

    // Set up tick handler for all connectors
    const handleTick = (tick: NormalizedTick): void => {
      // Buffer for batch ClickHouse insert
      this.clickhouseWriter.buffer(tick);

      // Publish real-time to Redis
      this.redisPublisher.publishTick(tick);

      // Update OHLCV candle
      this.ohlcvProcessor.processTick(tick);
    };

    this.cryptoConnector.onTick(handleTick);
    this.alpacaConnector.onTick(handleTick);
    this.polymarketConnector.onTick(handleTick);

    // Start OHLCV flush interval (every minute)
    this.ohlcvProcessor.onCandle((candle) => {
      this.clickhouseWriter.bufferCandle(candle);
      this.redisPublisher.publishCandle(candle);
    });

    // Start ClickHouse batch flush interval
    this.clickhouseWriter.startFlushInterval();

    // Connect to feeds
    const connectors = [];

    if (process.env.ENABLE_CRYPTO !== 'false') {
      connectors.push(this.cryptoConnector.connect());
    }
    if (process.env.ENABLE_EQUITIES !== 'false') {
      connectors.push(this.alpacaConnector.connect());
    }
    if (process.env.ENABLE_PREDICTION !== 'false') {
      connectors.push(this.polymarketConnector.connect());
    }

    await Promise.allSettled(connectors);

    console.log('[Ingest] All connectors started.');
  }

  async stop(): Promise<void> {
    console.log('[Ingest] Stopping data ingestion service...');
    this.running = false;

    this.cryptoConnector.disconnect();
    this.alpacaConnector.disconnect();
    this.polymarketConnector.disconnect();

    await this.clickhouseWriter.flush();
    await this.clickhouseWriter.close();
    await this.redisPublisher.close();

    console.log('[Ingest] Stopped.');
  }
}

// --- Main ---

const service = new IngestService();

service.start().catch((err) => {
  console.error('[Ingest] Fatal error:', err);
  process.exit(1);
});

function shutdown(signal: string): void {
  console.log(`\n[Ingest] Received ${signal}. Shutting down...`);
  service.stop().then(() => process.exit(0)).catch(() => process.exit(1));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { IngestService };
export type { NormalizedTick };
