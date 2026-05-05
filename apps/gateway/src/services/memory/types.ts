/**
 * Memory module type definitions — mirror the SQL schema in
 * `apps/gateway/migrations/2026_v2_memory_schema.sql`.
 */

export type Verdict = 'approve' | 'veto' | 'escalate';
export type Resolution = 'executed' | 'skipped' | 'manual_override' | 'expired';
export type AssetClass = 'equity' | 'option' | 'crypto';
export type Side = 'buy' | 'sell' | 'short' | 'cover';
export type FillStatus = 'filled' | 'partial' | 'rejected' | 'pending';
export type ExitReason = 'stop' | 'target' | 'trail' | 'time' | 'apex_close' | 'manual';

// ── decisions ─────────────────────────────────────────────────────────
export interface DecisionInput {
  strategy: string;
  signal: unknown;          // serialised to JSONB
  context: unknown;         // serialised to JSONB
  verdict?: Verdict | null;
  reasoning?: string | null;
  confidence?: number | null;          // 0..1
  adjustedSizeUsd?: number | null;
  adjustedStopPct?: number | null;
  modelUsed?: string | null;
  reasoningLatencyMs?: number | null;
}

export interface DecisionRow {
  id: string;
  createdAt: Date;
  resolvedAt: Date | null;
  strategy: string;
  signal: unknown;
  context: unknown;
  verdict: Verdict | null;
  reasoning: string | null;
  confidence: number | null;
  adjustedSizeUsd: number | null;
  adjustedStopPct: number | null;
  modelUsed: string | null;
  reasoningLatencyMs: number | null;
  resolution: Resolution | null;
}

export interface RecentDecisionsFilter {
  strategy?: string;
  verdict?: Verdict;
  resolution?: Resolution;
  /** ISO timestamp or Date — only return rows created at/after this */
  since?: Date | string;
}

// ── executions ────────────────────────────────────────────────────────
export interface ExecutionInput {
  decisionId: string;
  assetClass: AssetClass;
  symbol: string;
  side: Side;
  quantity: number;
  fillPrice?: number | null;
  fillStatus: FillStatus;
  broker: string;
  rawResponse?: unknown;
}

export interface ExecutionRow {
  id: string;
  decisionId: string;
  createdAt: Date;
  assetClass: AssetClass;
  symbol: string;
  side: Side;
  quantity: number;
  fillPrice: number | null;
  fillStatus: FillStatus;
  broker: string;
  rawResponse: unknown;
}

// ── trade_outcomes ────────────────────────────────────────────────────
export interface OutcomeInput {
  decisionId: string;
  realizedPnlUsd: number;
  rMultiple?: number | null;
  wasStopHit?: boolean | null;
  wasTargetHit?: boolean | null;
  holdingMinutes?: number | null;
  exitReason?: ExitReason | null;
  notes?: string | null;
  /** Defaults to NOW() server-side if omitted */
  closedAt?: Date | string;
}

export interface OutcomeRow {
  decisionId: string;
  closedAt: Date;
  realizedPnlUsd: number;
  rMultiple: number | null;
  wasStopHit: boolean | null;
  wasTargetHit: boolean | null;
  holdingMinutes: number | null;
  exitReason: ExitReason | null;
  notes: string | null;
}

// ── embeddings / similarity ───────────────────────────────────────────
export interface SimilarDecision {
  decisionId: string;
  similarity: number;       // cosine similarity in [0..1]
  strategy: string;
  verdict: Verdict | null;
  outcome: OutcomeRow | null;
}
