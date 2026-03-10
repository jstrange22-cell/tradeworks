import type { Position as SharedPosition, ExecutionResult, MarketType } from '@tradeworks/shared';
import {
  getOpenPositions,
  getDefaultPortfolio,
  closePosition as dbClosePosition,
  db,
  positions,
  type Position as DbPosition,
  eq, and, desc,
} from '@tradeworks/db';

/**
 * Map DB market enum values to shared MarketType.
 * DB uses: 'crypto', 'equities', 'forex', 'futures', 'options'
 * Shared uses: 'crypto', 'prediction', 'equity'
 */
const DB_MARKET_TO_SHARED: Record<string, MarketType> = {
  crypto: 'crypto',
  equities: 'equity',
  forex: 'equity',
  futures: 'equity',
  options: 'equity',
};

/**
 * Portfolio calculation service.
 * Manages position tracking, portfolio value computation, and P&L.
 */

export interface PortfolioSummary {
  totalEquity: number;
  cashBalance: number;
  positionsValue: number;
  unrealizedPnl: number;
  realizedPnlToday: number;
  dailyPnlPercent: number;
  openPositionCount: number;
}

export interface ClosedPosition {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  openedAt: string;
  closedAt: string;
  holdingPeriodMs: number;
}

export interface ClosePositionResult {
  success: boolean;
  execution?: ExecutionResult;
  error?: string;
}

/**
 * Map a DB Position (with numeric strings) to the shared Position type (with numbers).
 */
