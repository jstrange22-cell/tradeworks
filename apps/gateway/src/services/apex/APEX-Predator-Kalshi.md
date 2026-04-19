# APEX PREDATOR — Kalshi Trading Bot System
## Claude Code Build Prompts for TradeWorks
### Strange Digital Group | April 2026

---

# TABLE OF CONTENTS

1. [Project Bootstrap & Monorepo Setup](#prompt-0)
2. [ENGINE 1: Cross-Platform Latency Arbitrage (Rust)](#prompt-1)
3. [ENGINE 2: BTC/ETH/SOL 15-Min Microstructure Sniper](#prompt-2)
4. [ENGINE 3: Multi-Model AI Ensemble (Sports/Events)](#prompt-3)
5. [ENGINE 4: Weather Market Specialist](#prompt-4)
6. [ENGINE 5: New Market Listing Sniper](#prompt-5)
7. [UNIFIED RISK LAYER](#prompt-6)
8. [REAL-TIME DASHBOARD](#prompt-7)
9. [TELEGRAM BOT / ALERTS](#prompt-8)
10. [DEPLOYMENT & INFRASTRUCTURE](#prompt-9)

---

<a name="prompt-0"></a>
## PROMPT 0 — PROJECT BOOTSTRAP & MONOREPO SETUP

```
You are APEX, an elite trading systems architect. Initialize the TradeWorks Kalshi 
prediction market trading bot as a monorepo. This system has 5 concurrent profit 
engines feeding into a unified risk layer.

### MONOREPO STRUCTURE

Create the following directory structure:

tradeworks-kalshi/
├── rust-core/                    # Rust workspace for speed-critical paths
│   ├── Cargo.toml               # Workspace manifest
│   ├── arb-engine/              # ENGINE 1: Cross-platform arbitrage
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── kalshi_ws.rs     # Kalshi WebSocket client
│   │       ├── polymarket_ws.rs # Polymarket CLOB WebSocket
│   │       ├── arb_detector.rs  # Arbitrage opportunity detection
│   │       ├── executor.rs      # Trade execution with dedup
│   │       ├── position.rs      # Position tracking
│   │       └── circuit_breaker.rs
│   └── shared/                  # Shared Rust types/utils
│       ├── Cargo.toml
│       └── src/lib.rs
├── python-engines/              # Python for AI/ML strategy layers
│   ├── pyproject.toml           # uv project config
│   ├── engine_btc_sniper/       # ENGINE 2: BTC microstructure
│   │   ├── __init__.py
│   │   ├── sniper.py
│   │   ├── signals.py           # RSI, VWAP, momentum
│   │   ├── exchange_feeds.py    # Coinbase/Binance/Kraken
│   │   └── kalshi_trader.py
│   ├── engine_ai_ensemble/      # ENGINE 3: Multi-model sports/events
│   │   ├── __init__.py
│   │   ├── ensemble.py          # 5-model orchestration
│   │   ├── category_scorer.py   # Category edge tracking
│   │   ├── data_feeds.py        # News, Twitter, Sportradar
│   │   └── kalshi_trader.py
│   ├── engine_weather/          # ENGINE 4: Weather specialist
│   │   ├── __init__.py
│   │   ├── weather_bot.py
│   │   ├── gfs_ensemble.py      # Open-Meteo 31-member GFS
│   │   ├── city_config.py
│   │   └── kalshi_trader.py
│   ├── engine_sniper/           # ENGINE 5: New listing sniper
│   │   ├── __init__.py
│   │   ├── listing_monitor.py
│   │   ├── rapid_scorer.py
│   │   └── kalshi_trader.py
│   ├── risk_layer/              # UNIFIED RISK MANAGEMENT
│   │   ├── __init__.py
│   │   ├── risk_manager.py      # Central risk orchestrator
│   │   ├── kelly.py             # Fractional Kelly sizing
│   │   ├── circuit_breaker.py   # Portfolio-level kills
│   │   ├── allocation.py        # Engine capital allocation
│   │   └── audit_log.py         # Full trade forensics
│   ├── shared/                  # Shared Python utilities
│   │   ├── __init__.py
│   │   ├── kalshi_client.py     # Unified Kalshi REST/WS client
│   │   ├── polymarket_client.py # Polymarket CLOB client  
│   │   ├── config.py            # Central config management
│   │   ├── models.py            # Pydantic data models
│   │   └── db.py                # SQLite trade database
│   └── tests/
├── dashboard/                   # React real-time dashboard
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── hooks/
│   └── tailwind.config.js
├── telegram-bot/                # Telegram alerts & control
│   ├── package.json
│   └── src/
│       ├── bot.ts
│       ├── handlers/
│       └── formatters/
├── config/
│   ├── .env.example
│   ├── settings.toml            # All tunable parameters
│   └── categories.toml          # Category scoring config
├── data/
│   ├── trades.db                # SQLite master DB
│   └── backtest/
├── scripts/
│   ├── start_all.sh             # Launch all engines
│   ├── stop_all.sh              # Graceful shutdown
│   └── paper_trade.sh           # Paper trading mode
├── .claude/
│   └── commands/
│       ├── debug-full.md        # APEX Debugger (existing)
│       ├── engine-status.md     # Check all engine health
│       └── deploy.md            # Deployment checklist
├── docker-compose.yml
├── Dockerfile.rust
├── Dockerfile.python
└── README.md

### CONFIGURATION

Create config/settings.toml with ALL tunable parameters:

[general]
mode = "paper"  # "paper" | "live"  
base_currency = "USD"
starting_capital = 50000
log_level = "INFO"

[kalshi]
api_key_id = ""
private_key_path = "./kalshi_private_key.pem"
use_demo = true
api_base = "https://demo-api.kalshi.co/trade-api/v2"
ws_url = "wss://demo-api.kalshi.co/trade-api/ws/v2"

[polymarket]
private_key = ""
funder_address = ""
clob_url = "https://clob.polymarket.com"
gamma_url = "https://gamma-api.polymarket.com"

[risk]
max_daily_drawdown_pct = 10.0
max_total_drawdown_pct = 15.0
max_sector_concentration_pct = 30.0
kelly_fraction = 0.25
min_confidence = 0.45

[allocation]
arb_engine_pct = 40
btc_sniper_pct = 25
ai_ensemble_pct = 20
weather_pct = 10
listing_sniper_pct = 5

[ai]
openrouter_api_key = ""
daily_ai_budget_usd = 15.0
models = [
    { name = "claude-sonnet-4-20250514", role = "lead_analyst", weight = 0.30 },
    { name = "google/gemini-2.5-pro", role = "forecaster", weight = 0.30 },
    { name = "openai/gpt-4.1", role = "risk_manager", weight = 0.20 },
    { name = "deepseek/deepseek-r1", role = "bull_case", weight = 0.10 },
    { name = "x-ai/grok-3", role = "bear_case", weight = 0.10 }
]

[exchanges]
coinbase_ws = "wss://ws-feed.exchange.coinbase.com"
binance_ws = "wss://stream.binance.com:9443/ws"
kraken_ws = "wss://ws.kraken.com"

[telegram]
bot_token = ""
chat_id = ""
alert_on_trade = true
daily_summary = true
daily_summary_hour = 21

[categories]
# Score 0-100. Below 30 = hard blocked.
[categories.scores]
NCAAB = 72
NBA = 41
NFL = 55
MLB = 38
POLITICS = 31
CPI = 8
FED = 12
ECON_MACRO = 10
WEATHER = 65
CRYPTO_15M = 70

Create config/.env.example with all secrets placeholders.

Create shared Python models (python-engines/shared/models.py) using Pydantic v2:

- TradeSignal: engine_id, market_id, venue (kalshi|polymarket), side (yes|no), 
  confidence, edge_pct, suggested_size, reasoning, timestamp
- TradeExecution: signal ref, fill_price, quantity, fees, status, execution_ms
- PortfolioState: cash, positions[], daily_pnl, total_pnl, drawdown_pct
- MarketSnapshot: ticker, venue, yes_price, no_price, volume, spread, last_trade
- RiskCheck: engine_id, check_type, passed (bool), reason, timestamp
- CategoryScore: category, score, win_rate, roi, total_trades, status (GOOD|WEAK|BLOCKED)

Create the SQLite schema (shared/db.py) with tables:
- trades (full audit trail with microsecond timestamps)
- signals (every signal generated, whether acted on or not)
- risk_checks (every risk evaluation)
- daily_summary (daily P&L rollup per engine)
- category_performance (rolling stats per category)

Initialize all package files with proper dependencies. For Python use uv.
For Rust, use tokio, reqwest, serde, tokio-tungstenite.

Run `uv sync` and `cargo check` to validate the skeleton compiles.
```

---

<a name="prompt-1"></a>
## PROMPT 1 — ENGINE 1: Cross-Platform Latency Arbitrage (Rust)

```
You are APEX, building the highest-priority engine: the cross-platform arbitrage 
detector and executor in Rust. This is the lowest-risk, highest-frequency profit 
engine. It captures structural pricing inefficiencies between Kalshi and Polymarket.

### CONTEXT
- Arbitrage traders extracted $40M+ from prediction markets in one year
- 14/20 most profitable Polymarket wallets are bots  
- The edge is SPEED, not prediction accuracy
- YES + NO < $1.00 = guaranteed profit regardless of outcome

### BUILD: rust-core/arb-engine/

#### 1. Kalshi WebSocket Client (kalshi_ws.rs)

Implement a real-time Kalshi WebSocket client:
- RSA-PSS authentication per Kalshi API docs
- Subscribe to orderbook channels for ALL active markets
- Parse the Kalshi orderbook format: they only return bids (not asks) because 
  of the reciprocal YES/NO relationship
- Maintain local L2 orderbook with best bid/ask for each market
- Handle reconnection with exponential backoff
- Log latency for every message received

Key Kalshi specifics:
- API base: trading-api.kalshi.com (prod) or demo-api.kalshi.co (demo)
- Auth: RSA signature-based (not basic auth)
- Fee formula: ceil(0.07 × contracts × price × (1 - price))
- Rate limits: tiered based on account type
- Market tickers follow patterns: KXBTC15M, KXHIGHNY, etc.

#### 2. Polymarket WebSocket Client (polymarket_ws.rs)

Implement real-time Polymarket CLOB feed:
- Connect to Polymarket's Central Limit Order Book WebSocket
- Use Gamma API (gamma-api.polymarket.com) for market discovery
- Normalize prices to 0.00-1.00 probability format
- Track condition_id → market mapping
- Polymarket uses USDC on Polygon, so account for blockchain settlement time

#### 3. Market Matching (discovery.rs)

Build the cross-platform market matcher:
- Poll both venues for active markets
- Use fuzzy string matching + event metadata to pair same-event markets
- Handle naming differences: "Will BTC close above $100K?" vs 
  "Bitcoin price above 100000"
- Cache mappings with TTL, force rediscovery on FORCE_DISCOVERY=1
- Support sport-specific matching with team code lookups
- Store match confidence score, only trade on high-confidence matches

#### 4. Arbitrage Detection (arb_detector.rs)

Implement three arbitrage modes:

MODE A: Cross-Platform (Kalshi ↔ Polymarket)
- For each matched market pair, calculate:
  kalshi_yes_ask + poly_no_ask < 1.00 → BUY kalshi_yes + BUY poly_no
  kalshi_no_ask + poly_yes_ask < 1.00 → BUY kalshi_no + BUY poly_yes
- MUST factor in Kalshi fees: ceil(0.07 × contracts × price × (1-price))
- Polymarket: most markets fee-free, some categories have taker fees
- Minimum profit threshold: configurable (default 1.5 cents per contract)
- Must check actual orderbook DEPTH, not just top-of-book

MODE B: Same-Platform Kalshi
- Within Kalshi, check if YES_ask + NO_ask < 1.00
- This happens during high volatility when market makers pull quotes

MODE C: Same-Platform Polymarket  
- Within Polymarket CLOB, same check
- More common in illiquid/new markets

For each opportunity:
- Calculate net profit after ALL fees on both legs
- Estimate fill probability based on orderbook depth
- Score by: profit_per_contract × estimated_fillable_quantity
- Rank all opportunities, execute best first

#### 5. Trade Executor (executor.rs)

Build concurrent dual-leg execution:
- Execute BOTH legs simultaneously (not sequentially!)
- Use limit orders at specified prices, not market orders
- Implement in-flight deduplication (never double-execute same opportunity)
- Track partial fills — if one leg fills and other doesn't, manage the risk
- Circuit breaker: if execution latency > 500ms, abort
- Log every order attempt with microsecond timestamps

Kalshi order placement:
- POST to /trade-api/v2/portfolio/orders
- RSA-signed request headers
- Order types: limit, market
- Side: yes, no
- action: buy, sell

Polymarket order placement:
- EIP-712 signing for L1, HMAC for L2 trading
- Submit to CLOB API
- Handle Polygon blockchain confirmation times

#### 6. Position Tracker (position.rs)

- Track all open positions across both venues
- Calculate real-time P&L including unrealized
- Monitor settlement — when events resolve, record final P&L
- Implement ROTATION strategy: don't hold to maturity if spread closes
  before resolution. Exit early to free capital for next opportunity.

#### 7. Circuit Breaker (circuit_breaker.rs)

- Max daily loss: configurable (default $500 from arb engine allocation)
- Max concurrent positions: 20
- Stale data protection: refuse to trade if last WS message > 5 seconds old
- Error rate tracking: if > 3 failed executions in 5 minutes, pause 60 seconds
- Kill switch: check for STOP file every loop iteration

#### 8. Main Orchestration (main.rs)

Wire it all together:
- Start both WS feeds in parallel tokio tasks
- Run discovery matching on startup + every 5 minutes
- Arb detection loop: check all matched markets every 100ms
- When opportunity found: validate → risk check → execute → track
- Expose a simple HTTP health endpoint on port 8081
- Graceful shutdown on SIGTERM

### PERFORMANCE TARGETS
- Market data processing: < 1ms per message
- Opportunity detection: < 5ms from price update to signal
- Order submission: < 50ms from signal to API call
- Full round-trip: < 100ms detection-to-execution

### TESTING
- Unit tests for arb_detector with mock orderbooks
- Integration test against Kalshi demo API
- Paper trading mode that logs would-be trades without executing
- Backtest harness using historical orderbook snapshots

Build this engine. Make it compile. Make it fast.
```

---

<a name="prompt-2"></a>
## PROMPT 2 — ENGINE 2: BTC/ETH/SOL 15-Minute Microstructure Sniper

```
You are APEX, building Engine 2: the crypto microstructure sniper for Kalshi's 
KXBTC15M/KXETH15M/KXSOL15M series and equivalent Polymarket markets.

### THE EDGE
Crypto exchange data (Coinbase, Binance, Kraken) updates in real-time with 
sub-second granularity. Kalshi/Polymarket 15-minute crypto prediction markets 
reprice slower. When momentum signals strongly suggest BTC will be up/down in 
the next 15 minutes, we buy the mispriced contract before the market catches up.

One documented bot turned $200 → $964 in a single day using this exact strategy.

### BUILD: python-engines/engine_btc_sniper/

#### 1. Exchange Feed Aggregator (exchange_feeds.py)

Connect to three exchanges simultaneously via WebSocket:

COINBASE (wss://ws-feed.exchange.coinbase.com):
- Subscribe to "ticker" channel for BTC-USD, ETH-USD, SOL-USD
- Parse: price, volume_24h, best_bid, best_ask

BINANCE (wss://stream.binance.com:9443/ws):  
- Subscribe to streams: btcusdt@kline_1m, ethusdt@kline_1m, solusdt@kline_1m
- Parse 1-minute candles: open, high, low, close, volume

KRAKEN (wss://ws.kraken.com):
- Subscribe to ticker for XBT/USD, ETH/USD, SOL/USD
- Parse: last price, volume, VWAP

Aggregate into unified candle data structure:
- 1-minute candles with OHLCV from all three sources
- Weighted average price using volume from each exchange
- Real-time spread between exchanges (another signal)

#### 2. Signal Generator (signals.py)

Compute these signals in real-time, updating every second:

RSI (14-period on 1-minute candles):
- Standard RSI calculation
- RSI > 70 = bearish signal, RSI < 30 = bullish signal
- Weight: 0.20

MOMENTUM (multi-timeframe):
- 1-minute momentum: price_now / price_1m_ago - 1
- 5-minute momentum: price_now / price_5m_ago - 1  
- 15-minute momentum: price_now / price_15m_ago - 1
- Direction = sign of weighted sum (1m: 0.5, 5m: 0.3, 15m: 0.2)
- Weight: 0.25

VWAP DEVIATION:
- Calculate rolling VWAP for the current 15-minute window
- Deviation = (current_price - VWAP) / VWAP
- |deviation| > 0.002 = strong signal
- Weight: 0.20

SMA CROSSOVER:
- Fast SMA: 5-period on 1-min candles
- Slow SMA: 20-period on 1-min candles  
- Signal = fast > slow ? bullish : bearish
- Weight: 0.15

MARKET SKEW (cross-exchange):
- Compare Coinbase price vs Binance price
- Persistent positive skew = US buying pressure = bullish
- Weight: 0.10

ORDER FLOW IMBALANCE:
- Track bid vs ask volume from ticker feeds
- Ratio > 1.5 = strong buy pressure
- Weight: 0.10

COMPOSITE SIGNAL:
- Weighted sum of all signals normalized to [-1.0, +1.0]
- positive = BTC going UP, negative = BTC going DOWN
- |composite| > threshold = trade signal

#### 3. Market Scanner (sniper.py)

Poll for active 15-minute crypto markets:

KALSHI:
- Fetch events with ticker prefix KXBTC15M, KXETH15M, KXSOL15M
- Identify the CURRENT active market (closest expiry that hasn't closed)
- Get orderbook: best YES ask, best NO ask, depth
- Calculate time remaining in current window

POLYMARKET:
- Use Gamma API with tag_slug="crypto"
- Filter for BTC/ETH/SOL 15-minute Up/Down markets
- Get CLOB orderbook

TRADE LOGIC:
- Every 60 seconds (configurable), evaluate:
  1. Generate composite signal for each coin
  2. Get current market prices on both Kalshi and Polymarket
  3. Calculate EDGE = |model_probability - market_price|
  4. If edge > 2% AND composite confidence > threshold:
     - Determine which venue has better pricing
     - Generate TradeSignal → send to risk layer
  5. If edge > 5% on BOTH venues with opposite mispricing:
     - This is a cross-venue arb on crypto — flag for Engine 1

POSITION SIZING (Kelly Criterion):
kelly = (win_prob * payout_odds - lose_prob) / payout_odds
position_size = kelly * 0.15 * engine_bankroll  # 15% Kelly fraction
position_size = min(position_size, bankroll * 0.05)  # 5% max per trade
position_size = min(position_size, 75.00)  # Hard cap $75 per BTC trade

#### 4. Kalshi Trader (kalshi_trader.py)

Execute trades via Kalshi REST API:
- RSA-PSS authentication
- Place limit orders (never market orders for better fill)
- Track order status via polling or WebSocket
- Handle partial fills
- Implement cooldown: don't re-enter same market window within 3 minutes 
  of a losing trade

#### 5. Signal Calibration

Track prediction accuracy over time:
- For every signal generated, record predicted direction and actual outcome
- Calculate Brier score: mean((predicted_prob - actual_outcome)^2)
- If Brier score > 0.30 for any signal component over rolling 50 trades,
  reduce that signal's weight by 50%
- Auto-recalibrate weights weekly

#### 6. Paper Trading Mode

Full simulation without real orders:
- Virtual bankroll tracking
- Simulated fills at current ask prices + 1 cent slippage
- Equity curve tracking
- CSV export for analysis

### OPERATIONAL FLOW

Every 60 seconds:
1. Aggregate latest candle data from 3 exchanges
2. Compute all 6 signal components
3. Generate composite signal per coin (BTC, ETH, SOL)
4. Scan active Kalshi + Polymarket 15-min markets
5. Calculate edge per market
6. If edge threshold met → TradeSignal to risk layer
7. If risk approved → execute via kalshi_trader
8. Log everything to SQLite

### TESTING
- Backtest on 30 days of historical 1-min candles
- Paper trade for minimum 1 week before going live
- Assert all signals produce values in expected ranges
- Load test: can we process 3 coins × 3 exchanges × 1/sec = 9 msg/sec?
```

---

<a name="prompt-3"></a>
## PROMPT 3 — ENGINE 3: Multi-Model AI Ensemble for Sports/Events

```
You are APEX, building Engine 3: the multi-model AI ensemble that trades sports 
and event prediction markets on Kalshi.

### THE EDGE
AI LLMs can synthesize news, injury reports, historical data, and sentiment 
faster than retail traders. The key finding from live trading: SPORTS markets 
(especially college basketball NO-side) have consistent alpha. ECONOMIC markets 
(CPI, Fed, macro) are TRAPS — market-implied probabilities are already efficient 
for economic releases. Hard-block them.

Best documented result: NCAAB NO-side trading at 74% win rate, +10% ROI.

### BUILD: python-engines/engine_ai_ensemble/

#### 1. Category Scoring System (category_scorer.py)

Implement a dynamic scoring system (0-100) per market category:

Score calculation:
score = (win_rate * 40) + (roi_normalized * 30) + (sample_confidence * 20) + (base_prior * 10)

Where:
- win_rate: rolling win rate over last N trades (N=50 default)
- roi_normalized: ROI percentage normalized to 0-1 scale (cap at ±50%)
- sample_confidence: min(total_trades / required_sample, 1.0) where required_sample=20
- base_prior: manually configured starting score from categories.toml

Category enforcement rules:
- Score >= 50: GOOD — full allocation allowed
- Score 30-49: WEAK — reduced allocation (50% max position size)
- Score < 30: BLOCKED — zero trades regardless of AI confidence

Initial category config:
NCAAB = 72  (proven winner)
NFL = 55
NBA = 41  
MLB = 38
POLITICS = 31 (marginal — small positions only)
CPI = 8 (BLOCKED)
FED = 12 (BLOCKED)
ECON_MACRO = 10 (BLOCKED)

Auto-update scores after every resolved trade.
Hard-block any category until it proves positive edge over >= 5 trades.

#### 2. Data Feed Ingestion (data_feeds.py)

Aggregate multiple real-time data sources:

NEWS FEEDS:
- RSS feeds from major sports outlets (ESPN, Yahoo Sports, The Athletic)
- RSS from political news (AP, Reuters, The Hill)
- Parse headlines + summaries into structured events
- Score relevance to active Kalshi markets

TWITTER/X SCRAPER (use Grok API for X access):
- Monitor key accounts: team beat reporters, injury reporters
- @ShamsCharania, @wojespn for NBA
- @AdamSchefter, @RapSheet for NFL
- @JonRothstein for NCAAB
- Parse tweets for: injury updates, lineup changes, breaking news
- Timestamp everything — recency is critical

SPORTRADAR (or free alternatives):
- Live game data, play-by-play (if available)
- Historical matchup data
- Team/player statistics
- Odds movement from offshore sportsbooks as a signal

Produce a structured MarketContext for each active market:
- market_ticker, market_question, current_prices
- relevant_news[] with timestamps
- relevant_tweets[] with timestamps  
- historical_data (if applicable)
- time_to_resolution

#### 3. Multi-Model AI Ensemble (ensemble.py)

Orchestrate 5 LLMs via OpenRouter API:

MODEL ROSTER (configurable in settings.toml):
1. Claude Sonnet 4 (Lead Analyst, 30% weight):
   - Role: "You are a senior prediction market analyst. Evaluate this market 
     and provide your probability estimate with reasoning."
   
2. Gemini 2.5 Pro (Forecaster, 30% weight):
   - Role: "You are a quantitative forecaster specializing in event probability. 
     Use base rates, historical data, and current signals to estimate probability."

3. GPT-4.1 (Risk Manager, 20% weight):
   - Role: "You are a risk-focused analyst. Identify reasons this trade could 
     fail. Provide a conservative probability estimate and flag risks."

4. DeepSeek R1 (Bull Case, 10% weight):
   - Role: "You are an optimistic analyst. Make the strongest bull case for 
     the YES outcome. What signals support a higher probability?"

5. Grok 3 (Bear Case, 10% weight):
   - Role: "You are a skeptical analyst with real-time X/Twitter access. Make 
     the strongest bear case. What could go wrong? Check latest social signals."

For each market evaluation:

STEP 1: Build the prompt context
- Market question + rules + resolution criteria
- Current YES/NO prices on Kalshi
- All relevant news and tweets (last 24 hours)
- Historical data if applicable
- Time to resolution

STEP 2: Query all 5 models in PARALLEL via OpenRouter
- Each returns: { probability: float, confidence: float, reasoning: string }
- Track API cost per call against daily budget

STEP 3: Aggregate responses
weighted_probability = sum(model.probability * model.weight for each model)
weighted_confidence = sum(model.confidence * model.weight for each model)
model_agreement = 1 - stdev(all model probabilities)  # High agreement = good

STEP 4: Decision logic
edge = abs(weighted_probability - current_market_price)
IF edge > min_edge_threshold (default 5%):
  IF weighted_confidence > min_confidence (default 0.45):
    IF model_agreement > 0.7 (models roughly agree):
      → Generate TradeSignal
    ELSE:
      → Reduce position size by 50% (disagreement discount)
  ELSE:
    → SKIP (low confidence)
ELSE:
  → SKIP (no edge)

STEP 5: Side selection
IF weighted_probability > current_yes_price + edge_threshold:
  → BUY YES
IF weighted_probability < current_yes_price - edge_threshold:
  → BUY NO (this is the "NO-side" strategy that showed 74% win rate)

#### 4. AI Cost Management

- Track cumulative daily API spend
- Each OpenRouter call returns usage/cost in response
- If daily_spend >= daily_ai_budget → stop making AI calls for the day
- Prioritize evaluating highest-volume markets first (more liquidity = better fills)
- Cache evaluations: don't re-evaluate same market within 30 minutes unless 
  significant news breaks

#### 5. Kalshi Trader (kalshi_trader.py)

Same pattern as other engines:
- Generate limit orders at favorable prices
- Never chase — if market moved past our target, skip
- Track every trade to category_performance table

#### 6. Scheduling

Run market evaluation cycles:
- SPORTS: Scan every 15 minutes during active game hours
- POLITICS: Scan every 30 minutes
- For live games: increase to every 5 minutes
- Night/off-hours: scan hourly for overnight developments

### CRITICAL SAFEGUARDS
- NEVER enter economic markets (CPI, Fed, jobs) unless category_score > 50
- Maximum 3 simultaneous positions per category
- If 3 consecutive losses in a category, pause that category for 24 hours
- Log full AI reasoning for every decision (forensic audit)

### TESTING
- Run ensemble against 100 historical Kalshi markets with known outcomes
- Compare ensemble accuracy to individual model accuracy
- Measure: does the ensemble beat any single model?
- Paper trade for 2 weeks minimum before live deployment
```

---

<a name="prompt-4"></a>
## PROMPT 4 — ENGINE 4: Weather Market Specialist

```
You are APEX, building Engine 4: the weather market specialist for Kalshi's 
KXHIGH temperature series.

### THE EDGE
Weather markets are LESS efficient than sports because fewer bots target them.
Meanwhile, the US government literally publishes free 31-member ensemble weather 
forecasts that give us a probabilistic temperature distribution. When 28 out of 
31 models agree a temperature threshold will be exceeded, and the market says 
50/50, we have a massive edge.

### BUILD: python-engines/engine_weather/

#### 1. GFS Ensemble Forecaster (gfs_ensemble.py)

Fetch 31-member GFS ensemble forecasts from Open-Meteo API (FREE, no key needed):

API: https://ensemble-api.open-meteo.com/v1/ensemble

Parameters:
- latitude, longitude (per city)
- models: "gfs_seamless" (returns 31 ensemble members)
- hourly: "temperature_2m"
- forecast_days: 3
- temperature_unit: "fahrenheit"

For each city, for each forecast hour:
1. Get all 31 member forecasts for temperature
2. For a given threshold T (e.g., "Will NYC high exceed 75°F?"):
   - Count members above T: members_above = sum(1 for m in members if m > T)
   - Model probability = members_above / 31
   - Confidence = |members_above - 15.5| / 15.5  (how one-sided is the ensemble)
3. Example: 28/31 above threshold → probability = 90.3%, confidence = 80.6%

#### 2. City Configuration (city_config.py)

Configure all Kalshi weather market cities:

CITY_CONFIG = {
    "NY": {
        "name": "New York",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "kalshi_series": "KXHIGHNY",
        "station": "NYC_Central_Park"
    },
    "CHI": {
        "name": "Chicago",  
        "latitude": 41.8781,
        "longitude": -87.6298,
        "kalshi_series": "KXHIGHCHI",
        "station": "ORD"
    },
    "MIA": {
        "name": "Miami",
        "latitude": 25.7617,
        "longitude": -80.1918,
        "kalshi_series": "KXHIGHMIA",
        "station": "MIA"
    },
    "LAX": {
        "name": "Los Angeles",
        "latitude": 34.0522,
        "longitude": -118.2437,
        "kalshi_series": "KXHIGHLAX",
        "station": "LAX"
    },
    "DEN": {
        "name": "Denver",
        "latitude": 39.7392,
        "longitude": -104.9903,
        "kalshi_series": "KXHIGHDEN",
        "station": "DEN"
    }
}

Make it easily extensible — add new cities with one dict entry.

#### 3. Weather Bot (weather_bot.py)

Main loop (every 5 minutes):

STEP 1: Fetch active weather markets from Kalshi
- GET /trade-api/v2/events with series_ticker prefix for each city
- Parse market thresholds from ticker (e.g., KXHIGHNY-26APR03-T75 = NYC > 75°F)
- Get current YES/NO prices and orderbook depth

STEP 2: Also fetch equivalent Polymarket weather markets
- Use Gamma API filtered for weather/climate tag
- Match to Kalshi markets by city + date + threshold

STEP 3: For each market, generate forecast probability
- Call GFS ensemble for the relevant city, date, and time
- Calculate model_probability and confidence

STEP 4: Calculate edge and trade
edge_kalshi = model_probability - kalshi_yes_price  # positive = buy YES
edge_poly = model_probability - poly_yes_price      # positive = buy YES

For each venue:
  IF |edge| > 8% AND confidence > 60%:
    → Generate TradeSignal
    → Trade whichever venue has larger edge
  IF both venues mispriced in opposite directions:
    → Flag cross-venue arb for Engine 1

POSITION SIZING:
kelly = (win_prob * odds - lose_prob) / odds
position = kelly * 0.15 * engine_bankroll
position = min(position, bankroll * 0.05)  # 5% cap
position = min(position, 100.00)  # $100 hard cap per weather trade

#### 4. Calibration Tracking

After each market resolves:
- Record actual high temperature (from NOAA/NWS data)
- Compare to our forecast probability
- Track Brier score per city
- If a city's Brier score exceeds 0.25 over 30 trades, 
  add a correction factor or increase edge threshold for that city

#### 5. Multi-Source Verification (optional enhancement)

For higher confidence, also check:
- NOAA NDFD (National Digital Forecast Database) forecasts
- Weather.gov API for NWS official forecasts
- If GFS ensemble AND NWS official forecast agree → highest confidence

### TESTING
- Backtest: Fetch historical GFS ensemble data + historical Kalshi prices
  for past 90 days. Calculate what the bot would have traded.
- Validate GFS ensemble accuracy against actual temperatures (NOAA records)
- Paper trade all 5 cities for 1 week before live
```

---

<a name="prompt-5"></a>
## PROMPT 5 — ENGINE 5: New Market Listing Sniper

```
You are APEX, building Engine 5: the new market listing sniper. This engine 
detects new Kalshi market listings the instant they appear and enters before 
opening prices equilibrate.

### THE EDGE
New market listings are consistently mispriced because:
1. Retail traders haven't discovered them yet
2. Order books are thin with wide spreads
3. Market makers haven't fully calibrated their quotes
4. The "true" probability is often knowable from external data

First-mover advantage on new listings = easy edge.

### BUILD: python-engines/engine_sniper/

#### 1. Listing Monitor (listing_monitor.py)

Continuous polling for new markets:

POLLING LOOP (every 5 seconds):
1. GET /trade-api/v2/events with status="open" and sort by created_time desc
2. Compare against known_markets set (in-memory + persisted to SQLite)
3. Any new market_id NOT in known_markets → NEW LISTING DETECTED
4. Immediately fetch full market details:
   - Event question and resolution rules
   - All available contracts/tickers  
   - Current orderbook (if any)
   - Market close timestamp
   - Category

NEW LISTING EVENT:
{
    "event_ticker": "...",
    "market_ticker": "...",
    "title": "...",
    "category": "...",  
    "close_time": "...",
    "rules": "...",
    "yes_price": null,  # might not have quotes yet
    "no_price": null,
    "detected_at": "2026-04-02T12:00:00Z"
}

DISCOVERY SOURCES:
- Primary: Kalshi Events API polling
- Secondary: Kalshi WebSocket for new market messages
- Tertiary: Monitor @Kalshi and @KalshiExchange Twitter for market announcements

#### 2. Rapid Scorer (rapid_scorer.py)

When a new listing is detected, we have seconds to decide. Use a FAST evaluation:

TIER 1 — INSTANT CHECK (< 1 second):
- Is category BLOCKED? → Skip
- Is there enough time to resolution? (min 1 hour) → Skip if too soon
- Is it a type we've seen before? (weather, sports, crypto → use domain engine)

TIER 2 — RAPID AI EVALUATION (< 10 seconds):
- Single fast LLM call (Grok or Claude Haiku — fastest response time)
- Prompt: "New prediction market listing. Question: [X]. Resolution rules: [Y]. 
  Based on your current knowledge, what is the probability of YES? 
  Respond with ONLY a JSON: {probability: float, confidence: float, reasoning: string}"
- Compare AI probability to current market price (if any quotes exist)

TIER 3 — WEB SEARCH AUGMENTATION (< 30 seconds):
- If confidence from Tier 2 < 0.6, do a quick web search for context
- Search query: extract key entities from market question
- Feed search results into a second LLM call for refined probability

DECISION:
IF market has no quotes yet:
  → Place a limit order at our estimated fair price (passive entry)
  → We become the first price setter = maximum edge
IF market has quotes but thin book:
  IF |our_estimate - market_price| > 10%:
    → Enter at market_price (take the mispricing)
  ELSE:
    → Skip (not enough edge for the risk)

#### 3. Execution Speed Optimization

This engine is about SPEED. Optimize:
- Keep Kalshi auth token hot (refresh before expiry)
- Pre-calculate order parameters so we only need to fill in price/ticker
- Use connection pooling for HTTP requests
- Log time from detection → order submission (target < 5 seconds)

#### 4. Position Management

- Small positions only: max $50 per new listing trade
- Set exit price: if market moves 5% in our favor, take profit
- Hard stop: if market moves 10% against us, exit
- Time-based exit: if position open > 24 hours with no movement, close
- Never hold more than 10 sniper positions simultaneously

#### 5. Learning Loop

After each sniper trade resolves:
- Was the new listing mispriced in our direction? (win/loss)
- By how much? (magnitude of edge captured)
- What category? (update category_scorer)
- How long did the mispricing persist? (market efficiency measurement)
- Feed results back to improve rapid_scorer thresholds

### TESTING
- Backtest: Use historical Kalshi market creation timestamps
  + initial prices. Would we have identified the mispricing?
- Monitor new listings in paper mode for 1 week
- Track: detection latency, evaluation latency, execution latency
```

---

<a name="prompt-6"></a>
## PROMPT 6 — UNIFIED RISK LAYER

```
You are APEX, building the unified risk management layer that ALL 5 engines 
must pass through before executing any trade. This is the single most important 
component. Without it, every engine eventually blows up.

### BUILD: python-engines/risk_layer/

#### 1. Risk Manager (risk_manager.py)

Central risk orchestration. EVERY trade signal flows through here:

async def evaluate_signal(signal: TradeSignal) -> RiskCheck:
    """
    Returns RiskCheck with passed=True/False and reason.
    ALL of these must pass for a trade to execute.
    """

CHECK 1 — KILL SWITCH
- If file `data/STOP` exists → reject ALL trades immediately
- This is the emergency brake. Human can create this file anytime.

CHECK 2 — DAILY LOSS LIMIT  
- Calculate today's realized + unrealized P&L across all engines
- If daily_loss >= max_daily_drawdown_pct * starting_capital → HALT all trading
- Default: 10% = $5,000 on $50K capital

CHECK 3 — TOTAL DRAWDOWN CIRCUIT BREAKER
- Calculate drawdown from portfolio high-water mark
- If drawdown >= max_total_drawdown_pct → HALT all trading until manual reset
- Default: 15% = $7,500 on $50K capital
- This requires human intervention to resume (create data/RESUME file)

CHECK 4 — ENGINE ALLOCATION
- Each engine has a capital allocation percentage
- Engine cannot exceed its allocation (e.g., arb engine gets 40% = $20K)
- current_engine_exposure = sum of all open positions for this engine
- If current_engine_exposure + proposed_trade > engine_allocation → reject

CHECK 5 — SECTOR CONCENTRATION
- No single category can exceed 30% of total portfolio
- Sum all positions tagged with this category across all engines
- If concentration_pct + proposed_trade > 30% → reject

CHECK 6 — POSITION LIMITS
- Max positions per engine: configurable (default 20 for arb, 10 for others)
- Max total positions across all engines: 50
- If at limit → reject (must close something first)

CHECK 7 — CATEGORY SCORE
- Look up the market's category in category_scorer
- If score < 30 → BLOCKED, reject regardless of signal strength
- If score 30-49 → WEAK, reduce position size by 50%

CHECK 8 — CONFIDENCE MINIMUM
- Signal confidence must exceed min_confidence (default 0.45)
- Lower confidence = smaller position (linear scaling)

CHECK 9 — STALE DATA PROTECTION
- Signal must have been generated within last 30 seconds
- Market data feeding the signal must be < 10 seconds old
- If stale → reject (market may have moved)

CHECK 10 — CONSECUTIVE LOSS PROTECTION
- Track consecutive losses per engine
- If 5 consecutive losses → pause engine for 1 hour
- If 3 consecutive losses in a category → pause category for 24 hours

LOGGING:
- Every risk check (pass or fail) logged to risk_checks table
- Include: signal details, which check failed/passed, timestamp

#### 2. Kelly Position Sizer (kelly.py)

Implement fractional Kelly criterion:

def calculate_position_size(
    win_probability: float,
    edge_pct: float,
    bankroll: float,
    kelly_fraction: float = 0.25,  # Quarter-Kelly for safety
    max_pct_bankroll: float = 0.05,
    hard_cap: float = 100.0
) -> float:
    """
    Kelly formula for binary prediction markets:
    f* = (p * b - q) / b
    where:
      p = win probability
      q = 1 - p (loss probability)  
      b = payout odds (for prediction markets: (1 - price) / price for YES)
    
    We use fractional Kelly (default 0.25x) because:
    - Full Kelly is too aggressive for non-infinite bankrolls
    - 0.75x Kelly with 45% win rate → lose 80% of capital in standard drawdown
    - 0.25x Kelly significantly reduces variance while keeping most of the edge
    """
    
    price = 1 - edge_pct  # approximate (simplified)
    b = (1 - price) / price  # payout odds
    q = 1 - win_probability
    
    kelly_optimal = (win_probability * b - q) / b
    kelly_optimal = max(kelly_optimal, 0)  # never negative (no edge = no trade)
    
    position = kelly_optimal * kelly_fraction * bankroll
    position = min(position, bankroll * max_pct_bankroll)  # % bankroll cap
    position = min(position, hard_cap)  # hard dollar cap
    position = max(position, 0)  # floor at zero
    
    return round(position, 2)

#### 3. Portfolio State Manager (allocation.py)

Real-time portfolio tracking:

class PortfolioManager:
    - total_capital: float (starting + realized P&L)
    - cash_available: float (not allocated to positions)
    - positions: Dict[str, Position]  # market_ticker → position
    - engine_allocations: Dict[str, float]  # engine_id → max capital
    - high_water_mark: float  # for drawdown calculation
    - daily_pnl: float
    - total_pnl: float
    
    Methods:
    - get_engine_available(engine_id) → remaining capital for engine
    - get_category_exposure(category) → total $ in this category
    - mark_to_market() → recalculate all unrealized P&L
    - on_trade_executed(execution) → update state
    - on_position_closed(settlement) → update state + P&L
    - daily_rollover() → reset daily counters at midnight

#### 4. Audit Logger (audit_log.py)

Full forensic trail:
- Every signal generated (even ones not traded)
- Every risk check with full details
- Every trade executed with fills
- Every position settlement
- Daily summary per engine
- CSV export capability for analysis

Tables: trades, signals, risk_checks, daily_summary, category_performance

Include a CLI for querying:
  python -m risk_layer.audit_log history --engine btc_sniper --last 50
  python -m risk_layer.audit_log daily --date 2026-04-02
  python -m risk_layer.audit_log categories  # show all category scores

### TESTING
- Unit test every risk check in isolation
- Simulate scenarios: daily drawdown hit, sector concentration exceeded, etc.
- Fuzz test: send random TradeSignals and verify no check is bypassed
- Integration test: spin up mock engine → send signals → verify flow
```

---

<a name="prompt-7"></a>
## PROMPT 7 — REAL-TIME DASHBOARD

```
You are APEX, building the React real-time dashboard for monitoring all 5 
trading engines. This is deployed locally or on the VPS alongside the bots.

### BUILD: dashboard/

Tech stack: React 18 + TypeScript + TanStack Query + Tailwind CSS + Recharts

Design tokens (matching Strange Digital Group brand):
- Background: #080D1F (navy dark)
- Primary: #00D4C8 (teal)
- Accent: #FF6B35 (orange)  
- Success: #22C55E
- Danger: #EF4444
- Warning: #F59E0B
- Fonts: Syne (headings), Inter (body), JetBrains Mono (numbers/data)
- Dark mode ONLY

#### LAYOUT: 3-Column Dashboard

LEFT COLUMN (Engine Status):
- 5 engine cards, each showing:
  - Engine name + status (RUNNING / PAUSED / ERROR)
  - Current P&L (daily)
  - Win/Loss count
  - Active positions count
  - Last trade timestamp
  - Color-coded health indicator

CENTER COLUMN (Live Feed):
- Real-time trade log (newest first)
- Each entry shows: timestamp, engine, market, side, price, quantity, P&L
- Color-code: green for wins, red for losses, yellow for open
- Auto-scroll with pause on hover

RIGHT COLUMN (Analytics):
- Portfolio equity curve (Recharts line chart)
- Category performance heatmap
- Daily P&L bar chart (last 30 days)
- Risk metrics: current drawdown, sector concentrations
- Arb opportunities detected vs executed (funnel chart)

TOP BAR:
- Total portfolio value + daily P&L + total P&L
- Kill switch button (creates STOP file via API)
- Mode indicator: PAPER / LIVE
- Connection status for all WebSocket feeds

BOTTOM BAR:
- System health: CPU, memory, API latency per venue
- AI budget: spent today / daily limit
- Last risk check result

#### BACKEND API (FastAPI):

Create a lightweight FastAPI server that the dashboard queries:
- GET /api/portfolio → current portfolio state
- GET /api/trades?engine=X&limit=50 → recent trades
- GET /api/engines → all engine statuses
- GET /api/categories → category scores
- GET /api/equity-curve?days=30 → historical equity
- POST /api/kill → create STOP file
- POST /api/resume → create RESUME file
- WebSocket /ws/trades → real-time trade stream

This API reads from the shared SQLite database.
```

---

<a name="prompt-8"></a>
## PROMPT 8 — TELEGRAM BOT

```
You are APEX, building the Telegram bot for alerts, monitoring, and manual 
control of the trading system.

### BUILD: telegram-bot/

Use Node.js + telegraf library.

#### NOTIFICATIONS (Bot → User):

TRADE ALERTS:
🟢 ENTRY | Engine: BTC Sniper
Market: KXBTC15M-26APR03-T97500
Side: YES @ $0.52 | Qty: 10 | Cost: $5.20
Edge: 8.3% | Confidence: 0.72
Signal: Momentum +0.23%, RSI 32, VWAP dev +0.003

🔴 EXIT | Engine: Weather
Market: KXHIGHNY-26APR03-T75
Result: WIN ✅ | +$3.80 (P&L +73%)
GFS Forecast: 78°F | Actual: 79°F

⚠️ RISK ALERT | Daily drawdown at 7.2%
Remaining budget: $1,400 | Circuit breaker at $5,000

🛑 CIRCUIT BREAKER ACTIVATED
Daily loss limit hit: -$5,000
All trading halted. Send /resume to restart.

DAILY SUMMARY (configurable time, default 9 PM):
📊 Daily Summary | April 2, 2026
━━━━━━━━━━━━━━━━━━
💰 Total P&L: +$847.32
📈 Win Rate: 68% (17W / 8L)
━━━━━━━━━━━━━━━━━━
ENGINE BREAKDOWN:
  Arb Engine:    +$312.50 (8W/0L)
  BTC Sniper:    +$245.80 (5W/3L)
  AI Ensemble:   +$189.02 (3W/2L)
  Weather:       +$82.00 (1W/0L)
  Listing Sniper: +$18.00 (0W/3L)
━━━━━━━━━━━━━━━━━━
🎯 Categories: NCAAB 78% | NBA 50% | Weather 100%
💸 AI Spend: $8.42 / $15.00
🔒 Drawdown: 2.1%

#### COMMANDS (User → Bot):

/status → Current portfolio + all engine health
/pnl → Today's P&L breakdown
/pnl week → This week's P&L
/positions → All open positions
/engines → Engine status table
/categories → Category score table
/pause [engine] → Pause specific engine
/resume [engine] → Resume specific engine
/kill → Emergency stop all trading
/resume_all → Resume after kill (requires confirmation)
/config → Show current risk parameters
/set risk.max_daily_drawdown_pct 8 → Update config on the fly

#### INTERACTIVE CONTROLS:

On /status, show inline keyboard buttons:
[Pause All] [Resume All]
[View Trades] [View Positions]

On trade alerts, show:
[Close Position] [Add to Position]
```

---

<a name="prompt-9"></a>
## PROMPT 9 — DEPLOYMENT & INFRASTRUCTURE

```
You are APEX, building the deployment infrastructure for the complete trading system.

### DOCKER COMPOSE

Create docker-compose.yml with services:

1. rust-arb-engine: Built from Dockerfile.rust
   - Exposes port 8081 (health check)
   - Mounts config/ and data/ volumes
   - restart: unless-stopped

2. python-engines: Built from Dockerfile.python
   - Runs all 4 Python engines via supervisor or multiprocessing
   - Mounts config/ and data/ volumes
   - Depends on: redis

3. dashboard-api: FastAPI backend
   - Port 8080
   - Mounts data/ for SQLite access
   - Depends on: python-engines

4. dashboard-ui: React frontend  
   - Port 3000
   - Depends on: dashboard-api

5. telegram-bot: Node.js Telegram interface
   - Mounts data/ for SQLite access
   - Depends on: python-engines

6. redis: Redis for cross-engine state sharing
   - Port 6379
   - Used for real-time position tracking between Rust and Python

### DOCKERFILES

Dockerfile.rust:
- Base: rust:1.78-slim
- Multi-stage build (build stage + slim runtime)
- Copy only the binary to runtime image
- Target: release mode with LTO

Dockerfile.python:
- Base: python:3.12-slim
- Install uv, sync dependencies
- Use supervisord to run all 4 engines as separate processes
- Health check endpoint on port 8082

### STARTUP SCRIPTS

scripts/start_all.sh:
- Validate .env file exists and has required keys
- Check Kalshi API connectivity (demo first)
- Start all services via docker-compose
- Wait for health checks to pass
- Send Telegram notification: "🚀 APEX Trading System Online"

scripts/stop_all.sh:
- Create STOP file first (graceful trade halt)
- Wait 30 seconds for open orders to settle
- docker-compose down
- Send Telegram notification: "🛑 APEX Trading System Offline"

scripts/paper_trade.sh:
- Set MODE=paper in all configs
- Use Kalshi demo API
- Start everything in paper trading mode
- Log to separate paper_trades.db

### MONITORING

Create a simple health check aggregator:
- Ping each service health endpoint every 30 seconds
- If any service down → Telegram alert
- Track uptime percentage
- Log restarts

### VPS REQUIREMENTS

Recommended setup for production:
- Location: NYC area (closest to Kalshi/financial data centers)
- Specs: 4 vCPU, 8GB RAM, 50GB SSD minimum
- OS: Ubuntu 24.04 LTS
- Network: Sub-5ms to major exchange APIs
- Consider: QuantVPS or similar low-latency financial hosting

### SECURITY

- All API keys in .env file (never committed to git)
- .env in .gitignore
- Kalshi private key stored outside repo
- Docker secrets for sensitive values
- SQLite database backed up daily to cloud storage
- Telegram bot token restricted to specific chat_id
```

---

## EXECUTION ORDER

Build these prompts in this sequence for fastest path to paper trading:

1. **Prompt 0** — Bootstrap monorepo (Day 1)
2. **Prompt 6** — Risk layer (Day 1-2) — MUST exist before any engine
3. **Prompt 2** — BTC Sniper (Day 2-3) — Fastest to validate, runs 24/7
4. **Prompt 4** — Weather bot (Day 3-4) — Simple, high confidence
5. **Prompt 5** — Listing sniper (Day 4-5) — Quick wins
6. **Prompt 3** — AI Ensemble (Day 5-7) — Most complex, highest potential
7. **Prompt 1** — Rust arb engine (Day 7-10) — Rust adds complexity but speed
8. **Prompt 7** — Dashboard (Day 10-11) — Visualization
9. **Prompt 8** — Telegram bot (Day 11-12) — Monitoring
10. **Prompt 9** — Docker deployment (Day 12-14) — Production packaging

**Paper trade for minimum 2 weeks before deploying real capital.**

---

## CAPITAL DEPLOYMENT SCHEDULE

Week 1-2: Paper trading all engines. Fix bugs. Calibrate thresholds.
Week 3: Deploy $5,000 real capital. BTC Sniper + Weather only.
Week 4: If profitable, add $10,000. Enable AI Ensemble.
Week 5: Add $15,000. Enable Listing Sniper.
Week 6: Full $50,000 deployed. Enable Rust Arb Engine.
Week 8+: Compound profits. Scale position sizes. Add new categories.

---

*Built by APEX for TradeWorks | Strange Digital Group*
*"Speed beats intelligence. Diversification beats conviction."*
