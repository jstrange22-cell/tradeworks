import { Router, type Router as RouterType } from 'express';
import {
  eq,
  db,
  tradingCycles,
  getAgentLogs,
  getRecentAgentActivity,
  getRecentCycles,
  type AgentLog,
} from '@tradeworks/db';
import {
  agentLiveStatus,
  lastCycleSummary,
  cycleInProgress,
  getEngineState,
} from './engine.js';

/**
 * Agent routes.
 * GET /api/v1/agents/status        - Get status of all agents
 * GET /api/v1/agents/cycles        - Get recent cycle history
 * GET /api/v1/agents/cycles/:cycleId - Get details of a specific cycle
 * GET /api/v1/agents/logs          - Get recent agent log entries
 */

export const agentsRouter: RouterType = Router();

/** Static agent definitions (model, tools). */
const AGENT_DEFINITIONS = [
  {
    name: 'Quant Analyst',
    model: 'sonnet',
    tools: ['computeIndicators', 'detectPatterns', 'getSignalScore', 'getCandles', 'getOrderBook'],
  },
  {
    name: 'Sentiment Analyst',
    model: 'sonnet',
    tools: ['getSentiment', 'getCandles'],
  },
  {
    name: 'Macro Analyst',
    model: 'haiku',
    tools: ['getMacroData', 'getCandles'],
  },
  {
    name: 'Risk Guardian',
    model: 'sonnet',
    tools: ['checkRisk', 'getPortfolioHeat', 'calculatePositionSize', 'getVaR', 'getPositions'],
  },
  {
    name: 'Execution Specialist',
    model: 'sonnet',
    tools: ['executeTrade', 'cancelOrder', 'getPositions', 'closePosition', 'getOrderBook'],
  },
];

/**
 * GET /api/v1/agents/status
 * Get current status of all trading agents.
 */
agentsRouter.get('/status', async (_req, res) => {
  try {
    // Start with static agent definitions, then enhance with DB data
    let recentActivity: AgentLog[] = [];
    let cycleCount = 0;
    let lastCycleAt: string | null = null;

    try {
      recentActivity = await getRecentAgentActivity(50);
      const recentCycles = await getRecentCycles(1);
      if (recentCycles.length > 0) {
        const latestCycle = recentCycles[0]!;
        cycleCount = latestCycle.cycleNumber;
        lastCycleAt = latestCycle.startedAt.toISOString();
      }
    } catch (dbError) {
      console.warn('[Agents] DB unavailable for agent status, using static defaults:', dbError);
    }

    // Build a lookup of per-agent stats from recent activity
    const agentStats = new Map<
      string,
      { lastRunAt: string | null; lastDurationMs: number | null; totalRuns: number; errorCount: number }
    >();

    for (const log of recentActivity) {
      const key = log.agentType;
      if (!agentStats.has(key)) {
        agentStats.set(key, {
          lastRunAt: log.createdAt.toISOString(),
          lastDurationMs: log.durationMs,
          totalRuns: 0,
          errorCount: 0,
        });
      }
      const stats = agentStats.get(key)!;
      stats.totalRuns += 1;
      if (log.action.toLowerCase().includes('error')) {
        stats.errorCount += 1;
      }
    }

    // Get live engine state for orchestrator status
    const engineState = getEngineState();

    const agents = AGENT_DEFINITIONS.map((def) => {
      // Try to match the agent definition name to agentType in logs
      // Agent types in logs may use snake_case or different casing
      const normalizedName = def.name.toLowerCase().replace(/\s+/g, '_');
      const stats = agentStats.get(normalizedName) ??
        agentStats.get(def.name) ??
        { lastRunAt: null, lastDurationMs: null, totalRuns: 0, errorCount: 0 };

      // Use live status from engine during active cycles, fall back to 'idle'
      const livePhase = agentLiveStatus.get(def.name) ?? 'idle';

      return {
        name: def.name,
        model: def.model,
        status: livePhase === 'evaluating' ? 'deciding' as const : livePhase as 'idle' | 'analyzing' | 'executing',
        lastRunAt: stats.lastRunAt,
        lastDurationMs: stats.lastDurationMs,
        totalRuns: stats.totalRuns,
        errorCount: stats.errorCount,
        tools: def.tools,
      };
    });

    const cycleIntervalMs = engineState.config?.cycleIntervalMs ?? parseInt(process.env.CYCLE_INTERVAL_MS ?? '300000', 10);

    // Determine orchestrator status from engine state
    const orchestratorStatus = cycleInProgress
      ? 'analyzing'
      : engineState.status === 'running'
        ? 'running'
        : 'idle';

    res.json({
      data: agents,
      orchestrator: {
        status: orchestratorStatus,
        cycleCount: engineState.cycleCount || cycleCount,
        cycleIntervalMs,
        lastCycleAt: engineState.lastCycleAt || lastCycleAt,
        nextCycleAt: (engineState.lastCycleAt || lastCycleAt)
          ? new Date(new Date(engineState.lastCycleAt || lastCycleAt!).getTime() + cycleIntervalMs).toISOString()
          : null,
        cycleInProgress,
      },
      lastCycle: lastCycleSummary,
    });
  } catch (error) {
    console.error('[Agents] Error fetching agent status:', error);
    res.status(500).json({ error: 'Failed to fetch agent status' });
  }
});

