/**
 * Multi-armed bandit allocator — Thompson sampling over Beta(win-rate)
 * combined with an exponentially weighted Sharpe proxy.
 *
 * Algorithm (per recompute):
 *   1. For each strategy, compute decay-weighted wins, losses, expectancy,
 *      vol, sharpeProxy from its outcomes (lambda = 0.05/day default).
 *   2. Strategies with < minSampleSize raw trades are excluded from voting
 *      and assigned the floor weight (cold-start protection).
 *   3. For each of T Monte Carlo samples:
 *        - draw wr_sample ~ Beta(1 + wins, 1 + losses) for each eligible strat
 *        - compute score = wr_sample * (sharpeProxy + small_noise)
 *        - the strategy with the highest score gets one vote
 *      → raw_weight = votes / T
 *   4. EMA smoothing: final = (1 - smoothAlpha) * prev + smoothAlpha * raw
 *   5. Apply manual overrides (if any), then floor + cap, then renormalize
 *      to sum to 1.0.
 *
 * Pure function with injectable RNG so unit tests are deterministic.
 */

import type {
  BanditConfig,
  BanditInput,
  BanditOutput,
  BanditTradeOutcome,
  StrategyStats,
  StrategyWeightEntry,
} from './bandit-types.js';

// ── defaults ───────────────────────────────────────────────────────────

const DEFAULT_MONTE_CARLO_SAMPLES = 1000;
const DEFAULT_SMOOTH_ALPHA = 0.3;
const DEFAULT_FLOOR_WEIGHT = 0.05;
const DEFAULT_CAP_WEIGHT = 0.50;
const DEFAULT_MIN_SAMPLE_SIZE = 30;
const DEFAULT_DECAY_LAMBDA_PER_DAY = 0.05;
const VOL_FLOOR = 1e-6;
const ANNUALIZATION_FACTOR = Math.sqrt(252);
const SCORE_NOISE_AMPLITUDE = 1e-3;

// ── public API ─────────────────────────────────────────────────────────

/**
 * Compute one strategy's recency-weighted stats from its outcome rows.
 * Exposed for the runner + tests; pure.
 */
export function computeStrategyStats(
  strategy: string,
  outcomes: BanditTradeOutcome[],
  decayLambdaPerDay = DEFAULT_DECAY_LAMBDA_PER_DAY,
): StrategyStats {
  const sampleSize90d = outcomes.length;

  if (sampleSize90d === 0) {
    return {
      strategy,
      sampleSize90d: 0,
      weightedWins: 0,
      weightedLosses: 0,
      winRate: 0.5,            // Beta(1,1) prior mean = 0.5 — neutral
      expectancy: 0,
      vol: 0,
      sharpeProxy: 0,
    };
  }

  const lambdaPerHour = decayLambdaPerDay / 24;
  let weightedWins = 0;
  let weightedLosses = 0;
  let weightSum = 0;
  let weightedPnlSum = 0;

  // First pass: weights, wins/losses, weighted mean
  const decayWeights = outcomes.map((o) => Math.exp(-lambdaPerHour * o.ageHours));

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i]!;
    const w = decayWeights[i]!;
    weightSum += w;
    weightedPnlSum += w * o.realizedPnlUsd;
    if (o.realizedPnlUsd > 0) weightedWins += w;
    else weightedLosses += w;
  }

  const expectancy = weightSum > 0 ? weightedPnlSum / weightSum : 0;

  // Second pass: weighted variance around the weighted mean
  let weightedSqDevSum = 0;
  for (let i = 0; i < outcomes.length; i++) {
    const dev = outcomes[i]!.realizedPnlUsd - expectancy;
    weightedSqDevSum += decayWeights[i]! * dev * dev;
  }
  const vol = weightSum > 0 ? Math.sqrt(weightedSqDevSum / weightSum) : 0;

  // Bayesian posterior mean of win-rate with weak Beta(1,1) prior.
  const winRate = (1 + weightedWins) / (2 + weightedWins + weightedLosses);

  const sharpeProxy = (expectancy / Math.max(vol, VOL_FLOOR)) * ANNUALIZATION_FACTOR;

  return {
    strategy,
    sampleSize90d,
    weightedWins,
    weightedLosses,
    winRate,
    expectancy,
    vol,
    sharpeProxy,
  };
}

/**
 * Main bandit recompute. Pure function — no I/O.
 *
 * Inputs: one entry per strategy with its 90d outcomes + previous weight.
 * Output: smoothed, floored, capped, renormalized weights summing to 1.0.
 */
