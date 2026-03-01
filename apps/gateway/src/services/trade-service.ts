import type { ExecutionResult } from '@tradeworks/shared';

/**
 * Extended execution result with trade details for recording purposes.
 */
interface TradeExecutionResult extends ExecutionResult {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: string;
  timestamp: Date;
}

/**
 * Trade business logic service.
 * Handles trade querying, filtering, and statistics.
 */

export interface TradeRecord {
  id: string;
  orderId: string;
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: string;
  exchange: string;
  strategyId: string | null;
  cycleId: string | null;
  slippage: number | null;
  commission: number | null;
  realizedPnl: number | null;
  timestamp: string;
  createdAt: string;
}

export interface TradeListParams {
  userId: string;
  page: number;
  limit: number;
  filters: {
    instrument?: string;
    side?: string;
    status?: string;
    exchange?: string;
    startDate?: Date;
    endDate?: Date;
  };
  sort: {
    field: string;
    order: 'asc' | 'desc';
  };
}

export interface TradeListResult {
  trades: TradeRecord[];
  total: number;
}

export interface TradeStats {
  period: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
  largestWin: number;
  largestLoss: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  byInstrument: Record<string, {
    trades: number;
    pnl: number;
    winRate: number;
  }>;
  byExchange: Record<string, {
    trades: number;
    pnl: number;
  }>;
}

export class TradeService {
  /**
   * Get a paginated and filtered list of trades.
   */
  async listTrades(params: TradeListParams): Promise<TradeListResult> {
    console.log(
      `[TradeService] Listing trades for user ${params.userId}, page ${params.page}, limit ${params.limit}`,
    );

    // TODO: Integrate with @tradeworks/db
    // Build query with filters:
    // - WHERE userId = params.userId
    // - AND instrument = params.filters.instrument (if set)
    // - AND side = params.filters.side (if set)
    // - AND status = params.filters.status (if set)
    // - AND exchange = params.filters.exchange (if set)
    // - AND timestamp >= params.filters.startDate (if set)
    // - AND timestamp <= params.filters.endDate (if set)
    // - ORDER BY params.sort.field params.sort.order
    // - LIMIT params.limit OFFSET (params.page - 1) * params.limit

    return {
      trades: [],
      total: 0,
    };
  }

  /**
   * Get a single trade by ID.
   */
  async getTradeById(tradeId: string, userId: string): Promise<TradeRecord | null> {
    console.log(`[TradeService] Fetching trade ${tradeId} for user ${userId}`);

    // TODO: Integrate with @tradeworks/db
    // SELECT * FROM trades WHERE id = tradeId AND userId = userId
    return null;
  }

  /**
   * Get trade statistics for a time period.
   */
  async getTradeStats(userId: string, period: string): Promise<TradeStats> {
    console.log(`[TradeService] Computing trade stats for user ${userId}, period ${period}`);

    // Parse period: '7d', '30d', '90d', '1y', 'all'
    // TODO: Integrate with @tradeworks/db for aggregated queries
    void this.parsePeriod(period);

    return {
      period,
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      totalPnl: 0,
      averagePnl: 0,
      largestWin: 0,
      largestLoss: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      byInstrument: {},
      byExchange: {},
    };
  }

  /**
   * Record a new trade from an execution result.
   */
  async recordTrade(execution: TradeExecutionResult, metadata?: {
    userId: string;
    strategyId?: string;
    cycleId?: string;
    exchange?: string;
  }): Promise<TradeRecord> {
    console.log(`[TradeService] Recording trade: ${execution.orderId}`);

    const record: TradeRecord = {
      id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId: execution.orderId,
      instrument: execution.instrument,
      side: execution.side,
      quantity: execution.quantity,
      price: execution.price,
      status: execution.status,
      exchange: metadata?.exchange ?? 'unknown',
      strategyId: metadata?.strategyId ?? null,
      cycleId: metadata?.cycleId ?? null,
      slippage: null,
      commission: null,
      realizedPnl: null,
      timestamp: execution.timestamp.toISOString(),
      createdAt: new Date().toISOString(),
    };

    // TODO: Insert into @tradeworks/db

    return record;
  }

  private parsePeriod(period: string): Date {
    const now = new Date();
    const match = period.match(/^(\d+)([dhmy])$/);

    if (!match) return new Date(0); // 'all' or invalid = from beginning

    const [, countStr, unit] = match;
    const count = parseInt(countStr ?? '0', 10);

    switch (unit) {
      case 'd':
        now.setDate(now.getDate() - count);
        break;
      case 'h':
        now.setHours(now.getHours() - count);
        break;
      case 'm':
        now.setMonth(now.getMonth() - count);
        break;
      case 'y':
        now.setFullYear(now.getFullYear() - count);
        break;
    }

    return now;
  }
}
