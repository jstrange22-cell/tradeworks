import { eq, desc } from 'drizzle-orm';
import { db } from '../client.js';
import { backtestRuns, type BacktestRun, type NewBacktestRun } from '../schema.js';

/**
 * Insert a new backtest run.
 */
export async function createBacktest(data: NewBacktestRun): Promise<BacktestRun> {
  const [inserted] = await db.insert(backtestRuns).values(data).returning();
  return inserted!;
}

/**
 * Partially update a backtest run by ID (e.g. set results, status, metrics).
 * Returns the updated backtest run.
 */
export async function updateBacktest(
  id: string,
  data: Partial<Pick<
    NewBacktestRun,
    | 'status'
    | 'finalCapital'
    | 'totalTrades'
    | 'winRate'
    | 'sharpeRatio'
    | 'sortinoRatio'
    | 'maxDrawdown'
    | 'profitFactor'
    | 'calmarRatio'
    | 'resultsJson'
  >>,
): Promise<BacktestRun> {
  const [updated] = await db
    .update(backtestRuns)
    .set(data)
    .where(eq(backtestRuns.id, id))
    .returning();
  return updated!;
}

/**
 * Retrieve all backtest runs for a given strategy, newest first.
 */
export async function getBacktestsByStrategy(
  strategyId: string,
): Promise<BacktestRun[]> {
  return db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.strategyId, strategyId))
    .orderBy(desc(backtestRuns.createdAt));
}

/**
 * Retrieve a single backtest run by ID.
 */
export async function getBacktest(id: string): Promise<BacktestRun | undefined> {
  const [run] = await db
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.id, id))
    .limit(1);
  return run;
}
