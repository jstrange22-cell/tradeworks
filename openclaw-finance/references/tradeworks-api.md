# TradeWorks Gateway API Reference

Base URL: `http://localhost:4000/api/v1`
Auth: `Authorization: Bearer <JWT>`

## Portfolio & Monitoring
| Method | Path | Description |
|--------|------|-------------|
| GET | /portfolio | Full portfolio snapshot |
| GET | /portfolio/equity-curve | Historical equity values |
| GET | /portfolio/allocation | Asset allocation breakdown |
| GET | /portfolio/positions | All open positions |
| GET | /portfolio/trades | Trade history |
| GET | /portfolio/risk | Portfolio risk metrics |
| GET | /portfolio/balances | Exchange balances (Coinbase, Alpaca) |
| PATCH | /portfolio/mode | Switch paper/live mode |

## Trading
| Method | Path | Description |
|--------|------|-------------|
| POST | /trades | Execute a trade |
| GET | /positions | All open positions |
| GET | /positions/:instrument | Positions for specific asset |
| POST | /positions/:id/close | Close a position |
| GET | /positions/history/closed | Closed position history |
| POST | /orders | Place an order |
| POST | /orders/advanced | Advanced orders (TWAP, VWAP, Iceberg) |

## Risk Management
| Method | Path | Description |
|--------|------|-------------|
| GET | /risk/metrics | Current risk dashboard |
| GET | /risk/history | Historical risk events |
| GET | /risk/limits | Hard risk limits |
| POST | /risk/circuit-breaker | Trip or reset circuit breaker |

## Solana Sniper
| Method | Path | Description |
|--------|------|-------------|
| GET | /solana/sniper/status | Bot status, positions, P&L |
| GET | /solana/sniper/templates | List strategy templates |
| POST | /solana/sniper/templates | Create new template |
| PUT | /solana/sniper/templates/:id | Update template config |
| DELETE | /solana/sniper/templates/:id | Delete template |
| POST | /solana/sniper/templates/:id/start | Start strategy |
| POST | /solana/sniper/templates/:id/stop | Stop strategy |
| GET | /solana/sniper/history | Execution history |
| GET | /solana/sniper/holdings | Holdings P&L per token |
| GET | /solana/sniper/pnl | Aggregated P&L |
| POST | /solana/sniper/execute | Manual snipe |
| POST | /solana/sniper/clean-wallet | Clean dust accounts |
| GET | /solana/sniper/presets | List strategy presets |
| POST | /solana/sniper/presets/:name/apply | Apply preset as template |

## Solana Ecosystem
| Method | Path | Description |
|--------|------|-------------|
| GET | /solana/balances | Wallet SOL + token balances |
| GET | /solana/wallet | Wallet connection status |
| POST | /solana/swap | Token swap |
| GET | /solana/scanner/tokens | Token scanner |
| GET | /solana/whales/list | Tracked whale wallets |
| GET | /solana/whales/activity | Whale transactions |
| POST | /solana/whales/add | Add wallet to tracking |
| GET | /solana/launchpads/status | Launchpad monitor status |

## Market Data
| Method | Path | Description |
|--------|------|-------------|
| GET | /market/instruments | Watchlist / instrument list |
| GET | /market/candles | OHLCV candlestick data |
| GET | /market/regime | Macro regime classification |
| GET | /market/correlations | Cross-market correlations |

## Strategies & Analysis
| Method | Path | Description |
|--------|------|-------------|
| GET | /strategies | List strategies |
| POST | /strategies | Create strategy |
| POST | /backtest | Run backtest |
| GET | /arbitrage/opportunities | Arb scanner |
| GET | /agents | List AI agents/signals |
| POST | /agents/signal | Generate trading signal |

## Prediction Markets
| Method | Path | Description |
|--------|------|-------------|
| GET | /polymarket/markets | Active markets |
| GET | /polymarket/positions | Open positions |
| POST | /polymarket/orders | Place order |

## System
| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /auth/login | Login (email/password) |
| POST | /auth/google | Google OAuth |
| GET | /auth/me | Current user |
| GET | /settings | User settings |
| GET | /settings/api-keys | API key management |
| GET | /settings/asset-protection | Asset protection config |
| GET | /journal | Trade journal |
| POST | /journal | Create journal entry |
| GET | /notifications | Notification settings |
| POST | /notifications | Create alert |
| POST | /webhooks/tradingview | TradingView webhook receiver |

## WebSocket
| Path | Description |
|------|-------------|
| /ws | Real-time updates (positions, P&L, signals, sniper activity) |
