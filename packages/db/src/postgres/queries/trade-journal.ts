import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { db } from '../client.js';
import { tradeJournals, type TradeJournal, type NewTradeJournal } from '../schema.js';

/**
 * Get all journal entries, newest first.
 */
export async function getJournalEntries(limit = 100): Promise<TradeJournal[]> {
  return db
    .select()
    .from(tradeJournals)
    .orderBy(desc(tradeJournals.createdAt))
    .limit(limit);
}

/**
 * Get a single journal entry by ID.
 */
export async function getJournalEntry(id: string): Promise<TradeJournal | undefined> {
  const [entry] = await db
    .select()
    .from(tradeJournals)
    .where(eq(tradeJournals.id, id))
    .limit(1);
  return entry;
}

/**
 * Get journal entry linked to a specific trade.
 */
export async function getJournalByTradeId(tradeId: string): Promise<TradeJournal | undefined> {
  const [entry] = await db
    .select()
    .from(tradeJournals)
    .where(eq(tradeJournals.tradeId, tradeId))
    .limit(1);
  return entry;
}

/**
 * Get journal entries within a date range.
 */
export async function getJournalEntriesByDateRange(
  from: Date,
  to: Date,
  limit = 200,
): Promise<TradeJournal[]> {
  return db
    .select()
    .from(tradeJournals)
    .where(and(
      gte(tradeJournals.createdAt, from),
      lte(tradeJournals.createdAt, to),
    ))
    .orderBy(desc(tradeJournals.createdAt))
    .limit(limit);
}

/**
 * Create a new journal entry.
 */
export async function createJournalEntry(data: NewTradeJournal): Promise<TradeJournal> {
  const [entry] = await db.insert(tradeJournals).values(data).returning();
  return entry!;
}

/**
 * Update an existing journal entry.
 */
export async function updateJournalEntry(
  id: string,
  data: Partial<Pick<NewTradeJournal,
    'notes' | 'tags' | 'emotionalState' | 'lessonsLearned' | 'rating' | 'screenshots'
    | 'instrument' | 'market' | 'side' | 'entryPrice' | 'exitPrice' | 'pnl' | 'strategyUsed'
  >>,
): Promise<TradeJournal | undefined> {
  const [updated] = await db
    .update(tradeJournals)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tradeJournals.id, id))
    .returning();
  return updated;
}

/**
 * Delete a journal entry.
 */
export async function deleteJournalEntry(id: string): Promise<void> {
  await db.delete(tradeJournals).where(eq(tradeJournals.id, id));
}

/**
 * Get tag statistics across all journal entries.
 */
export async function getJournalTagStats(): Promise<Array<{ tag: string; count: number }>> {
  const entries = await db
    .select({ tags: tradeJournals.tags })
    .from(tradeJournals);

  const tagMap = new Map<string, number>();
  for (const entry of entries) {
    const tags = (entry.tags ?? []) as string[];
    for (const tag of tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