/**
 * GET /api/v1/agents/cycles
 * Get recent orchestrator cycle history.
 */
agentsRouter.get('/cycles', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const page = parseInt(req.query.page as string, 10) || 1;

    let cycles: unknown[] = [];
    let total = 0;

    try {
      // Fetch one extra page worth to estimate if there are more
      const allCycles = await getRecentCycles(limit * page);
      total = allCycles.length;
      // Slice to the requested page
      const startIdx = (page - 1) * limit;
      cycles = allCycles.slice(startIdx, startIdx + limit);
    } catch (dbError) {
      console.warn('[Agents] DB unavailable for cycle history, returning empty:', dbError);
    }

    res.json({
      data: cycles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    console.error('[Agents] Error fetching cycle history:', error);
    res.status(500).json({ error: 'Failed to fetch cycle history' });
  }
});

/**
 * GET /api/v1/agents/cycles/:cycleId
 * Get detailed information about a specific cycle.
 */
agentsRouter.get('/cycles/:cycleId', async (req, res) => {
  try {
    const { cycleId } = req.params;

    let cycle = null;

    try {
      const [found] = await db
        .select()
        .from(tradingCycles)
        .where(eq(tradingCycles.id, cycleId))
        .limit(1);
      cycle = found ?? null;
    } catch (dbError) {
      console.warn('[Agents] DB unavailable for cycle detail:', dbError);
    }

    if (!cycle) {
      res.status(404).json({ error: `Cycle ${cycleId} not found` });
      return;
    }

    res.json({ data: cycle });
  } catch (error) {
    console.error('[Agents] Error fetching cycle details:', error);
    res.status(500).json({ error: 'Failed to fetch cycle details' });
  }
});

/**
 * GET /api/v1/agents/logs
 * Get recent agent log entries.
 */
agentsRouter.get('/logs', async (req, res) => {
  try {
    const agentName = req.query.agent as string | undefined;
    const level = req.query.level as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    let logs: unknown[] = [];

    try {
      logs = await getAgentLogs({
        agentType: agentName,
        limit,
      });
    } catch (dbError) {
      console.warn('[Agents] DB unavailable for agent logs, returning empty:', dbError);
    }

    res.json({
      data: logs,
      filters: {
        agent: agentName ?? 'all',
        level: level ?? 'all',
        limit,
      },
    });
  } catch (error) {
    console.error('[Agents] Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch agent logs' });
  }
});
