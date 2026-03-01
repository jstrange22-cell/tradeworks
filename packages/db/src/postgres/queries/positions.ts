import { eq, and } from 'drizzle-orm';
import { db } from '../client.js';
import { positions, type Position, type NewPosition } from '../schema.js';

/**
 * Get all open positions for a portfolio.
 */
export async function getOpenPositions(portfolioId: string): Promise<Position[]> {
  return db
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.portfolioId, portfolioId),
        eq(positions.status, 'open'),
      ),
    );
}

/**
 * Update fields on an existing position by ID.
 * Returns the updated position.
 */
export async function updatePosition(
  positionId: string,
  data: Partial<Pick<
    NewPosition,
    | 'currentPrice'
    | 'unrealizedPnl'
    | 'realizedPnl'
    | 'stopLoss'
    | 'takeProfit'
    | 'quantity'
    | 'metadata'
  >>,
): Promise<Position> {
  const [updated] = await db
    .update(positions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(positions.id, positionId))
    .returning();
  return updated!;
}

/**
 * Close a position by setting its status to 'closed' and recording the close timestamp.
 * Optionally set final realized PnL.
 */
export async function closePosition(
  positionId: string,
  realizedPnl?: string,
): Promise<Position> {
  const now = new Date();
  const [closed] = await db
    .update(positions)
    .set({
      status: 'closed',
      closedAt: now,
      unrealizedPnl: '0',
      ...(realizedPnl !== undefined ? { realizedPnl } : {}),
      updatedAt: now,
    })
    .where(eq(positions.id, positionId))
    .returning();
  return closed!;
}
