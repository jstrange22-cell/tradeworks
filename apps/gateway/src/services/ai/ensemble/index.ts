/**
 * Ensemble — multi-model fan-out + consensus primitives.
 *
 * Used by:
 *   - apex-chat.ts — synthesis path (primary + secondaries → unified APEX reply)
 *   - tradevisor-agent/ensemble-reasoner.ts — verdict path (consensus → Decision)
 */
export { callModelsParallel, isEnabled } from './fan-out.js';
export { synthesizeResponses } from './synthesize.js';
export { detectConsensus } from './consensus.js';
export {
  estimateCallCostUsd,
  getDailyBudgetUsd,
  getDailySpend,
  isOverBudget,
  recordEnsembleSpend,
  resetSpendForTesting,
} from './cost-tracker.js';
export type {
  EnsembleModelName,
  ModelResponse,
  FanOutOptions,
  FanOutResult,
} from './types.js';
export type { ConsensusResult, ModelVerdict } from './consensus.js';
