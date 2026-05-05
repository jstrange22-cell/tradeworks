/**
 * Unit tests for the portfolio heat tracker.
 *
 * Strategy:
 *   - `aggregateHeat` is a pure function — exercised directly with synthetic
 *     OpenRiskItem[] inputs.
 *   - `checkHeatBudget` reads heat via the cached snapshot. We populate the
 *     cache via `_setHeatCacheForTests` so the function sees a known state
 *     without booting any ledgers, then assert on the gate verdict.
 *   - The regime module is mocked to a deterministic `calm` regime + scalar
 *     1.0 so budget math is unaffected by the parallel D2 regime work.
 *
 * Cases covered:
 *   - empty portfolio → 0% heat / no breach
 *   - 5-position synthetic → correct totals + sector / factor aggregation
 *   - prospective trade pushing over total cap → ok=false offendingBudget=total
 *   - prospective trade pushing over sector cap → ok=false offendingBudget=sector
 *   - prospective trade pushing over factor cap → ok=false offendingBudget=factor
 *   - prospective with zero risk → trivially ok
 *   - custom env-overridden budgets honoured
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the regime module BEFORE importing heat.ts so the mocked exports are
// what `checkHeatBudget` resolves at runtime. Note: `getHeatBudgetScalar` is
// called synchronously, so we use a plain fn (not vi.fn().mockReturnValue)
// — vitest hoists this block but the mockReturnValue setter doesn't survive
// through the hoist for this consumer. Using `() => 1` is bullet-proof.
vi.mock('../regime.js', () => ({
  getCurrentRegime: async () => ({
    tag: 'calm' as const,
    confidence: 0.5,
    asOf: new Date().toISOString(),
    signals: {},
    rationale: 'test stub',
  }),
  getHeatBudgetScalar: () => 1.0,
}));

import {
  _resetHeatCache,
  _setHeatCacheForTests,
  aggregateHeat,
  checkHeatBudget,
  getOpenRiskPositions,
  getPortfolioHeat,
} from '../heat.js';
import type { OpenRiskItem } from '../heat-types.js';

// ── env pinning ───────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

function setBudgets(total: number, sector: number, factor: number): void {
  process.env.HEAT_TOTAL_MAX_PCT = String(total);
  process.env.HEAT_SECTOR_MAX_PCT = String(sector);
  process.env.HEAT_FACTOR_MAX_PCT = String(factor);
}

beforeEach(() => {
  setBudgets(6, 2, 3);
  _resetHeatCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────

function makeRiskItem(overrides: Partial<OpenRiskItem> = {}): OpenRiskItem {
  return {
    decisionId: 'd-' + Math.random().toString(36).slice(2),
    symbol: 'AAPL',
    side: 'buy',
    qty: 10,
    entryPrice: 100,
    stopPrice: 95,
    riskUsd: 50, // 10 × |100-95|
    sector: 'Technology',
    factorTags: ['momentum', 'large_cap'],
    ...overrides,
  };
}

// ── aggregation ────────────────────────────────────────────────────────

describe('aggregateHeat', () => {
  it('empty portfolio returns 0% heat across the board', () => {
    const heat = aggregateHeat([], 100_000);
    expect(heat.totalEquityUsd).toBe(100_000);
    expect(heat.totalOpenRiskUsd).toBe(0);
    expect(heat.totalOpenRiskPct).toBe(0);
    expect(heat.bySector).toEqual({});
    expect(heat.byFactor).toEqual({});
    expect(heat.utilization.total).toBe(0);
    expect(heat.utilization.worstSector.utilization).toBe(0);
    expect(heat.utilization.worstFactor.utilization).toBe(0);
  });

  it('aggregates 5 synthetic positions into correct sector + factor + totals', () => {
    const equity = 100_000;
    // 5 positions, each $400 risk → $2000 total = 2% of $100k equity.
    // Sectors: 3 Tech ($1200 = 1.2%), 2 Financials ($800 = 0.8%).
    // Factors: all carry 'large_cap' ($2000 = 2%).
    const positions: OpenRiskItem[] = [
      makeRiskItem({ symbol: 'AAPL', riskUsd: 400, sector: 'Technology', factorTags: ['momentum', 'large_cap'] }),
      makeRiskItem({ symbol: 'MSFT', riskUsd: 400, sector: 'Technology', factorTags: ['large_cap', 'growth'] }),
      makeRiskItem({ symbol: 'NVDA', riskUsd: 400, sector: 'Technology', factorTags: ['momentum', 'large_cap', 'high_beta'] }),
      makeRiskItem({ symbol: 'JPM', riskUsd: 400, sector: 'Financials', factorTags: ['large_cap', 'value'] }),
      makeRiskItem({ symbol: 'GS', riskUsd: 400, sector: 'Financials', factorTags: ['large_cap', 'high_beta'] }),
    ];
    const heat = aggregateHeat(positions, equity);

    expect(heat.totalOpenRiskUsd).toBe(2000);
    expect(heat.totalOpenRiskPct).toBeCloseTo(0.02, 5);

    // Sector totals
    expect(heat.bySector.Technology.riskUsd).toBe(1200);
    expect(heat.bySector.Technology.pct).toBeCloseTo(0.012, 5);
    expect(heat.bySector.Financials.riskUsd).toBe(800);
    expect(heat.bySector.Financials.pct).toBeCloseTo(0.008, 5);

    // Factor totals — every position carries 'large_cap'
    expect(heat.byFactor.large_cap.riskUsd).toBe(2000);
    expect(heat.byFactor.large_cap.pct).toBeCloseTo(0.02, 5);
    // 'momentum' is on AAPL + NVDA → 800
    expect(heat.byFactor.momentum.riskUsd).toBe(800);
    // 'high_beta' is on NVDA + GS → 800
    expect(heat.byFactor.high_beta.riskUsd).toBe(800);

    // Utilization: total 2% / 6% cap = 0.333…
    expect(heat.utilization.total).toBeCloseTo(2 / 6, 5);
    // Worst sector = Technology @ 1.2% / 2% cap = 0.6
    expect(heat.utilization.worstSector.sector).toBe('Technology');
    expect(heat.utilization.worstSector.utilization).toBeCloseTo(0.6, 5);
    // Worst factor = large_cap @ 2% / 3% cap = 0.666…
    expect(heat.utilization.worstFactor.factor).toBe('large_cap');
    expect(heat.utilization.worstFactor.utilization).toBeCloseTo(2 / 3, 5);
  });

  it('handles zero-equity guard without dividing by zero', () => {
    const heat = aggregateHeat([makeRiskItem({ riskUsd: 100 })], 0);
    expect(Number.isFinite(heat.totalOpenRiskPct)).toBe(true);
  });
});

// ── checkHeatBudget ────────────────────────────────────────────────────
//
// We seed the heat-cache with a synthetic snapshot so `checkHeatBudget`
// reads a deterministic state. Each test pins the cache to a different
// shape and asserts the gate response.

describe('checkHeatBudget', () => {
  it('zero-risk prospective → trivially ok', async () => {
    const result = await checkHeatBudget({ symbol: 'AAPL', riskUsd: 0 });
    expect(result.ok).toBe(true);
  });

  it('prospective fits under total + sector + factor → ok', async () => {
    const equity = 100_000;
    const fakeHeat = aggregateHeat(
      [makeRiskItem({ riskUsd: 1000, sector: 'Technology', factorTags: ['momentum', 'large_cap'] })],
      equity,
    );
    _setHeatCacheForTests(fakeHeat);

    // Adding $400 (0.4%) to AAPL (Technology / momentum / large_cap):
    //   total: 1% + 0.4% = 1.4% < 6% ✓
    //   sector Tech: 1% + 0.4% = 1.4% < 2% ✓
    //   factor large_cap: 1% + 0.4% = 1.4% < 3% ✓
    const result = await checkHeatBudget({ symbol: 'AAPL', riskUsd: 400 });
    expect(result.ok).toBe(true);
  });

  it('cache helper round-trips: getPortfolioHeat reads what _setHeatCacheForTests set', async () => {
    const fakeHeat = aggregateHeat([makeRiskItem({ riskUsd: 999, sector: 'Technology', factorTags: ['large_cap'] })], 100_000);
    _setHeatCacheForTests(fakeHeat);
    const got = await getPortfolioHeat();
    expect(got.totalOpenRiskUsd).toBe(999);
    expect(got.bySector.Technology.riskUsd).toBe(999);
  });

  it('prospective pushes total over cap → veto with offendingBudget=total', async () => {
    const equity = 100_000;
    // Spread risk thin across many sectors / factors so neither sector nor
    // factor caps bind first. 6 positions × $950 = $5700 (5.7%) sitting at
    // 95% of the 6% cap. Add $500 → 6.2% > 6% → total veto.
    // Each position uses a unique sector AND a unique factor tag so the
    // prospective can't overlap into a budget that's already loaded.
    const fakeHeat = aggregateHeat(
      [
        makeRiskItem({ symbol: 'A', riskUsd: 950, sector: 'Technology', factorTags: ['large_cap'] }),
        makeRiskItem({ symbol: 'B', riskUsd: 950, sector: 'Financials', factorTags: ['value'] }),
        makeRiskItem({ symbol: 'C', riskUsd: 950, sector: 'Health Care', factorTags: ['low_vol'] }),
        makeRiskItem({ symbol: 'D', riskUsd: 950, sector: 'Energy', factorTags: ['dividend'] }),
        makeRiskItem({ symbol: 'E', riskUsd: 950, sector: 'Materials', factorTags: ['high_beta'] }),
        makeRiskItem({ symbol: 'F', riskUsd: 950, sector: 'Utilities', factorTags: ['momentum'] }),
      ],
      equity,
    );
    _setHeatCacheForTests(fakeHeat);

    // Prospective lands in Consumer Staples (empty sector) and the symbol
    // 'CFAKE' is unknown to the factor map so it gets the default
    // factorTags=['large_cap']. Existing 'large_cap' bucket already holds
    // $950 (0.95%) — adding $500 → $1450 = 1.45%, still under 3% factor cap.
    // Sector Consumer Staples is empty + $500 = 0.5% < 2% cap.
    // Total: $5700 + $500 = $6200 = 6.2% > 6% cap → total veto.
    const result = await checkHeatBudget({
      symbol: 'CFAKE',
      riskUsd: 500,
      sector: 'Consumer Staples',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrowing
    expect(result.offendingBudget).toBe('total');
    expect(result.current).toBeGreaterThan(result.cap);
    expect(result.cap).toBeCloseTo(0.06, 5);
  });

  it('prospective pushes one sector over cap → veto with offendingBudget=sector', async () => {
    const equity = 100_000;
    // Tech sector already at $1900 = 1.9% of 2% cap. Adding $200 → 2.1% > 2% sector cap.
    // Total stays at $2100 = 2.1% < 6% so total isn't the binding constraint.
    // Use unique factor tags so factor cap doesn't bind: existing position
    // has 'value' (1.9%) and the prospective MSFT brings 'momentum'/'large_cap'/'growth'
    // — but each of those buckets is empty currently → 0% + 0.2% = 0.2% < 3% cap. ✓
    const fakeHeat = aggregateHeat(
      [makeRiskItem({ symbol: 'AAPL', riskUsd: 1900, sector: 'Technology', factorTags: ['value'] })],
      equity,
    );
    _setHeatCacheForTests(fakeHeat);

    // Prospective: explicit Technology sector (overrides factor-map lookup
    // for sector resolution) so it lands in the loaded sector bucket.
    const result = await checkHeatBudget({
      symbol: 'MSFT',
      riskUsd: 200,
      sector: 'Technology',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.offendingBudget).toBe('sector');
    expect(result.current).toBeGreaterThan(result.cap);
    expect(result.cap).toBeCloseTo(0.02, 5);
  });

  it('prospective pushes one factor over cap → veto with offendingBudget=factor', async () => {
    const equity = 100_000;
    // 'momentum' factor already at $2900 = 2.9% of 3% cap. Add $200 → 3.1% > 3%.
    // Spread across two sectors so the sector cap (2%) doesn't bind first:
    //   Tech: $1450 (1.45%) — Financials: $1450 (1.45%) — both under 2%.
    // Total: $2900 = 2.9% < 6%; +$200 = 3.1% < 6% ✓
    const fakeHeat = aggregateHeat(
      [
        makeRiskItem({ symbol: 'NVDA', riskUsd: 1450, sector: 'Technology', factorTags: ['momentum'] }),
        makeRiskItem({ symbol: 'GS', riskUsd: 1450, sector: 'Financials', factorTags: ['momentum'] }),
      ],
      equity,
    );
    _setHeatCacheForTests(fakeHeat);

    // Prospective sector override: Energy (currently empty bucket) so sector
    // cap can't be the binding constraint. Symbol 'NEW_ENERGY_NAME' is
    // unknown to the factor map, so it gets default factorTags=['large_cap'].
    // 'large_cap' bucket is empty + $200 = 0.2% < 3% cap. ✓
    // BUT we need the prospective to overlap with the loaded 'momentum'
    // factor — so use a *known* symbol that carries 'momentum'. Use 'NVDA'
    // (factorTags include 'momentum') with explicit sector='Energy' override.
    const result = await checkHeatBudget({
      symbol: 'NVDA',           // factor tags include 'momentum'
      riskUsd: 200,
      sector: 'Energy',         // override to empty sector
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.offendingBudget).toBe('factor');
    expect(result.current).toBeGreaterThan(result.cap);
    expect(result.cap).toBeCloseTo(0.03, 5);
  });

  it('honours custom env-overridden budgets', async () => {
    setBudgets(10, 5, 7); // looser budgets — same scenario should now pass
    _resetHeatCache();

    const equity = 100_000;
    const fakeHeat = aggregateHeat(
      [makeRiskItem({ symbol: 'AAPL', riskUsd: 1900, sector: 'Technology', factorTags: ['value'] })],
      equity,
    );
    _setHeatCacheForTests(fakeHeat);

    const result = await checkHeatBudget({
      symbol: 'MSFT',
      riskUsd: 200,
      sector: 'Technology',
    });
    // Sector now 5% cap → 1.9% + 0.2% = 2.1% < 5% ✓
    expect(result.ok).toBe(true);
  });
});

// ── shape smoke (cache-served) ────────────────────────────────────────
// These exercise the public accessors via a pre-warmed cache so we don't
// boot the full crypto-agent / stock-orchestrator transitive imports in
// the unit-test environment. The cold path (cache miss → enumerate
// ledgers) is exercised end-to-end by the routes test elsewhere.

describe('getPortfolioHeat / getOpenRiskPositions shape', () => {
  it('returns a well-formed PortfolioHeat shape', async () => {
    _setHeatCacheForTests(aggregateHeat([], 100_000));
    const heat = await getPortfolioHeat();
    expect(heat).toMatchObject({
      totalEquityUsd: expect.any(Number),
      totalOpenRiskUsd: expect.any(Number),
      totalOpenRiskPct: expect.any(Number),
      bySector: expect.any(Object),
      byFactor: expect.any(Object),
      budgets: {
        totalOpenRiskMaxPct: expect.any(Number),
        perSectorMaxPct: expect.any(Number),
        perFactorMaxPct: expect.any(Number),
      },
      utilization: expect.any(Object),
    });
    expect(heat.totalOpenRiskUsd).toBeGreaterThanOrEqual(0);
    expect(heat.totalOpenRiskPct).toBeGreaterThanOrEqual(0);
  });

  it('positions endpoint returns an array', async () => {
    const fakePositions: OpenRiskItem[] = [
      makeRiskItem({ symbol: 'AAPL', riskUsd: 100, sector: 'Technology' }),
    ];
    _setHeatCacheForTests(aggregateHeat(fakePositions, 100_000), fakePositions);
    const positions = await getOpenRiskPositions();
    expect(Array.isArray(positions)).toBe(true);
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('AAPL');
  });
});
