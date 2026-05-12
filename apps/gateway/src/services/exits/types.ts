/**
 * Exit-monitor public types — shared between rules, the engine, the monitor
 * loop, and the routes layer.
 *
 * Built for D5 (the unified exit monitor). Lives next to the existing
 * outcome-writer module so both the monitor (which fires exits) and the
 * writer (which attributes realized P&L) share the same vocabulary.
 *
 * IMPORTANT: keep this file dependency-free (only type imports allowed).
 * Anything that imports this should be testable in isolation.
 */
import type { ExitAssetClass } from './monitor.js';
import type { StockRegime } from '../stock-intelligence/stock-models.js';

// ── Strategy taxonomy ───────────────────────────────────────────────────
//
// The v2 strategy mix. Each open position carries a `strategy` tag so the
// engine can pick the right time-stop window and rule set.
export type StrategyTag =
  | 'PEAD'              // post-earnings drift — equities, ~60d
  | 'regime_trend'      // regime trend-follow — equities, ~90d
  | 'vol_rank_options'  // options on high-IV-rank — ~21d
  | 'sector_rotation'   // sector ETF rotation — ~30d
  | 'funding_basis'     // crypto funding/basis — open-ended
  | 'range_grid'        // crypto range/grid — open-ended
  | 'tradevisor'        // discretionary TradeVisor signal (legacy default)
  | 'unknown';

/**
 * Side from the exit-monitor perspective. Internally we normalise to
 * 'long' | 'short' so rule code reads cleanly.
 */
export type ExitSide = 'long' | 'short';

/**
 * Regime tag for regime-exit rule. Re-exported under a stable name so rule
 * code doesn't have to reach into stock-intelligence.
 */
export type RegimeTag = StockRegime;

// ── Open position (rule input) ──────────────────────────────────────────

/**
 * Normalised view of an open position the exit monitor evaluates.
 * Adapters (equity / option / cex) populate this from their native shapes
 * once per tick, so rule code doesn't fan out into per-asset branches.
 */
export interface OpenPosition {
  /** TradeVisor decision UUID — required for outcome attribution. */
  decisionId: string | null;
  /** Stable ID across ticks so the tracker can key high/low memory. */
  trackerId: string;
  assetClass: ExitAssetClass;
  symbol: string;
  side: ExitSide;
  /** Quantity remaining (post any partial closes). */
  qty: number;
  /** Original entry size — used by the r-ladder to reason about partials. */
  qtyAtEntry: number;
  entryPrice: number;
  /** Current hard stop. Must always be set; the monitor refuses stopless positions. */
  stopPrice: number;
  /** ISO timestamp of entry. */
  openedAt: string;
  strategy: StrategyTag;
  /** ATR at entry (in price units). Optional — atr-trailing skips when unset. */
  atrAtEntry?: number | null;
  /** Option-only: expiry date (YYYY-MM-DD). */
  expiry?: string | null;
  /** Whether the r-ladder partial has already fired this position. */
  ladderPartialDone?: boolean;
}

// ── Bar / tick (rule input) ─────────────────────────────────────────────

export interface ExitBar {
  /** Last trade or mid. */
  close: number;
  /** Bar high since the previous tick (use close if no high available). */
  high: number;
  /** Bar low since the previous tick (use close if no low available). */
  low: number;
  ts: string;
}

// ── Tracker state (per-position, persisted across ticks) ────────────────

export interface PositionTrackerState {
  trackerId: string;
  highSinceEntry: number;
  lowSinceEntry: number;
  /** True once the +1R partial has been taken. */
  ladderPartialDone: boolean;
  /** Last tick we evaluated this position. */
  lastEvaluatedAt: string;
}

// ── Rule contract ───────────────────────────────────────────────────────

export interface ExitRuleContext {
  position: OpenPosition;
  bar: ExitBar;
  highSinceEntry: number;
  lowSinceEntry: number;
  regime: RegimeTag;
  /** Wall-clock timestamp the rules engine considers "now" — injectable for tests. */
  now: Date;
}

export type ExitReasonTag =
  | 'stop'
  | 'target'
  | 'trail'
  | 'time'
  | 'regime'
  | 'r_ladder';

export interface ExitDecision {
  shouldExit: boolean;
  /** Mandatory when shouldExit=true; ignored otherwise. */
  reason?: ExitReasonTag;
  /** Mandatory when shouldExit=true; ignored otherwise. */
  exitPrice?: number;
  /** Set for partial fills (r_ladder). When omitted, full close is assumed. */
  partialQty?: number;
  /** Free-form trace for logs / dashboards. */
  notes?: string;
}