export function computeWeights(
  inputs: BanditInput[],
  config: BanditConfig = {},
): BanditOutput {
  const T = config.monteCarloSamples ?? DEFAULT_MONTE_CARLO_SAMPLES;
  const smoothAlpha = config.smoothAlpha ?? DEFAULT_SMOOTH_ALPHA;
  const floor = config.floorWeight ?? DEFAULT_FLOOR_WEIGHT;
  const cap = config.capWeight ?? DEFAULT_CAP_WEIGHT;
  const minN = config.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const lambdaPerDay = config.decayLambdaPerDay ?? DEFAULT_DECAY_LAMBDA_PER_DAY;
  const rng = config.rng ?? Math.random;
  const overrides = config.overrides ?? {};

  if (inputs.length === 0) {
    return { strategies: [], totalSamples: 0, coldStartStrategies: [] };
  }

  // Equal-weight default for any strategy missing prevWeight.
  const equalPrev = 1 / inputs.length;

  // 1. Per-strategy stats.
  const stats = new Map<string, StrategyStats>();
  for (const inp of inputs) {
    stats.set(inp.strategy, computeStrategyStats(inp.strategy, inp.outcomes, lambdaPerDay));
  }

  // 2. Cold-start partition.
  const eligible: BanditInput[] = [];
  const coldStart: string[] = [];
  for (const inp of inputs) {
    const s = stats.get(inp.strategy)!;
    if (s.sampleSize90d < minN) coldStart.push(inp.strategy);
    else eligible.push(inp);
  }

  // 3. Monte Carlo voting over eligible strategies.
  const voteCounts = new Map<string, number>();
  for (const inp of eligible) voteCounts.set(inp.strategy, 0);

  if (eligible.length > 0) {
    for (let t = 0; t < T; t++) {
      let bestStrat = '';
      let bestScore = -Infinity;
      for (const inp of eligible) {
        const s = stats.get(inp.strategy)!;
        const alpha = 1 + s.weightedWins;
        const beta = 1 + s.weightedLosses;
        const wrSample = sampleBeta(alpha, beta, rng);
        // Add tiny noise so identical-stats strategies still spread votes.
        const noise = (rng() - 0.5) * 2 * SCORE_NOISE_AMPLITUDE;
        const score = wrSample * (s.sharpeProxy + noise);
        if (score > bestScore) {
          bestScore = score;
          bestStrat = inp.strategy;
        }
      }
      if (bestStrat) {
        voteCounts.set(bestStrat, (voteCounts.get(bestStrat) ?? 0) + 1);
      }
    }
  }

  // 4. Raw vote share + EMA smoothing.
  const totalVotes = T > 0 && eligible.length > 0 ? T : 1;
  const smoothedRaw = new Map<string, number>();
  for (const inp of inputs) {
    const prev = inp.prevWeight ?? equalPrev;
    const rawVote = (voteCounts.get(inp.strategy) ?? 0) / totalVotes;
    // Cold-start: skip smoothing toward votes (it has none); pin to floor pre-renorm.
    if (coldStart.includes(inp.strategy)) {
      smoothedRaw.set(inp.strategy, floor);
      continue;
    }
    const smoothed = (1 - smoothAlpha) * prev + smoothAlpha * rawVote;
    smoothedRaw.set(inp.strategy, smoothed);
  }

  // 5. Apply manual overrides BEFORE renormalization (will still get capped).
  const overrideStrats = new Set<string>();
  for (const [strat, w] of Object.entries(overrides)) {
    if (typeof w === 'number' && Number.isFinite(w) && w >= 0) {
      smoothedRaw.set(strat, w);
      overrideStrats.add(strat);
    }
  }

  // 6. Floor + cap + renormalize. Cold-start entries are pinned at the floor
  // so the renormalizer doesn't redistribute residual onto them — they stay
  // at the exploration floor regardless of how much room the eligible set has.
  let working = new Map<string, number>();
  for (const [k, v] of smoothedRaw) {
    working.set(k, Math.max(floor, Math.min(cap, v)));
  }
  const pinned = new Set<string>(coldStart);
  working = renormalize(working, floor, cap, pinned);

  // 7. Build output entries.
  const entries: StrategyWeightEntry[] = inputs.map((inp) => {
    const s = stats.get(inp.strategy)!;
    const weight = working.get(inp.strategy) ?? floor;
    const prevWeight = inp.prevWeight ?? equalPrev;
    const voteShare = (voteCounts.get(inp.strategy) ?? 0) / totalVotes;
    const isCold = coldStart.includes(inp.strategy);
    const isOverride = overrideStrats.has(inp.strategy);
    const source: StrategyWeightEntry['source'] = isOverride
      ? 'override'
      : isCold
        ? 'cold_start'
        : 'normal';
    return {
      weight,
      prevWeight,
      voteShare,
      sampleSize90d: s.sampleSize90d,
      winRate: s.winRate,
      expectancy: s.expectancy,
      sharpeProxy: s.sharpeProxy,
      source,
    };
  });

  return {
    strategies: entries,
    totalSamples: inputs.reduce((acc, i) => acc + i.outcomes.length, 0),
    coldStartStrategies: coldStart,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

/**
 * Renormalize a weights map to sum to 1.0 while respecting [floor, cap].
 *
 * Pinned entries (cold-start strategies) are held at exactly the floor and
 * excluded from the renormalization budget — the remaining strategies share
 * the (1 - pinnedSum) budget subject to [floor, cap].
 *
 * Iterative water-filling: scale free entries → clip to [floor, cap] →
 * repeat. Converges in 1-3 iterations for typical inputs.
 */
function renormalize(
  weights: Map<string, number>,
  floor: number,
  cap: number,
  pinned: Set<string> = new Set(),
): Map<string, number> {
  const n = weights.size;
  if (n === 0) return weights;

  const out = new Map(weights);

  // Pin first — exact floor for cold-start entries.
  for (const k of pinned) {
    if (out.has(k)) out.set(k, floor);
  }

  const freeKeys: string[] = [];
  for (const k of out.keys()) {
    if (!pinned.has(k)) freeKeys.push(k);
  }
  const nFree = freeKeys.length;

  // All pinned? Just return as-is (sum may be < 1, but allocation is degenerate).
  if (nFree === 0) return out;

  const pinnedSum = floor * pinned.size;
  const budget = 1 - pinnedSum;

  // Infeasibility guards on the FREE budget.
  if (floor * nFree > budget + 1e-9) {
    // Floors of free entries alone exceed the remaining budget. Equal-split
    // the budget across free entries (will violate floor for some, but it's
    // the least-bad option).
    const each = budget / nFree;
    for (const k of freeKeys) out.set(k, each);
    return out;
  }
  if (cap * nFree < budget - 1e-9) {
    // Caps of free entries can't fill the budget. Equal-split (will violate cap).
    const each = budget / nFree;
    for (const k of freeKeys) out.set(k, each);
    return out;
  }

  // Iterative water-filling on free entries only.
  for (let iter = 0; iter < 8; iter++) {
    let freeSum = 0;
    for (const k of freeKeys) freeSum += out.get(k) ?? 0;
    if (freeSum <= 0) {
      const each = budget / nFree;
      for (const k of freeKeys) out.set(k, each);
      break;
    }

    const scale = budget / freeSum;
    for (const k of freeKeys) out.set(k, (out.get(k) ?? 0) * scale);

    let changed = false;
    for (const k of freeKeys) {
      const v = out.get(k) ?? 0;
      if (v < floor) {
        out.set(k, floor);
        changed = true;
      } else if (v > cap) {
        out.set(k, cap);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Distribute residual across non-clipped free entries.
  let total = 0;
  for (const v of out.values()) total += v;
  const residual = 1 - total;
  if (Math.abs(residual) > 1e-9) {
    const adjustable: string[] = [];
    for (const k of freeKeys) {
      const v = out.get(k) ?? 0;
      if (v > floor + 1e-9 && v < cap - 1e-9) adjustable.push(k);
    }
    if (adjustable.length > 0) {
      const perEntry = residual / adjustable.length;
      for (const k of adjustable) {
        const cur = out.get(k) ?? 0;
        out.set(k, Math.max(floor, Math.min(cap, cur + perEntry)));
      }
    }
  }

  return out;
}

// ── Beta sampling via Marsaglia-Tsang gamma ────────────────────────────

/**
 * Beta(alpha, beta) sample via the gamma-ratio identity:
 *   X ~ Gamma(alpha, 1), Y ~ Gamma(beta, 1)  =>  X / (X+Y) ~ Beta(alpha, beta)
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const denom = x + y;
  if (denom <= 0) return 0.5;     // numerical guard — should never fire
  return x / denom;
}

/**
 * Marsaglia-Tsang method for Gamma(shape, scale=1). Handles shape >= 1
 * directly; for shape < 1 uses the boost trick (Gamma(shape+1) * U^(1/shape)).
 */
export function sampleGamma(shape: number, rng: () => number = Math.random): number {
  if (shape < 1) {
    const g = sampleGamma(shape + 1, rng);
    const u = Math.max(rng(), Number.EPSILON);
    return g * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  // Bounded loop — Marsaglia-Tsang has acceptance >= 0.95 for shape>=1.
  // 10000 iters is theoretical-impossibility safety; almost always exits in 1-2.
  for (let i = 0; i < 10_000; i++) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(Math.max(u, Number.EPSILON)) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }

  // Fallback — should be statistically impossible.
  return d;
}

/**
 * Box-Muller standard normal sample. Uses two uniforms per call but we
 * only return one (the second is discarded; could be cached, not worth
 * the state mgmt for our throughput).
 */
function sampleNormal(rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
