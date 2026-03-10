import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  engineState,
  getCircuitBreakerStatus,
  tripCircuitBreaker,
  resetCircuitBreaker,
  testCoinbaseAndUpdateState,
  startCycleLoop,
  stopCycleLoop,
  getCycleHistory,
  initEngine,
  // Re-export for consumers that currently import from engine.ts
  agentLiveStatus,
  lastCycleSummary,
  cycleInProgress,
  getEngineState,
  type AgentPhase,
} from '../services/cycle-service.js';

/**
 * Engine control routes.
 * GET    /api/v1/engine/status  - Read engine status
 * POST   /api/v1/engine/start   - Start the trading engine
 * POST   /api/v1/engine/stop    - Stop the trading engine
 * PATCH  /api/v1/engine/config  - Update engine configuration
 * GET    /api/v1/engine/cycles  - Get cycle history with agent outputs
 * GET    /api/v1/engine/circuit-breaker - Get circuit breaker state
 * POST   /api/v1/engine/circuit-breaker/reset - Manually reset circuit breaker
 */

export const engineRouter: RouterType = Router();

// Re-export everything that other route files currently import from here.
// This keeps agents.ts, health.ts, and index.ts working without changes.
export {
  agentLiveStatus,
  lastCycleSummary,
  cycleInProgress,
  getEngineState,
  getCircuitBreakerStatus,
  initEngine,
  type AgentPhase,
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ConfigSchema = z.object({
  cycleIntervalMs: z.number().min(10000).max(3600000).optional(),
  markets: z.array(z.enum(['crypto', 'equities', 'prediction'])).optional(),
  paperMode: z.boolean().optional(),
});

engineRouter.get('/status', (_req, res) => {
  const cbState = getCircuitBreakerStatus();
  res.json({
    data: {
      ...engineState,
      uptime: engineState.startedAt
        ? Date.now() - new Date(engineState.startedAt).getTime()
        : 0,
      coinbaseConnected: engineState.coinbaseConnected,
      coinbaseAccounts: engineState.coinbaseAccounts,
      circuitBreaker: {
        tripped: cbState.tripped,
        reason: cbState.reason,
        trippedAt: cbState.trippedAt,
        canResumeAt: cbState.canResumeAt,
      },
    },
  });
});

engineRouter.get('/cycles', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
  const result = getCycleHistory(limit);
  res.json(result);
});

engineRouter.get('/test-coinbase', async (_req, res) => {
  const result = await testCoinbaseAndUpdateState();
  res.json({ data: result });
});

engineRouter.post('/start', (_req, res) => {
  if (engineState.status === 'running') {
    res.status(400).json({ error: 'Engine is already running' });
    return;
  }

  engineState.status = 'running';
  engineState.startedAt = new Date().toISOString();
  startCycleLoop();

  res.json({ data: engineState, message: 'Engine started' });
});

engineRouter.post('/stop', (_req, res) => {
  if (engineState.status === 'stopped') {
    res.status(400).json({ error: 'Engine is already stopped' });
    return;
  }

  engineState.status = 'stopped';
  engineState.startedAt = null;
  stopCycleLoop();

  res.json({ data: engineState, message: 'Engine stopped' });
});

engineRouter.patch('/config', (req, res) => {
  try {
    const updates = ConfigSchema.parse(req.body);

    if (updates.cycleIntervalMs !== undefined) {
      engineState.config.cycleIntervalMs = updates.cycleIntervalMs;
      if (engineState.status === 'running') { stopCycleLoop(); startCycleLoop(); }
    }
    if (updates.markets !== undefined) {
      engineState.config.markets = updates.markets;
    }
    if (updates.paperMode !== undefined) {
      engineState.config.paperMode = updates.paperMode;
    }

    res.json({ data: engineState.config, message: 'Engine configuration updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid config', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// ---------------------------------------------------------------------------
// Circuit Breaker Routes
// ---------------------------------------------------------------------------

engineRouter.get('/circuit-breaker', (_req, res) => {
  res.json({ data: getCircuitBreakerStatus() });
});

engineRouter.post('/circuit-breaker/reset', (_req, res) => {
  const cbState = getCircuitBreakerStatus();
  if (!cbState.tripped) {
    res.status(400).json({ error: 'Circuit breaker is not tripped' });
    return;
  }
  resetCircuitBreaker();
  res.json({ data: getCircuitBreakerStatus(), message: 'Circuit breaker reset — trading resumed' });
});

engineRouter.post('/circuit-breaker/trip', (req, res) => {
  const reason = (req.body as { reason?: string })?.reason ?? 'Manual trip via API';
  const cbState = getCircuitBreakerStatus();
  if (cbState.tripped) {
    res.status(400).json({ error: 'Circuit breaker is already tripped' });
    return;
  }
  tripCircuitBreaker(reason);
  res.json({ data: getCircuitBreakerStatus(), message: 'Circuit breaker tripped — trading halted' });
});
