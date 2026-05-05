/**
 * Quant sizing — type definitions.
 *
 * The orchestrator-level sizing module replaces the legacy dollar-tier sizing
 * in `services/stock-intelligence/sizing.ts`. Sizing flows top-down:
 *
 *   portfolio_vol_budget (D1)
 *     × bandit_weight (C4)        → strategy_budget_usd
 *     × risk_per_trade_pct        → recommended_risk_usd
 *     ÷ stop_distance_usd         → recommended_quantity
 *
 * Risk-per-trade is modulated by an empirical fractional Kelly computed from
 * the calibration table. Position size is then hard-capped at 5% of equity.
 */

export interface SizingInputs {
  /**
   * Strategy name. Must match the keys used by the bandit + calibration
   * tables (e.g. 'pead', 'regime_trend', 'tradevisor_pine'). When unknown,
   * the caller should pass 'unknown' — sizing will fall back to neutral
   * defaults (equal bandit weight, neutral Kelly).
   */
  strategy: string;
  symbol: string;
  side: 'buy' | 'sell' | 'short';
  /** Per-share entry price (or per-contract premium for options). */
  entryPrice: number;
  /** Hard-stop level. Distance to entry defines per-share risk. */
  stopPrice: number;
  /**
   * ATR(14) in dollar terms. Currently only used for telemetry — stop
   * distance is taken directly from `entryPrice - stopPrice`. Optional:
   * pass null/undefined when unavailable.
   */
  atrDollars?: number | null;
  /** Current account equity in USD. Used for the 5% per-position cap. */
  totalEquityUsd: number;
  /**
   * Options flag. Affects share rounding (round to whole contracts; each
   * contract = 100 shares of premium). Default: false (equity).
   */
  isOption?: boolean;
}

export interface SizingBreakdown {
  /** Output of getStrategyVolBudget — already includes bandit weighting. */
  strategyBudgetUsd: number;
  /** Bandit weight for this strategy at sizing time. */
  banditWeight: number;
  /**
   * Vol-target scalar at sizing time (1.0 in normal regime, < 1 in
   * elevated vol, > 1 in compressed vol — capped by D1 internally).
   */
  portfolioVolScalar: number;
  /** Risk-per-trade as fraction of strategy budget. */
  riskPerTradePct: number;
  /** Stop distance as fraction of entry price. */
  stopDistancePct: number;
  /**
   * Empirical fractional Kelly from calibration:
   *   kelly_full = winRate - (1 - winRate) / avgR
   *   kelly_fraction = clamp(0, 0.5) of (kelly_full × 0.5)
   */
  kellyFraction: number;
  /** Hard cap: 5% of total equity. */
  maxPositionCapUsd: number;
}

export interface SizingResult {
  /** Whole shares for equity, whole contracts for options. */
  recommendedQuantity: number;
  recommendedNotionalUsd: number;
  /** Dollar risk to the stop (qty × stop distance). */
  recommendedRiskUsd: number;
  breakdown: SizingBreakdown;
  /**
   * Soft warnings: stale calibration, missing budget, position-cap clamp,
   * tiny budget skip, etc. Empty when sizing was clean.
   */
  warnings: string[];
}
