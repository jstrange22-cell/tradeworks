import { eq, desc, and } from 'drizzle-orm';
import { db } from '../client.js';
import { agentLogs, type AgentLog, type NewAgentLog } from '../schema.js';

/**
 * Insert a new agent log entry.
 */
export async function insertAgentLog(data: NewAgentLog): Promise<AgentLog> {
  const [inserted] = await db.insert(agentLogs).values(data).returning();
  return inserted!;
}

/**
 * Retrieve agent logs with optional filters.
 */
export async function getAgentLogs(options: {
  cycleId?: string;
  agentType?: string;
  limit?: number;
} = {}): Promise<AgentLog[]> {
  const { cycleId, agentType, limit = 100 } = options;

  const conditions = [];
  if (cycleId) conditions.push(eq(agentLogs.parentCycleId, cycleId));
  if (agentType) conditions.push(eq(agentLogs.agentType, agentType));

  const query = db
    .select()
    .from(agentLogs)
    .orderBy(desc(agentLogs.createdAt))
    .limit(limit);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }

  return query;
}

/**
 * Retrieve the most recent agent activity logs.
 */
export async function getRecentAgentActivity(limit = 20): Promise<AgentLog[]> {
  return db
    .select()
    .from(agentLogs)
    .orderBy(desc(agentLogs.createdAt))
    .limit(limit);
}
