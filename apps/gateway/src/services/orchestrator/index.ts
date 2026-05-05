/**
 * Orchestrator module barrel — APEX meta-controller layer.
 *
 * Phase C exports the multi-armed bandit allocator. Phase D's sizing module
 * should import `getBanditWeight` from here and multiply it into the
 * per-trade size budget:
 *
 *   import { getBanditWeight } from '../orchestrator/index.js';
 *   const weight = getBanditWeight(signal.strategy);   // [0..1], sums to 1 across known strategies
 *   const size = baseSize * weight;
 *
 * The accessor is synchronous, never throws, and returns 1/N (equal weight)
 * if the weights file hasn't been loaded yet.
 */

export {
  canRecomputeNow,
  clearTempOverrides,
  getBanditWeight,
  getCurrentWeights,
  initBandit,
  recomputeNow,
  setTempOverride,
} from './bandit-runner.js';

export {
  computeStrategyStats,
  computeWeights,
  sampleBeta,
  sampleGamma,
} from './bandit.js';

export {
  KNOWN_STRATEGIES,
  type BanditConfig,
  type BanditInput,
  type BanditOutput,
  type BanditTradeOutcome,
  type BanditWeightsFile,
  type StrategyName,
  type StrategyStats,
  type StrategyWeightEntry,
} from './bandit-types.js';

// ── Phase D1: vol-targeted portfolio sizing ────────────────────────────
// Phase D2 sizing should consume `getStrategyVolBudget(strategy)` to derive
// per-trade USD size from the strategy's vol budget and stop distance.
export {
  clearVolTargetCache,
  computeAnnualizedVolPctFromDailyPnl,
  getAllStrategyVolBudgets,
  getPortfolioVolBudget,
  getStrategyVolBudget,
} from './vol-target.js';

export type {
  DailyPnlBucket,
  PortfolioVolBudget,
  StrategyVolBudget,
  VolTargetConfig,
} from './vol-target-types.js';

// ── Phase D: market-regime detection ───────────────────────────────────
// Drives:
//   - TradeVisor reasoner context (`ctx.macro.regime` is now a RegimeTag)
//   - Bandit recompute output (`byRegime` field tags weights with regime)
//   - D2 sizing → `isCrisisGate()` returns 0 qty during crisis
//   - D3 heat tracker → `getHeatBudgetScalar()` scales budget in volatile/crisis
export {
  classify,
  getCachedRegime,
  getCurrentRegime,
  getHeatBudgetScalar,
  getRegimeForDate,
  isCrisisGate,
} from './regime.js';

export type {
  LastRegimeFile,
  MarketRegime,
  RegimeSignals,
  RegimeTag,
} from './regime-types.js';