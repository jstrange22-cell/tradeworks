-- ClickHouse migration: market_trades
-- Raw trade-level market data ingested from exchanges

CREATE TABLE IF NOT EXISTS market_trades
(
    exchange       LowCardinality(String),
    instrument     LowCardinality(String),
    market         LowCardinality(String),
    trade_time     DateTime64(6, 'UTC'),
    price          Float64,
    quantity       Float64,
    side           Enum8('buy' = 1, 'sell' = 2, 'unknown' = 0),
    trade_id       String,
    metadata       String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY (market, toYYYYMM(trade_time))
ORDER BY (instrument, trade_time)
TTL toDateTime(trade_time) + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;
