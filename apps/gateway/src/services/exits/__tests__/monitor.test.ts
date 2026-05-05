/**
 * Smoke test for the exit monitor.
 *
 * The monitor pulls live positions from disk-backed ledgers + remote
 * quotes. Re-implementing those for a test would amount to mocking the
 * world. Instead, this test exercises the in-memory tick path directly:
 * we feed `runTickForTest` through a pair of synthesised positions via
 * vi.mock so the real adapter / fetcher modules return deterministic
 * data, and assert the engine fires the expected exits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenPosition, ExitBar } from '../types.js';

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock the position adapters so the monitor sees fake positions.
const mockPositions: OpenPosition[] = [];
vi.mock('../position-adapters.js', () => ({
  loadAllOpenPositions: vi.fn(async () => mockPositions),
  loadEquityPositions: vi.fn(async () => mockPositions.filter(p => p.assetClass === 'equity')),
  loadOptionPositions: vi.fn(async () => mockPositions.filter(p => p.assetClass === 'option')),
  loadCexPositions: vi.fn(async () => mockPositions.filter(p => p.assetClass === 'crypto-cex')),
}));

// Mock the price fetcher so we control the bar each position sees.
const mockBars = new Map<string, ExitBar>();
vi.mock('../price-fetcher.js', () => ({
  fetchBarsFor: vi.fn(async (positions: OpenPosition[]) => {
    const bars = new Map<string, ExitBar>();
    const missing: string[] = [];
    for (const p of positions) {
      const bar = mockBars.get(p.trackerId);
      if (bar) bars.set(p.trackerId, bar);
      else missing.push(p.symbol);
    }
    return { bars, missing };
  }),
  _resetPriceCache: vi.fn(),
}));

// Mock the stock-agent so we don't actually try to mutate a paper ledger.
const closeEquityCalls: Array<{ id: string; exit: number; reason: string }> = [];
const closeOptionCalls: Array<{ id: string; exit: number; reason: string }> = [];
vi.mock('../../stock-intelligence/stock-agent.js', () => ({
  closeEquityPosition: vi.fn(async (pos: { id: string }, exit: number, reason: string) => {
    closeEquityCalls.push({ id: pos.id, exit, reason });
  }),
  closeOptionPosition: vi.fn(async (pos: { id: string }, exit: number, reason: string) => {
    closeOptionCalls.push({ id: pos.id, exit, reason });
  }),
}));

// Mock the orchestrator so the dispatcher can find a "live position" by id.
const mockLedger = {
  paperCashUsd: 10_000,
  equityPositions: [] as Array<{
    id: string;
    symbol: string;
    shares: number;
    entryPrice: number;
    currentPrice: number;
    entryAt: string;
    signalSource: string;
    signalScore: number;
    decisionId: string;
    stopLossPrice: number;
  }>,
  optionPositions: [] as Array<{
    id: string;
    symbol: string;
    occSymbol: string;
    type: 'call' | 'put';
    strike: number;
    expiry: string;
    contracts: number;
    entryMid: number;
    currentMid: number;
    entryIV: number;
    entryAt: string;
    signalSource: string;
    signalScore: number;
    decisionId: string;
    stopLossMid: number;
  }>,
  equityClosed: [],
  optionClosed: [],
  stats: { totalTrades: 0, wins: 0, losses: 0 },
};
vi.mock('../../stock-intelligence/stock-orchestrator.js', () => ({
  loadPaperLedger: vi.fn(() => mockLedger),
  savePaperLedger: vi.fn(),
  getStockRegime: vi.fn(() => ({ regime: 'neutral', vix: 18 })),
}));

// Stub the outcome writer so we don't try to talk to pg.
vi.mock('../outcome-writer.js', async () => {
  const actual = await vi.importActual<typeof import('../outcome-writer.js')>(
    '../outcome-writer.js',
  );
  return {
    ...actual,
    writeOutcomeFromTrade: vi.fn(async () => null),
  };
});

// Use a temp tracker file so the test doesn't pollute production state.
const tmpDir = `./tmp-test-${Date.now()}`;
process.env['EXIT_TRACKER_FILE'] = `${tmpDir}/exit-tracker.json`;

// Pull the monitor under test AFTER mocks are set up.
import { _runTickForTest, _resetMonitorState } from '../monitor.js';
import { _resetTrackerCache } from '../tracker-store.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeEquityPosition(overrides: Partial<OpenPosition> & { id: string }): OpenPosition {
  return {
    decisionId: `d-${overrides.id}`,
    trackerId: `equity:${overrides.id}`,
    assetClass: 'equity',
    symbol: 'TEST',
    side: 'long',
    qty: 100,
    qtyAtEntry: 100,
    entryPrice: 100,
    stopPrice: 95,
    openedAt: new Date('2026-04-01T14:30:00Z').toISOString(),
    strategy: 'PEAD',
    atrAtEntry: 2.0,
    expiry: null,
    ladderPartialDone: false,
    ...overrides,
  };
}

function pushEquityToLedger(p: OpenPosition): void {
  const id = p.trackerId.split(':')[1];
  mockLedger.equityPositions.push({
    id,
    symbol: p.symbol,
    shares: p.qty,
    entryPrice: p.entryPrice,
    currentPrice: p.entryPrice,
    entryAt: p.openedAt,
    signalSource: 'tradevisor_prime',
    signalScore: 5,
    decisionId: p.decisionId ?? 'd-test',
    stopLossPrice: p.stopPrice,
  });
}

// ── Test cases ─────────────────────────────────────────────────────────

describe('exit monitor smoke', () => {
  beforeEach(() => {
    mockPositions.length = 0;
    mockBars.clear();
    mockLedger.equityPositions.length = 0;
    mockLedger.optionPositions.length = 0;
    closeEquityCalls.length = 0;
    closeOptionCalls.length = 0;
    _resetMonitorState();
    _resetTrackerCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hard-stop fires close on a position that pierced its stop', async () => {
    const winner = makeEquityPosition({ id: 'win-1', symbol: 'WINNER' });
    const loser = makeEquityPosition({
      id: 'lose-1',
      symbol: 'LOSER',
      stopPrice: 95,
    });
    mockPositions.push(winner, loser);
    pushEquityToLedger(winner);
    pushEquityToLedger(loser);

    mockBars.set(winner.trackerId, { close: 102, high: 103, low: 101, ts: '' });
    mockBars.set(loser.trackerId, { close: 96, high: 97, low: 94, ts: '' });

    const evals = await _runTickForTest();
    expect(evals).toHaveLength(2);

    const loserEval = evals.find(e => e.symbol === 'LOSER')!;
    expect(loserEval.triggered).toBe('hard_stop');
    expect(loserEval.fired).toBe(true);
    expect(closeEquityCalls).toContainEqual({ id: 'lose-1', exit: 95, reason: 'hard_stop' });

    const winnerEval = evals.find(e => e.symbol === 'WINNER')!;
    expect(winnerEval.triggered).toBe('none');
    expect(winnerEval.fired).toBe(false);
  });

  it('r-multiple-ladder fires partial when up +1R', async () => {
    const pos = makeEquityPosition({
      id: 'ladder-1',
      symbol: 'LADDER',
      qty: 100,
      qtyAtEntry: 100,
      entryPrice: 100,
      stopPrice: 95,
    });
    mockPositions.push(pos);
    pushEquityToLedger(pos);
    mockBars.set(pos.trackerId, { close: 105, high: 105.5, low: 102, ts: '' });

    const evals = await _runTickForTest();
    expect(evals).toHaveLength(1);
    const e = evals[0];
    expect(e.triggered).toBe('r_multiple_ladder');
    expect(e.fired).toBe(true);
    expect(e.decision.partialQty).toBe(50);
    // Partial path doesn't call closeEquityPosition; it mutates the ledger
    // directly. Verify via the live position state.
    expect(mockLedger.equityPositions[0].shares).toBe(50);
    expect(mockLedger.equityPositions[0].stopLossPrice).toBe(100); // breakeven
    expect(closeEquityCalls).toHaveLength(0);
  });

  it('time-stop fires when position age exceeds strategy window', async () => {
    const pos = makeEquityPosition({
      id: 'old-1',
      symbol: 'OLDIE',
      strategy: 'PEAD', // 60d window
      openedAt: new Date('2026-01-01T00:00:00Z').toISOString(), // ~123d ago
    });
    mockPositions.push(pos);
    pushEquityToLedger(pos);
    mockBars.set(pos.trackerId, { close: 101, high: 101, low: 100.5, ts: '' });

    const evals = await _runTickForTest();
    expect(evals).toHaveLength(1);
    expect(evals[0].triggered).toBe('time_stop');
    expect(evals[0].fired).toBe(true);
    expect(closeEquityCalls[0]).toMatchObject({ id: 'old-1', reason: 'time_stop' });
  });

  it('handles three positions deterministically', async () => {
    // Synthetic 3 open positions → tick once → assert correct exits triggered.
    const stop = makeEquityPosition({ id: 's1', symbol: 'STOPME', stopPrice: 95 });
    const ladder = makeEquityPosition({
      id: 's2', symbol: 'LADDERME', entryPrice: 100, stopPrice: 95,
    });
    const calm = makeEquityPosition({ id: 's3', symbol: 'CALMER' });
    mockPositions.push(stop, ladder, calm);
    [stop, ladder, calm].forEach(pushEquityToLedger);

    mockBars.set(stop.trackerId,   { close: 95.5, high: 96, low: 94, ts: '' }); // hits stop
    mockBars.set(ladder.trackerId, { close: 105, high: 105, low: 103, ts: '' }); // +1R
    mockBars.set(calm.trackerId,   { close: 101, high: 101, low: 100.5, ts: '' }); // nothing

    const evals = await _runTickForTest();
    expect(evals.map(e => e.triggered).sort()).toEqual(['hard_stop', 'none', 'r_multiple_ladder']);
    expect(evals.filter(e => e.fired).length).toBe(2);
  });
});
