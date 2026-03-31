---
name: tradeworks-apex
description: >
  TradeWorks APEX finance and trading platform integration.
  Use when Jason asks about: crypto signals, stock analysis,
  Polymarket opportunities, sports betting, portfolio status, P&L,
  market scans, position management, risk assessment, trading bot status,
  Solana sniper activity, macro regime, or any finance/trading/investment topic.
version: 1.0.0
author: Strange Digital Group
requires:
  env:
    - TRADEWORKS_GATEWAY_URL
    - APEX_JWT_TOKEN
    - JUPITER_API_KEY
    - ANTHROPIC_API_KEY
  binaries:
    - curl
    - jq
    - node
---

# APEX Trading Skills

## PortfolioIntelligenceSkill

### Description
Full portfolio overview across all markets — crypto, stocks, prediction markets, sports bets. Shows total value, allocation breakdown, P&L by market, equity curve, and open positions.

### Triggers
- "how's my portfolio"
- "show positions"
- "P&L"
- "what's my allocation"
- "portfolio overview"
- "total balance"
- "how am I doing"

### Tools
- `GET /portfolio` — Full portfolio snapshot
- `GET /portfolio/equity-curve` — Historical equity values
- `GET /portfolio/allocation` — Asset allocation breakdown
- `GET /portfolio/risk` — Portfolio risk metrics
- `GET /solana/balances` — Solana wallet balances
- `GET /portfolio/balances` — Exchange balances (Coinbase, Alpaca)

### Output Schema
```json
{
  "totalValueUsd": 12450.00,
  "dayPnl": 340.50,
  "dayPnlPct": 2.8,
  "markets": {
    "crypto": { "value": 8200, "pnl": 180, "positions": 12 },
    "stocks": { "value": 3100, "pnl": 95, "positions": 4 },
    "predictions": { "value": 800, "pnl": 45, "positions": 3 },
    "sports": { "value": 350, "pnl": 20, "positions": 2 }
  }
}
```

---

## TradeExecutionSkill

### Description
Execute, close, or modify trades across all connected markets. Supports market orders, limit orders, and advanced order types (TWAP, VWAP, iceberg). Requires confirmation for trades exceeding thresholds.

### Triggers
- "buy BTC"
- "sell SOL"
- "close position"
- "place order"
- "execute trade"

### Tools
- `POST /trades` — Execute a trade
- `POST /orders` — Place an order
- `POST /orders/advanced` — Advanced order types
- `POST /positions/:id/close` — Close a position
- `DELETE /orders/:id` — Cancel an order

---

## RiskManagementSkill

### Description
Real-time risk assessment — Kelly criterion sizing, portfolio heat score, Value at Risk, correlation matrix, and circuit breaker management. Enforces hard limits on position sizing and drawdown.

### Triggers
- "risk check"
- "portfolio heat"
- "circuit breaker"
- "VaR"
- "position sizing"
- "how much should I buy"
- "Kelly criterion"

### Tools
- `GET /risk/metrics` — Current risk dashboard
- `GET /risk/limits` — Hard risk limits
- `GET /risk/history` — Historical risk events
- `POST /risk/circuit-breaker` — Trip or reset circuit breaker

---

## MarketScannerSkill

### Description
Scan across all markets for opportunities — new crypto tokens, oversold stocks, mispriced prediction markets, +EV sports bets. Configurable filters and sorting.

### Triggers
- "scan markets"
- "find opportunities"
- "new tokens"
- "what's trending"
- "any good setups"
- "scan crypto"
- "scan stocks"

### Tools
- `GET /solana/scanner/tokens` — New Solana token scanner
- `GET /market/instruments` — Stock/ETF watchlist
- `GET /polymarket/markets` — Active prediction markets
- `GET /solana/sniper/status` — Sniper bot activity

---

## SignalGeneratorSkill

### Description
Generate AI trading signals with composite confidence scoring. Combines technical analysis (35%), security analysis (20%), momentum (20%), sentiment (15%), and volume/liquidity (10%).

### Triggers
- "generate signal"
- "analyze BTC"
- "should I buy"
- "what do you think about"
- "signal for"

### Tools
- `POST /agents/signal` — Generate and store signal
- `GET /agents` — List recent signals

---

## SolanaSniperSkill

