/**
 * Unit tests for the multi-armed bandit allocator.
 *
 * Strategy (pun intended): generate synthetic outcome streams with known
 * win-rates + expectancies and assert the bandit's weights converge to the
 * known-best arm. Uses a seeded RNG so the test is deterministic.
 */

import { describe, expect, it } from 'vitest';
import {
  computeStrategyStats,
  computeWeights,
  sampleBeta,
  sampleGamma,
} from '../bandit.js';
import type { BanditInput, BanditTradeOutcome } from '../bandit-types.js';

// ── seedable RNG (mulberry32) ──────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── synthetic outcome generators ──────────────────────────────────────

interface SynthSpec {
  winRate: number;      // probability of a win
  winAvg: number;       // mean USD on a win
  lossAvg: number;      // mean USD on a loss (expected to be negative)
  noise: number;        // std dev of the gaussian noise added to each outcome
  count: number;        // number of trades
}

function genOutcomes(spec: SynthSpec, rng: () => number, ageRangeHours = 90 * 24): BanditTradeOutcome[] {
  const out: BanditTradeOutcome[] = [];
  for (let i = 0; i < spec.count; i++) {
    const isWin = rng() < spec.winRate;
    const base = isWin ? spec.winAvg : spec.lossAvg;
    const noise = (rng() - 0.5) * 2 * spec.noise;
    out.push({
      // Spread evenly across the window — newest trades have ageHours near 0.
      ageHours: (i / spec.count) * ageRangeHours,
      realizedPnlUsd: base + noise,
    });
  }
  return out;
}

// ── tests ─────────────────────────────────────────────────────────────

describe('sampleBeta / sampleGamma', () => {
  it('Beta(1,1) sample mean ~= 0.5', () => {
    const rng = makeRng(42);
    let sum = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) sum += sampleBeta(1, 1, rng);
    expect(sum / N).toBeCloseTo(0.5, 1);
  });

  it('Beta(7,3) sample mean ~= 0.7 (alpha/(alpha+beta))', () => {
    const rng = makeRng(123);
    let sum = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) sum += sampleBeta(7, 3, rng);
    expect(sum / N).toBeCloseTo(0.7, 1);
  });

  it('Gamma(shape) is positive', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 200; i++) {
      expect(sampleGamma(2, rng)).toBeGreaterThan(0);
      expect(sampleGamma(0.5, rng)).toBeGreaterThan(0);
    }
  });
});

describe('computeStrategyStats', () => {
  it('empty outcomes returns neutral prior', () => {
    const s = computeStrategyStats('foo', []);
    expect(s.sampleSize90d).toBe(0);
    expect(s.winRate).toBeCloseTo(0.5, 5);
    expect(s.expectancy).toBe(0);
    expect(s.sharpeProxy).toBe(0);
  });

  it('all-win stream → high win rate + positive expectancy', () => {
    const outcomes: BanditTradeOutcome[] = Array.from({ length: 50 }, (_, i) => ({
      ageHours: i * 24,
      realizedPnlUsd: 100,
    }));
    const s = computeStrategyStats('winner', outcomes);
    expect(s.sampleSize90d).toBe(50);
    expect(s.winRate).toBeGreaterThan(0.95);
    expect(s.expectancy).toBeCloseTo(100, 0);
    expect(s.vol).toBeCloseTo(0, 5);
  });

  it('recency weighting: recent wins beat ancient losses', () => {
    const recent: BanditTradeOutcome[] = Array.from({ length: 20 }, () => ({
      ageHours: 24,                 // 1 day old
      realizedPnlUsd: 50,
    }));
    const ancient: BanditTradeOutcome[] = Array.from({ length: 20 }, () => ({
      ageHours: 80 * 24,            // 80 days old
      realizedPnlUsd: -50,
    }));
    const s = computeStrategyStats('mixed', [...recent, ...ancient]);
    // Despite equal counts, the recent wins are weighted ~e^(80*0.05) ~= 55x more
    // than the ancient losses → expectancy should be strongly positive.
    expect(s.expectancy).toBeGreaterThan(20);
    expect(s.winRate).toBeGreaterThan(0.75);
  });
});

