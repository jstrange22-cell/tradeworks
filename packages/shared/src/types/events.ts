import type { Trade, Position, Order } from './trade.js';
import type { AgentLog, TradingCycle, AgentStatus } from './agent.js';
import type { RiskSnapshot, CircuitBreakerState } from './risk.js';

// WebSocket event types for real-time dashboard updates
export type EventType =
  | 'portfolio:update'
  | 'position:opened'
  | 'position:closed'
  | 'position:updated'
  | 'trade:executed'
  | 'order:placed'
  | 'order:filled'
  | 'order:cancelled'
  | 'agent:log'
  | 'agent:status'
  | 'cycle:started'
  | 'cycle:completed'
  | 'risk:snapshot'
  | 'risk:alert'
  | 'circuit_breaker:triggered'
  | 'circuit_breaker:cleared'
  | 'market:tick';

export interface WSMessage<T = unknown> {
  channel: string;
  event: EventType;
  data: T;
  timestamp: string;
}

export interface WSCommand {
  command: 'emergency_stop' | 'close_all' | 'subscribe' | 'unsubscribe';
  channel?: string;
  params?: Record<string, unknown>;
}

// Redis pub/sub channel definitions
export const REDIS_CHANNELS = {
  ENGINE_COMMANDS: 'tradeworks:engine:commands',
  ENGINE_STATUS: 'tradeworks:engine:status',
  INGEST_TICKS: 'tradeworks:ingest:ticks',
  INGEST_CANDLES: 'tradeworks:ingest:candles',
  RISK_ALERTS: 'tradeworks:risk:alerts',
  CIRCUIT_BREAKER: 'tradeworks:circuit-breaker',
  AGENT_OUTPUT: (type: string) => `tradeworks:agent:${type}:output`,
} as const;

// Event payloads
export interface PortfolioUpdateEvent {
  portfolioId: string;
  totalEquity: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  openPositions: number;
}

export interface TradeExecutedEvent {
  trade: Trade;
}

export interface PositionEvent {
  position: Position;
}

export interface OrderEvent {
  order: Order;
}

export interface AgentLogEvent {
  log: AgentLog;
}

export interface AgentStatusEvent {
  status: AgentStatus;
}

export interface CycleEvent {
  cycle: TradingCycle;
}

export interface RiskAlertEvent {
  type: 'warning' | 'critical';
  message: string;
  snapshot: RiskSnapshot;
}

export interface CircuitBreakerEvent {
  state: CircuitBreakerState;
}

export interface MarketTickEvent {
  instrument: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
}
