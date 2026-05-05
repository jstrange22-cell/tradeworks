/**
 * Exit attribution + unified monitor barrel.
 *
 * Public surface:
 *   - writeOutcome / writeOutcomeFromTrade (close handlers call these)
 *   - triggerExit                          (preserved C1 wrapper)
 *   - forceFlattenAll                      (master-kill flatten)
 *   - startExitMonitor / stopExitMonitor   (D5 unified monitor lifecycle)
 *   - getExitMonitorStatus / getExitMonitorEvaluations / manualCloseByDecisionId
 *   - setStrategyExitConfig / getStrategyExitConfig
 *   - computePnlUsd / computeRMultiple     (exposed for unit tests + reuse)
 *   - mapReasonToExitReason                (exposed for tests + ad-hoc backfills)
 *
 * All operations no-op cleanly when MEMORY_DB_URL is unset, so this module is
 * safe to import from any close path.
 */

export {
  computePnlUsd,
  computeRMultiple,
  mapReasonToExitReason,
  writeOutcome,
  writeOutcomeFromTrade,
} from './outcome-writer.js';

export type {
  ComputeOutcomeInput,
  DirectOutcomeInput,
} from './outcome-writer.js';

export {
  triggerExit,
  forceFlattenAll,
  startExitMonitor,
  stopExitMonitor,
  getExitMonitorStatus,
  getExitMonitorEvaluations,
  setStrategyExitConfig,
  getStrategyExitConfig,
  manualCloseByDecisionId,
} from './monitor.js';
export type {
  ExitAssetClass,
  ExitTrigger,
  PositionEvaluation,
  MonitorStatus,
} from './monitor.js';

export type {
  ExitBar,
  ExitDecision,
  ExitReasonTag,
  ExitRule,
  ExitRuleContext,
  ExitRuleEntry,
  OpenPosition,
  PositionTrackerState,
  RegimeTag,
  StrategyExitConfig,
  StrategyExitConfigMap,
  StrategyTag,
} from './types.js';
export { DEFAULT_STRATEGY_EXIT_CONFIG } from './types.js';

export {
  buildRuleStack,
  evaluateExitRules,
  evaluateForStrategy,
  PRIORITY,
} from './rules-engine.js';
export type { EngineEvaluation } from './rules-engine.js';
