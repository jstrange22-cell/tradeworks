/**
 * Seed historical market data for backtest regression testing.
 * Generates synthetic OHLCV candles for BTC-USD, ETH-USD, SPY.
 */

import { getClickHouseClient } from '@tradeworks/db';

const INSTRUMENTS = ['BTC-USD', 'ETH-USD', 'SPY'];
const DAYS = 365;
const CANDLES_PER_DAY = 24; // 1h candles

interface SyntheticCandle {
  instrument: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function generateCandles(instrument: string, basePrice: number): SyntheticCandle[] {
  const candles: SyntheticCandle[] = [];
  let price = basePrice;
  const now = Date.now();
  const startMs = now - DAYS * 24 * 60 * 60 * 1000;

  for (let day = 0; day < DAYS; day++) {
    for (let hour = 0; hour < CANDLES_PER_DAY; hour++) {
      const ts = new Date(startMs + (day * 24 + hour) * 3600_000);
      const change = (Math.random() - 0.498) * basePrice * 0.02;
      const open = price;
      price = Math.max(basePrice * 0.1, price + change);
      const close = price;
      const high = Math.max(open, close) * (1 + Math.random() * 0.005);
      const low = Math.min(open, close) * (1 - Math.random() * 0.005);
      const volume = Math.floor(Math.random() * 1000 + 100) * basePrice;

      candles.push({
        instrument,
        timestamp: ts.toISOString().replace('T', ' ').replace('Z', ''),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: parseFloat(volume.toFixed(2)),
      });
    }
  }
  return candles;
}

async function main(): Promise<void> {
  const ch = getClickHouseClient();

  // Create candles table if not exists
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS candles (
        instrument String,
        timestamp DateTime64(3, 'UTC'),
        open Float64,
        high Float64,
        low Float64,
        close Float64,
        volume Float64
      ) ENGINE = MergeTree()
      ORDER BY (instrument, timestamp)
    `,
  });

  const basePrices: Record<string, number> = {
    'BTC-USD': 65000,
    'ETH-USD': 3400,
    'SPY': 520,
  };

  for (const instrument of INSTRUMENTS) {
    const candles = generateCandles(instrument, basePrices[instrument]!);
    const rows = candles.map((c) =>
      `('${c.instrument}', '${c.timestamp}', ${c.open}, ${c.high}, ${c.low}, ${c.close}, ${c.volume})`,
    );

    // Insert in batches of 1000
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      await ch.command({
        query: `INSERT INTO candles (instrument, timestamp, open, high, low, close, volume) VALUES ${batch.join(',')}`,
      });
    }

    console.log(`Seeded ${candles.length} candles for ${instrument}`);
  }

  console.log('Backtest data seeding complete.');
  await ch.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
