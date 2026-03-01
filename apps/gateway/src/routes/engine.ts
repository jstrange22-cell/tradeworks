import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';

/**
 * Engine control routes.
 * GET    /api/v1/engine/status  - Read engine status
 * POST   /api/v1/engine/start   - Start the trading engine
 * POST   /api/v1/engine/stop    - Stop the trading engine
 * PATCH  /api/v1/engine/config  - Update engine configuration
 */

export const engineRouter: RouterType = Router();

// In-memory engine state (will be replaced by Redis when available)
let engineState: {
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  startedAt: string | null;
  cycleCount: number;
  lastCycleAt: string | null;
  config: {
    cycleIntervalMs: number;
    markets: string[];
    paperMode: boolean;
  };
} = {
  status: 'stopped',
  startedAt: null,
  cycleCount: 0,
  lastCycleAt: null,
  config: {
    cycleIntervalMs: 300000, // 5 min default
    markets: ['crypto'],
    paperMode: true,
  },
};

const ConfigSchema = z.object({
  cycleIntervalMs: z.number().min(10000).max(3600000).optional(),
  markets: z.array(z.enum(['crypto', 'equities', 'prediction'])).optional(),
  paperMode: z.boolean().optional(),
});

/**
 * GET /
 * Get current engine status.
 */
engineRouter.get('/status', (_req, res) => {
  res.json({
    data: {
      ...engineState,
      uptime: engineState.startedAt
        ? Date.now() - new Date(engineState.startedAt).getTime()
        : 0,
    },
  });
});

/**
 * POST /start
 * Start the trading engine.
 */
engineRouter.post('/start', (_req, res) => {
  if (engineState.status === 'running') {
    res.status(400).json({ error: 'Engine is already running' });
    return;
  }

  engineState.status = 'running';
  engineState.startedAt = new Date().toISOString();

  // Try to publish to Redis if available
  try {
    // Will be wired to Redis pub/sub when engine service subscribes
    console.log('[Engine] Start command issued');
  } catch {
    // Redis not available, that's fine for now
  }

  res.json({
    data: engineState,
    message: 'Engine started',
  });
});

/**
 * POST /stop
 * Stop the trading engine.
 */
engineRouter.post('/stop', (_req, res) => {
  if (engineState.status === 'stopped') {
    res.status(400).json({ error: 'Engine is already stopped' });
    return;
  }

  engineState.status = 'stopped';
  engineState.startedAt = null;

  try {
    console.log('[Engine] Stop command issued');
  } catch {
    // Redis not available
  }

  res.json({
    data: engineState,
    message: 'Engine stopped',
  });
});

/**
 * PATCH /config
 * Update engine configuration.
 */
engineRouter.patch('/config', (req, res) => {
  try {
    const updates = ConfigSchema.parse(req.body);

    if (updates.cycleIntervalMs !== undefined) {
      engineState.config.cycleIntervalMs = updates.cycleIntervalMs;
    }
    if (updates.markets !== undefined) {
      engineState.config.markets = updates.markets;
    }
    if (updates.paperMode !== undefined) {
      engineState.config.paperMode = updates.paperMode;
    }

    res.json({
      data: engineState.config,
      message: 'Engine configuration updated',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid config', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to update config' });
  }
});
