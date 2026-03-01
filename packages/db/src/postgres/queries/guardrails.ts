import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { guardrails, type Guardrail, type NewGuardrail } from '../schema.js';

/**
 * Get all guardrails.
 */
export async function getGuardrails(): Promise<Guardrail[]> {
  return db.select().from(guardrails);
}

/**
 * Get a specific guardrail by type.
 */
export async function getGuardrailByType(
  guardrailType: NewGuardrail['guardrailType'],
): Promise<Guardrail | undefined> {
  const rows = await db
    .select()
    .from(guardrails)
    .where(eq(guardrails.guardrailType, guardrailType))
    .limit(1);
  return rows[0];
}

/**
 * Upsert a guardrail — insert if it doesn't exist, update if it does.
 * We match on guardrailType since each type should only have one row.
 */
export async function upsertGuardrail(
  guardrailType: NewGuardrail['guardrailType'],
  value: Record<string, unknown>,
  enabled: boolean = true,
): Promise<Guardrail> {
  const existing = await getGuardrailByType(guardrailType);

  if (existing) {
    const updated = await db
      .update(guardrails)
      .set({
        value,
        enabled,
        updatedAt: new Date(),
      })
      .where(eq(guardrails.id, existing.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db
    .insert(guardrails)
    .values({
      guardrailType,
      value,
      enabled,
    })
    .returning();
  return inserted[0]!;
}

/**
 * Delete a guardrail by ID.
 */
export async function deleteGuardrail(id: string): Promise<void> {
  await db.delete(guardrails).where(eq(guardrails.id, id));
}
