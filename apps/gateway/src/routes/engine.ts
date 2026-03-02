import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';

/**
 * Engine control routes.
 * GET    /api/v1/engine/status  - Read engine status
 * POST   /api/v1/engine/start   - Start the trading engine
 * POST   /api/v1/engine/stop    - Stop the trading engine
 * PATCH  /api/v1/engine/config  - Update engine configuration
 * GET    /api/v1/engine/cycles  - Get cycle history with agent outputs
 */

export const engineRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CycleAgentOutput {
  quantBias: 'bullish' | 'bearish' | 'neutral';
  quantConfidence: number;
  quantSignals: Array<{
    instrument: string;
    direction: 'long' | 'short';
    indicator: string;
    confidence: number;
  }>;
  sentimentScore: number;
  sentimentLabel: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  macroRegime: 'risk-on' | 'risk-off' | 'transition' | 'neutral';
  macroRiskLevel: 'low' | 'normal' | 'elevated' | 'extreme';
}

interface CycleDecision {
  instrument: string;
  direction: 'long' | 'short';
  confidence: number;
  approved: boolean;
  rejectionReason?: string;
}

interface CycleExecution {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: 'filled' | 'simulated' | 'cancelled' | 'failed';
  slippage?: number;
}

interface CycleResult {
  id: string;
  cycleNumber: number;
  timestamp: string;
  status: 'completed' | 'no_signals' | 'circuit_breaker' | 'error';
  durationMs: number;
  agents: CycleAgentOutput;
  decisions: CycleDecision[];
  riskAssessment: {
    portfolioHeat: number;
    drawdownPercent: number;
    approved: number;
    rejected: number;
  };
  executions: CycleExecution[];
  summary: string;
}

// ---------------------------------------------------------------------------
// In-memory engine state
// ---------------------------------------------------------------------------

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
    cycleIntervalMs: 300000,
    markets: ['crypto'],
    paperMode: true,
  },
};

const cycleHistory: CycleResult[] = [];
const MAX_CYCLE_HISTORY = 100;
let cycleTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Cycle simulation
// ---------------------------------------------------------------------------

const INSTRUMENTS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD'];
const INDICATORS = ['EMA Crossover', 'RSI Divergence', 'MACD Signal', 'Bollinger Breakout', 'Volume Surge', 'Smart Money OB'];
const BIASES: Array<'bullish' | 'bearish' | 'neutral'> = ['bullish', 'bearish', 'neutral'];
const REGIMES: Array<'risk-on' | 'risk-off' | 'transition' | 'neutral'> = ['risk-on', 'risk-off', 'transition', 'neutral'];
const RISK_LEVELS: Array<'low' | 'normal' | 'elevated' | 'extreme'> = ['low', 'normal', 'elevated', 'extreme'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min: number, max: number): number { return min + Math.random() * (max - min); }

