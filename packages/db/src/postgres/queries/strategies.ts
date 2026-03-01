import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { strategies, type Strategy, type NewStrategy } from '../schema.js';

/**
 * Retrieve all strategies.
 */
export async function getStrategies(): Promise<Strategy[]> {
  return db.select().from(strategies);
}

/**
 * Retrieve a strategy by its ID.
 */
export async function getStrategy(id: string): Promise<Strategy | undefined> {
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, id))
    .limit(1);
  return strategy;
}

/**
 * Insert a new strategy.
 */
export async function createStrategy(data: NewStrategy): Promise<Strategy> {
  const [inserted] = await db.insert(strategies).values(data).returning();
  return inserted!;
}

/**
 * Partially update a strategy by ID.
 * Returns the updated strategy.
 */
export async function updateStrategy(
  id: string,
  data: Partial<Pick<
    NewStrategy,
    | 'name'
    | 'market'
    | 'strategyType'
    | 'params'
    | 'enabled'
    | 'maxAllocation'
    | 'riskPerTrade'
    | 'minRiskReward'
  >>,
): Promise<Strategy> {
  const [updated] = await db
    .update(strategies)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(strategies.id, id))
    .returning();
  return updated!;
}

/**
 * Enable or disable a strategy by ID.
 * Returns the updated strategy.
 */
export async function toggleStrategy(
  id: string,
  enabled: boolean,
): Promise<Strategy> {
  const [updated] = await db
    .update(strategies)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(strategies.id, id))
    .returning();
  return updated!;
}
