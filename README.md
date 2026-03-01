# TradeWorks

Master Trading Agent System -- Autonomous multi-asset trading across crypto, prediction markets, and equities using AI agent orchestration.

## Architecture

TradeWorks is a monorepo containing a multi-agent trading system powered by the Claude Agent SDK. Five specialized AI agents collaborate on each trading cycle:

```
ORCHESTRATOR (Team Lead)
    |
    +-- Quant Analyst     (technical analysis, patterns, Smart Money Concepts)
    +-- Sentiment Analyst  (news & social NLP)
    +-- Macro Analyst      (economic indicators)
    +-- Risk Guardian      (VaR, drawdown, circuit breaker)
    +-- Execution Specialist (order routing, MEV protection)
```

### Markets

| Market | Exchange | Protocol |
|--------|----------|----------|
| Crypto | Coinbase AgentKit | Base L2 (ERC-4337 smart wallets) |
| Prediction | Polymarket | CLOB API on Polygon |
| Equities | Alpaca | REST + WebSocket |

## Tech Stack

- **Runtime:** TypeScript + Node.js 20
- **Monorepo:** Turborepo + pnpm
- **AI:** Claude Agent SDK + MCP servers
- **Databases:** PostgreSQL (Drizzle ORM) + ClickHouse + Redis
- **Dashboard:** React 19 + Vite + Tailwind + Recharts
- **Testing:** Vitest
- **CI/CD:** GitHub Actions
- **Deployment:** Railway (backend) + Vercel (dashboard)

## Project Structure

```
tradeworks/
  apps/
    engine/      -- Core trading engine (always-on, runs agent orchestration)
    gateway/     -- REST + WebSocket API server
    ingest/      -- Market data ingestion (WebSocket feeds -> ClickHouse)
    dashboard/   -- React monitoring dashboard
  packages/
    shared/      -- Types, Zod schemas, constants
    indicators/  -- Technical analysis (RSI, MACD, Bollinger, Smart Money, etc.)
    strategies/  -- Trading strategies (trend following, arbitrage, momentum, etc.)
    risk/        -- Risk management (position sizing, VaR, circuit breaker)
    backtester/  -- Event-driven backtesting engine
    db/          -- Database layer (Drizzle + ClickHouse + Redis)
    config/      -- Shared tsconfig + eslint
```

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm, Docker

# Clone and install
git clone https://github.com/jstrange22-cell/tradeworks.git
cd tradeworks
pnpm install

# Start databases
docker compose -f docker/docker-compose.yml up -d

# Copy env file
cp .env.paper .env

# Build all packages
pnpm build

# Start dashboard
pnpm --filter @tradeworks/dashboard dev
```

## Risk Management

All hardcoded safety limits:

| Rule | Limit |
|------|-------|
| Max risk per trade | 1% of capital |
| Daily loss cap | 3% of capital |
| Weekly loss cap | 7% of capital |
| Portfolio heat max | 6% total risk |
| Min risk-reward | 1:3 |
| Circuit breaker | Auto-halt on any breach |

## Development

```bash
pnpm build        # Build all packages
pnpm dev          # Start all in dev mode
pnpm test         # Run all tests
pnpm typecheck    # Type check everything
```

## License

Private
