import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { userSettings, type UserSetting } from '../schema.js';

/**
 * Get a single setting by key.
 */
export async function getSetting(key: string): Promise<UserSetting | undefined> {
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.key, key))
    .limit(1);
  return rows[0];
}

/**
 * Get all settings.
 */
export async function getAllSettings(): Promise<UserSetting[]> {
  return db.select().from(userSettings);
}

/**
 * Set (upsert) a setting by key. Creates if missing, updates if present.
 */
export async function setSetting(
  key: string,
  value: Record<string, unknown> | unknown[],
): Promise<UserSetting> {
  const existing = await getSetting(key);

  if (existing) {
    const updated = await db
      .update(userSettings)
      .set({
        value,
        updatedAt: new Date(),
      })
      .where(eq(userSettings.key, key))
      .returning();
    return updated[0]!;
  }

  const inserted = await db
    .insert(userSettings)
    .values({
      key,
      value,
    })
    .returning();
  return inserted[0]!;
}

/**
 * Delete a setting by key.
 */
export async function deleteSetting(key: string): Promise<void> {
  await db.delete(userSettings).where(eq(userSettings.key, key));
}
