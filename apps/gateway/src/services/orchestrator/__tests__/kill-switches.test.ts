/**
 * Unit tests for the multi-level kill-switch orchestrator.
 *
 * Coverage:
 *   1. 5 consecutive losses on a strategy → pauseStrategy fires.
 *   2. Daily DD ≤ -3% of starting capital → pausePortfolio fires.
 *   3. master kill → all subsequent isTradingAllowed return false.
 *   4. resume operations clear state correctly.
 *   5. Persisted state survives a "boot" (re-import of the module via
 *      cache reset).
 *
 * Strategy: stub the `getPool` import from the memory DB module and the
 * `forceFlattenAll` import from the exits monitor. Use a temp `data/`
 * directory under the gateway root by setting cwd-aware path resolution
 * — this module writes to `apps/gateway/data/kill-switch-state.json`
 * which lives under the actual repo so we point it at a tmpdir via the
 * path resolution + jiggering DATA_DIR. Easiest: clean up the file before
 * and after each test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ── Resolve the on-disk state file path the same way the SUT does. ─────

function stateFilePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));     // .../orchestrator/__tests__
  const orchestrator = dirname(here);                        // .../orchestrator
  const services = dirname(orchestrator);                    // .../services
  const srcOrDist = dirname(services);                       // .../src
  const gatewayRoot = dirname(srcOrDist);                    // .../apps/gateway
  return resolve(gatewayRoot, 'data', 'kill-switch-state.json');
}

function cleanStateFile(): void {
  const p = stateFilePath();
  if (existsSync(p)) rmSync(p, { force: true });
}

// ── DB pool mock ────────────────────────────────────────────────────────
// Reset between tests so each test can dictate fresh PnL + outcomes.
//
// We mock at the memory/db.js path because that's exactly what the SUT
// imports.

interface MockPnlRow {
  daily_pnl: number;
  weekly_pnl: number;
  monthly_pnl: number;
}

interface MockOutcomeRow {
  strategy: string;
  realized_pnl_usd: number;
  rn: number;
}

let mockPnl: MockPnlRow = { daily_pnl: 0, weekly_pnl: 0, monthly_pnl: 0 };
let mockOutcomes: MockOutcomeRow[] = [];
let usePool = true;

vi.mock('../../memory/db.js', () => ({
  getPool: () => {
    if (!usePool) return null;
    return {
      query: async (sql: string) => {
        if (sql.includes('FROM trade_outcomes') && sql.includes('SUM(realized_pnl_usd)')) {
          return { rows: [mockPnl] };
        }
        if (sql.includes('ranked')) {
          return { rows: mockOutcomes };
        }
        return { rows: [] };
      },
    };
  },
}));

// ── exits/monitor mock — capture forceFlattenAll calls ─────────────────

const flattenCalls: string[] = [];
vi.mock('../../exits/monitor.js', () => ({
  forceFlattenAll: async (reason: string) => {
    flattenCalls.push(reason);
    return 0;
  },
}));

// ── bandit-runner mock so setTempOverride doesn't need the real file ──

vi.mock('../bandit-runner.js', () => ({
  getBanditWeight: () => 0.5,
  setTempOverride: vi.fn(),
  clearTempOverrides: vi.fn(),
}));

// ── SUT — imported AFTER mocks are set up ──────────────────────────────

import {
  __resetKillSwitchCacheForTests,
  activateMasterKill,
  checkAndActivateAuto,
  deactivateMaster,
  getKillSwitchStatus,
  isTradingAllowed,
  pausePortfolio,
  pauseStrategy,
  resumePortfolio,
  resumeStrategy,
} from '../kill-switches.js';

// ── Hooks ──────────────────────────────────────────────────────────────

beforeEach(() => {
  cleanStateFile();
  __resetKillSwitchCacheForTests();
  mockPnl = { daily_pnl: 0, weekly_pnl: 0, monthly_pnl: 0 };
  mockOutcomes = [];
  flattenCalls.length = 0;
  usePool = true;
});

afterEach(() => {
  cleanStateFile();
  __resetKillSwitchCacheForTests();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('kill-switches: strategy auto-pause', () => {
  it('fires pauseStrategy when 5 consecutive losses appear', async () => {
    // 5 losing trades, in descending recency order (rn 1 = newest).
    mockOutcomes = [
      { strategy: 'pead', realized_pnl_usd: -10, rn: 1 },
      { strategy: 'pead', realized_pnl_usd: -8,  rn: 2 },
      { strategy: 'pead', realized_pnl_usd: -5,  rn: 3 },
      { strategy: 'pead', realized_pnl_usd: -3,  rn: 4 },
      { strategy: 'pead', realized_pnl_usd: -1,  rn: 5 },
    ];

    const status = await checkAndActivateAuto();
    expect(status.strategies['pead']?.active).toBe(true);
    if (status.strategies['pead']?.active) {
      expect(status.strategies['pead'].level).toBe('strategy');
      expect(status.strategies['pead'].reason).toMatch(/consecutive losses/i);
      expect(status.strategies['pead'].expiresAt).toBeDefined();
    }

    // Hot-path gate denies new entries for paused strategy, allows others.
    expect(isTradingAllowed('pead').allowed).toBe(false);
    expect(isTradingAllowed('regime_trend').allowed).toBe(true);
  });

  it('does NOT pause on 4 losses (one short of threshold)', async () => {
    mockOutcomes = [
      { strategy: 'pead', realized_pnl_usd: -10, rn: 1 },
      { strategy: 'pead', realized_pnl_usd: -8,  rn: 2 },
      { strategy: 'pead', realized_pnl_usd: -5,  rn: 3 },
      { strategy: 'pead', realized_pnl_usd: -3,  rn: 4 },
    ];

    const status = await checkAndActivateAuto();
    expect(status.strategies['pead']?.active ?? false).toBe(false);
  });

  it('does NOT pause when a recent win breaks the loss run', async () => {
    mockOutcomes = [
      { strategy: 'pead', realized_pnl_usd: -10, rn: 1 },
      { strategy: 'pead', realized_pnl_usd: +5,  rn: 2 }, // win breaks the run
      { strategy: 'pead', realized_pnl_usd: -8,  rn: 3 },
      { strategy: 'pead', realized_pnl_usd: -5,  rn: 4 },
      { strategy: 'pead', realized_pnl_usd: -3,  rn: 5 },
      { strategy: 'pead', realized_pnl_usd: -1,  rn: 6 },
    ];

    const status = await checkAndActivateAuto();
    expect(status.strategies['pead']?.active ?? false).toBe(false);
  });
});

describe('kill-switches: portfolio auto-pause', () => {
  it('fires pausePortfolio when daily DD ≤ -3% of starting capital', async () => {
    // STARTING_CAPITAL defaults to $10K. -3% = -$300.
    mockPnl = { daily_pnl: -350, weekly_pnl: -350, monthly_pnl: -350 };

    const status = await checkAndActivateAuto();
    expect(status.portfolio.active).toBe(true);
    if (status.portfolio.active) {
      expect(status.portfolio.reason).toMatch(/daily DD/i);
      // Auto-deactivation timestamp present
      expect(status.portfolio.expiresAt).toBeDefined();
    }

    expect(isTradingAllowed('any_strategy').allowed).toBe(false);
  });

  it('fires pausePortfolio when weekly DD ≤ -6% (and daily is fine)', async () => {
    mockPnl = { daily_pnl: -50, weekly_pnl: -700, monthly_pnl: -700 };

    const status = await checkAndActivateAuto();
    expect(status.portfolio.active).toBe(true);
    if (status.portfolio.active) {
      expect(status.portfolio.reason).toMatch(/weekly DD/i);
    }
  });

  it('does NOT pause when DD is within thresholds', async () => {
    mockPnl = { daily_pnl: -100, weekly_pnl: -200, monthly_pnl: -300 };

    const status = await checkAndActivateAuto();
    expect(status.portfolio.active).toBe(false);
  });
});

describe('kill-switches: master kill', () => {
  it('blocks all isTradingAllowed checks once activated', async () => {
    expect(isTradingAllowed('pead').allowed).toBe(true);

    await activateMasterKill('panic test');
    expect(isTradingAllowed('pead').allowed).toBe(false);
    expect(isTradingAllowed('regime_trend').allowed).toBe(false);
    expect(isTradingAllowed('any_other').allowed).toBe(false);

    const status = await getKillSwitchStatus();
    expect(status.master.active).toBe(true);
    if (status.master.active) {
      expect(status.master.level).toBe('master');
      expect(status.master.reason).toBe('panic test');
    }
  });

  it('triggers forceFlattenAll on activation', async () => {
    await activateMasterKill('flatten test');
    expect(flattenCalls.length).toBe(1);
    expect(flattenCalls[0]).toContain('flatten test');
  });

  it('is idempotent on repeated activation', async () => {
    await activateMasterKill('first');
    await activateMasterKill('second');
    expect(flattenCalls.length).toBe(1); // only first call flattens
  });

  it('deactivateMaster restores trading', async () => {
    await activateMasterKill('temp');
    expect(isTradingAllowed('pead').allowed).toBe(false);

    await deactivateMaster();
    expect(isTradingAllowed('pead').allowed).toBe(true);

    const status = await getKillSwitchStatus();
    expect(status.master.active).toBe(false);
  });
});

describe('kill-switches: manual pause + resume', () => {
  it('pauseStrategy + resumeStrategy round-trip', async () => {
    await pauseStrategy('pead', 24, 'manual test');
    expect(isTradingAllowed('pead').allowed).toBe(false);
    expect(isTradingAllowed('regime_trend').allowed).toBe(true);

    await resumeStrategy('pead');
    expect(isTradingAllowed('pead').allowed).toBe(true);
  });

  it('pausePortfolio + resumePortfolio round-trip', async () => {
    await pausePortfolio('manual halt');
    expect(isTradingAllowed('pead').allowed).toBe(false);

    await resumePortfolio();
    expect(isTradingAllowed('pead').allowed).toBe(true);
  });

  it('resumeStrategy on an unpaused strategy is a no-op', async () => {
    await resumeStrategy('pead');
    expect(isTradingAllowed('pead').allowed).toBe(true);
  });
});

describe('kill-switches: persistence', () => {
  it('persists state across a simulated boot', async () => {
    await pauseStrategy('regime_trend', 12, 'persistence test');
    expect(isTradingAllowed('regime_trend').allowed).toBe(false);

    // Simulate a boot — drop the in-memory cache. Next call must reload
    // from disk and observe the same paused state.
    __resetKillSwitchCacheForTests();
    expect(isTradingAllowed('regime_trend').allowed).toBe(false);

    const status = await getKillSwitchStatus();
    expect(status.strategies['regime_trend']?.active).toBe(true);
  });

  it('starts with all switches OFF when state file is absent', async () => {
    cleanStateFile();
    __resetKillSwitchCacheForTests();
    const status = await getKillSwitchStatus();
    expect(status.master.active).toBe(false);
    expect(status.portfolio.active).toBe(false);
    expect(status.strategies).toEqual({});
  });
});

describe('kill-switches: precedence (master > portfolio > strategy)', () => {
  it('master kill takes precedence over portfolio + strategy pauses', async () => {
    await pauseStrategy('pead', 24, 's');
    await pausePortfolio('p');
    await activateMasterKill('m');

    const gate = isTradingAllowed('pead');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/master kill/i);
  });

  it('portfolio pause takes precedence over strategy pause', async () => {
    await pauseStrategy('pead', 24, 's');
    await pausePortfolio('p');

    const gate = isTradingAllowed('pead');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/portfolio paused/i);
  });
});

describe('kill-switches: degraded modes', () => {
  it('returns zeroed metrics + does not auto-trip when DB is unavailable', async () => {
    usePool = false;
    const status = await checkAndActivateAuto();
    expect(status.metrics.dailyPnlPct).toBe(0);
    expect(status.metrics.weeklyPnlPct).toBe(0);
    expect(status.master.active).toBe(false);
    expect(status.portfolio.active).toBe(false);
  });
});
