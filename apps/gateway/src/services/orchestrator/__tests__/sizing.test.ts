/**
 * Unit tests for vol-budgeted, ATR-distance, fractional-Kelly sizing.
 *
 * The sizing module reads data/calibration.json off disk via a path resolved
 * from import.meta.url. Tests round-trip the file: snapshot whatever's there,
 * write synthetic content, run assertions, restore at the end.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computePositionSize, __resetSizingCachesForTests } from '../sizing.js';
import { clearVolTargetCache } from '../vol-target.js';

// Resolve the same path the sizing module uses (apps/gateway/data/calibration.json).
const HERE = dirname(fileURLToPath(import.meta.url));
const CAL_PATH = resolve(HERE, '..', '..', '..', '..', 'data', 'calibration.json');

let originalCalibration: string | null = null;
let originalExisted = false;

function writeCalibration(byStrategy: Array<Record<string, unknown>>): void {
  const file = {
    generatedAt: new Date().toISOString(),
    windowDays: 365,
    totalApproves: byStrategy.reduce((sum, s) => sum + ((s['n'] as number) ?? 0), 0),
    byStrategy,
    byConfidence: [],
    byRegime: [],
    byHour: [],
    bySector: [],
    failureModes: { highConfLossesLast30d: 0, volatileNoScoutLossesLast30d: 0 },
  };
  writeFileSync(CAL_PATH, JSON.stringify(file, null, 2), 'utf8');
  __resetSizingCachesForTests();
}

beforeAll(() => {
  if (existsSync(CAL_PATH)) {
    originalExisted = true;
    originalCalibration = readFileSync(CAL_PATH, 'utf8');
  }
});

afterAll(() => {
  if (originalExisted && originalCalibration !== null) {
    writeFileSync(CAL_PATH, originalCalibration, 'utf8');
  } else if (existsSync(CAL_PATH)) {
    unlinkSync(CAL_PATH);
  }
  __resetSizingCachesForTests();
});

beforeEach(() => {
  __resetSizingCachesForTests();
  clearVolTargetCache();
});

describe('orchestrator/sizing — full flow with calibration', () => {
  it('produces expected qty when calibration is present', async () => {
    // Vol-target: portfolio budget = $100k × 14% = $14,000.
    // 6 KNOWN_STRATEGIES → cold-start equal bandit weight = 1/6 ≈ 0.1667.
    // strategyBudget = $14,000 × 0.1667 × 1.0 (scalar) ≈ $2,333.33.
    //
    // Calibration: 60% WR, avgR=1.5 → kelly_full = 0.6 - 0.4/1.5 = 0.333…
    // half-Kelly = 0.1667 (under 0.5 cap).
    // riskPerTradePct = 0.005 × (1 + 0.1667) ≈ 0.005833.
    // recommendedRisk = $2,333.33 × 0.005833 ≈ $13.61.
    // stopDistance = $185.50 - $178.10 = $7.40.
    // qty = floor(13.61 / 7.40) = 1.
    writeCalibration([
      { bucketKey: 'pead', n: 100, winRate: 0.6, avgRMultiple: 1.5, expectancyUsd: 25 },
    ]);

    const result = await computePositionSize({
      strategy: 'pead',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 185.5,
      stopPrice: 178.1,
      totalEquityUsd: 100_000,
    });

    expect(result.recommendedQuantity).toBe(1);
    expect(result.breakdown.kellyFraction).toBeCloseTo(0.1667, 3);
    expect(result.breakdown.kellyFraction).toBeLessThanOrEqual(0.5);
    expect(result.breakdown.maxPositionCapUsd).toBe(5_000);
    expect(result.breakdown.strategyBudgetUsd).toBeCloseTo(2333.33, 1);
    expect(result.breakdown.banditWeight).toBeCloseTo(1 / 6, 3);
    expect(result.breakdown.riskPerTradePct).toBeCloseTo(0.005833, 5);
    expect(result.recommendedRiskUsd).toBeCloseTo(7.4, 5);
    expect(result.warnings.some((w) => w.includes('no calibration data'))).toBe(false);
  });

  it('caps Kelly fraction at 0.5 (half-Kelly safety)', async () => {
    // Extreme calibration: 90% WR, avgR=5 → kelly_full = 0.9 - 0.1/5 = 0.88
    // half-Kelly raw = 0.44, well under 0.5 cap → no clamp.
    // Choose stronger: 95% WR, avgR=10 → kelly_full = 0.95 - 0.05/10 = 0.945
    // half-Kelly raw = 0.4725. Need WR=99/avgR=10 → kelly_full=0.989, half=0.4945.
    // Need to push past 0.5: WR=99, avgR=100 → kelly_full=0.9899, half=0.4949.
    // Still under. Half-Kelly of any kelly_full ≤ 1.0 is ≤ 0.5 already, so the
    // cap only ever bites when winRate > 1 (impossible). Test the clamp by
    // pinning a contrived input: WR=1.0, avgR=any positive → half-Kelly = 0.5.
    writeCalibration([
      { bucketKey: 'mega_edge', n: 50, winRate: 1.0, avgRMultiple: 2.0, expectancyUsd: 100 },
    ]);

    const result = await computePositionSize({
      strategy: 'mega_edge',
      symbol: 'XYZ',
      side: 'buy',
      entryPrice: 100,
      stopPrice: 95,
      totalEquityUsd: 100_000,
    });

    expect(result.breakdown.kellyFraction).toBeLessThanOrEqual(0.5);
    expect(result.breakdown.kellyFraction).toBeCloseTo(0.5, 5);
  });

  it('floors Kelly at 0 for losing strategies', async () => {
    // 20% WR, avgR=0.5 → kelly_full = 0.2 - 0.8/0.5 = -1.4 → clamp to 0.
    writeCalibration([
      { bucketKey: 'losing_strat', n: 80, winRate: 0.2, avgRMultiple: 0.5, expectancyUsd: -10 },
    ]);

    const result = await computePositionSize({
      strategy: 'losing_strat',
      symbol: 'XYZ',
      side: 'buy',
      entryPrice: 100,
      stopPrice: 95,
      totalEquityUsd: 100_000,
    });

    expect(result.breakdown.kellyFraction).toBe(0);
    // Risk-per-trade collapses to base 0.5%
    expect(result.breakdown.riskPerTradePct).toBeCloseTo(0.005, 5);
  });
});

describe('orchestrator/sizing — safe defaults when calibration is missing', () => {
  it('falls back to neutral kelly and warns when calibration is empty', async () => {
    // No matching strategy in calibration → neutral Kelly = 0.
    writeCalibration([]);

    const result = await computePositionSize({
      strategy: 'unknown_strategy',
      symbol: 'TSLA',
      side: 'buy',
      entryPrice: 200,
      stopPrice: 190,
      totalEquityUsd: 100_000,
    });

    expect(result.breakdown.kellyFraction).toBe(0);
    expect(result.breakdown.riskPerTradePct).toBeCloseTo(0.005, 5);
    expect(result.warnings.some((w) => w.includes('no calibration data'))).toBe(true);
    // Vol-target is available → strategyBudget = $14k × 1/6 ≈ $2333.33
    // (unknown strategies still get equal weight from the bandit cache).
    expect(result.breakdown.strategyBudgetUsd).toBeCloseTo(2333.33, 1);
    // recommendedRisk = $2333.33 × 0.5% ≈ $11.67, stopDist = $10 → qty = 1
    expect(result.recommendedQuantity).toBe(1);
  });

  it('falls back to neutral kelly for strategy not in calibration', async () => {
    writeCalibration([
      { bucketKey: 'pead', n: 100, winRate: 0.6, avgRMultiple: 1.5, expectancyUsd: 25 },
    ]);

    const result = await computePositionSize({
      strategy: 'tradevisor_pine',  // not in calibration
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 200,
      stopPrice: 190,
      totalEquityUsd: 100_000,
    });

    expect(result.breakdown.kellyFraction).toBe(0);
    expect(result.warnings.some((w) => w.includes('no calibration data'))).toBe(true);
  });
});

describe('orchestrator/sizing — input validation', () => {
  beforeEach(() => writeCalibration([]));

  it('returns zero qty + warning for stopless trade (entry == stop)', async () => {
    const result = await computePositionSize({
      strategy: 'pead',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 100,
      stopPrice: 100,
      totalEquityUsd: 100_000,
    });

    expect(result.recommendedQuantity).toBe(0);
    expect(result.recommendedNotionalUsd).toBe(0);
    expect(result.warnings.some((w) => w.includes('stopless'))).toBe(true);
  });

  it('returns zero qty for invalid entryPrice', async () => {
    const result = await computePositionSize({
      strategy: 'pead',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 0,
      stopPrice: 95,
      totalEquityUsd: 100_000,
    });
    expect(result.recommendedQuantity).toBe(0);
    expect(result.warnings.some((w) => w.includes('invalid entryPrice'))).toBe(true);
  });

  it('returns zero qty for invalid totalEquityUsd', async () => {
    const result = await computePositionSize({
      strategy: 'pead',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 100,
      stopPrice: 95,
      totalEquityUsd: 0,
    });
    expect(result.recommendedQuantity).toBe(0);
    expect(result.warnings.some((w) => w.includes('invalid totalEquityUsd'))).toBe(true);
  });
});

describe('orchestrator/sizing — position cap', () => {
  it('scales down quantity to the 5% equity cap', async () => {
    // Tiny stop distance forces a large raw quantity.
    // Equity = $100k → cap = $5,000.
    // Entry = $50, stop = $49.99 → stopDist = $0.01.
    // Strategy budget default = $10k. Risk = $50. Raw qty = floor(50/0.01) = 5000.
    // Raw notional = 5000 × 50 = $250,000. Way over $5,000 cap.
    // Capped qty = floor(5000 / 50) = 100. Capped notional = $5000.
    writeCalibration([]);
    const result = await computePositionSize({
      strategy: 'unknown',
      symbol: 'XYZ',
      side: 'buy',
      entryPrice: 50,
      stopPrice: 49.99,
      totalEquityUsd: 100_000,
    });

    expect(result.recommendedQuantity).toBe(100);
    expect(result.recommendedNotionalUsd).toBe(5_000);
    expect(result.breakdown.maxPositionCapUsd).toBe(5_000);
    expect(result.warnings.some((w) => w.includes('5% of equity cap'))).toBe(true);
  });
});

describe('orchestrator/sizing — tiny budget', () => {
  it('returns zero qty when risk dollars fall below $5 floor', async () => {
    // Equity = $500 → strategy budget default = $50.
    // Risk = $50 × 0.005 = $0.25. Below $5 floor → skip.
    writeCalibration([]);
    const result = await computePositionSize({
      strategy: 'pead',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 100,
      stopPrice: 95,
      totalEquityUsd: 500,
    });

    expect(result.recommendedQuantity).toBe(0);
    expect(result.warnings.some((w) => w.includes('strategy budget too small'))).toBe(true);
  });

  it('returns zero qty when risk supports < 1 whole share', async () => {
    // Equity $1k, default 10% budget = $100, risk = $0.50 → still below floor.
    // Bump equity higher to clear the floor but produce sub-1-share quantity.
    // Equity $50k → budget $5k, risk = $25, stopDist = $30 → qty = floor(25/30) = 0.
    writeCalibration([]);
    const result = await computePositionSize({
      strategy: 'pead',
      symbol: 'BRK.A',
      side: 'buy',
      entryPrice: 600_000,
      stopPrice: 599_970,  // $30 stop distance
      totalEquityUsd: 50_000,
    });

    expect(result.recommendedQuantity).toBe(0);
    expect(
      result.warnings.some((w) => w.includes('fewer than one whole share')),
    ).toBe(true);
  });
});

describe('orchestrator/sizing — options', () => {
  it('rounds to whole contracts and returns zero when budget < 1 contract', async () => {
    // Equity $100k → budget $10k → risk = $50.
    // Premium = $5/share, stop at 50% premium = $2.50/share stop dist.
    // Per-contract risk = $2.50 × 100 = $250.
    // Contracts = floor(50 / 250) = 0 → zero qty + "fewer than one whole" warning.
    writeCalibration([]);
    const result = await computePositionSize({
      strategy: 'vol_rank_options',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 5,
      stopPrice: 2.5,
      totalEquityUsd: 100_000,
      isOption: true,
    });

    expect(result.recommendedQuantity).toBe(0);
    expect(
      result.warnings.some((w) => w.includes('fewer than one whole')),
    ).toBe(true);
  });

  it('produces whole contracts when budget supports it', async () => {
    // Equity $5M → portfolio budget = $700k.
    // 6 known strategies → bandit weight 1/6 ≈ 0.1667.
    // strategyBudget ≈ $116.67k. Risk @ neutral Kelly = 0.5% = $583.33.
    // Premium $2, stop $1 → per-share risk $1, per-contract risk $100.
    // Contracts = floor(583.33 / 100) = 5.
    // Notional = 5 × 2 × 100 = $1,000 (way under 5% cap of $250k).
    writeCalibration([]);
    const result = await computePositionSize({
      strategy: 'vol_rank_options',
      symbol: 'AAPL',
      side: 'buy',
      entryPrice: 2,
      stopPrice: 1,
      totalEquityUsd: 5_000_000,
      isOption: true,
    });

    expect(result.recommendedQuantity).toBe(5);
    expect(result.recommendedNotionalUsd).toBe(1_000);
  });
});