describe('computeWeights — convergence', () => {
  it('clear winner gets > 50% allocation', () => {
    const rng = makeRng(2026);
    const inputs: BanditInput[] = [
      {
        strategy: 'winner',
        outcomes: genOutcomes({ winRate: 0.7, winAvg: 50, lossAvg: -20, noise: 5, count: 80 }, rng),
      },
      {
        strategy: 'loser_a',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 80 }, rng),
      },
      {
        strategy: 'loser_b',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 80 }, rng),
      },
    ];

    const result = computeWeights(inputs, {
      monteCarloSamples: 2000,
      // Smooth alpha = 1.0 to skip the EMA-toward-prev step (no warm-up here).
      smoothAlpha: 1.0,
      // Cap raised above 0.5 so the brief's spec assertion (winner > 0.5)
      // can actually be observed. With cap=0.5 the winner saturates at exactly 0.5.
      capWeight: 0.7,
      rng: makeRng(99),
    });

    const winner = result.strategies[0]!;
    const loserA = result.strategies[1]!;
    const loserB = result.strategies[2]!;

    expect(winner.weight).toBeGreaterThan(0.5);
    expect(winner.weight).toBeLessThanOrEqual(0.7 + 1e-6);
    expect(loserA.weight).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(loserB.weight).toBeGreaterThanOrEqual(0.05 - 1e-9);

    const sum = result.strategies.reduce((a, e) => a + e.weight, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('cold-start strategy (< 30 trades) gets the floor', () => {
    const rng = makeRng(7);
    const inputs: BanditInput[] = [
      {
        strategy: 'mature',
        outcomes: genOutcomes({ winRate: 0.6, winAvg: 50, lossAvg: -20, noise: 5, count: 60 }, rng),
      },
      {
        strategy: 'cold',
        outcomes: genOutcomes({ winRate: 0.9, winAvg: 100, lossAvg: -10, noise: 1, count: 10 }, rng),
      },
      {
        strategy: 'mature_b',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 60 }, rng),
      },
    ];

    const result = computeWeights(inputs, {
      monteCarloSamples: 1000,
      smoothAlpha: 1.0,
      rng: makeRng(11),
    });

    const cold = result.strategies[1]!;
    expect(cold.source).toBe('cold_start');
    expect(result.coldStartStrategies).toContain('cold');
    // Cold strategy should be at or near the floor (renorm may push it up slightly).
    expect(cold.weight).toBeLessThan(0.10);
  });

  it('floor is enforced for losers', () => {
    const rng = makeRng(3);
    const inputs: BanditInput[] = [
      {
        strategy: 'dominant',
        outcomes: genOutcomes({ winRate: 0.9, winAvg: 100, lossAvg: -5, noise: 2, count: 100 }, rng),
      },
      {
        strategy: 'awful',
        outcomes: genOutcomes({ winRate: 0.1, winAvg: 5, lossAvg: -100, noise: 2, count: 100 }, rng),
      },
    ];
    const result = computeWeights(inputs, {
      monteCarloSamples: 1000,
      smoothAlpha: 1.0,
      rng: makeRng(13),
    });
    const awful = result.strategies[1]!;
    expect(awful.weight).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('cap is enforced — no strategy exceeds 50%', () => {
    const rng = makeRng(4);
    const inputs: BanditInput[] = [
      {
        strategy: 'monster',
        outcomes: genOutcomes({ winRate: 0.95, winAvg: 200, lossAvg: -2, noise: 1, count: 200 }, rng),
      },
      {
        strategy: 'b',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 60 }, rng),
      },
      {
        strategy: 'c',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 60 }, rng),
      },
    ];
    const result = computeWeights(inputs, {
      monteCarloSamples: 1000,
      smoothAlpha: 1.0,
      rng: makeRng(17),
    });
    for (const s of result.strategies) {
      expect(s.weight).toBeLessThanOrEqual(0.50 + 1e-6);
    }
  });

  it('weights sum to 1.0 across many random scenarios', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rng = makeRng(seed);
      const inputs: BanditInput[] = Array.from({ length: 6 }, (_, i) => ({
        strategy: `strat_${i}`,
        outcomes: genOutcomes(
          {
            winRate: 0.3 + rng() * 0.5,
            winAvg: 20 + rng() * 80,
            lossAvg: -(10 + rng() * 40),
            noise: 5,
            count: 40 + Math.floor(rng() * 80),
          },
          rng,
        ),
      }));
      const result = computeWeights(inputs, {
        monteCarloSamples: 500,
        smoothAlpha: 0.3,
        rng: makeRng(seed + 100),
      });
      const sum = result.strategies.reduce((a, e) => a + e.weight, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    }
  });

  it('manual override is respected (subject to floor/cap/renorm)', () => {
    const rng = makeRng(5);
    const inputs: BanditInput[] = [
      {
        strategy: 'a',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 60 }, rng),
      },
      {
        strategy: 'b',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 60 }, rng),
      },
    ];
    const result = computeWeights(inputs, {
      monteCarloSamples: 500,
      smoothAlpha: 1.0,
      rng: makeRng(19),
      overrides: { a: 0.40 },
    });
    const a = result.strategies[0]!;
    expect(a.source).toBe('override');
    // a was forced to 0.40 (within bounds), then renormalized — should stay close.
    expect(a.weight).toBeGreaterThan(0.30);
    expect(a.weight).toBeLessThanOrEqual(0.50 + 1e-6);
  });

  it('empty inputs returns empty output', () => {
    const result = computeWeights([], { rng: makeRng(1) });
    expect(result.strategies).toHaveLength(0);
    expect(result.totalSamples).toBe(0);
    expect(result.coldStartStrategies).toHaveLength(0);
  });

  it('EMA smoothing dampens whiplash from a single recompute', () => {
    const rng = makeRng(8);
    const inputs: BanditInput[] = [
      {
        strategy: 'hot',
        outcomes: genOutcomes({ winRate: 0.8, winAvg: 100, lossAvg: -10, noise: 2, count: 80 }, rng),
        prevWeight: 0.3,                   // started equal-ish
      },
      {
        strategy: 'cold',
        outcomes: genOutcomes({ winRate: 0.4, winAvg: 30, lossAvg: -30, noise: 5, count: 80 }, rng),
        prevWeight: 0.3,
      },
      {
        strategy: 'meh',
        outcomes: genOutcomes({ winRate: 0.5, winAvg: 30, lossAvg: -30, noise: 5, count: 80 }, rng),
        prevWeight: 0.4,
      },
    ];
    const result = computeWeights(inputs, {
      monteCarloSamples: 1000,
      smoothAlpha: 0.3,
      rng: makeRng(23),
    });
    const hot = result.strategies[0]!;
    // Even though `hot` would dominate the votes, smoothing toward prev=0.3
    // should keep the new weight under ~0.5.
    expect(hot.weight).toBeGreaterThan(0.30);
    expect(hot.weight).toBeLessThanOrEqual(0.50 + 1e-6);
  });
});
