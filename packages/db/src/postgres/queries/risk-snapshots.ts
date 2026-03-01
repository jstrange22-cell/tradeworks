import { eq, desc, and, gte } from 'drizzle-orm';
import { db } from '../client.js';
import { riskSnapshots, type RiskSnapshot, type NewRiskSnapshot } from '../schema.js';

/**
 * Insert a new risk snapshot.
 */
export async function insertRiskSnapshot(data: NewRiskSnapshot): Promise<RiskSnapshot> {
  const [inserted] = await db.insert(riskSnapshots).values(data).returning();
  return inserted!;
}

/**
 * Retrieve the most recent risk snapshot for a portfolio.
 */
export async function getLatestRiskSnapshot(
  portfolioId: string,
): Promise<RiskSnapshot | undefined> {
  const [snapshot] = await db
    .select()
    .from(riskSnapshots)
    .where(eq(riskSnapshots.portfolioId, portfolioId))
    .orderBy(desc(riskSnapshots.timestamp))
    .limit(1);
  return snapshot;
}

/**
 * Retrieve risk snapshot history for a portfolio over the last N days.
 */
export async function getRiskHistory(
  portfolioId: string,
  days: number,
): Promise<RiskSnapshot[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  return db
    .select()
    .from(riskSnapshots)
    .where(
      and(
        eq(riskSnapshots.portfolioId, portfolioId),
        gte(riskSnapshots.timestamp, since),
      ),
    )
    .orderBy(desc(riskSnapshots.timestamp));
}
