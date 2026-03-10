import type { MarketType } from './market-data.js';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'twap' | 'vwap' | 'iceberg';
export type OrderStatus = 'pending' | 'submitted' | 'partial' | 'filled' | 'cancelled' | 'rejected';
export type PositionSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed' | 'liquidated';

export interface Trade {
  id: string;
  portfolioId: string;
  instrument: string;
  market: MarketType;
  side: OrderSide;
  quantity: number;
  price: number;
  fees: number;
  slippage: number;
  strategyId: string;
  agentId: string;
  cycleId: string;
  executedAt: Date;
  exchangeRef: string;
  metadata: Record<string, unknown>;
}

export interface Order {
  id: string;
  portfolioId: string;
  positionId: string | null;
  instrument: string;
  market: MarketType;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  filledQuantity: number;
  averageFill: number | null;
  status: OrderStatus;
  exchangeRef: string | null;
  strategyId: string | null;
  agentId: string | null;
  submittedAt: Date | null;
  filledAt: Date | null;
  cancelledAt: Date | null;
  fees: number;
  slippage: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Position {
  id: string;
  portfolioId: string;
  instrument: string;
  market: MarketType;
  side: PositionSide;
  quantity: number;
  averageEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: Date;
  closedAt: Date | null;
  status: PositionStatus;
  strategyId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Portfolio {
  id: string;
  name: string;
  initialCapital: number;
  currentCapital: number;
  currency: string;
  paperTrading: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// --- Advanced Order Types ---

export interface TwapSlice {
  sliceIndex: number;
  quantity: number;
  scheduledAt: string; // ISO timestamp
  delayMs: number;
}

export interface TwapPlan {
  type: 'twap';
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  slices: number;
  durationMinutes: number;
  intervalMs: number;
  plan: TwapSlice[];
  createdAt: string;
}

export interface VwapSlice {
  sliceIndex: number;
  quantity: number;
  weight: number;
  scheduledAt: string; // ISO timestamp
  delayMs: number;
}

export interface VwapPlan {
  type: 'vwap';
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  slices: number;
  volumeProfile: number[];
  plan: VwapSlice[];
  createdAt: string;
}

export interface IcebergPlan {
  type: 'iceberg';
  instrument: string;
  side: OrderSide;
  totalQuantity: number;
  displayQuantity: number;
  price: number;
  totalRefills: number;
  remainderQuantity: number;
  createdAt: string;
}
