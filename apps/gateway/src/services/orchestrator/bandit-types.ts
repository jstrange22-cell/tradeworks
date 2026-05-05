/**
 * Bandit allocator type definitions — multi-armed bandit over the v2 strategy
 * lab outputs (pead, regime_trend, vol_rank_options, sector_rotation,
 * funding_basis, range_grid_stables).
 *
 * Each strategy is one "arm". Weights sum to 1.0 across all known strategies
 * and represent the fraction of risk-budget the APEX sizing layer should
 * route to each strategy on its next signal.
 */

/**
 * Canonical list of strategies the bandit knows about. Adding a new strategy?
 * Append it here AND make sure decisions tagged with that strategy name flow
 * through the `decisions` table (the bandit-runner pulls outcomes by joining
 * `decisions.strategy` -> `trade_outcomes`).
 *
 * Cold-start strategies (< 30 trades in 90d) get the floor weight automatically.
 */
export const KNOWN_STRATEGIES = [
  'pead',
  'regime_trend',
  'vol_rank_options',
  'sector_rotation',
  'funding_basis',
  'range_grid_stables',
] as const;

export type StrategyName = (typeof KNOWN_STRATEGIES)[number] | string;

/**
 * Per-strategy stats computed from the last 90d of decisions joined to
 * trade_outcomes. Recency-weighted via exponential decay (lambda = 0.05/day).
 */
export interface StrategyStats {
  strategy: StrategyName;
  /** Raw trade count (unweighted) — used for cold-start gating. */
  sampleSize90d: number;
  /** Decay-weighted win count (realized_pnl > 0). */
  weightedWins: number;
  /** Decay-weighted loss count (realized_pnl <= 0). */
  weightedLosses: number;
  /** Win rate from the Beta posterior mean: (1 + wins) / (2 + wins + losses). */
  winRate: number;
  /** Decay-weighted mean of realized_pnl_usd over the window. */
  expectancy: number;
  /** Decay-weighted stddev of realized_pnl_usd. */
  vol: number;
  /** Annualized-like Sharpe proxy: expectancy / max(vol, eps) * sqrt(252). */
  sharpeProxy: number;
}

/**
 * One strategy's slot in the persisted weights file.
 */
export interface StrategyWeightEntry {
  weight: number;
  prevWeight: number;
  voteShare: number;
  sampleSize90d: number;
  winRate: number;
  expectancy: number;
  sharpeProxy: number;
  /**
   * 'cold_start' = forced to floor (< 30 trades in 90d).
   * 'override'   = forced by env or temp override route.
   * 'normal'     = computed via Thompson sampling.
   */
  source: 'cold_start' | 'normal' | 'override';
}

/**
 * The on-disk shape of `data/bandit-weights.json`. Read at gateway boot,
 * rewritten weekly (and on demand via /recompute).
 */
export interface BanditWeightsFile {
  /** ISO timestamp of the most recent successful recompute. */
  updatedAt: string;
  /** Schema version — bump when shape changes. */
  schemaVersion: 1;
  strategies: Record<string, StrategyWeightEntry>;
  /**
   * Active market regime at recompute time, tagged via the orchestrator
   * regime classifier (`services/orchestrator/regime.ts`). Optional for
   * backward compat — older weights files predate regime tagging and read
   * back as `undefined`.
   */
  regime?: {
    tag: 'calm' | 'trending' | 'volatile' | 'crisis';
    confidence: number;
    rationale: string;
  };
  /**
   * Total weight allocated by regime as of this recompute. Helps audit
   * per-regime allocation history (e.g. "during crisis weeks, the bandit
   * concentrated 0.78 of weight in regime_trend"). Sums to 1.0 across the
   * four regimes, but only the active regime's bucket carries non-zero on
   * a single recompute. Historical aggregation is left to a downstream
   * analytics job; this field captures the snapshot only.
   */
  byRegime?: Record<'calm' | 'trending' | 'volatile' | 'crisis', number>;
}

/**
 * One strategy's outcome row, joined from decisions + trade_outcomes.
 * Used as input to the bandit math; can be supplied either by the runner
 * (pulling from postgres) or directly in unit tests (synthetic data).
 */
export interface BanditTradeOutcome {
  /** Hours since "now" — used to compute the exponential decay weight. */
  ageHours: number;
  /** Realized P&L in USD. Positive = win, <= 0 = loss. */
  realizedPnlUsd: number;
}

/**
 * Knobs for `computeWeights()`. Defaults are encoded in `bandit.ts`.
 */
export interface BanditConfig {
  /** Number of Monte Carlo samples per recompute. Default: 1000. */
  monteCarloSamples?: number;
  /** EMA smoothing alpha applied to raw vote share. Default: 0.3. */
  smoothAlpha?: number;
  /** Minimum weight per strategy (exploration floor). Default: 0.05. */
  floorWeight?: number;
  /** Maximum weight per strategy (concentration cap). Default: 0.50. */
  capWeight?: number;
  /** Minimum sample size to participate in voting. Default: 30. */
  minSampleSize?: number;
  /** Decay rate per day for recency weighting. Default: 0.05. */
  decayLambdaPerDay?: number;
  /** Optional manual overrides keyed by strategy name. */
  overrides?: Partial<Record<string, number>>;
  /** Optional deterministic RNG (for tests). Default: Math.random. */
  rng?: () => number;
}

/**
 * Inputs to `computeWeights()`. One entry per strategy currently known.
 */
export interface BanditInput {
  strategy: StrategyName;
  outcomes: BanditTradeOutcome[];
  /** Previous weight for EMA smoothing. If unknown, pass undefined → 1/N. */
  prevWeight?: number;
}

/**
 * Output of `computeWeights()`.
 */
export interface BanditOutput {
  strategies: StrategyWeightEntry[];
  totalSamples: number;
  /** Strategies that hit the cold-start floor (< minSampleSize trades). */
  coldStartStrategies: string[];
}
