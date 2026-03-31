# External Market Data API Reference

## DexScreener (Solana Token Data)
- Base: `https://api.dexscreener.com`
- `GET /latest/dex/tokens/{mint}` — Token pairs, price, volume, liquidity
- `GET /latest/dex/search?q={query}` — Search tokens by name/symbol
- Free tier: No key required, rate limited
- Returns: chainId, priceUsd, volume24h, liquidity, priceChange

## Birdeye (Solana Analytics)
- Base: `https://public-api.birdeye.so`
- `GET /defi/token_overview?address={mint}` — Token overview
- `GET /defi/ohlcv?address={mint}` — OHLCV candles
- Requires: `X-API-KEY` header
- Returns: price, volume, trades, holders, mcap

## Jupiter (Solana DEX Aggregator)
- Base: `https://api.jup.ag`
- `GET /swap/v1/quote` — Get swap quote with split routing
- `POST /swap/v1/swap` — Build swap transaction
- `GET /price/v2?ids={mints}` — Token prices (batch)
- Requires: `x-api-key` header (free at portal.jup.ag)
- Features: split routing across 370+ DEXs, dynamic slippage, CU optimization

## GoPlus (Token Security)
- Base: `https://api.gopluslabs.io`
- `GET /api/v1/token_security/{chain_id}?contract_addresses={mint}` — Security report
- Free tier available
- Returns: is_honeypot, is_mintable, owner_change_balance, holder analysis

## RugCheck
- Base: `https://api.rugcheck.xyz`
- `GET /v1/tokens/{mint}/report/summary` — Rug risk summary
- Returns: score (0-1000), top holder %, bundle detected, risks

## Coinbase (Crypto Exchange)
- Base: `https://api.coinbase.com`
- `GET /v2/prices/{pair}/spot` — Spot price (free, no auth)
- Advanced Trade API requires CDP JWT auth (Ed25519)

## Alpaca (US Equities)
- Base: `https://api.alpaca.markets` (live) / `https://paper-api.alpaca.markets` (paper)
- Data: `https://data.alpaca.markets`
- `GET /v2/account` — Account info
- `GET /v2/positions` — Open positions
- `POST /v2/orders` — Place order
- `GET /v2/stocks/{symbol}/bars` — OHLCV bars
- Auth: `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers

## Polymarket (Prediction Markets)
- Base: `https://clob.polymarket.com` (order book) / `https://gamma-api.polymarket.com` (discovery)
- `GET /markets` — Active markets
- `GET /book?token_id={id}` — Order book
- CLOB requires API key for trading

## The Odds API (Sports Betting)
- Base: `https://api.the-odds-api.com`
- `GET /v4/sports` — Available sports
- `GET /v4/sports/{sport}/odds` — Odds from 20+ books
- `GET /v4/sports/{sport}/scores` — Live scores
- Free tier: 500 requests/month
- Auth: `apiKey` query parameter

## Tavily (News/Sentiment)
- Base: `https://api.tavily.com`
- `POST /search` — AI-powered news search
- Returns: title, content, url, score, published_date
- Good for: breaking news detection, sentiment analysis

## Helius (Solana Infrastructure)
- Base: `https://mainnet.helius-rpc.com/?api-key={key}`
- Standard Solana JSON-RPC + enhanced methods
- `getAssetBatch` — DAS API for token prices + metadata
- Enhanced WebSockets for real-time transaction monitoring
- Free tier: 1M credits, 10 RPS
