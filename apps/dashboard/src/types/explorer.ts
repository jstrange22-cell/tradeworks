/**
 * Trades & Decisions Explorer — shared types between the page,
 * detail view, and hooks. Mirrors the gateway routes in
 * `apps/gateway/src/routes/trades-explorer.ts`.
 */

export type Verdict = 'approve' | 'veto' | 'escalate';
export type Resolution = 'executed' | 'skipped' | 'manual_override' | 'expired';

export interface ExplorerListRow {
  id: string;
  createdAt: string;
  resolvedAt: string | null;
  strategy: string;
  symbol: string | null;
  verdict: Verdict | null;
  confidence: number | null;
  reasoningSnippet: string | null;
  modelUsed: string | null;
  reasoningLatencyMs: number | null;
  adjustedSizeUsd: number | null;
  adjustedStopPct: number | null;
  resolution: Resolution | null;
  regime: string | null;
  sector: string | null;
  scoutRank: number | null;
  action: string | null;
  realizedPnlUsd: number | null;
  rMultiple: number | null;
  exitReason: string | null;
  closedAt: string | null;
  execCount: number;
  ragMatchCount: number;
}

export interface ExplorerListResponse {
  data: {
    rows: ExplorerListRow[];
    total: number;
    limit: number;
    offset: number;
  };
  meta: { available: boolean; reason?: string };
}

export interface ExplorerListFilters {
  strategy?: string;
  verdict?: Verdict;
  regime?: string;
  sector?: string;
  symbol?: string;
  minConfidence?: number;
  maxConfidence?: number;
  startDate?: string;
  endDate?: string;
}

// ── Detail view ──

export interface ExplorerDecisionDetail {
  id: string;
  createdAt: string;
  resolvedAt: string | null;
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
  symbol: string | null;
  action: string | null;
  regime: string | null;
  sector: string | null;
  scoutRank: number | null;
}

export interface ExplorerExecution {
  id: string;
  createdAt: string;
  assetClass: 'equity' | 'option' | 'crypto';
  symbol: string;
  side: 'buy' | 'sell' | 'short' | 'cover';
  quantity: number;
  fillPrice: number | null;
  fillStatus: 'filled' | 'partial' | 'rejected' | 'pending';
  broker: string;
  rawResponse: unknown;
}

export interface ExplorerOutcome {
  decisionId: string;
  closedAt: string;
  realizedPnlUsd: number;
  rMultiple: number | null;
  wasStopHit: boolean | null;
  wasTargetHit: boolean | null;
  holdingMinutes: number | null;
  exitReason: string | null;
  notes: string | null;
}

export interface ExplorerRagRetrieval {
  decisionId: string;
  similarity: number;
  signal: {
    symbol: string;
    action: string;
    strategy: string;
    grade: string | null;
    score: number | null;
    regime: string | null;
  };
  contextSnippet: string;
  outcome: {
    realizedPnlUsd: number;
    rMultiple: number | null;
    exitReason: string;
    holdingMinutes: number;
  } | null;
  createdAt: string;
}

export interface ExplorerActiveHeuristic {
  id: string;
  lesson: string;
  impact?: string;
}

export interface ExplorerDetailResponse {
  data: {
    decision: ExplorerDecisionDetail;
    executions: ExplorerExecution[];
    outcome: ExplorerOutcome | null;
    ragRetrievals: ExplorerRagRetrieval[];
    activeHeuristics: ExplorerActiveHeuristic[];
  };
}

// ── Aggregates ──

export type AggregateGroupBy =
  | 'strategy'
  | 'regime'
  | 'confidence_bucket'
  | 'sector'
  | 'hour'
  | 'verdict'
  | 'symbol';

export interface AggregateBucketStats {
  bucketKey: string;
  n: number;
  closed: number;
  winRate: number;
  avgRMultiple: number;
  avgPnlUsd: number;
  totalPnlUsd: number;
  approves: number;
  vetoes: number;
  escalations: number;
}

export interface ExplorerAggregateResponse {
  data: {
    groupBy: AggregateGroupBy;
    buckets: AggregateBucketStats[];
    totals: AggregateBucketStats;
  };
  meta: { available: boolean };
}
