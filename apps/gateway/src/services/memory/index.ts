/**
 * Memory module barrel — APEX learning memory layer (pgvector-backed).
 *
 * Public surface:
 *   - initializeMemory / runMigrations  (boot-time wiring)
 *   - decisions / executions / outcomes (CRUD)
 *   - embeddings + similarity search
 *
 * All operations no-op cleanly when `MEMORY_DB_URL` is unset, so this module
 * is safe to import unconditionally from gateway code paths.
 */

// db lifecycle
export {
  closeMemoryPool,
  getPool,
  initializeMemory,
  isAvailable,
  runMigrations,
} from './db.js';

// decisions
export {
  getDecisionById,
  getRecentDecisions,
  insertDecision,
  updateDecisionResolution,
} from './decisions.js';

// executions
export {
  getExecutionsByDecisionId,
  insertExecution,
} from './executions.js';

// outcomes
export {
  getOutcomeByDecisionId,
  upsertOutcome,
} from './outcomes.js';

// embeddings + similarity
export {
  embedAndStore,
  embedDecision,
  searchSimilar,
  searchSimilarByText,
} from './embeddings.js';

export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER,
  embedText,
} from './embedder.js';

// RAG retrieval + prompt formatting
export { retrieveSimilarTrades } from './rag.js';
export type { SimilarTrade, SignalSummary, RetrieveOptions } from './rag.js';
export { formatRagContext } from './rag-format.js';

// types
export type {
  AssetClass,
  DecisionInput,
  DecisionRow,
  ExecutionInput,
  ExecutionRow,
  ExitReason,
  FillStatus,
  OutcomeInput,
  OutcomeRow,
  RecentDecisionsFilter,
  Resolution,
  Side,
  SimilarDecision,
  Verdict,
} from './types.js';