function generateCycle(): CycleResult {
  engineState.cycleCount += 1;
  const cycleNum = engineState.cycleCount;

  const quantBias = pick(BIASES);
  const quantConfidence = Math.round(rand(0.4, 0.95) * 100) / 100;
  const sentimentScore = Math.round(rand(-0.8, 0.8) * 100) / 100;
  const macroRegime = pick(REGIMES);
  const macroRiskLevel = macroRegime === 'risk-off' ? pick(['elevated', 'extreme'] as const) :
    macroRegime === 'risk-on' ? pick(['low', 'normal'] as const) : pick(RISK_LEVELS);

  const signalCount = Math.floor(rand(1, 4));
  const quantSignals = Array.from({ length: signalCount }, () => ({
    instrument: pick(INSTRUMENTS),
    direction: quantBias === 'bearish' ? 'short' as const : quantBias === 'bullish' ? 'long' as const : pick(['long', 'short'] as const),
    indicator: pick(INDICATORS),
    confidence: Math.round(rand(0.5, 0.9) * 100) / 100,
  }));

  const decisions: CycleDecision[] = quantSignals
    .filter(s => s.confidence >= 0.6)
    .map(s => {
      const riskOk = macroRiskLevel !== 'extreme' && Math.random() > 0.25;
      return {
        instrument: s.instrument,
        direction: s.direction,
        confidence: s.confidence,
        approved: riskOk,
        rejectionReason: !riskOk
          ? macroRiskLevel === 'extreme' ? 'Macro risk extreme — all trades halted' : 'Portfolio heat limit exceeded'
          : undefined,
      };
    });

  const approved = decisions.filter(d => d.approved);
  const rejected = decisions.filter(d => !d.approved);

  const executions: CycleExecution[] = approved.map(d => {
    const basePrice = d.instrument.includes('BTC') ? rand(90000, 105000) :
      d.instrument.includes('ETH') ? rand(3000, 4000) :
        d.instrument.includes('SOL') ? rand(100, 250) : rand(10, 80);
    return {
      instrument: d.instrument,
      side: d.direction === 'long' ? 'buy' as const : 'sell' as const,
      quantity: Math.round(rand(0.01, 1) * 1000) / 1000,
      price: Math.round(basePrice * 100) / 100,
      status: 'simulated' as const,
      slippage: Math.round(rand(0.5, 5) * 10) / 10,
    };
  });

  const durationMs = Math.round(rand(800, 4500));
  const status: CycleResult['status'] = macroRiskLevel === 'extreme' ? 'circuit_breaker' :
    decisions.length === 0 ? 'no_signals' : 'completed';

  let summary = '';
  if (status === 'circuit_breaker') {
    summary = `Circuit breaker — macro risk extreme. No trades.`;
  } else if (status === 'no_signals') {
    summary = `No signals. Quant ${quantBias} (${(quantConfidence * 100).toFixed(0)}%), Sentiment ${sentimentScore > 0 ? '+' : ''}${sentimentScore.toFixed(2)}.`;
  } else if (executions.length > 0) {
    const exec = executions[0];
    const more = executions.length > 1 ? ` (+${executions.length - 1} more)` : '';
    summary = `${exec.side.toUpperCase()} ${exec.quantity} ${exec.instrument} @ $${exec.price.toLocaleString()}${more} — Quant ${quantBias}, Sentiment ${sentimentScore.toFixed(2)}, ${macroRegime}`;
  } else {
    summary = `${rejected.length} signal(s) risk-rejected.`;
  }

  const cycle: CycleResult = {
    id: `cycle-${cycleNum}-${Date.now()}`,
    cycleNumber: cycleNum,
    timestamp: new Date().toISOString(),
    status,
    durationMs,
    agents: {
      quantBias, quantConfidence, quantSignals,
      sentimentScore,
      sentimentLabel: sentimentScore > 0.3 ? 'bullish' : sentimentScore < -0.3 ? 'bearish' : 'neutral',
      macroRegime, macroRiskLevel,
    },
    decisions,
    riskAssessment: {
      portfolioHeat: Math.round(rand(0, 6) * 100) / 100,
      drawdownPercent: Math.round(rand(0, 3) * 100) / 100,
      approved: approved.length,
      rejected: rejected.length,
    },
    executions,
    summary,
  };

  cycleHistory.unshift(cycle);
  if (cycleHistory.length > MAX_CYCLE_HISTORY) cycleHistory.pop();
  engineState.lastCycleAt = cycle.timestamp;

  console.log(`[Engine] Cycle #${cycleNum}: ${status} — ${summary}`);
  return cycle;
}

function startCycleLoop(): void {
  if (cycleTimer) return;
  generateCycle();
  cycleTimer = setInterval(() => {
    if (engineState.status === 'running') generateCycle();
  }, engineState.config.cycleIntervalMs);
}

function stopCycleLoop(): void {
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ConfigSchema = z.object({
  cycleIntervalMs: z.number().min(10000).max(3600000).optional(),
  markets: z.array(z.enum(['crypto', 'equities', 'prediction'])).optional(),
  paperMode: z.boolean().optional(),
});

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

engineRouter.get('/cycles', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
  res.json({
    data: cycleHistory.slice(0, limit),
    total: cycleHistory.length,
  });
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
