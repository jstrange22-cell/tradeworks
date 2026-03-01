import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mock @tradeworks/db before any imports that use it
vi.mock('@tradeworks/db', () => {
  const mockRedisClient = {
    publish: vi.fn().mockResolvedValue(0),
    ping: vi.fn().mockResolvedValue('PONG'),
  };

  return {
    db: {
      execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue([]),
      }),
    },
    pool: {
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    },
    getRedisClient: vi.fn(() => mockRedisClient),
    getDefaultPortfolio: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getOpenPositions: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getTradesByPortfolio: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getAgentLogs: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getRecentCycles: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getLatestRiskSnapshot: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getRiskHistory: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    updatePortfolio: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getStrategies: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    getStrategy: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    createStrategy: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    updateStrategy: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    toggleStrategy: vi.fn().mockRejectedValue(new Error('DB not available in test')),
    requireRole: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  };
});

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join('?'),
    values,
  }),
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  count: vi.fn(),
}));

import { createTestApp } from './test-app.js';

const app = createTestApp();

// ─── Health Routes ────────────────────────────────────────────────────────

describe('GET /api/v1/health', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('services');
    expect(res.body.services).toHaveProperty('gateway', 'running');
  });

  it('should include environment info', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.environment).toBeDefined();
    expect(typeof res.body.timestamp).toBe('string');
    // Should be a valid ISO date
    expect(new Date(res.body.timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ─── Portfolio Routes ─────────────────────────────────────────────────────

describe('GET /api/v1/portfolio', () => {
  it('should return portfolio data (fallback mode)', async () => {
    const res = await request(app).get('/api/v1/portfolio');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('equity');
    expect(res.body).toHaveProperty('initialCapital');
    expect(res.body).toHaveProperty('dailyPnl');
    expect(res.body).toHaveProperty('dailyPnlPercent');
    expect(res.body).toHaveProperty('totalPnl');
    expect(res.body).toHaveProperty('winRate');
    expect(res.body).toHaveProperty('totalTrades');
    expect(res.body).toHaveProperty('openPositions');
    expect(res.body).toHaveProperty('recentTrades');
    expect(res.body).toHaveProperty('equityCurve');
    expect(res.body).toHaveProperty('paperTrading');
    expect(res.body).toHaveProperty('circuitBreaker');
  });

  it('should return numeric values', async () => {
    const res = await request(app).get('/api/v1/portfolio');

    expect(typeof res.body.equity).toBe('number');
    expect(typeof res.body.initialCapital).toBe('number');
    expect(typeof res.body.dailyPnl).toBe('number');
    expect(typeof res.body.winRate).toBe('number');
    expect(typeof res.body.totalTrades).toBe('number');
  });

  it('should return positions as array', async () => {
    const res = await request(app).get('/api/v1/portfolio');

    expect(Array.isArray(res.body.openPositions)).toBe(true);
    expect(res.body.openPositions.length).toBeGreaterThan(0);

    const pos = res.body.openPositions[0];
    expect(pos).toHaveProperty('id');
    expect(pos).toHaveProperty('instrument');
    expect(pos).toHaveProperty('side');
    expect(pos).toHaveProperty('quantity');
  });

  it('should return equity curve as array', async () => {
    const res = await request(app).get('/api/v1/portfolio');

    expect(Array.isArray(res.body.equityCurve)).toBe(true);
    expect(res.body.equityCurve.length).toBeGreaterThan(0);

    const point = res.body.equityCurve[0];
    expect(point).toHaveProperty('date');
    expect(point).toHaveProperty('equity');
  });
});

describe('GET /api/v1/portfolio/positions', () => {
  it('should return positions with summary', async () => {
    const res = await request(app).get('/api/v1/portfolio/positions');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('positions');
    expect(res.body).toHaveProperty('summary');
    expect(Array.isArray(res.body.positions)).toBe(true);
    expect(typeof res.body.summary.total).toBe('number');
    expect(typeof res.body.summary.totalUnrealizedPnl).toBe('number');
    expect(Array.isArray(res.body.summary.markets)).toBe(true);
  });
});

describe('GET /api/v1/portfolio/trades', () => {
  it('should return paginated trades', async () => {
    const res = await request(app).get('/api/v1/portfolio/trades');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('trades');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('totalPages');
    expect(Array.isArray(res.body.trades)).toBe(true);
  });

  it('should support pagination params', async () => {
    const res = await request(app)
      .get('/api/v1/portfolio/trades')
      .query({ page: 0, limit: 3 });

    expect(res.status).toBe(200);
    expect(res.body.trades.length).toBeLessThanOrEqual(3);
    expect(res.body.page).toBe(0);
  });
});

describe('GET /api/v1/portfolio/equity-curve', () => {
  it('should return equity curve data', async () => {
    const res = await request(app).get('/api/v1/portfolio/equity-curve');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/portfolio/allocation', () => {
  it('should return allocation breakdown', async () => {
    const res = await request(app).get('/api/v1/portfolio/allocation');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);

    const item = res.body.data[0];
    expect(item).toHaveProperty('market');
    expect(item).toHaveProperty('value');
    expect(item).toHaveProperty('percent');
  });
});

describe('GET /api/v1/portfolio/agents', () => {
  it('should return agents, logs, and cycles', async () => {
    const res = await request(app).get('/api/v1/portfolio/agents');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agents');
    expect(res.body).toHaveProperty('logs');
    expect(res.body).toHaveProperty('cycles');
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(Array.isArray(res.body.cycles)).toBe(true);
  });

  it('should include all 5 agent types', async () => {
    const res = await request(app).get('/api/v1/portfolio/agents');

    const agentTypes = res.body.agents.map((a: { agentType: string }) => a.agentType);
    expect(agentTypes).toContain('quant');
    expect(agentTypes).toContain('sentiment');
    expect(agentTypes).toContain('macro');
    expect(agentTypes).toContain('risk');
    expect(agentTypes).toContain('execution');
  });
});

describe('GET /api/v1/portfolio/risk', () => {
  it('should return risk metrics', async () => {
    const res = await request(app).get('/api/v1/portfolio/risk');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('equity');
    expect(res.body).toHaveProperty('portfolioHeat');
    expect(res.body).toHaveProperty('var95');
    expect(res.body).toHaveProperty('var99');
    expect(res.body).toHaveProperty('maxDrawdown');
    expect(res.body).toHaveProperty('circuitBreakerActive');
    expect(res.body).toHaveProperty('riskLimits');
    expect(res.body).toHaveProperty('exposureByMarket');
    expect(res.body).toHaveProperty('drawdownHistory');
  });

  it('should include risk limits as array', async () => {
    const res = await request(app).get('/api/v1/portfolio/risk');

    expect(Array.isArray(res.body.riskLimits)).toBe(true);
    expect(res.body.riskLimits.length).toBeGreaterThan(0);

    const limit = res.body.riskLimits[0];
    expect(limit).toHaveProperty('metric');
    expect(limit).toHaveProperty('current');
    expect(limit).toHaveProperty('limit');
    expect(limit).toHaveProperty('unit');
  });
});

describe('PATCH /api/v1/portfolio/mode', () => {
  it('should toggle to paper mode', async () => {
    const res = await request(app)
      .patch('/api/v1/portfolio/mode')
      .send({ mode: 'paper' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('paper');
    expect(res.body.paperTrading).toBe(true);
  });

  it('should toggle to live mode', async () => {
    const res = await request(app)
      .patch('/api/v1/portfolio/mode')
      .send({ mode: 'live' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('live');
    expect(res.body.paperTrading).toBe(false);
  });

  it('should reject invalid mode', async () => {
    const res = await request(app)
      .patch('/api/v1/portfolio/mode')
      .send({ mode: 'turbo' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('mode must be');
  });
});

describe('POST /api/v1/portfolio/circuit-breaker', () => {
  it('should activate circuit breaker', async () => {
    const res = await request(app)
      .post('/api/v1/portfolio/circuit-breaker')
      .send({ active: true });

    expect(res.status).toBe(200);
    expect(res.body.circuitBreakerActive).toBe(true);
  });

  it('should deactivate circuit breaker', async () => {
    const res = await request(app)
      .post('/api/v1/portfolio/circuit-breaker')
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.circuitBreakerActive).toBe(false);
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Not found');
  });
});
