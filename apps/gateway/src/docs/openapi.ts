/**
 * OpenAPI 3.0 specification for the TradeWorks Gateway API.
 * Serves as the single source of truth for all REST endpoints.
 * Mounted at /api/docs via swagger-ui-express.
 */

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'TradeWorks Gateway API',
    version: '0.1.0',
    description:
      'Multi-exchange algorithmic trading platform with AI-powered agents, ' +
      'risk management, Solana DeFi integration, and real-time market data.',
    contact: {
      name: 'TradeWorks',
      url: 'https://github.com/jstrange22-cell/tradeworks',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:4000',
      description: 'Local development',
    },
  ],
  tags: [
    { name: 'Health', description: 'Service health checks' },
    { name: 'Market Data', description: 'Public market data from Crypto.com' },
    { name: 'Instruments', description: 'Tradable instrument discovery (crypto, equities, prediction markets)' },
    { name: 'Portfolio', description: 'Portfolio summary, equity curve, allocation, positions, trades, agents, risk' },
    { name: 'Trades', description: 'Trade history with filtering and pagination' },
    { name: 'Positions', description: 'Open and closed position management' },
    { name: 'Strategies', description: 'Strategy CRUD, templates, and toggle' },
    { name: 'Risk', description: 'Risk metrics, history, limits, and circuit breaker' },
    { name: 'Agents', description: 'AI trading agent status, cycles, and logs' },
    { name: 'Backtest', description: 'Backtesting submission and results' },
    { name: 'Orders', description: 'Order placement and routing' },
    { name: 'Engine', description: 'Trading engine start/stop, config, cycles, and circuit breaker' },
    { name: 'Settings', description: 'General settings and risk limit guardrails' },
    { name: 'API Keys', description: 'Exchange API key management (add, list, delete, test)' },
    { name: 'Balances', description: 'Per-exchange balance breakdown' },
    { name: 'Asset Protection', description: 'Protect existing holdings from the trading engine' },
    { name: 'Journal', description: 'Trade journal CRUD with tags and emotional tracking' },
    { name: 'Robinhood', description: 'Robinhood Crypto API integration' },
    { name: 'Solana - Wallet', description: 'Solana wallet connection and balances' },
    { name: 'Solana - Swap', description: 'Token swaps via Jupiter V6 aggregator' },
    { name: 'Solana - Scanner', description: 'Token scanner, trending, and safety checks' },
    { name: 'Solana - Pump.fun', description: 'pump.fun real-time launch monitor' },
    { name: 'Solana - Sniper', description: 'Autonomous token sniping engine' },
    { name: 'Solana - Whales', description: 'Whale wallet tracking and copy-trade' },
    { name: 'Solana - Moonshot', description: 'Multi-factor moonshot scoring AI' },
  ],

  // ────────────────────────────────────────────────────────────────────────
  // PATHS
  // ────────────────────────────────────────────────────────────────────────

  paths: {
    // ── Health ──────────────────────────────────────────────────────────
    '/api/v1/health': {
      get: {
        tags: ['Health'],
        summary: 'Basic health check',
        description: 'Returns service status, uptime, and connectivity for database, Redis, engine, and ingest.',
        responses: {
          200: {
            description: 'Health status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: {
                  status: 'healthy',
                  version: '0.1.0',
                  timestamp: '2026-03-10T12:00:00.000Z',
                  uptime: { seconds: 3600, formatted: '1h 0m 0s' },
                  environment: 'development',
                  services: {
                    gateway: 'running',
                    engine: 'running',
                    ingest: 'running',
                    database: 'connected',
                    redis: 'connected',
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/health/detailed': {
      get: {
        tags: ['Health'],
        summary: 'Detailed health check',
        description: 'Returns per-service latency, pool stats, and memory usage for internal monitoring.',
        responses: {
          200: {
            description: 'Detailed health status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DetailedHealthResponse' },
              },
            },
          },
        },
      },
    },

    // ── Market Data ────────────────────────────────────────────────────
    '/api/v1/market/tickers': {
      get: {
        tags: ['Market Data'],
        summary: 'Get ticker(s)',
        description: 'Proxies Crypto.com public API. Returns ticker data for one or all instruments.',
        parameters: [
          {
            name: 'instrument_name',
            in: 'query',
            description: 'Crypto.com instrument name (e.g. BTC_USDT). Omit for all tickers.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Ticker data from Crypto.com' },
          502: { description: 'Upstream API error' },
        },
      },
    },

    '/api/v1/market/candlestick': {
      get: {
        tags: ['Market Data'],
        summary: 'Get candlestick data',
        description: 'Returns OHLCV candlestick data for a given instrument and timeframe.',
        parameters: [
          { name: 'instrument_name', in: 'query', required: true, schema: { type: 'string' }, description: 'e.g. BTC_USDT' },
          { name: 'timeframe', in: 'query', schema: { type: 'string', default: '1h' }, description: 'e.g. 1m, 5m, 15m, 1h, 4h, 1D' },
        ],
        responses: {
          200: { description: 'Candlestick data' },
          400: { description: 'Missing instrument_name' },
          502: { description: 'Upstream API error' },
        },
      },
    },

    '/api/v1/market/book': {
      get: {
        tags: ['Market Data'],
        summary: 'Get order book',
        description: 'Returns order book bids and asks for an instrument.',
        parameters: [
          { name: 'instrument_name', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'depth', in: 'query', schema: { type: 'string', default: '10' } },
        ],
        responses: {
          200: { description: 'Order book data' },
          400: { description: 'Missing instrument_name' },
          502: { description: 'Upstream API error' },
        },
      },
    },

    '/api/v1/market/trades': {
      get: {
        tags: ['Market Data'],
        summary: 'Get recent market trades',
        description: 'Returns recent public trades for an instrument.',
        parameters: [
          { name: 'instrument_name', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'count', in: 'query', schema: { type: 'string', default: '20' } },
        ],
        responses: {
          200: { description: 'Recent trades' },
          400: { description: 'Missing instrument_name' },
          502: { description: 'Upstream API error' },
        },
      },
    },

    // ── Instruments ────────────────────────────────────────────────────
    '/api/v1/market/instruments': {
      get: {
        tags: ['Instruments'],
        summary: 'List tradable instruments',
        description: 'Returns available instruments across crypto (Crypto.com), equities (Alpaca), and prediction markets (Polymarket). Supports search and market filtering.',
        parameters: [
          { name: 'market', in: 'query', schema: { type: 'string', enum: ['crypto', 'equities', 'prediction'] }, description: 'Filter by market' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search by symbol or name' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          200: {
            description: 'Instrument list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InstrumentsResponse' },
              },
            },
          },
        },
      },
    },

    // ── Portfolio ──────────────────────────────────────────────────────
    '/api/v1/portfolio': {
      get: {
        tags: ['Portfolio'],
        summary: 'Full portfolio summary',
        description: 'Returns equity, P&L, win rate, open positions, recent trades, and equity curve. Falls back to live exchange balances if DB is unavailable.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Portfolio summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PortfolioSummary' },
              },
            },
          },
        },
      },
    },

    '/api/v1/portfolio/equity-curve': {
      get: {
        tags: ['Portfolio'],
        summary: 'Historical equity values',
        description: 'Returns a 30-day equity curve for charting.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Equity curve data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', format: 'date' },
                          equity: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/portfolio/allocation': {
      get: {
        tags: ['Portfolio'],
        summary: 'Asset allocation breakdown',
        description: 'Returns allocation percentages by market (crypto, equities, prediction, cash).',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Allocation data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/AllocationItem' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/portfolio/positions': {
      get: {
        tags: ['Portfolio'],
        summary: 'Open positions from portfolio view',
        description: 'Returns open positions with summary stats.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Positions with summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PortfolioPositionsResponse' },
              },
            },
          },
        },
      },
    },

    '/api/v1/portfolio/trades': {
      get: {
        tags: ['Portfolio'],
        summary: 'Recent trade history (portfolio view)',
        description: 'Paginated trade history with optional market and strategy filters.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'market', in: 'query', schema: { type: 'string' } },
          { name: 'strategy', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 15 } },
        ],
        responses: {
          200: { description: 'Paginated trades' },
        },
      },
    },

    '/api/v1/portfolio/agents': {
      get: {
        tags: ['Portfolio'],
        summary: 'Agent status from portfolio view',
        description: 'Returns agent status array, recent logs, and cycle history.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Agent status and logs' },
        },
      },
    },

    '/api/v1/portfolio/risk': {
      get: {
        tags: ['Portfolio'],
        summary: 'Risk metrics from portfolio view',
        description: 'Returns equity, VaR, drawdown, portfolio heat, risk limits, and exposure breakdown.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Risk metrics' },
        },
      },
    },

    '/api/v1/portfolio/mode': {
      patch: {
        tags: ['Portfolio'],
        summary: 'Toggle paper/live mode',
        description: 'Switches the portfolio between paper trading and live trading.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: ['paper', 'live'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Mode updated' },
          400: { description: 'Invalid mode value' },
        },
      },
    },

    '/api/v1/portfolio/circuit-breaker': {
      post: {
        tags: ['Portfolio'],
        summary: 'Toggle portfolio circuit breaker',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Circuit breaker toggled' },
        },
      },
    },

    '/api/v1/portfolio/balances': {
      get: {
        tags: ['Balances'],
        summary: 'Exchange balance breakdown',
        description: 'Returns per-exchange (Coinbase, Alpaca, Solana) balance breakdown with total USD value.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Balance breakdown by exchange' },
        },
      },
    },

    // ── Trades ─────────────────────────────────────────────────────────
    '/api/v1/trades': {
      get: {
        tags: ['Trades'],
        summary: 'List trades',
        description: 'Paginated list of trades with optional filters for instrument, side, status, exchange, and date range.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'instrument', in: 'query', schema: { type: 'string' } },
          { name: 'side', in: 'query', schema: { type: 'string', enum: ['buy', 'sell'] } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['filled', 'partial', 'pending', 'cancelled', 'failed', 'simulated'] } },
          { name: 'exchange', in: 'query', schema: { type: 'string', enum: ['coinbase', 'alpaca', 'polymarket'] } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['timestamp', 'instrument', 'pnl', 'quantity'], default: 'timestamp' } },
          { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
        ],
        responses: {
          200: {
            description: 'Paginated trade list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedTradesResponse' },
              },
            },
          },
          400: { description: 'Invalid query parameters' },
        },
      },
    },

    '/api/v1/trades/{id}': {
      get: {
        tags: ['Trades'],
        summary: 'Get trade by ID',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Trade detail' },
          404: { description: 'Trade not found' },
        },
      },
    },

    '/api/v1/trades/stats/summary': {
      get: {
        tags: ['Trades'],
        summary: 'Trade statistics summary',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', default: '30d' }, description: 'e.g. 7d, 30d, 90d' },
        ],
        responses: {
          200: { description: 'Trade statistics' },
        },
      },
    },

    // ── Positions ──────────────────────────────────────────────────────
    '/api/v1/positions': {
      get: {
        tags: ['Positions'],
        summary: 'Get all open positions',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'exchange', in: 'query', schema: { type: 'string' }, description: 'Filter by exchange' },
        ],
        responses: {
          200: {
            description: 'Positions with summary',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PositionsResponse' },
              },
            },
          },
        },
      },
    },

    '/api/v1/positions/{instrument}': {
      get: {
        tags: ['Positions'],
        summary: 'Get position by instrument',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'instrument', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Position detail' },
          404: { description: 'No open position for this instrument' },
        },
      },
    },

    '/api/v1/positions/{id}/close': {
      post: {
        tags: ['Positions'],
        summary: 'Close a position',
        description: 'Close a position fully or partially. Supports market and limit order types.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ClosePositionRequest' },
            },
          },
        },
        responses: {
          200: { description: 'Position closed' },
          400: { description: 'Invalid request' },
        },
      },
    },

    '/api/v1/positions/history/closed': {
      get: {
        tags: ['Positions'],
        summary: 'Recently closed positions',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Closed positions' },
        },
      },
    },

    // ── Strategies ─────────────────────────────────────────────────────
    '/api/v1/strategies': {
      get: {
        tags: ['Strategies'],
        summary: 'List all strategies',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Strategy list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Strategy' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Strategies'],
        summary: 'Create a strategy',
        description: 'Create a new trading strategy. Requires admin or trader role.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateStrategyRequest' },
            },
          },
        },
        responses: {
          201: { description: 'Strategy created' },
          400: { description: 'Invalid strategy definition' },
        },
      },
    },

    '/api/v1/strategies/templates': {
      get: {
        tags: ['Strategies'],
        summary: 'List strategy templates',
        description: 'Returns pre-built strategy templates (BTC Trend, ETH Mean Reversion, etc.).',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Strategy templates' },
        },
      },
    },

    '/api/v1/strategies/from-template': {
      post: {
        tags: ['Strategies'],
        summary: 'Create strategy from template',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['templateId'],
                properties: {
                  templateId: { type: 'string', description: 'Template ID (e.g. tpl-btc-trend)' },
                  name: { type: 'string', description: 'Optional name override' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Strategy created from template' },
          404: { description: 'Template not found' },
        },
      },
    },

    '/api/v1/strategies/{id}': {
      get: {
        tags: ['Strategies'],
        summary: 'Get strategy by ID',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Strategy detail' },
          404: { description: 'Strategy not found' },
        },
      },
      put: {
        tags: ['Strategies'],
        summary: 'Update strategy (full replacement)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateStrategyRequest' },
            },
          },
        },
        responses: {
          200: { description: 'Strategy updated' },
          400: { description: 'Invalid strategy definition' },
        },
      },
      patch: {
        tags: ['Strategies'],
        summary: 'Partially update strategy',
        description: 'Toggle active state, update name, parameters, or risk overrides.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PatchStrategyRequest' },
            },
          },
        },
        responses: {
          200: { description: 'Strategy updated' },
          400: { description: 'Invalid update data' },
        },
      },
      delete: {
        tags: ['Strategies'],
        summary: 'Delete strategy',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          204: { description: 'Deleted' },
        },
      },
    },

    // ── Risk ───────────────────────────────────────────────────────────
    '/api/v1/risk/metrics': {
      get: {
        tags: ['Risk'],
        summary: 'Current risk metrics',
        description: 'Returns portfolio risk metrics including VaR, drawdown, portfolio heat, exposure by market, and circuit breaker state.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Risk metrics',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RiskMetricsResponse' },
              },
            },
          },
        },
      },
    },

    '/api/v1/risk/history': {
      get: {
        tags: ['Risk'],
        summary: 'Historical risk metrics',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', default: '7d' }, description: 'e.g. 1d, 7d, 30d' },
          { name: 'interval', in: 'query', schema: { type: 'string', default: '1h' } },
        ],
        responses: {
          200: { description: 'Historical risk snapshots' },
        },
      },
    },

    '/api/v1/risk/limits': {
      get: {
        tags: ['Risk'],
        summary: 'Get risk limit configuration',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Risk limits',
            content: {
              'application/json': {
                example: {
                  data: {
                    perTradeRiskPercent: 1.0,
                    highConvictionRiskPercent: 1.5,
                    dailyLossLimitPercent: 3.0,
                    portfolioHeatLimitPercent: 6.0,
                    maxDrawdownPercent: 10.0,
                    maxPositionConcentrationPercent: 10.0,
                    maxSectorConcentrationPercent: 25.0,
                    maxCorrelatedPositions: 3,
                    maxLeverage: { crypto: 2.0, equities: 1.0, predictions: 1.0 },
                    maxDailyTrades: 50,
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/v1/risk/circuit-breaker': {
      post: {
        tags: ['Risk'],
        summary: 'Toggle circuit breaker',
        description: 'Manually trip or reset the risk circuit breaker. Admin only.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action'],
                properties: {
                  action: { type: 'string', enum: ['trip', 'reset'] },
                  reason: { type: 'string', maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Circuit breaker toggled' },
          400: { description: 'Invalid request' },
        },
      },
    },

    // ── Agents ─────────────────────────────────────────────────────────
    '/api/v1/agents/status': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent status',
        description: 'Returns current status of all five AI trading agents (Quant, Sentiment, Macro, Risk, Execution) with orchestrator state.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Agent status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentStatusResponse' },
              },
            },
          },
        },
      },
    },

    '/api/v1/agents/cycles': {
      get: {
        tags: ['Agents'],
        summary: 'Get cycle history',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          200: { description: 'Paginated cycle history' },
        },
      },
    },

    '/api/v1/agents/cycles/{cycleId}': {
      get: {
        tags: ['Agents'],
        summary: 'Get cycle detail',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'cycleId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Cycle detail' },
          404: { description: 'Cycle not found' },
        },
      },
    },

    '/api/v1/agents/logs': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent logs',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'agent', in: 'query', schema: { type: 'string' }, description: 'Filter by agent name' },
          { name: 'level', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: { description: 'Agent log entries' },
        },
      },
    },

    // ── Backtest ───────────────────────────────────────────────────────
    '/api/v1/backtest': {
      get: {
        tags: ['Backtest'],
        summary: 'List backtests',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'strategyId', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: { description: 'Backtest list' },
        },
      },
      post: {
        tags: ['Backtest'],
        summary: 'Submit a backtest',
        description: 'Submits a backtest job. Rate limited. Returns a job ID to poll for results.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BacktestRequest' },
            },
          },
        },
        responses: {
          202: { description: 'Backtest job submitted' },
          400: { description: 'Invalid backtest configuration' },
        },
      },
    },

    '/api/v1/backtest/{id}': {
      get: {
        tags: ['Backtest'],
        summary: 'Get backtest results',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Backtest results' },
          404: { description: 'Backtest not found' },
        },
      },
    },

    // ── Orders ─────────────────────────────────────────────────────────
    '/api/v1/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Place a new order',
        description: 'Routes the order to the appropriate exchange based on instrument/market. Supports market, limit, stop, and stop-limit orders.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderRequest' },
            },
          },
        },
        responses: {
          201: { description: 'Order placed' },
          400: { description: 'Invalid order' },
          422: { description: 'Order rejected by exchange' },
        },
      },
    },

    // ── Engine ─────────────────────────────────────────────────────────
    '/api/v1/engine/status': {
      get: {
        tags: ['Engine'],
        summary: 'Get engine status',
        description: 'Returns engine running state, cycle count, config, Coinbase connectivity, and circuit breaker state.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Engine status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EngineStatusResponse' },
              },
            },
          },
        },
      },
    },

    '/api/v1/engine/start': {
      post: {
        tags: ['Engine'],
        summary: 'Start the trading engine',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Engine started' },
          400: { description: 'Engine is already running' },
        },
      },
    },

    '/api/v1/engine/stop': {
      post: {
        tags: ['Engine'],
        summary: 'Stop the trading engine',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Engine stopped' },
          400: { description: 'Engine is already stopped' },
        },
      },
    },

    '/api/v1/engine/config': {
      patch: {
        tags: ['Engine'],
        summary: 'Update engine configuration',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EngineConfigUpdate' },
            },
          },
        },
        responses: {
          200: { description: 'Config updated' },
          400: { description: 'Invalid config' },
        },
      },
    },

    '/api/v1/engine/cycles': {
      get: {
        tags: ['Engine'],
        summary: 'Get engine cycle history',
        description: 'Returns recent analysis cycles with full agent outputs, decisions, and executions.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          200: { description: 'Cycle history' },
        },
      },
    },

    '/api/v1/engine/test-coinbase': {
      get: {
        tags: ['Engine'],
        summary: 'Test Coinbase connection',
        description: 'Manually tests the Coinbase API connection using stored CDP keys.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Connection test result' },
        },
      },
    },

    '/api/v1/engine/circuit-breaker': {
      get: {
        tags: ['Engine'],
        summary: 'Get engine circuit breaker state',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Circuit breaker state',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EngineCircuitBreakerState' },
              },
            },
          },
        },
      },
    },

    '/api/v1/engine/circuit-breaker/reset': {
      post: {
        tags: ['Engine'],
        summary: 'Reset engine circuit breaker',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Circuit breaker reset' },
          400: { description: 'Circuit breaker is not tripped' },
        },
      },
    },

    '/api/v1/engine/circuit-breaker/trip': {
      post: {
        tags: ['Engine'],
        summary: 'Manually trip engine circuit breaker',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Circuit breaker tripped' },
          400: { description: 'Circuit breaker is already tripped' },
        },
      },
    },

    // ── Settings ───────────────────────────────────────────────────────
    '/api/v1/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get all settings',
        description: 'Returns combined general settings and risk guardrails.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Settings object' },
        },
      },
      put: {
        tags: ['Settings'],
        summary: 'Update general settings',
        description: 'Partial merge update for paper trading mode, cycle interval, and notifications.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GeneralSettingsUpdate' },
            },
          },
        },
        responses: {
          200: { description: 'Settings updated' },
          400: { description: 'Invalid settings' },
        },
      },
    },

    '/api/v1/settings/risk-limits': {
      get: {
        tags: ['Settings'],
        summary: 'Get risk limit guardrails',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Risk limits' },
        },
      },
      put: {
        tags: ['Settings'],
        summary: 'Update risk limit guardrails',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RiskLimitsUpdate' },
            },
          },
        },
        responses: {
          200: { description: 'Risk limits updated' },
          400: { description: 'Invalid risk limits' },
        },
      },
    },

    // ── API Keys ───────────────────────────────────────────────────────
    '/api/v1/settings/api-keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys (masked)',
        description: 'Returns all stored exchange API keys with masked values. Never exposes raw secrets.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Masked API key list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/MaskedApiKey' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Add a new API key',
        description: 'Encrypts and stores a new exchange API key. Supports Coinbase, Alpaca, Polymarket, Solana, and Robinhood.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateApiKeyRequest' },
            },
          },
        },
        responses: {
          201: { description: 'API key created' },
          400: { description: 'Invalid API key data' },
        },
      },
    },

    '/api/v1/settings/api-keys/{id}': {
      delete: {
        tags: ['API Keys'],
        summary: 'Delete an API key',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          204: { description: 'Deleted' },
        },
      },
    },

    '/api/v1/settings/api-keys/{id}/test': {
      post: {
        tags: ['API Keys'],
        summary: 'Test exchange connection',
        description: 'Decrypts the key and makes a test API call to the respective exchange.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Test result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          404: { description: 'API key not found' },
        },
      },
    },

    // ── Asset Protection ───────────────────────────────────────────────
    '/api/v1/settings/asset-protection': {
      get: {
        tags: ['Asset Protection'],
        summary: 'Get asset protection config',
        description: 'Returns engine trading toggle, budget, protected assets, and engine-owned positions.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Asset protection configuration' },
        },
      },
      put: {
        tags: ['Asset Protection'],
        summary: 'Update asset protection config',
        description: 'Toggle engine trading, set budget, lock/unlock individual assets.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AssetProtectionUpdate' },
            },
          },
        },
        responses: {
          200: { description: 'Config updated' },
        },
      },
    },

    '/api/v1/settings/asset-protection/snapshot': {
      post: {
        tags: ['Asset Protection'],
        summary: 'Snapshot current holdings',
        description: 'Fetches current exchange balances and creates a snapshot. All non-USD assets are locked by default.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Snapshot created' },
        },
      },
    },

    // ── Journal ────────────────────────────────────────────────────────
    '/api/v1/journal': {
      get: {
        tags: ['Journal'],
        summary: 'List journal entries',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start date for range filter' },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'End date for range filter' },
          { name: 'tag', in: 'query', schema: { type: 'string' }, description: 'Filter by tag' },
        ],
        responses: {
          200: { description: 'Journal entries' },
        },
      },
      post: {
        tags: ['Journal'],
        summary: 'Create journal entry',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateJournalRequest' },
            },
          },
        },
        responses: {
          201: { description: 'Entry created' },
          400: { description: 'Invalid data' },
        },
      },
    },

    '/api/v1/journal/tags': {
      get: {
        tags: ['Journal'],
        summary: 'Get tag statistics',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Tag usage stats' },
        },
      },
    },

    '/api/v1/journal/trade/{tradeId}': {
      get: {
        tags: ['Journal'],
        summary: 'Get journal entry by linked trade',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tradeId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Journal entry' },
          404: { description: 'No entry for this trade' },
        },
      },
    },

    '/api/v1/journal/{id}': {
      get: {
        tags: ['Journal'],
        summary: 'Get journal entry',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Journal entry' },
          404: { description: 'Not found' },
        },
      },
      patch: {
        tags: ['Journal'],
        summary: 'Update journal entry',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateJournalRequest' },
            },
          },
        },
        responses: {
          200: { description: 'Entry updated' },
          400: { description: 'Invalid data' },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Journal'],
        summary: 'Delete journal entry',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          204: { description: 'Deleted' },
        },
      },
    },

    // ── Robinhood ──────────────────────────────────────────────────────
    '/api/v1/robinhood/account': {
      get: {
        tags: ['Robinhood'],
        summary: 'Get Robinhood account info',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Account info and holdings' },
          401: { description: 'No Robinhood API keys configured' },
        },
      },
    },

    '/api/v1/robinhood/holdings': {
      get: {
        tags: ['Robinhood'],
        summary: 'Get crypto holdings',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Crypto holdings' },
        },
      },
    },

    '/api/v1/robinhood/prices': {
      get: {
        tags: ['Robinhood'],
        summary: 'Get crypto prices',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Current crypto prices' },
        },
      },
    },

    '/api/v1/robinhood/order': {
      post: {
        tags: ['Robinhood'],
        summary: 'Place crypto order',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['symbol', 'side', 'quantity'],
                properties: {
                  symbol: { type: 'string', description: 'e.g. BTC' },
                  side: { type: 'string', enum: ['buy', 'sell'] },
                  quantity: { type: 'number' },
                  type: { type: 'string', enum: ['market', 'limit'], default: 'market' },
                  price: { type: 'number', description: 'Required for limit orders' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Order placed' },
          400: { description: 'Invalid order' },
        },
      },
    },

    // ── Solana: Wallet & Balances ──────────────────────────────────────
    '/api/v1/solana/wallet': {
      get: {
        tags: ['Solana - Wallet'],
        summary: 'Wallet connection status',
        description: 'Returns whether a Solana bot wallet is configured and its public key.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Wallet status',
            content: {
              'application/json': {
                example: { connected: true, wallet: 'ABC1...xyz4', rpcUrl: 'https://api.mainnet-beta.solana.com' },
              },
            },
          },
        },
      },
    },

    '/api/v1/solana/balances': {
      get: {
        tags: ['Solana - Wallet'],
        summary: 'Get Solana balances',
        description: 'Returns SOL balance and all SPL token balances with USD values via Jupiter price API.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Balance breakdown',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SolanaBalanceResponse' },
              },
            },
          },
          400: { description: 'No Solana wallet configured' },
        },
      },
    },

    // ── Solana: Swap ──────────────────────────────────────────────────
    '/api/v1/solana/quote': {
      get: {
        tags: ['Solana - Swap'],
        summary: 'Get swap quote',
        description: 'Gets a Jupiter V6 quote for a token swap.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'inputMint', in: 'query', required: true, schema: { type: 'string' }, description: 'Input token mint address' },
          { name: 'outputMint', in: 'query', required: true, schema: { type: 'string' }, description: 'Output token mint address' },
          { name: 'amount', in: 'query', required: true, schema: { type: 'string' }, description: 'Input amount in smallest units (lamports)' },
          { name: 'slippageBps', in: 'query', schema: { type: 'string', default: '300' }, description: 'Slippage tolerance in basis points' },
        ],
        responses: {
          200: { description: 'Jupiter swap quote' },
          400: { description: 'Missing required params' },
        },
      },
    },

    '/api/v1/solana/swap': {
      post: {
        tags: ['Solana - Swap'],
        summary: 'Execute swap',
        description: 'Executes a token swap via Jupiter V6 using the bot wallet. Gets quote, builds transaction, signs, and confirms.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SolanaSwapRequest' },
            },
          },
        },
        responses: {
          200: { description: 'Swap executed' },
          400: { description: 'Invalid request or wallet not configured' },
        },
      },
    },

    '/api/v1/solana/swap/{signature}': {
      get: {
        tags: ['Solana - Swap'],
        summary: 'Check transaction status',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'signature', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Transaction status' },
        },
      },
    },

    // ── Solana: Scanner ───────────────────────────────────────────────
    '/api/v1/solana/trending': {
      get: {
        tags: ['Solana - Scanner'],
        summary: 'Trending tokens',
        description: 'Returns trending Solana tokens from Dexscreener.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Trending token list' },
        },
      },
    },

    '/api/v1/solana/new-tokens': {
      get: {
        tags: ['Solana - Scanner'],
        summary: 'Recently launched tokens',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'New token list' },
        },
      },
    },

    '/api/v1/solana/token/{mint}': {
      get: {
        tags: ['Solana - Scanner'],
        summary: 'Token detail and safety check',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'mint', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Token detail with safety score' },
          404: { description: 'Token not found' },
        },
      },
    },

    '/api/v1/solana/token/{mint}/price': {
      get: {
        tags: ['Solana - Scanner'],
        summary: 'Token price chart data',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'mint', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Price chart data' },
        },
      },
    },

    // ── Solana: pump.fun ──────────────────────────────────────────────
    '/api/v1/solana/pumpfun/latest': {
      get: {
        tags: ['Solana - Pump.fun'],
        summary: 'Latest pump.fun launches',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: 'Recent pump.fun token launches' },
        },
      },
    },

    '/api/v1/solana/pumpfun/token/{mint}': {
      get: {
        tags: ['Solana - Pump.fun'],
        summary: 'Token bonding curve status',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'mint', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Bonding curve info' },
        },
      },
    },

    '/api/v1/solana/pumpfun/monitor/start': {
      post: {
        tags: ['Solana - Pump.fun'],
        summary: 'Start real-time monitor',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Monitor started' } },
      },
    },

    '/api/v1/solana/pumpfun/monitor/stop': {
      post: {
        tags: ['Solana - Pump.fun'],
        summary: 'Stop real-time monitor',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Monitor stopped' } },
      },
    },

    '/api/v1/solana/pumpfun/monitor/status': {
      get: {
        tags: ['Solana - Pump.fun'],
        summary: 'Monitor status',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Monitor running state and stats' } },
      },
    },

    // ── Solana: Sniper ────────────────────────────────────────────────
    '/api/v1/solana/sniper/config': {
      get: {
        tags: ['Solana - Sniper'],
        summary: 'Get sniper configuration',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Sniper config' } },
      },
      put: {
        tags: ['Solana - Sniper'],
        summary: 'Update sniper configuration',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  maxBuySol: { type: 'number', description: 'Max SOL per snipe' },
                  takeProfitMultiplier: { type: 'number' },
                  stopLossPercent: { type: 'number' },
                  maxDailySnipes: { type: 'integer' },
                  priorityFeeLamports: { type: 'integer' },
                  autoSell: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Config updated' } },
      },
    },

    '/api/v1/solana/sniper/start': {
      post: {
        tags: ['Solana - Sniper'],
        summary: 'Start auto-sniper',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Sniper started' } },
      },
    },

    '/api/v1/solana/sniper/stop': {
      post: {
        tags: ['Solana - Sniper'],
        summary: 'Stop auto-sniper',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Sniper stopped' } },
      },
    },

    '/api/v1/solana/sniper/status': {
      get: {
        tags: ['Solana - Sniper'],
        summary: 'Sniper status and active positions',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Sniper status with positions' } },
      },
    },

    '/api/v1/solana/sniper/execute': {
      post: {
        tags: ['Solana - Sniper'],
        summary: 'Manual single snipe',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mint'],
                properties: {
                  mint: { type: 'string', description: 'Token mint address to snipe' },
                  amountSol: { type: 'number', description: 'SOL amount to spend' },
                  slippageBps: { type: 'integer', default: 1000 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Snipe executed' },
          400: { description: 'Invalid request' },
        },
      },
    },

    '/api/v1/solana/sniper/history': {
      get: {
        tags: ['Solana - Sniper'],
        summary: 'Snipe execution history',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Snipe history' } },
      },
    },

    // ── Solana: Whales ────────────────────────────────────────────────
    '/api/v1/solana/whales/list': {
      get: {
        tags: ['Solana - Whales'],
        summary: 'List tracked whale wallets',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Tracked whale list' } },
      },
    },

    '/api/v1/solana/whales/add': {
      post: {
        tags: ['Solana - Whales'],
        summary: 'Add whale wallet to track',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['address'],
                properties: {
                  address: { type: 'string', description: 'Solana wallet address' },
                  label: { type: 'string', description: 'Friendly label' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Whale added' } },
      },
    },

    '/api/v1/solana/whales/{address}': {
      delete: {
        tags: ['Solana - Whales'],
        summary: 'Remove tracked whale',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'address', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Removed' } },
      },
    },

    '/api/v1/solana/whales/activity': {
      get: {
        tags: ['Solana - Whales'],
        summary: 'Recent whale activity feed',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Whale activity' } },
      },
    },

    '/api/v1/solana/whales/monitor/start': {
      post: {
        tags: ['Solana - Whales'],
        summary: 'Start whale monitoring',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Monitor started' } },
      },
    },

    '/api/v1/solana/whales/monitor/stop': {
      post: {
        tags: ['Solana - Whales'],
        summary: 'Stop whale monitoring',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Monitor stopped' } },
      },
    },

    '/api/v1/solana/whales/monitor/status': {
      get: {
        tags: ['Solana - Whales'],
        summary: 'Whale monitor status',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Monitor status' } },
      },
    },

    '/api/v1/solana/whales/leaderboard': {
      get: {
        tags: ['Solana - Whales'],
        summary: 'Top whale wallets by activity',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Whale leaderboard' } },
      },
    },

    '/api/v1/solana/whales/copy-trade': {
      get: {
        tags: ['Solana - Whales'],
        summary: 'Get copy-trade settings',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Copy-trade configuration' } },
      },
      put: {
        tags: ['Solana - Whales'],
        summary: 'Configure copy-trade settings',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  maxSolPerTrade: { type: 'number' },
                  maxDailyTrades: { type: 'integer' },
                  minWhaleConfidence: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Settings updated' } },
      },
    },

    // ── Solana: Moonshot ──────────────────────────────────────────────
    '/api/v1/solana/moonshot/score': {
      post: {
        tags: ['Solana - Moonshot'],
        summary: 'Score a single token',
        description: 'Multi-factor scoring combining on-chain data, social signals, volume patterns, and rug detection into a 0-100 score.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['mint'],
                properties: {
                  mint: { type: 'string', description: 'Token mint address' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Moonshot score' } },
      },
    },

    '/api/v1/solana/moonshot/scan': {
      post: {
        tags: ['Solana - Moonshot'],
        summary: 'Scan and score trending tokens',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Scored token list' } },
      },
    },

    '/api/v1/solana/moonshot/leaderboard': {
      get: {
        tags: ['Solana - Moonshot'],
        summary: 'Top scored tokens',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Moonshot leaderboard' } },
      },
    },

    '/api/v1/solana/moonshot/alerts': {
      get: {
        tags: ['Solana - Moonshot'],
        summary: 'Recent high-score alerts',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Alert list' } },
      },
    },

    '/api/v1/solana/moonshot/config': {
      get: {
        tags: ['Solana - Moonshot'],
        summary: 'Get scoring config',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Scoring weights and thresholds' } },
      },
      put: {
        tags: ['Solana - Moonshot'],
        summary: 'Update scoring weights',
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  liquidityWeight: { type: 'number' },
                  volumeWeight: { type: 'number' },
                  holderWeight: { type: 'number' },
                  socialWeight: { type: 'number' },
                  safetyWeight: { type: 'number' },
                  minScore: { type: 'integer', description: 'Minimum score for alerts' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Config updated' } },
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // COMPONENTS
  // ────────────────────────────────────────────────────────────────────────

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT authentication. In development mode, auth is bypassed with a dev user.',
      },
    },

    schemas: {
      // ── Health ────────────────────────────────────────────────────
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'degraded'] },
          version: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          uptime: {
            type: 'object',
            properties: {
              seconds: { type: 'integer' },
              formatted: { type: 'string' },
            },
          },
          environment: { type: 'string' },
          services: {
            type: 'object',
            properties: {
              gateway: { type: 'string' },
              engine: { type: 'string' },
              ingest: { type: 'string' },
              database: { type: 'string', enum: ['connected', 'disconnected'] },
              redis: { type: 'string', enum: ['connected', 'disconnected'] },
            },
          },
        },
      },

      DetailedHealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          checks: { type: 'object', additionalProperties: true },
          pool: {
            type: 'object',
            properties: {
              totalCount: { type: 'integer' },
              idleCount: { type: 'integer' },
              waitingCount: { type: 'integer' },
            },
          },
          memory: {
            type: 'object',
            properties: {
              rss: { type: 'string' },
              heapUsed: { type: 'string' },
              heapTotal: { type: 'string' },
              external: { type: 'string' },
            },
          },
          uptime: { type: 'string' },
        },
      },

      // ── Instruments ──────────────────────────────────────────────
      InstrumentsResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string', example: 'BTC-USD' },
                displayName: { type: 'string', example: 'BTC / USD' },
                market: { type: 'string', enum: ['crypto', 'equities', 'prediction'] },
                exchange: { type: 'string' },
                tradable: { type: 'boolean' },
              },
            },
          },
          total: { type: 'integer' },
          cached: { type: 'boolean' },
        },
      },

      // ── Portfolio ────────────────────────────────────────────────
      PortfolioSummary: {
        type: 'object',
        properties: {
          equity: { type: 'number', example: 105000 },
          initialCapital: { type: 'number', example: 100000 },
          dailyPnl: { type: 'number' },
          dailyPnlPercent: { type: 'number' },
          weeklyPnl: { type: 'number' },
          totalPnl: { type: 'number' },
          winRate: { type: 'number' },
          totalTrades: { type: 'integer' },
          openPositions: { type: 'array', items: { $ref: '#/components/schemas/Position' } },
          recentTrades: { type: 'array', items: { $ref: '#/components/schemas/Trade' } },
          equityCurve: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, equity: { type: 'number' } } } },
          paperTrading: { type: 'boolean' },
          circuitBreaker: { type: 'boolean' },
        },
      },

      AllocationItem: {
        type: 'object',
        properties: {
          market: { type: 'string' },
          value: { type: 'number' },
          percent: { type: 'number' },
        },
      },

      PortfolioPositionsResponse: {
        type: 'object',
        properties: {
          positions: { type: 'array', items: { $ref: '#/components/schemas/Position' } },
          summary: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              totalUnrealizedPnl: { type: 'number' },
              markets: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },

      Position: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          instrument: { type: 'string', example: 'BTC-USD' },
          market: { type: 'string' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          quantity: { type: 'number' },
          averageEntry: { type: 'number' },
          currentPrice: { type: 'number' },
          unrealizedPnl: { type: 'number' },
          realizedPnl: { type: 'number' },
          strategyId: { type: 'string', nullable: true },
          openedAt: { type: 'string', format: 'date-time' },
        },
      },

      Trade: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          instrument: { type: 'string' },
          market: { type: 'string' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          quantity: { type: 'number' },
          price: { type: 'number' },
          pnl: { type: 'number' },
          strategyId: { type: 'string', nullable: true },
          executedAt: { type: 'string', format: 'date-time' },
        },
      },

      // ── Trades ───────────────────────────────────────────────────
      PaginatedTradesResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Trade' } },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
              hasNext: { type: 'boolean' },
              hasPrev: { type: 'boolean' },
            },
          },
        },
      },

      // ── Positions ────────────────────────────────────────────────
      PositionsResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Position' } },
          summary: {
            type: 'object',
            properties: {
              totalValue: { type: 'number' },
              totalUnrealizedPnl: { type: 'number' },
              positionCount: { type: 'integer' },
            },
          },
        },
      },

      ClosePositionRequest: {
        type: 'object',
        properties: {
          quantity: { type: 'number', description: 'Omit to close entire position' },
          type: { type: 'string', enum: ['market', 'limit'], default: 'market' },
          price: { type: 'number', description: 'Required for limit orders' },
        },
      },

      // ── Strategies ───────────────────────────────────────────────
      Strategy: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          market: { type: 'string' },
          strategyType: { type: 'string' },
          enabled: { type: 'boolean' },
          params: { type: 'object', additionalProperties: true },
          riskPerTrade: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },

      CreateStrategyRequest: {
        type: 'object',
        required: ['name', 'type', 'instruments', 'timeframes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          type: { type: 'string', enum: ['momentum', 'mean_reversion', 'breakout', 'smc', 'sentiment', 'macro', 'custom'] },
          instruments: { type: 'array', items: { type: 'string' }, minItems: 1 },
          timeframes: { type: 'array', items: { type: 'string' }, minItems: 1 },
          parameters: { type: 'object', additionalProperties: true },
          riskOverrides: {
            type: 'object',
            properties: {
              maxRiskPercent: { type: 'number', minimum: 0.1, maximum: 3.0 },
              maxPositionSize: { type: 'number' },
              maxDailyTrades: { type: 'integer' },
            },
          },
          active: { type: 'boolean', default: false },
        },
      },

      PatchStrategyRequest: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          name: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object', additionalProperties: true },
          riskOverrides: { type: 'object', additionalProperties: true },
        },
      },

      // ── Risk ─────────────────────────────────────────────────────
      RiskMetricsResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              timestamp: { type: 'string', format: 'date-time' },
              portfolio: {
                type: 'object',
                properties: {
                  equity: { type: 'number' },
                  cash: { type: 'number' },
                  marginUsed: { type: 'number' },
                  marginAvailable: { type: 'number' },
                  buyingPower: { type: 'number' },
                },
              },
              risk: {
                type: 'object',
                properties: {
                  portfolioHeat: { type: 'number' },
                  dailyPnl: { type: 'number' },
                  maxDrawdown: { type: 'number' },
                  valueAtRisk1Day: { type: 'number' },
                  valueAtRisk5Day: { type: 'number' },
                  sharpeRatio: { type: 'number' },
                },
              },
              positions: {
                type: 'object',
                properties: {
                  totalOpen: { type: 'integer' },
                  totalValue: { type: 'number' },
                  unrealizedPnl: { type: 'number' },
                  biggestWinner: { type: 'string', nullable: true },
                  biggestLoser: { type: 'string', nullable: true },
                },
              },
              circuitBreaker: {
                type: 'object',
                properties: {
                  tripped: { type: 'boolean' },
                  reason: { type: 'string', nullable: true },
                },
              },
              exposure: {
                type: 'object',
                properties: {
                  crypto: { type: 'number' },
                  equities: { type: 'number' },
                  predictions: { type: 'number' },
                  cash: { type: 'number' },
                },
              },
            },
          },
        },
      },

      // ── Agents ───────────────────────────────────────────────────
      AgentStatusResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', example: 'Quant Analyst' },
                model: { type: 'string', example: 'sonnet' },
                status: { type: 'string', enum: ['idle', 'analyzing', 'deciding', 'executing'] },
                lastRunAt: { type: 'string', format: 'date-time', nullable: true },
                lastDurationMs: { type: 'integer', nullable: true },
                totalRuns: { type: 'integer' },
                errorCount: { type: 'integer' },
                tools: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          orchestrator: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['idle', 'running', 'analyzing'] },
              cycleCount: { type: 'integer' },
              cycleIntervalMs: { type: 'integer' },
              lastCycleAt: { type: 'string', nullable: true },
              nextCycleAt: { type: 'string', nullable: true },
              cycleInProgress: { type: 'boolean' },
            },
          },
          lastCycle: { type: 'object', nullable: true },
        },
      },

      // ── Backtest ─────────────────────────────────────────────────
      BacktestRequest: {
        type: 'object',
        required: ['instruments', 'startDate', 'endDate'],
        properties: {
          strategyId: { type: 'string' },
          strategy: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['momentum', 'mean_reversion', 'breakout', 'smc', 'sentiment', 'macro', 'custom'] },
              parameters: { type: 'object', additionalProperties: true },
            },
          },
          instruments: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          initialCapital: { type: 'number', default: 100000 },
          commission: { type: 'number', default: 0.001 },
          slippage: { type: 'number', default: 0.0005 },
          riskSettings: {
            type: 'object',
            properties: {
              maxRiskPercent: { type: 'number', default: 1.0 },
              maxDrawdownPercent: { type: 'number', default: 10.0 },
              maxPositionSizePercent: { type: 'number', default: 10.0 },
            },
          },
        },
      },

      // ── Orders ───────────────────────────────────────────────────
      OrderRequest: {
        type: 'object',
        required: ['instrument', 'side', 'quantity'],
        properties: {
          instrument: { type: 'string', example: 'BTC-USD' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          quantity: { type: 'number', example: 0.01 },
          orderType: { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'], default: 'market' },
          price: { type: 'number', description: 'Required for limit/stop_limit orders' },
          stopPrice: { type: 'number', description: 'Required for stop/stop_limit orders' },
          market: { type: 'string', enum: ['crypto', 'equities', 'prediction'] },
        },
      },

      // ── Engine ───────────────────────────────────────────────────
      EngineStatusResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['running', 'stopped', 'starting', 'stopping'] },
              startedAt: { type: 'string', nullable: true },
              cycleCount: { type: 'integer' },
              lastCycleAt: { type: 'string', nullable: true },
              config: {
                type: 'object',
                properties: {
                  cycleIntervalMs: { type: 'integer', example: 300000 },
                  markets: { type: 'array', items: { type: 'string' } },
                  paperMode: { type: 'boolean' },
                },
              },
              uptime: { type: 'integer', description: 'Milliseconds since engine started' },
              coinbaseConnected: { type: 'boolean' },
              coinbaseAccounts: { type: 'integer' },
              circuitBreaker: { $ref: '#/components/schemas/EngineCircuitBreakerState' },
            },
          },
        },
      },

      EngineConfigUpdate: {
        type: 'object',
        properties: {
          cycleIntervalMs: { type: 'integer', minimum: 10000, maximum: 3600000 },
          markets: { type: 'array', items: { type: 'string', enum: ['crypto', 'equities', 'prediction'] } },
          paperMode: { type: 'boolean' },
        },
      },

      EngineCircuitBreakerState: {
        type: 'object',
        properties: {
          tripped: { type: 'boolean' },
          reason: { type: 'string', nullable: true },
          trippedAt: { type: 'string', nullable: true },
          canResumeAt: { type: 'string', nullable: true },
          stats: {
            type: 'object',
            properties: {
              dailyLossPercent: { type: 'number' },
              consecutiveLosses: { type: 'integer' },
              consecutiveErrors: { type: 'integer' },
              cyclesSinceTrip: { type: 'integer' },
            },
          },
        },
      },

      // ── Settings ─────────────────────────────────────────────────
      GeneralSettingsUpdate: {
        type: 'object',
        properties: {
          paperTrading: { type: 'boolean' },
          cycleIntervalSeconds: { type: 'integer', minimum: 60, maximum: 3600 },
          notifications: {
            type: 'object',
            properties: {
              onTrade: { type: 'boolean' },
              onCircuitBreaker: { type: 'boolean' },
              onError: { type: 'boolean' },
              onDailyReport: { type: 'boolean' },
            },
          },
        },
      },

      RiskLimitsUpdate: {
        type: 'object',
        properties: {
          maxRiskPerTrade: { type: 'number', minimum: 0.1, maximum: 5 },
          dailyLossCap: { type: 'number', minimum: 1, maximum: 10 },
          weeklyLossCap: { type: 'number', minimum: 2, maximum: 20 },
          maxPortfolioHeat: { type: 'number', minimum: 1, maximum: 15 },
          minRiskReward: { type: 'number', minimum: 1, maximum: 10 },
          maxCorrelation: { type: 'number', minimum: 10, maximum: 100 },
        },
      },

      // ── API Keys ─────────────────────────────────────────────────
      MaskedApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          service: { type: 'string', enum: ['coinbase', 'alpaca', 'polymarket', 'solana', 'robinhood'] },
          keyName: { type: 'string' },
          maskedKey: { type: 'string', example: 'organiza...4f2e' },
          environment: { type: 'string', enum: ['production', 'sandbox', 'testnet'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },

      CreateApiKeyRequest: {
        type: 'object',
        required: ['service', 'keyName', 'apiKey'],
        properties: {
          service: { type: 'string', enum: ['coinbase', 'alpaca', 'polymarket', 'solana', 'robinhood'] },
          keyName: { type: 'string', description: 'Friendly name for the key' },
          apiKey: { type: 'string', description: 'Raw API key value' },
          apiSecret: { type: 'string', description: 'API secret (if applicable)' },
          environment: { type: 'string', enum: ['production', 'sandbox', 'testnet'], default: 'sandbox' },
        },
      },

      // ── Asset Protection ─────────────────────────────────────────
      AssetProtectionUpdate: {
        type: 'object',
        properties: {
          engineTradingEnabled: { type: 'boolean' },
          tradingBudgetUsd: { type: 'number' },
          protectedAssets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                locked: { type: 'boolean' },
              },
            },
          },
        },
      },

      // ── Journal ──────────────────────────────────────────────────
      CreateJournalRequest: {
        type: 'object',
        properties: {
          tradeId: { type: 'string', format: 'uuid', nullable: true },
          instrument: { type: 'string', nullable: true },
          market: { type: 'string', enum: ['crypto', 'equities', 'forex', 'futures', 'options'], nullable: true },
          side: { type: 'string', enum: ['buy', 'sell'], nullable: true },
          entryPrice: { type: 'string', nullable: true },
          exitPrice: { type: 'string', nullable: true },
          pnl: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' }, default: [] },
          emotionalState: {
            type: 'string',
            enum: ['confident', 'anxious', 'neutral', 'fomo', 'fearful', 'greedy', 'disciplined', 'impulsive'],
            nullable: true,
          },
          lessonsLearned: { type: 'string', nullable: true },
          strategyUsed: { type: 'string', nullable: true },
          rating: { type: 'integer', minimum: 1, maximum: 5, nullable: true },
          screenshots: { type: 'array', items: { type: 'string' }, default: [] },
        },
      },

      // ── Solana ───────────────────────────────────────────────────
      SolanaBalanceResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              wallet: { type: 'string' },
              rpcUrl: { type: 'string' },
              solBalance: { type: 'number', example: 1.5 },
              solValueUsd: { type: 'number', example: 225.0 },
              tokens: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    mint: { type: 'string' },
                    symbol: { type: 'string' },
                    name: { type: 'string' },
                    amount: { type: 'number' },
                    decimals: { type: 'integer' },
                    valueUsd: { type: 'number' },
                    logoUri: { type: 'string', nullable: true },
                  },
                },
              },
              totalValueUsd: { type: 'number' },
            },
          },
        },
      },

      SolanaSwapRequest: {
        type: 'object',
        required: ['inputMint', 'outputMint', 'amount'],
        properties: {
          inputMint: { type: 'string', description: 'Input token mint address' },
          outputMint: { type: 'string', description: 'Output token mint address' },
          amount: { type: 'string', description: 'Input amount in smallest units' },
          slippageBps: { type: 'integer', default: 300, description: 'Slippage tolerance in basis points' },
          priorityFee: { type: 'integer', default: 50000, description: 'Priority fee in micro-lamports per CU' },
        },
      },

      // ── Error ────────────────────────────────────────────────────
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
          status: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;