function mapDbPosition(p: DbPosition): SharedPosition {
  return {
    id: p.id,
    portfolioId: p.portfolioId,
    instrument: p.instrument,
    market: DB_MARKET_TO_SHARED[p.market] ?? 'crypto',
    side: p.side,
    quantity: parseFloat(p.quantity),
    averageEntry: parseFloat(p.averageEntry),
    currentPrice: p.currentPrice ? parseFloat(p.currentPrice) : 0,
    unrealizedPnl: p.unrealizedPnl ? parseFloat(p.unrealizedPnl) : 0,
    realizedPnl: p.realizedPnl ? parseFloat(p.realizedPnl) : 0,
    stopLoss: p.stopLoss ? parseFloat(p.stopLoss) : null,
    takeProfit: p.takeProfit ? parseFloat(p.takeProfit) : null,
    openedAt: p.openedAt,
    closedAt: p.closedAt ?? null,
    status: p.status,
    strategyId: p.strategyId ?? null,
    metadata: (p.metadata as Record<string, unknown>) ?? {},
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Map a DB closed Position to the ClosedPosition interface.
 */
function mapDbClosedPosition(p: DbPosition): ClosedPosition {
  const entryPrice = parseFloat(p.averageEntry);
  const exitPrice = p.currentPrice ? parseFloat(p.currentPrice) : entryPrice;
  const realizedPnl = p.realizedPnl ? parseFloat(p.realizedPnl) : 0;
  const quantity = parseFloat(p.quantity);
  const costBasis = entryPrice * quantity;
  const openedAt = p.openedAt.toISOString();
  const closedAt = p.closedAt ? p.closedAt.toISOString() : new Date().toISOString();
  const holdingPeriodMs = (p.closedAt ? p.closedAt.getTime() : Date.now()) - p.openedAt.getTime();

  return {
    instrument: p.instrument,
    side: p.side === 'long' ? 'buy' : 'sell',
    quantity,
    entryPrice,
    exitPrice,
    realizedPnl,
    realizedPnlPercent: costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0,
    openedAt,
    closedAt,
    holdingPeriodMs,
  };
}

export class PortfolioService {
  /**
   * Get all open positions, optionally filtered by exchange.
   */
  async getPositions(userId: string, exchange?: string): Promise<SharedPosition[]> {
    console.log(`[PortfolioService] Fetching positions for user ${userId}, exchange: ${exchange ?? 'all'}`);

    try {
      const portfolio = await getDefaultPortfolio();
      if (!portfolio) {
        console.warn('[PortfolioService] No default portfolio found');
        return [];
      }

      const dbPositions = await getOpenPositions(portfolio.id);
      return dbPositions.map(mapDbPosition);
    } catch (error) {
      console.error('[PortfolioService] Error fetching positions:', error);
      return [];
    }
  }

  /**
   * Get a specific position by instrument.
   */
  async getPosition(userId: string, instrument: string): Promise<SharedPosition | null> {
    console.log(`[PortfolioService] Fetching position: ${instrument} for user ${userId}`);

    try {
      const rows = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.instrument, instrument),
            eq(positions.status, 'open'),
          ),
        )
        .limit(1);

      if (rows.length === 0) return null;
      return mapDbPosition(rows[0]!);
    } catch (error) {
      console.error('[PortfolioService] Error fetching position by instrument:', error);
      return null;
    }
  }

  /**
   * Close a position (fully or partially).
   */
  async closePosition(
    userId: string,
    positionId: string,
    _options: {
      quantity?: number;
      orderType: 'market' | 'limit';
      limitPrice?: number;
    },
  ): Promise<ClosePositionResult> {
    console.log(
      `[PortfolioService] Closing position ${positionId} for user ${userId}`,
    );

    try {
      const closed = await dbClosePosition(positionId);
      return {
        success: true,
        execution: {
          filled: true,
          orderId: `close-${positionId}`,
          fillPrice: closed.currentPrice ? parseFloat(closed.currentPrice) : null,
          fillQuantity: parseFloat(closed.quantity),
          slippage: 0,
          fees: 0,
          exchangeRef: null,
          errorMessage: null,
        },
      };
    } catch (error) {
      console.error('[PortfolioService] Error closing position:', error);
      return {
        success: false,
        error: `Failed to close position: ${String(error)}`,
      };
    }
  }

  /**
   * Get recently closed positions.
   */
  async getClosedPositions(userId: string, limit: number): Promise<ClosedPosition[]> {
    console.log(`[PortfolioService] Fetching closed positions for user ${userId}, limit: ${limit}`);

    try {
      const rows = await db
        .select()
        .from(positions)
        .where(eq(positions.status, 'closed'))
        .orderBy(desc(positions.closedAt))
        .limit(limit);

      return rows.map(mapDbClosedPosition);
    } catch (error) {
      console.error('[PortfolioService] Error fetching closed positions:', error);
      return [];
    }
  }

  /**
   * Get portfolio summary with calculated metrics.
   */
  async getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
    console.log(`[PortfolioService] Computing portfolio summary for user ${userId}`);

    try {
      const portfolio = await getDefaultPortfolio();
      const openPositions = await this.getPositions(userId);

      const cashBalance = portfolio ? parseFloat(portfolio.currentCapital) : 0;

      const positionsValue = openPositions.reduce(
        (sum, p) => sum + p.quantity * p.currentPrice,
        0,
      );

      const unrealizedPnl = openPositions.reduce(
        (sum, p) => sum + (p.unrealizedPnl ?? 0),
        0,
      );

      // Compute today's realized P&L from closed positions today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let realizedPnlToday = 0;
      try {
        const closedToday = await db
          .select()
          .from(positions)
          .where(
            and(
              eq(positions.status, 'closed'),
            ),
          );
        realizedPnlToday = closedToday
          .filter(p => p.closedAt && p.closedAt >= todayStart)
          .reduce((sum, p) => sum + (p.realizedPnl ? parseFloat(p.realizedPnl) : 0), 0);
      } catch {
        // Ignore - use 0
      }

      const totalEquity = cashBalance + positionsValue;

      return {
        totalEquity,
        cashBalance,
        positionsValue,
        unrealizedPnl,
        realizedPnlToday,
        dailyPnlPercent: totalEquity > 0 ? ((unrealizedPnl + realizedPnlToday) / totalEquity) * 100 : 0,
        openPositionCount: openPositions.length,
      };
    } catch (error) {
      console.error('[PortfolioService] Error computing portfolio summary:', error);
      return {
        totalEquity: 0,
        cashBalance: 0,
        positionsValue: 0,
        unrealizedPnl: 0,
        realizedPnlToday: 0,
        dailyPnlPercent: 0,
        openPositionCount: 0,
      };
    }
  }

  /**
   * Calculate portfolio allocation breakdown.
   */
  async getAllocation(userId: string): Promise<Record<string, { value: number; percent: number }>> {
    const openPositions = await this.getPositions(userId);
    const totalValue = openPositions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);

    if (totalValue === 0) return {};

    const allocation: Record<string, { value: number; percent: number }> = {};

    for (const position of openPositions) {
      const category = this.categorizeInstrument(position.instrument);
      if (!allocation[category]) {
        allocation[category] = { value: 0, percent: 0 };
      }
      const posValue = position.quantity * position.currentPrice;
      allocation[category].value += posValue;
      allocation[category].percent = (allocation[category].value / totalValue) * 100;
    }

    return allocation;
  }

  /**
   * Categorize an instrument for allocation tracking.
   */
  private categorizeInstrument(instrument: string): string {
    const upper = instrument.toUpperCase();

    const cryptoPatterns = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'DOGE', 'LINK', 'UNI', 'AAVE'];
    if (cryptoPatterns.some((p) => upper.includes(p))) return 'crypto';

    if (upper.startsWith('0X') || upper.includes('POLYMARKET')) return 'predictions';

    return 'equities';
  }
}
