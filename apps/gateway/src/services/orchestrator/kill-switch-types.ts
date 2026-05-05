/**
 * Multi-level kill-switch system — type definitions.
 *
 * Three independently-tracked levels, each with its own activation/deactivation
 * lifecycle. The runtime composite is `KillSwitchStatus`, returned by every
 * status / action call so callers always see the full picture after any change.
 *
 * Levels:
 *   - 'strategy'  → pause a single strategy (e.g. on 5 consecutive losses)
 *                   Auto-deactivates after `expiresAt`. Reduces bandit weight to floor.
 *   - 'portfolio' → pause ALL new entries (e.g. on daily DD ≥ 3%, weekly DD ≥ 6%)
 *                   Auto-deactivates next 9 AM ET unless explicitly extended.
 *   - 'master'    → human-fired panic button. Flattens all open positions
 *                   immediately + blocks all new entries. Manual reset only.
 */

export type KillSwitchLevel = 'strategy' | 'portfolio' | 'master';

/** A single switch is either off, or active with metadata describing why/when. */
export type KillSwitchState =
  | { active: false }
  | {
      active: true;
      level: KillSwitchLevel;
      reason: string;
      activatedAt: string;
      /** ISO timestamp at which auto-deactivation occurs. Omit for indefinite/manual-only. */
      expiresAt?: string;
    };

/**
 * Full system snapshot. Returned by status calls and by every mutating
 * activate/deactivate operation. Always includes the metrics that drive the
 * auto-activation rules so dashboards can render thresholds without a separate
 * round-trip.
 */
export interface KillSwitchStatus {
  master: KillSwitchState;
  portfolio: KillSwitchState;
  /** Map of strategy name → state. Strategies not in the map are implicitly off. */
  strategies: Record<string, KillSwitchState>;
  metrics: {
    /** Realized daily PnL as a percentage of starting capital (e.g. -0.025 = -2.5%). */
    dailyPnlPct: number;
    /** Realized trailing-7-day PnL as a percentage of starting capital. */
    weeklyPnlPct: number;
    /** Realized trailing-30-day PnL as a percentage of starting capital. */
    monthlyPnlPct: number;
    /** Per-strategy run of consecutive losing trades on the most recent N outcomes. */
    consecutiveLossesByStrategy: Record<string, number>;
  };
}

/** Persistence schema. Bumped if the on-disk format ever changes. */
export interface KillSwitchPersistedFile {
  schemaVersion: 1;
  updatedAt: string;
  master: KillSwitchState;
  portfolio: KillSwitchState;
  strategies: Record<string, KillSwitchState>;
}

/** Auto-activation thresholds, exposed for tests + future config. */
export interface KillSwitchThresholds {
  /** Number of consecutive losses that pauses a strategy. Default: 5 */
  consecutiveLossLimit: number;
  /** Strategy pause duration in hours. Default: 24 */
  strategyPauseHours: number;
  /** Daily realized PnL pct below which portfolio pauses. Default: -0.03 (-3%). */
  dailyDdLimitPct: number;
  /** Weekly realized PnL pct below which portfolio pauses. Default: -0.06 (-6%). */
  weeklyDdLimitPct: number;
}

export const DEFAULT_THRESHOLDS: KillSwitchThresholds = {
  consecutiveLossLimit: 5,
  strategyPauseHours: 24,
  dailyDdLimitPct: -0.03,
  weeklyDdLimitPct: -0.06,
};
