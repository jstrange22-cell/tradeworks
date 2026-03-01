import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigint,
  pgEnum,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const marketEnum = pgEnum('market', [
  'crypto',
  'equities',
  'forex',
  'futures',
  'options',
]);

export const sideEnum = pgEnum('side', ['long', 'short']);

export const orderSideEnum = pgEnum('order_side', ['buy', 'sell']);

export const orderTypeEnum = pgEnum('order_type', [
  'market',
  'limit',
  'stop',
  'stop_limit',
  'trailing_stop',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'submitted',
  'partial',
  'filled',
  'cancelled',
  'rejected',
  'expired',
]);

export const positionStatusEnum = pgEnum('position_status', [
  'open',
  'closed',
  'liquidated',
]);

export const strategyTypeEnum = pgEnum('strategy_type', [
  'momentum',
  'mean_reversion',
  'trend_following',
  'arbitrage',
  'market_making',
  'ml_signal',
  'custom',
]);

export const cycleStatusEnum = pgEnum('cycle_status', [
  'running',
  'completed',
  'failed',
  'skipped',
]);

export const backtestStatusEnum = pgEnum('backtest_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const apiEnvironmentEnum = pgEnum('api_environment', [
  'production',
  'sandbox',
  'testnet',
]);

export const guardrailTypeEnum = pgEnum('guardrail_type', [
  'max_position_size',
  'max_portfolio_heat',
  'max_drawdown',
  'max_daily_loss',
  'max_correlation',
  'circuit_breaker',
  'custom',
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const portfolios = pgTable('portfolios', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  initialCapital: numeric('initial_capital', { precision: 18, scale: 2 }).notNull(),
  currentCapital: numeric('current_capital', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  paperTrading: boolean('paper_trading').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const strategies = pgTable('strategies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  market: marketEnum('market').notNull(),
  strategyType: strategyTypeEnum('strategy_type').notNull(),
  params: jsonb('params').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  maxAllocation: numeric('max_allocation', { precision: 18, scale: 2 }),
  riskPerTrade: numeric('risk_per_trade', { precision: 8, scale: 6 }),
  minRiskReward: numeric('min_risk_reward', { precision: 6, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  portfolioId: uuid('portfolio_id')
    .notNull()
    .references(() => portfolios.id, { onDelete: 'cascade' }),
  instrument: varchar('instrument', { length: 50 }).notNull(),
  market: marketEnum('market').notNull(),
  side: sideEnum('side').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 8 }).notNull(),
  averageEntry: numeric('average_entry', { precision: 18, scale: 8 }).notNull(),
  currentPrice: numeric('current_price', { precision: 18, scale: 8 }),
  unrealizedPnl: numeric('unrealized_pnl', { precision: 18, scale: 2 }).default('0'),
  realizedPnl: numeric('realized_pnl', { precision: 18, scale: 2 }).default('0'),
  stopLoss: numeric('stop_loss', { precision: 18, scale: 8 }),
  takeProfit: numeric('take_profit', { precision: 18, scale: 8 }),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  status: positionStatusEnum('status').notNull().default('open'),
  strategyId: uuid('strategy_id').references(() => strategies.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  portfolioId: uuid('portfolio_id')
    .notNull()
    .references(() => portfolios.id, { onDelete: 'cascade' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
  instrument: varchar('instrument', { length: 50 }).notNull(),
  market: marketEnum('market').notNull(),
  side: orderSideEnum('side').notNull(),
  orderType: orderTypeEnum('order_type').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 8 }).notNull(),
  price: numeric('price', { precision: 18, scale: 8 }),
  stopPrice: numeric('stop_price', { precision: 18, scale: 8 }),
  filledQuantity: numeric('filled_quantity', { precision: 18, scale: 8 }).notNull().default('0'),
  averageFill: numeric('average_fill', { precision: 18, scale: 8 }),
  status: orderStatusEnum('status').notNull().default('pending'),
  exchangeRef: varchar('exchange_ref', { length: 255 }),
  strategyId: uuid('strategy_id').references(() => strategies.id, { onDelete: 'set null' }),
  agentId: varchar('agent_id', { length: 100 }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  filledAt: timestamp('filled_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  fees: numeric('fees', { precision: 18, scale: 8 }).default('0'),
  slippage: numeric('slippage', { precision: 18, scale: 8 }).default('0'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentLogs = pgTable('agent_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentType: varchar('agent_type', { length: 100 }).notNull(),
  sessionId: varchar('session_id', { length: 100 }).notNull(),
  action: varchar('action', { length: 255 }).notNull(),
  inputSummary: text('input_summary'),
  outputSummary: text('output_summary'),
  decision: jsonb('decision'),
  tokensUsed: integer('tokens_used'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  durationMs: integer('duration_ms'),
  parentCycleId: uuid('parent_cycle_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tradingCycles = pgTable('trading_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  marketSnapshot: jsonb('market_snapshot'),
  decisions: jsonb('decisions'),
  ordersPlaced: integer('orders_placed').notNull().default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0'),
  status: cycleStatusEnum('status').notNull().default('running'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskSnapshots = pgTable('risk_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  portfolioId: uuid('portfolio_id')
    .notNull()
    .references(() => portfolios.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  totalEquity: numeric('total_equity', { precision: 18, scale: 2 }).notNull(),
  cashBalance: numeric('cash_balance', { precision: 18, scale: 2 }).notNull(),
  grossExposure: numeric('gross_exposure', { precision: 18, scale: 2 }).notNull(),
  netExposure: numeric('net_exposure', { precision: 18, scale: 2 }).notNull(),
  var95: numeric('var_95', { precision: 18, scale: 2 }),
  var99: numeric('var_99', { precision: 18, scale: 2 }),
  maxDrawdown: numeric('max_drawdown', { precision: 10, scale: 6 }),
  dailyPnl: numeric('daily_pnl', { precision: 18, scale: 2 }),
  sharpe30d: numeric('sharpe_30d', { precision: 10, scale: 6 }),
  portfolioHeat: numeric('portfolio_heat', { precision: 10, scale: 6 }),
  positionsCount: integer('positions_count').notNull().default(0),
  circuitBreaker: boolean('circuit_breaker').notNull().default(false),
  metadata: jsonb('metadata').default({}),
});

export const backtestRuns = pgTable('backtest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  strategyId: uuid('strategy_id')
    .notNull()
    .references(() => strategies.id, { onDelete: 'cascade' }),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }).notNull(),
  initialCapital: numeric('initial_capital', { precision: 18, scale: 2 }).notNull(),
  finalCapital: numeric('final_capital', { precision: 18, scale: 2 }),
  totalTrades: integer('total_trades'),
  winRate: numeric('win_rate', { precision: 6, scale: 4 }),
  sharpeRatio: numeric('sharpe_ratio', { precision: 10, scale: 6 }),
  sortinoRatio: numeric('sortino_ratio', { precision: 10, scale: 6 }),
  maxDrawdown: numeric('max_drawdown', { precision: 10, scale: 6 }),
  profitFactor: numeric('profit_factor', { precision: 10, scale: 4 }),
  calmarRatio: numeric('calmar_ratio', { precision: 10, scale: 6 }),
  params: jsonb('params').notNull().default({}),
  status: backtestStatusEnum('status').notNull().default('queued'),
  resultsJson: jsonb('results_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  service: varchar('service', { length: 100 }).notNull(),
  keyName: varchar('key_name', { length: 255 }).notNull(),
  encryptedKey: bytea('encrypted_key').notNull(),
  encryptedSecret: bytea('encrypted_secret'),
  environment: apiEnvironmentEnum('environment').notNull().default('sandbox'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guardrails = pgTable('guardrails', {
  id: uuid('id').primaryKey().defaultRandom(),
  guardrailType: guardrailTypeEnum('guardrail_type').notNull(),
  value: jsonb('value').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userSettings = pgTable('user_settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const portfoliosRelations = relations(portfolios, ({ many }) => ({
  positions: many(positions),
  orders: many(orders),
  riskSnapshots: many(riskSnapshots),
}));

export const strategiesRelations = relations(strategies, ({ many }) => ({
  positions: many(positions),
  orders: many(orders),
  backtestRuns: many(backtestRuns),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  portfolio: one(portfolios, {
    fields: [positions.portfolioId],
    references: [portfolios.id],
  }),
  strategy: one(strategies, {
    fields: [positions.strategyId],
    references: [strategies.id],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [orders.portfolioId],
    references: [portfolios.id],
  }),
  position: one(positions, {
    fields: [orders.positionId],
    references: [positions.id],
  }),
  strategy: one(strategies, {
    fields: [orders.strategyId],
    references: [strategies.id],
  }),
}));

export const riskSnapshotsRelations = relations(riskSnapshots, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [riskSnapshots.portfolioId],
    references: [portfolios.id],
  }),
}));

export const backtestRunsRelations = relations(backtestRuns, ({ one }) => ({
  strategy: one(strategies, {
    fields: [backtestRuns.strategyId],
    references: [strategies.id],
  }),
}));

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type Strategy = typeof strategies.$inferSelect;
export type NewStrategy = typeof strategies.$inferInsert;

export type AgentLog = typeof agentLogs.$inferSelect;
export type NewAgentLog = typeof agentLogs.$inferInsert;

export type TradingCycle = typeof tradingCycles.$inferSelect;
export type NewTradingCycle = typeof tradingCycles.$inferInsert;

export type RiskSnapshot = typeof riskSnapshots.$inferSelect;
export type NewRiskSnapshot = typeof riskSnapshots.$inferInsert;

export type BacktestRun = typeof backtestRuns.$inferSelect;
export type NewBacktestRun = typeof backtestRuns.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Guardrail = typeof guardrails.$inferSelect;
export type NewGuardrail = typeof guardrails.$inferInsert;

export type UserSetting = typeof userSettings.$inferSelect;
export type NewUserSetting = typeof userSettings.$inferInsert;
