import { eq, desc } from 'drizzle-orm';
import { db } from '../client.js';
import { orders, type NewOrder, type Order } from '../schema.js';

/**
 * Insert a new trade (order) into the database.
 */
export async function insertTrade(trade: NewOrder): Promise<Order> {
  const [inserted] = await db.insert(orders).values(trade).returning();
  return inserted!;
}

/**
 * Retrieve all trades (orders) for a given portfolio, newest first.
 */
export async function getTradesByPortfolio(
  portfolioId: string,
  limit = 100,
): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.portfolioId, portfolioId))
    .orderBy(desc(orders.submittedAt))
    .limit(limit);
}

/**
 * Retrieve all trades (orders) placed by a given strategy, newest first.
 */
export async function getTradesByStrategy(
  strategyId: string,
  limit = 100,
): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.strategyId, strategyId))
    .orderBy(desc(orders.submittedAt))
    .limit(limit);
}
