// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

export { db, pool, type Database } from './postgres/client.js';

export {
  // Enums
  marketEnum,
  sideEnum,
  orderSideEnum,
  orderTypeEnum,
  orderStatusEnum,
  positionStatusEnum,
  strategyTypeEnum,
  cycleStatusEnum,
  backtestStatusEnum,
  apiEnvironmentEnum,
  guardrailTypeEnum,
  // Tables
  portfolios,
  positions,
  orders,
  strategies,
  agentLogs,
  tradingCycles,
  riskSnapshots,
  backtestRuns,
  apiKeys,
  guardrails,
  // Relations
  portfoliosRelations,
  strategiesRelations,
  positionsRelations,
  ordersRelations,
  riskSnapshotsRelations,
  backtestRunsRelations,
  // Types
  type Portfolio,
  type NewPortfolio,
  type Position,
  type NewPosition,
  type Order,
  type NewOrder,
  type Strategy,
  type NewStrategy,
  type AgentLog,
  type NewAgentLog,
  type TradingCycle,
  type NewTradingCycle,
  type RiskSnapshot,
  type NewRiskSnapshot,
  type BacktestRun,
  type NewBacktestRun,
  type ApiKey,
  type NewApiKey,
  type Guardrail,
  type NewGuardrail,
} from './postgres/schema.js';

export {
  insertTrade,
  getTradesByPortfolio,
  getTradesByStrategy,
} from './postgres/queries/trades.js';

export {
  getOpenPositions,
  updatePosition,
  closePosition,
} from './postgres/queries/positions.js';

export {
  getPortfolio,
  getDefaultPortfolio,
  createPortfolio,
  updatePortfolio,
} from './postgres/queries/portfolios.js';

export {
  getStrategies,
  getStrategy,
  createStrategy,
  updateStrategy,
  toggleStrategy,
} from './postgres/queries/strategies.js';

export {
  insertAgentLog,
  getAgentLogs,
  getRecentAgentActivity,
} from './postgres/queries/agent-logs.js';

export {
  insertCycle,
  completeCycle,
  getRecentCycles,
} from './postgres/queries/trading-cycles.js';

export {
  insertRiskSnapshot,
  getLatestRiskSnapshot,
  getRiskHistory,
} from './postgres/queries/risk-snapshots.js';

export {
  createBacktest,
  updateBacktest,
  getBacktestsByStrategy,
  getBacktest,
} from './postgres/queries/backtests.js';

// ---------------------------------------------------------------------------
// ClickHouse
// ---------------------------------------------------------------------------

export {
  getClickHouseClient,
  closeClickHouseClient,
  type ClickHouseClient,
} from './clickhouse/client.js';

export {
  getCandles,
  getLatestPrice,
  getOrderBookSnapshot,
  type Candle,
  type LatestPrice,
  type OrderBookSnapshot,
} from './clickhouse/queries/market-data.js';

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

export {
  getRedisClient,
  createRedisClient,
  closeRedisClient,
} from './redis/client.js';

export {
  REDIS_CHANNELS,
  publish,
  subscribe,
  type RedisChannel,
  type Subscription,
} from './redis/pub-sub.js';

export {
  cacheGet,
  cacheSet,
  cacheDel,
} from './redis/cache.js';
