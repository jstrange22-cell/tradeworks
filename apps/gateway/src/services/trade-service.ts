import type { ExecutionResult } from '@tradeworks/shared';
import {
  getTradesByPortfolio,
  insertTrade,
  getDefaultPortfolio,
  db,
  orders,
  type Order as DbOrder,
} from '@tradeworks/db';
import { eq, desc, and, gte, lte, count } from 'drizzle-orm';

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

/**
 * Map a DB Order (with numeric strings) to a TradeRecord (with numbers).
 */
function mapDbOrderToTradeRecord(o: DbOrder): TradeRecord {
  return {
    id: o.id,
    orderId: o.exchangeRef ?? o.id,
    instrument: o.instrument,
    side: o.side,
    quantity: parseFloat(o.quantity),
    price: o.averageFill ? parseFloat(o.averageFill) : (o.price ? parseFloat(o.price) : 0),
    status: o.status,
    exchange: o.market,
    strategyId: o.strategyId ?? null,
    cycleId: null,
    slippage: o.slippage ? parseFloat(o.slippage) : null,
    commission: o.fees ? parseFloat(o.fees) : null,
    realizedPnl: null,
    timestamp: o.submittedAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
  };
}

export class TradeService {
  /**
   * Get a paginated and filtered list of trades.
   */
  async listTrades(params: TradeListParams): Promise<TradeListResult> {
    console.log(
      `[TradeService] Listing trades for user ${params.userId}, page ${params.page}, limit ${params.limit}`,
    );

    try {
      const portfolio = await getDefaultPortfolio();
      if (!portfolio) {
        console.warn('[TradeService] No default portfolio found');
        return { trades: [], total: 0 };
      }

      // Build dynamic where conditions
      const conditions = [eq(orders.portfolioId, portfolio.id)];

      if (params.filters.instrument) {
        conditions.push(eq(orders.instrument, params.filters.instrument));
      }
      if (params.filters.side && (params.filters.side === 'buy' || params.filters.side === 'sell')) {
        conditions.push(eq(orders.side, params.filters.side));
      }
      if (params.filters.status) {
        conditions.push(eq(orders.status, params.filters.status as typeof orders.status.enumValues[number]));
      }
      if (params.filters.startDate) {
        conditions.push(gte(orders.submittedAt, params.filters.startDate));
      }
      if (params.filters.endDate) {
        conditions.push(lte(orders.submittedAt, params.filters.endDate));
      }

      const whereClause = and(...conditions);

      // Get total count
      const [countResult] = await db
        .select({ value: count() })
        .from(orders)
        .where(whereClause);
      const total = countResult?.value ?? 0;

      // Get paginated results
      const rows = await db
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(desc(orders.submittedAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit);

      return {
        trades: rows.map(mapDbOrderToTradeRecord),
        total,
      };
    } catch (error) {
      console.error('[TradeService] Error listing trades:', error);
      return { trades: [], total: 0 };
    }
  }

  /**
   * Get a single trade by ID.
   */
  async getTradeById(tradeId: string, userId: string): Promise<TradeRecord | null> {
    console.log(`[TradeService] Fetching trade ${tradeId} for user ${userId}`);

    try {
      const rows = await db
        .select()
        .from(orders)
        .where(eq(orders.id, tradeId))
        .limit(1);

      if (rows.length === 0) return null;
      return mapDbOrderToTradeRecord(rows[0]!);
    } catch (error) {
      console.error('[TradeService] Error fetching trade by ID:', error);
      return null;
    }
  }

  /**
   * Get trade statistics for a time period.
   */
  async getTradeStats(userId: string, period: string): Promise<TradeStats> {
    console.log(`[TradeService] Computing trade stats for user ${userId}, period ${period}`);

    const periodStart = this.parsePeriod(period);

    try {
      const portfolio = await getDefaultPortfolio();
      if (!portfolio) {
        console.warn('[TradeService] No default portfolio found');
        return this.emptyStats(period);
      }

      // Fetch all trades for the portfolio within the period
      const allTrades = await getTradesByPortfolio(portfolio.id, 1000);
      const filteredTrades = allTrades.filter(t => t.submittedAt >= periodStart);

      if (filteredTrades.length === 0) {
        return this.emptyStats(period);
      }

      // Compute stats in-memory
      const mapped = filteredTrades.map(mapDbOrderToTradeRecord);
      const withPnl = mapped.filter(t => t.realizedPnl !== null);
      const wins = withPnl.filter(t => (t.realizedPnl ?? 0) > 0);
      const losses = withPnl.filter(t => (t.realizedPnl ?? 0) < 0);

      const totalPnl = withPnl.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0);
      const totalWinPnl = wins.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0);
      const totalLossPnl = losses.reduce((sum, t) => sum + Math.abs(t.realizedPnl ?? 0), 0);

      // Max consecutive
      let maxConsecutiveWins = 0;
      let maxConsecutiveLosses = 0;
      let currentWinStreak = 0;
      let currentLossStreak = 0;
      for (const t of withPnl) {
        if ((t.realizedPnl ?? 0) > 0) {
          currentWinStreak++;
          currentLossStreak = 0;
          maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWinStreak);
        } else if ((t.realizedPnl ?? 0) < 0) {
          currentLossStreak++;
          currentWinStreak = 0;
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLossStreak);
        }
      }

      // By instrument
      const byInstrument: Record<string, { trades: number; pnl: number; winRate: number }> = {};
      for (const t of mapped) {
        if (!byInstrument[t.instrument]) {
          byInstrument[t.instrument] = { trades: 0, pnl: 0, winRate: 0 };
        }
        byInstrument[t.instrument].trades++;
        byInstrument[t.instrument].pnl += t.realizedPnl ?? 0;
      }
      // Calculate win rate per instrument
      for (const inst of Object.keys(byInstrument)) {
        const instTrades = withPnl.filter(t => t.instrument === inst);
        const instWins = instTrades.filter(t => (t.realizedPnl ?? 0) > 0);
        byInstrument[inst].winRate = instTrades.length > 0 ? (instWins.length / instTrades.length) * 100 : 0;
      }

      // By exchange
      const byExchange: Record<string, { trades: number; pnl: number }> = {};
      for (const t of mapped) {
        if (!byExchange[t.exchange]) {
          byExchange[t.exchange] = { trades: 0, pnl: 0 };
        }
        byExchange[t.exchange].trades++;
        byExchange[t.exchange].pnl += t.realizedPnl ?? 0;
      }

      // Simple Sharpe approximation (daily returns std dev)
      const pnlValues = withPnl.map(t => t.realizedPnl ?? 0);
      const meanPnl = pnlValues.length > 0 ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length : 0;
      const variance = pnlValues.length > 1
        ? pnlValues.reduce((sum, v) => sum + (v - meanPnl) ** 2, 0) / (pnlValues.length - 1)
        : 0;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? (meanPnl / stdDev) * Math.sqrt(252) : 0;

      return {
        period,
        totalTrades: mapped.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRate: withPnl.length > 0 ? (wins.length / withPnl.length) * 100 : 0,
        totalPnl,
        averagePnl: withPnl.length > 0 ? totalPnl / withPnl.length : 0,
        largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.realizedPnl ?? 0)) : 0,
        largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.realizedPnl ?? 0)) : 0,
        averageWin: wins.length > 0 ? totalWinPnl / wins.length : 0,
        averageLoss: losses.length > 0 ? -(totalLossPnl / losses.length) : 0,
        profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : 0,
        sharpeRatio,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        byInstrument,
        byExchange,
      };
    } catch (error) {
      console.error('[TradeService] Error computing trade stats:', error);
      return this.emptyStats(period);
    }
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

    try {
      const portfolio = await getDefaultPortfolio();
      if (!portfolio) {
        throw new Error('No default portfolio found');
      }

      const inserted = await insertTrade({
        portfolioId: portfolio.id,
        instrument: execution.instrument,
        market: (metadata?.exchange as 'crypto' | 'equities' | 'forex' | 'futures' | 'options') ?? 'crypto',
        side: execution.side,
        orderType: 'market',
        quantity: String(execution.quantity),
        price: String(execution.price),
        status: (execution.status as 'pending' | 'submitted' | 'partial' | 'filled' | 'cancelled' | 'rejected' | 'expired') ?? 'filled',
        strategyId: metadata?.strategyId ?? null,
        agentId: null,
      });

      return mapDbOrderToTradeRecord(inserted);
    } catch (error) {
      console.error('[TradeService] Error recording trade, using in-memory fallback:', error);

      // Fallback: return a record without DB persistence
      return {
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
    }
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

  private emptyStats(period: string): TradeStats {
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
}
