import { getClickHouseClient } from '../client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Candle {
  instrument: string;
  bucket: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trade_count: number;
}

export interface LatestPrice {
  instrument: string;
  price: number;
  trade_time: string;
}

export interface OrderBookSnapshot {
  exchange: string;
  instrument: string;
  timestamp: string;
  mid_price: number;
  spread: number;
  bid_depth_10: number;
  ask_depth_10: number;
  bids: string;
  asks: string;
  imbalance: number;
}

// ---------------------------------------------------------------------------
// Timeframe mapping
// ---------------------------------------------------------------------------

type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

function getTableForTimeframe(tf: Timeframe): string {
  switch (tf) {
    case '1m':
    case '5m':
    case '15m':
      return 'ohlcv_1m';
    case '1h':
    case '4h':
      return 'ohlcv_1h';
    case '1d':
      return 'ohlcv_1d';
  }
}

function getGroupInterval(tf: Timeframe): string | null {
  switch (tf) {
    case '1m':
    case '1h':
    case '1d':
      return null; // no further grouping needed
    case '5m':
      return 'toStartOfFiveMinutes(bucket)';
    case '15m':
      return 'toStartOfFifteenMinutes(bucket)';
    case '4h':
      return 'toStartOfInterval(bucket, INTERVAL 4 HOUR)';
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch OHLCV candles for an instrument.
 */
export async function getCandles(
  instrument: string,
  timeframe: Timeframe,
  limit = 500,
): Promise<Candle[]> {
  const client = getClickHouseClient();
  const table = getTableForTimeframe(timeframe);
  const groupBy = getGroupInterval(timeframe);

  let query: string;

  if (groupBy === null) {
    // Direct read from the matching aggregate table
    query = `
      SELECT
        instrument,
        toString(bucket) AS bucket,
        argMinMerge(open)    AS open,
        maxMerge(high)       AS high,
        minMerge(low)        AS low,
        argMaxMerge(close)   AS close,
        sumMerge(volume)     AS volume,
        countMerge(trade_count) AS trade_count
      FROM ${table}
      WHERE instrument = {instrument: String}
      GROUP BY instrument, bucket
      ORDER BY bucket DESC
      LIMIT {limit: UInt32}
    `;
  } else {
    // Re-aggregate into a larger bucket
    query = `
      SELECT
        instrument,
        toString(${groupBy}) AS bucket,
        argMinMerge(open)    AS open,
        maxMerge(high)       AS high,
        minMerge(low)        AS low,
        argMaxMerge(close)   AS close,
        sumMerge(volume)     AS volume,
        countMerge(trade_count) AS trade_count
      FROM ${table}
      WHERE instrument = {instrument: String}
      GROUP BY instrument, bucket
      ORDER BY bucket DESC
      LIMIT {limit: UInt32}
    `;
  }

  const result = await client.query({
    query,
    query_params: { instrument, limit },
    format: 'JSONEachRow',
  });

  return result.json<Candle>();
}

/**
 * Get the latest trade price for an instrument.
 */
export async function getLatestPrice(
  instrument: string,
): Promise<LatestPrice | null> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        instrument,
        price,
        toString(trade_time) AS trade_time
      FROM market_trades
      WHERE instrument = {instrument: String}
      ORDER BY trade_time DESC
      LIMIT 1
    `,
    query_params: { instrument },
    format: 'JSONEachRow',
  });

  const rows = await result.json<LatestPrice>();
  return rows.length > 0 ? rows[0]! : null;
}

/**
 * Get the most recent order book snapshot for an instrument.
 */
export async function getOrderBookSnapshot(
  instrument: string,
  exchange?: string,
): Promise<OrderBookSnapshot | null> {
  const client = getClickHouseClient();

  const exchangeFilter = exchange
    ? 'AND exchange = {exchange: String}'
    : '';

  const result = await client.query({
    query: `
      SELECT
        exchange,
        instrument,
        toString(timestamp) AS timestamp,
        mid_price,
        spread,
        bid_depth_10,
        ask_depth_10,
        bids,
        asks,
        imbalance
      FROM orderbook_snapshots
      WHERE instrument = {instrument: String}
      ${exchangeFilter}
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    query_params: { instrument, ...(exchange ? { exchange } : {}) },
    format: 'JSONEachRow',
  });

  const rows = await result.json<OrderBookSnapshot>();
  return rows.length > 0 ? rows[0]! : null;
}
