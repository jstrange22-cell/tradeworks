import { eq, desc } from 'drizzle-orm';
import { db } from '../client.js';
import { tradingCycles, type TradingCycle, type NewTradingCycle } from '../schema.js';

/**
 * Insert a new trading cycle.
 */
export async function insertCycle(data: NewTradingCycle): Promise<TradingCycle> {
  const [inserted] = await db.insert(tradingCycles).values(data).returning();
  return inserted!;
}

/**
 * Complete a trading cycle by updating its status and completion timestamp.
 */
export async function completeCycle(
  id: string,
  data: Partial<Pick<
    NewTradingCycle,
    | 'status'
    | 'ordersPlaced'
    | 'totalCostUsd'
    | 'decisions'
    | 'marketSnapshot'
    | 'errorMessage'
  >>,
): Promise<TradingCycle> {
  const [updated] = await db
    .update(tradingCycles)
    .set({ ...data, completedAt: new Date() })
    .where(eq(tradingCycles.id, id))
    .returning();
  return updated!;
}

/**
 * Retrieve the most recent trading cycles, newest first.
 */
export async function getRecentCycles(limit = 20): Promise<TradingCycle[]> {
  return db
    .select()
    .from(tradingCycles)
    .orderBy(desc(tradingCycles.startedAt))
    .limit(limit);
}
