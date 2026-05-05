/**
 * Vol-targeted portfolio sizing — type definitions.
 *
 * The vol-target module turns a portfolio-level annualized-vol target (default
 * 14%) into a USD risk budget per strategy. Phase D2 sizing then divides each
 * strategy's USD budget by the per-trade stop distance to land a position
 * size, replacing the old fixed $100 / $250 / $500 tiers.
 *
 * Total budget is scaled by:
 *
 *   scalar = clamp( target_vol / realized_vol , 0.25 , 2.0 )
 *
 * so live realized vol drifting above the target shrinks risk; below target
 * lets us scale up — capped to avoid run-away leverage.
 */

/**
 * Portfolio-level vol budget — the total dollar exposure budget at full
 * sizing across ALL strategies.
 */
export interface PortfolioVolBudget {
  /** Annualized vol the portfolio aims at, in percent. Default 14. */
  targetVolAnnualizedPct: number;
  /**
   * Realized annualized vol of the portfolio over the last 60 trading days,
   * computed from daily realized P&L returns. Cold-start (< 30 days of data)
   * defaults to `targetVolAnnualizedPct` so `scalar` = 1.0.
   */
  realizedVolAnnualizedPct: number;
  /**
   * Risk-on/off scalar = target / realized, clamped to [0.25, 2.0].
   * 1.0 = neutral, 2.0 = max risk-on, 0.25 = heavy de-risk.
   */
  scalar: number;
  /** Total account equity in USD (env var or default fallback). */
  totalEquityUsd: number;
  /**
   * Approximate USD risk budget at full sizing across the entire portfolio
   * = totalEquityUsd × (targetVolAnnualizedPct / 100).
   *
   * NOT the cap on gross notional — that's deployable equity. This is the
   * vol-budget pie that gets sliced across strategies via the bandit weights.
   */
  budgetUsdAtFullSizing: number;
}

/**
 * Per-strategy slice of the portfolio vol budget.
 */
export interface StrategyVolBudget {
  strategy: string;
  /** Bandit weight for this strategy [0..1]. Sums to ~1.0 across strategies. */
  banditWeight: number;
  /**
   * Realized annualized vol of this strategy's last-60d closed trades, in
   * percent. Falls back to portfolio realized vol when the strategy has
   * < 20 trades in the window.
   */
  realizedVolAnnualizedPct: number;
  /**
   * USD budget for this strategy
   * = portfolio.budgetUsdAtFullSizing × banditWeight × portfolio.scalar.
   *
   * Phase D2 sizing: per_trade_size_usd = budgetUsd / stop_distance_pct × …
   * (signal-specific math). Always non-negative.
   */
  budgetUsd: number;
}

/**
 * Knobs for the vol-target module. All optional — sane defaults provided.
 */
export interface VolTargetConfig {
  /** Annualized vol target in percent. Default 14. */
  targetVolAnnualizedPct?: number;
  /** Lookback in calendar days for realized-vol calc. Default 60. */
  lookbackDays?: number;
  /**
   * Min number of daily P&L observations required for a portfolio realized-
   * vol calc. Below this, realizedVol = target (scalar = 1.0). Default 30.
   */
  minDaysForVolCalc?: number;
  /**
   * Min closed trades for a per-strategy realized-vol calc. Below this,
   * the strategy inherits portfolio realized vol. Default 20.
   */
  minTradesForStrategyVolCalc?: number;
  /** Lower clamp on the risk scalar. Default 0.25. */
  scalarMin?: number;
  /** Upper clamp on the risk scalar. Default 2.0. */
  scalarMax?: number;
  /** Total account equity in USD; if omitted, env PORTFOLIO_EQUITY_USD or 100_000. */
  totalEquityUsd?: number;
}

/**
 * Internal — daily P&L bucket used in realized-vol math.
 */
export interface DailyPnlBucket {
  /** YYYY-MM-DD UTC date string (used as map key). */
  date: string;
  /** Sum of realized P&L on that date, USD. */
  realizedPnlUsd: number;
}
