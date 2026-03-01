-- ClickHouse schema for TradeWorks market data analytics
-- Executed automatically on first container start via docker-entrypoint-initdb.d

CREATE DATABASE IF NOT EXISTS tradeworks;

-- ─── Raw market trades ──────────────────────────────────────────────
-- Partitioned by instrument and month for efficient time-range queries.
-- OrderingKey on (instrument, timestamp) enables fast lookups per symbol.

CREATE TABLE IF NOT EXISTS tradeworks.market_trades
(
    instrument    LowCardinality(String)   COMMENT 'Trading pair, e.g. BTC_USDT',
    trade_id      String                   COMMENT 'Exchange-assigned trade ID',
    timestamp     DateTime64(3, 'UTC')     COMMENT 'Trade execution time (ms precision)',
    price         Float64                  COMMENT 'Trade price',
    quantity      Float64                  COMMENT 'Trade quantity / volume',
    side          LowCardinality(String)   COMMENT 'buy or sell',
    exchange      LowCardinality(String)   COMMENT 'Source exchange name',
    received_at   DateTime64(3, 'UTC')     DEFAULT now64(3) COMMENT 'When the ingest service received this trade'
)
ENGINE = MergeTree()
PARTITION BY (instrument, toYYYYMM(timestamp))
ORDER BY (instrument, timestamp, trade_id)
TTL toDateTime(timestamp) + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;


-- ─── OHLCV 1-minute materialized view ──────────────────────────────
-- Aggregates raw trades into 1-minute candles in real time.

CREATE TABLE IF NOT EXISTS tradeworks.ohlcv_1m
(
    instrument    LowCardinality(String),
    bucket        DateTime('UTC')          COMMENT 'Candle open time (1-min aligned)',
    open          AggregateFunction(argMin, Float64, DateTime64(3, 'UTC')),
    high          AggregateFunction(max, Float64),
    low           AggregateFunction(min, Float64),
    close         AggregateFunction(argMax, Float64, DateTime64(3, 'UTC')),
    volume        AggregateFunction(sum, Float64),
    trade_count   AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
PARTITION BY (instrument, toYYYYMM(bucket))
ORDER BY (instrument, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS tradeworks.ohlcv_1m_mv
TO tradeworks.ohlcv_1m
AS
SELECT
    instrument,
    toStartOfMinute(timestamp) AS bucket,
    argMinState(price, timestamp)  AS open,
    maxState(price)                AS high,
    minState(price)                AS low,
    argMaxState(price, timestamp)  AS close,
    sumState(quantity)             AS volume,
    countState()                   AS trade_count
FROM tradeworks.market_trades
GROUP BY instrument, bucket;


-- ─── OHLCV 1-hour materialized view ────────────────────────────────
-- Rolls up 1-minute candles into 1-hour candles.

CREATE TABLE IF NOT EXISTS tradeworks.ohlcv_1h
(
    instrument    LowCardinality(String),
    bucket        DateTime('UTC')          COMMENT 'Candle open time (1-hour aligned)',
    open          AggregateFunction(argMin, Float64, DateTime('UTC')),
    high          AggregateFunction(max, Float64),
    low           AggregateFunction(min, Float64),
    close         AggregateFunction(argMax, Float64, DateTime('UTC')),
    volume        AggregateFunction(sum, Float64),
    trade_count   AggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY (instrument, toYYYYMM(bucket))
ORDER BY (instrument, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS tradeworks.ohlcv_1h_mv
TO tradeworks.ohlcv_1h
AS
SELECT
    instrument,
    toStartOfHour(bucket) AS bucket,
    argMinState(argMinMerge(open), bucket)  AS open,
    maxState(maxMerge(high))                AS high,
    minState(minMerge(low))                 AS low,
    argMaxState(argMaxMerge(close), bucket) AS close,
    sumState(sumMerge(volume))              AS volume,
    sumState(countMerge(trade_count))       AS trade_count
FROM tradeworks.ohlcv_1m
GROUP BY instrument, bucket;


-- ─── OHLCV 1-day materialized view ─────────────────────────────────
-- Rolls up 1-hour candles into daily candles.

CREATE TABLE IF NOT EXISTS tradeworks.ohlcv_1d
(
    instrument    LowCardinality(String),
    bucket        Date                     COMMENT 'Candle date (UTC)',
    open          AggregateFunction(argMin, Float64, DateTime('UTC')),
    high          AggregateFunction(max, Float64),
    low           AggregateFunction(min, Float64),
    close         AggregateFunction(argMax, Float64, DateTime('UTC')),
    volume        AggregateFunction(sum, Float64),
    trade_count   AggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY (instrument, toYear(bucket))
ORDER BY (instrument, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS tradeworks.ohlcv_1d_mv
TO tradeworks.ohlcv_1d
AS
SELECT
    instrument,
    toDate(bucket) AS bucket,
    argMinState(argMinMerge(open), bucket)  AS open,
    maxState(maxMerge(high))                AS high,
    minState(minMerge(low))                 AS low,
    argMaxState(argMaxMerge(close), bucket) AS close,
    sumState(sumMerge(volume))              AS volume,
    sumState(countMerge(trade_count))       AS trade_count
FROM tradeworks.ohlcv_1h
GROUP BY instrument, bucket;
