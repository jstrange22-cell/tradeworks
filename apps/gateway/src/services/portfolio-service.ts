import type { Position, ExecutionResult } from '@tradeworks/shared';

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

export class PortfolioService {
  /**
   * Get all open positions, optionally filtered by exchange.
   */
  async getPositions(userId: string, exchange?: string): Promise<Position[]> {
    console.log(`[PortfolioService] Fetching positions for user ${userId}, exchange: ${exchange ?? 'all'}`);

    // TODO: Integrate with @tradeworks/db
    // SELECT * FROM positions
    //   WHERE userId = userId
    //   AND status = 'open'
    //   AND (exchange = exchange OR exchange IS NULL)
    //   ORDER BY timestamp DESC

    return [];
  }

  /**
   * Get a specific position by instrument.
   */
  async getPosition(userId: string, instrument: string): Promise<Position | null> {
    console.log(`[PortfolioService] Fetching position: ${instrument} for user ${userId}`);

    // TODO: Integrate with @tradeworks/db
    return null;
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

    // TODO: Integrate with engine for trade execution
    // 1. Fetch the position
    // 2. Validate the close request
    // 3. Submit close order to the engine
    // 4. Wait for execution
    // 5. Update position record

    return {
      success: false,
      error: 'Position closing not yet implemented - engine integration pending',
    };
  }

  /**
   * Get recently closed positions.
   */
  async getClosedPositions(userId: string, limit: number): Promise<ClosedPosition[]> {
    console.log(`[PortfolioService] Fetching closed positions for user ${userId}, limit: ${limit}`);

    // TODO: Integrate with @tradeworks/db
    return [];
  }

  /**
   * Get portfolio summary with calculated metrics.
   */
  async getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
    console.log(`[PortfolioService] Computing portfolio summary for user ${userId}`);

    const positions = await this.getPositions(userId);

    const positionsValue = positions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0,
    );

    const unrealizedPnl = positions.reduce(
      (sum, p) => sum + (p.unrealizedPnl ?? 0),
      0,
    );

    // TODO: Get cash balance and realized P&L from database
    const cashBalance = 0;
    const realizedPnlToday = 0;
    const totalEquity = cashBalance + positionsValue;

    return {
      totalEquity,
      cashBalance,
      positionsValue,
      unrealizedPnl,
      realizedPnlToday,
      dailyPnlPercent: totalEquity > 0 ? ((unrealizedPnl + realizedPnlToday) / totalEquity) * 100 : 0,
      openPositionCount: positions.length,
    };
  }

  /**
   * Calculate portfolio allocation breakdown.
   */
  async getAllocation(userId: string): Promise<Record<string, { value: number; percent: number }>> {
    const positions = await this.getPositions(userId);
    const totalValue = positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);

    if (totalValue === 0) return {};

    const allocation: Record<string, { value: number; percent: number }> = {};

    for (const position of positions) {
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
