-- ClickHouse migration: OHLCV candle tables with materialized views
-- Auto-aggregate from market_trades into 1-minute, 1-hour, and 1-day candles

-- ==========================================================================
-- 1-minute candles
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ohlcv_1m
(
    instrument     LowCardinality(String),
    market         LowCardinality(String),
    bucket         DateTime('UTC'),
    open           AggregateFunction(argMin, Float64, DateTime64(6, 'UTC')),
    high           AggregateFunction(max, Float64),
    low            AggregateFunction(min, Float64),
    close          AggregateFunction(argMax, Float64, DateTime64(6, 'UTC')),
    volume         AggregateFunction(sum, Float64),
    trade_count    AggregateFunction(count, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY (market, toYYYYMM(bucket))
ORDER BY (instrument, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1m_mv
TO ohlcv_1m
AS
SELECT
    instrument,
    market,
    toStartOfMinute(trade_time) AS bucket,
    argMinState(price, trade_time) AS open,
    maxState(price) AS high,
    minState(price) AS low,
    argMaxState(price, trade_time) AS close,
    sumState(quantity) AS volume,
    countState(toUInt64(1)) AS trade_count
FROM market_trades
GROUP BY instrument, market, bucket;

-- ==========================================================================
-- 1-hour candles
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ohlcv_1h
(
    instrument     LowCardinality(String),
    market         LowCardinality(String),
    bucket         DateTime('UTC'),
    open           AggregateFunction(argMin, Float64, DateTime64(6, 'UTC')),
    high           AggregateFunction(max, Float64),
    low            AggregateFunction(min, Float64),
    close          AggregateFunction(argMax, Float64, DateTime64(6, 'UTC')),
    volume         AggregateFunction(sum, Float64),
    trade_count    AggregateFunction(count, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY (market, toYYYYMM(bucket))
ORDER BY (instrument, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1h_mv
TO ohlcv_1h
AS
SELECT
    instrument,
    market,
    toStartOfHour(trade_time) AS bucket,
    argMinState(price, trade_time) AS open,
    maxState(price) AS high,
    minState(price) AS low,
    argMaxState(price, trade_time) AS close,
    sumState(quantity) AS volume,
    countState(toUInt64(1)) AS trade_count
FROM market_trades
GROUP BY instrument, market, bucket;

-- ==========================================================================
-- 1-day candles
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ohlcv_1d
(
    instrument     LowCardinality(String),
    market         LowCardinality(String),
    bucket         Date,
    open           AggregateFunction(argMin, Float64, DateTime64(6, 'UTC')),
    high           AggregateFunction(max, Float64),
    low            AggregateFunction(min, Float64),
    close          AggregateFunction(argMax, Float64, DateTime64(6, 'UTC')),
    volume         AggregateFunction(sum, Float64),
    trade_count    AggregateFunction(count, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY (market, toYear(bucket))
ORDER BY (instrument, bucket);

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1d_mv
TO ohlcv_1d
AS
SELECT
    instrument,
    market,
    toDate(trade_time) AS bucket,
    argMinState(price, trade_time) AS open,
    maxState(price) AS high,
    minState(price) AS low,
    argMaxState(price, trade_time) AS close,
    sumState(quantity) AS volume,
    countState(toUInt64(1)) AS trade_count
FROM market_trades
GROUP BY instrument, market, bucket;
