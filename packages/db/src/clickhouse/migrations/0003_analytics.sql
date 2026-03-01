-- ClickHouse migration: analytics tables
-- system_trades, equity_curve, sentiment_scores, orderbook_snapshots

-- ==========================================================================
-- System trades: mirrors orders from Postgres for fast analytics
-- ==========================================================================

CREATE TABLE IF NOT EXISTS system_trades
(
    trade_id          UUID,
    portfolio_id      UUID,
    strategy_id       Nullable(UUID),
    agent_id          LowCardinality(String),
    instrument        LowCardinality(String),
    market            LowCardinality(String),
    side              Enum8('buy' = 1, 'sell' = 2),
    order_type        LowCardinality(String),
    quantity          Float64,
    fill_price        Float64,
    fees              Float64 DEFAULT 0,
    slippage          Float64 DEFAULT 0,
    pnl               Float64 DEFAULT 0,
    filled_at         DateTime64(3, 'UTC'),
    metadata          String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY (market, toYYYYMM(filled_at))
ORDER BY (portfolio_id, filled_at)
TTL toDateTime(filled_at) + INTERVAL 5 YEAR
SETTINGS index_granularity = 8192;

-- ==========================================================================
-- Equity curve: periodic snapshots of portfolio equity
-- ==========================================================================

CREATE TABLE IF NOT EXISTS equity_curve
(
    portfolio_id      UUID,
    timestamp         DateTime64(3, 'UTC'),
    total_equity      Float64,
    cash_balance      Float64,
    positions_value   Float64,
    daily_pnl         Float64 DEFAULT 0,
    cumulative_pnl    Float64 DEFAULT 0,
    drawdown          Float64 DEFAULT 0,
    high_watermark    Float64
)
ENGINE = MergeTree()
PARTITION BY (portfolio_id, toYYYYMM(timestamp))
ORDER BY (portfolio_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 5 YEAR
SETTINGS index_granularity = 8192;

-- ==========================================================================
-- Sentiment scores: AI-generated or aggregated sentiment signals
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sentiment_scores
(
    instrument        LowCardinality(String),
    source            LowCardinality(String),
    timestamp         DateTime64(3, 'UTC'),
    score             Float32,
    magnitude         Float32 DEFAULT 0,
    label             LowCardinality(String) DEFAULT 'neutral',
    summary           String DEFAULT '',
    metadata          String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY (instrument, toYYYYMM(timestamp))
ORDER BY (instrument, timestamp)
TTL toDateTime(timestamp) + INTERVAL 1 YEAR
SETTINGS index_granularity = 8192;

-- ==========================================================================
-- Order book snapshots: periodic depth-of-book captures
-- ==========================================================================

CREATE TABLE IF NOT EXISTS orderbook_snapshots
(
    exchange          LowCardinality(String),
    instrument        LowCardinality(String),
    market            LowCardinality(String),
    timestamp         DateTime64(6, 'UTC'),
    mid_price         Float64,
    spread            Float64,
    bid_depth_10      Float64,
    ask_depth_10      Float64,
    bids              String,
    asks              String,
    imbalance         Float32 DEFAULT 0
)
ENGINE = MergeTree()
PARTITION BY (market, toYYYYMM(timestamp))
ORDER BY (instrument, timestamp)
TTL toDateTime(timestamp) + INTERVAL 6 MONTH
SETTINGS index_granularity = 8192;