### Description
Manage the Solana sniper bot — start/stop strategies, configure templates, view positions, check execution history. Supports 4 strategies: Graduation Hold, Quick Scalp, Copy Trading, Graduation Snipe.

### Triggers
- "sniper status"
- "start sniper"
- "stop sniper"
- "sniper config"
- "sniper history"
- "auto-buy"

### Tools
- `GET /solana/sniper/status` — Bot status, positions, P&L
- `GET /solana/sniper/templates` — List strategy templates
- `PUT /solana/sniper/templates/:id` — Update template config
- `POST /solana/sniper/templates/:id/start` — Start strategy
- `POST /solana/sniper/templates/:id/stop` — Stop strategy
- `GET /solana/sniper/history` — Execution history
- `POST /solana/sniper/execute` — Manual snipe
- `POST /solana/sniper/clean-wallet` — Clean dust token accounts

---

## WhaleTrackerSkill

### Description
Track large Solana wallets with proven track records. Monitor their buys/sells, copy trade automatically, and analyze their performance over time.

### Triggers
- "whale activity"
- "big wallets"
- "smart money"
- "copy trade"
- "who's buying"

### Tools
- `GET /solana/whales/list` — Tracked whale wallets
- `GET /solana/whales/activity` — Recent whale transactions
- `POST /solana/whales/add` — Add wallet to tracking
- `GET /solana/whales/:address/stats` — Wallet performance stats

---

## BacktestSkill

### Description
Test trading strategies against historical data before deploying live. Supports custom date ranges, position sizing rules, and multi-strategy comparison.

### Triggers
- "backtest"
- "test strategy"
- "historical performance"
- "how would this have performed"

### Tools
- `POST /backtest` — Run backtest with strategy config

---

## ArbitrageSkill

### Description
Detect price differences for the same asset across exchanges (crypto) or for the same event across prediction market platforms. Calculate profit after fees.

### Triggers
- "arbitrage"
- "price difference"
- "cross-exchange"
- "arb opportunity"

### Tools
- `GET /arbitrage/opportunities` — Current arb opportunities

---

## PolymarketSkill

### Description
Analyze prediction market opportunities on Polymarket. Compare odds across platforms, detect mispricings from news sentiment, and manage positions.

### Triggers
- "prediction market"
- "polymarket"
- "event odds"
- "what are the odds"
- "bet on"

### Tools
- `GET /polymarket/markets` — Active markets with odds
- `GET /polymarket/positions` — Open positions
- `POST /polymarket/orders` — Place prediction market order

---

## SportsBettingSkill

### Description
Sports betting analysis — line shopping across sportsbooks, expected value calculation, player prop modeling, and parlay construction. Alerts on +EV opportunities.

### Triggers
- "sports bets"
- "line shopping"
- "player props"
- "NFL odds"
- "NBA betting"
- "who should I bet on"

### Tools
- `GET /sports/odds` — Current odds across sportsbooks
- `GET /sports/ev` — Expected value calculations
- `GET /sports/props` — Player prop analysis

---

## MacroRegimeSkill

### Description
Classify the current macro market regime (Risk-On, Risk-Off, Transitioning, Crisis) and adjust all strategy parameters accordingly. Monitors VIX, DXY, Treasury yields, BTC dominance, and Fed funds rate.

### Triggers
- "macro regime"
- "market regime"
- "risk on or risk off"
- "what's the market doing"
- "morning brief"

### Tools
- `GET /market/regime` — Current regime classification
- `GET /market/correlations` — Cross-market correlations

---

## JournalSkill

### Description
Trade journal — log decisions, rationale, and outcomes. Review past trades, analyze patterns, and extract lessons. Auto-logged by the sniper bot, manually augmented by APEX.

### Triggers
- "trade journal"
- "log trade"
- "review trades"
- "what did I trade"

### Tools
- `GET /journal` — Journal entries
- `POST /journal` — Create journal entry

---

## IntelligenceBriefSkill

### Description
Generate market intelligence reports — morning briefs, weekly summaries, breaking news analysis. Synthesizes data across all markets into actionable insights.

### Triggers
- "market brief"
- "intelligence report"
- "morning update"
- "what happened today"
- "news"

### Tools
- `GET /agents/briefing` — Generate market briefing
- Web search via Tavily for breaking news