export type ExitRule = (ctx: ExitRuleContext) => ExitDecision;

export interface ExitRuleEntry {
  /** Stable id for telemetry / config. */
  id:
    | 'hard_stop'
    | 'regime_exit'
    | 'r_multiple_ladder'
    | 'atr_trailing'
    | 'time_stop'
    | 'profit_target';
  /** Lower number = higher priority. */
  priority: number;
  rule: ExitRule;
  /** When false, rule is skipped this tick (still evaluated in tests). */
  enabled: boolean;
}

// ── Strategy → rule config (loaded from data/exit-rules.json) ───────────

export interface StrategyExitConfig {
  /** Days after which the time-stop fires (open-ended → null). */
  timeStopDays: number | null;
  /** ATR multiple for the trailing stop (default 1.5). */
  atrTrailMultiple: number;
  /** Fixed profit-target % (relative to entry). null disables. */
  profitTargetPct: number | null;
  /** Disable the r-ladder for this strategy (e.g. options where partial = whole contract). */
  rLadderEnabled: boolean;
  /** Disable the atr-trailing rule when atrAtEntry isn't reliable. */
  atrTrailEnabled: boolean;
  /** Whether regime crisis flips us flat. Default true for equities, false for hedged crypto. */
  regimeExitEnabled: boolean;
}

export type StrategyExitConfigMap = Record<StrategyTag, StrategyExitConfig>;

/**
 * Default per-strategy exit config. The shipped time-stop windows match the
 * v2 brief (PEAD=60d, regime_trend=90d, vol_rank_options=21d,
 * sector_rotation=30d, funding_basis=null, range_grid=null).
 */
export const DEFAULT_STRATEGY_EXIT_CONFIG: StrategyExitConfigMap = {
  PEAD: {
    timeStopDays: 60,
    atrTrailMultiple: 1.5,
    profitTargetPct: null,
    rLadderEnabled: true,
    atrTrailEnabled: true,
    regimeExitEnabled: true,
  },
  regime_trend: {
    timeStopDays: 90,
    atrTrailMultiple: 2.0,
    profitTargetPct: null,
    rLadderEnabled: true,
    atrTrailEnabled: true,
    regimeExitEnabled: true,
  },
  vol_rank_options: {
    timeStopDays: 21,
    atrTrailMultiple: 1.5,
    profitTargetPct: null,
    // Options sized in contracts where 1 contract ≈ minimum size — partial
    // closes don't make sense for the typical 1-contract paper trade.
    rLadderEnabled: false,
    atrTrailEnabled: false,
    regimeExitEnabled: true,
  },
  sector_rotation: {
    timeStopDays: 30,
    atrTrailMultiple: 1.5,
    profitTargetPct: null,
    rLadderEnabled: true,
    atrTrailEnabled: true,
    regimeExitEnabled: true,
  },
  funding_basis: {
    timeStopDays: null,
    atrTrailMultiple: 1.5,
    // 8% TP mirrors the CEX paper agent's own 8% threshold — positions that
    // run through a bull move will actually close via the exit monitor.
    profitTargetPct: 8,
    rLadderEnabled: false,
    atrTrailEnabled: false,
    // Hedged carry strategy — flipping flat on regime crisis would defeat
    // the purpose. Hold the basis trade through volatility.
    regimeExitEnabled: false,
  },
  range_grid: {
    timeStopDays: null,
    atrTrailMultiple: 1.5,
    profitTargetPct: 8,
    rLadderEnabled: false,
    atrTrailEnabled: false,
    regimeExitEnabled: false,
  },
  tradevisor: {
    // 5 trading days ≈ 7 calendar — matches the legacy stock-agent default
    // so behaviour stays the same for any open position tagged 'tradevisor'.
    timeStopDays: 7,
    atrTrailMultiple: 1.5,
    // Hard TP at 8% so straight-up bull moves actually realize — the ATR
    // trailing stop only arms at +3% and needs a 1% pullback to fire,
    // which may never come on a gap-up day.
    profitTargetPct: 8,
    rLadderEnabled: true,
    atrTrailEnabled: true,
    regimeExitEnabled: true,
  },
  unknown: {
    timeStopDays: 30,
    atrTrailMultiple: 1.5,
    profitTargetPct: 8,
    rLadderEnabled: false,
    atrTrailEnabled: false,
    regimeExitEnabled: true,
  },
};
