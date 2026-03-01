import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { portfolios, type Portfolio, type NewPortfolio } from '../schema.js';

/**
 * Retrieve a portfolio by its ID.
 */
export async function getPortfolio(id: string): Promise<Portfolio | undefined> {
  const [portfolio] = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.id, id))
    .limit(1);
  return portfolio;
}

/**
 * Retrieve the first (default) portfolio.
 */
export async function getDefaultPortfolio(): Promise<Portfolio | undefined> {
  const [portfolio] = await db
    .select()
    .from(portfolios)
    .limit(1);
  return portfolio;
}

/**
 * Insert a new portfolio.
 */
export async function createPortfolio(data: NewPortfolio): Promise<Portfolio> {
  const [inserted] = await db.insert(portfolios).values(data).returning();
  return inserted!;
}

/**
 * Partially update a portfolio by ID.
 * Returns the updated portfolio.
 */
export async function updatePortfolio(
  id: string,
  data: Partial<Pick<NewPortfolio, 'name' | 'currentCapital' | 'currency' | 'paperTrading'>>,
): Promise<Portfolio> {
  const [updated] = await db
    .update(portfolios)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(portfolios.id, id))
    .returning();
  return updated!;
}
