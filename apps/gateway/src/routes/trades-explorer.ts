/**
 * Trades & Decisions Explorer HTTP API.
 *
 * Surfaces a searchable, filterable view of every APEX reasoning event
 * joined with the broker fills, realised outcomes, and (for the detail
 * view) the RAG retrievals + active learned heuristics that shaped the
 * verdict.
 *
 *   GET /api/v1/explorer/decisions             — paginated list with filters
 *   GET /api/v1/explorer/decisions/:id         — single decision, full join
 *   GET /api/v1/explorer/aggregates            — calibration-style group-bys
 *
 * All routes degrade cleanly when MEMORY_DB_URL is unset (returns empty
 * arrays / zeroed counts so the dashboard renders the empty-state instead
 * of crashing).
 */
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getPool } from '../services/memory/db.js';
import {
  getDecisionById,
  getExecutionsByDecisionId,
  getOutcomeByDecisionId,
} from '../services/memory/index.js';
import { retrieveSimilarTrades } from '../services/memory/rag.js';
import { readHeuristics } from '../services/ai/post-mortem/heuristics-store.js';
import { logger } from '../lib/logger.js';
import {
  bucketizeConfidence,
  hourBucket,
  type ConfidenceBucketKey,
} from '../services/ai/calibration/buckets.js';

export const tradesExplorerRouter: RouterType = Router();

// ── Query schemas ─────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  strategy: z.string().optional(),
  verdict: z.enum(['approve', 'veto', 'escalate']).optional(),
  regime: z.string().optional(),
  sector: z.string().optional(),
  symbol: z.string().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const AggregateQuerySchema = z.object({
  groupBy: z
    .enum(['strategy', 'regime', 'confidence_bucket', 'sector', 'hour', 'verdict', 'symbol'])
    .default('strategy'),
  strategy: z.string().optional(),
  verdict: z.enum(['approve', 'veto', 'escalate']).optional(),
  regime: z.string().optional(),
  sector: z.string().optional(),
  symbol: z.string().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ── Joined DB row shape ───────────────────────────────────────────────

interface ExplorerDbRow {
  id: string;
  created_at: Date;
  resolved_at: Date | null;
  strategy: string;
  signal: unknown;
  context: unknown;
  verdict: string | null;
  reasoning: string | null;
  confidence: number | null;
  adjusted_size_usd: number | null;
  adjusted_stop_pct: number | null;
  model_used: string | null;
  reasoning_latency_ms: number | null;
  resolution: string | null;
  // Outcome fields (left join — may be null)
  o_realized_pnl_usd: number | null;
  o_r_multiple: number | null;
  o_was_stop_hit: boolean | null;
  o_was_target_hit: boolean | null;
  o_holding_minutes: number | null;
  o_exit_reason: string | null;
  o_closed_at: Date | null;
  o_notes: string | null;
  // Aggregated execution counts via subquery
  exec_count: number;
  // Embedding count — used to display "K similar past trades" hint
  rag_match_count: number;
}

// ── JSONB extractors (defensive against schema drift) ─────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function pickString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function extractSymbol(signal: unknown): string | null {
  if (!isObject(signal)) return null;
  return pickString(signal['symbol']) ?? pickString(signal['ticker']);
}
function extractRegime(ctx: unknown): string | null {
  if (!isObject(ctx)) return null;
  const macro = ctx['macro'];
  if (!isObject(macro)) return null;
  return pickString(macro['regime']);
}
function extractSector(ctx: unknown, symbol: string | null): string | null {
  if (!isObject(ctx)) return null;
  const portfolio = ctx['portfolio'];
  if (!isObject(portfolio)) return null;
  const positions = portfolio['equityPositions'];
  if (!Array.isArray(positions) || symbol === null) return null;
  for (const pos of positions) {
    if (isObject(pos) && pos['symbol'] === symbol && typeof pos['sector'] === 'string') {
      return pos['sector'];
    }
  }
  return pickString(ctx['sector']);
}
function extractScoutRank(ctx: unknown): number | null {
  if (!isObject(ctx)) return null;
  const scout = ctx['scout'];
  if (!isObject(scout)) return null;
  return typeof scout['rank'] === 'number' ? scout['rank'] : null;
}

// ── Row shaping ───────────────────────────────────────────────────────

interface ExplorerListRow {
  id: string;
  createdAt: string;
  resolvedAt: string | null;
  strategy: string;
  symbol: string | null;
  verdict: string | null;
  confidence: number | null;
  reasoningSnippet: string | null;
  modelUsed: string | null;
  reasoningLatencyMs: number | null;
  adjustedSizeUsd: number | null;
  adjustedStopPct: number | null;
  resolution: string | null;
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

function shapeListRow(r: ExplorerDbRow): ExplorerListRow {
  const symbol = extractSymbol(r.signal);
  const action = isObject(r.signal)
    ? pickString(r.signal['action']) ?? pickString(r.signal['side'])
    : null;
  const reasoningSnippet =
    typeof r.reasoning === 'string' && r.reasoning.length > 0
      ? r.reasoning.slice(0, 240)
      : null;

  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    strategy: r.strategy,
    symbol,
    verdict: r.verdict,
    confidence: r.confidence === null ? null : Number(r.confidence),
    reasoningSnippet,
    modelUsed: r.model_used,
    reasoningLatencyMs: r.reasoning_latency_ms,
    adjustedSizeUsd: r.adjusted_size_usd === null ? null : Number(r.adjusted_size_usd),
    adjustedStopPct: r.adjusted_stop_pct === null ? null : Number(r.adjusted_stop_pct),
    resolution: r.resolution,
    regime: extractRegime(r.context),
    sector: extractSector(r.context, symbol),
    scoutRank: extractScoutRank(r.context),
    action,
    realizedPnlUsd: r.o_realized_pnl_usd === null ? null : Number(r.o_realized_pnl_usd),
    rMultiple: r.o_r_multiple === null ? null : Number(r.o_r_multiple),
    exitReason: r.o_exit_reason,
    closedAt: r.o_closed_at ? r.o_closed_at.toISOString() : null,
    execCount: Number(r.exec_count ?? 0),
    ragMatchCount: Number(r.rag_match_count ?? 0),
  };
}

// ── Filter → SQL WHERE builder ────────────────────────────────────────

interface FilterParams {
  strategy?: string;
  verdict?: 'approve' | 'veto' | 'escalate';
  regime?: string;
  sector?: string;
  symbol?: string;
  minConfidence?: number;
  maxConfidence?: number;
  startDate?: string;
  endDate?: string;
}

interface BuiltWhere {
  sql: string;
  params: unknown[];
}

function buildWhere(filters: FilterParams, startIndex = 1): BuiltWhere {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  const push = (clause: string, value: unknown) => {
    parts.push(clause.replace('$$', `$${i}`));
    params.push(value);
    i += 1;
  };

  if (filters.strategy) push('d.strategy = $$', filters.strategy);
  if (filters.verdict) push('d.verdict = $$', filters.verdict);
  if (filters.minConfidence !== undefined) push('d.confidence >= $$', filters.minConfidence);
  if (filters.maxConfidence !== undefined) push('d.confidence <= $$', filters.maxConfidence);
  if (filters.startDate) push('d.created_at >= $$', filters.startDate);
  if (filters.endDate) push('d.created_at <= $$', filters.endDate);
  if (filters.regime) {
    push("d.context->'macro'->>'regime' = $$", filters.regime);
  }
  if (filters.symbol) {
    // Support both `signal.symbol` and `signal.ticker` keys
    parts.push(`(d.signal->>'symbol' = $${i} OR d.signal->>'ticker' = $${i})`);
    params.push(filters.symbol);
    i += 1;
  }
  if (filters.sector) {
    push("d.context->>'sector' = $$", filters.sector);
  }

  const sql = parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '';
  return { sql, params };
}

// ── GET /decisions — paginated list ───────────────────────────────────

tradesExplorerRouter.get('/decisions', async (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid query', detail: parsed.error.flatten() });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.json({
      data: { rows: [], total: 0, limit: parsed.data.limit, offset: parsed.data.offset },
      meta: { available: false, reason: 'MEMORY_DB_URL unset' },
    });
    return;
  }

  const { limit, offset, ...filters } = parsed.data;
  const { sql: whereSql, params } = buildWhere(filters, 1);

  // total count (filtered)
  const countSql = `SELECT COUNT(*)::bigint AS total FROM decisions d ${whereSql}`;
  // page rows with joined outcome + execution count + rag match count
  const pageSql = `
    SELECT
      d.id, d.created_at, d.resolved_at, d.strategy, d.signal, d.context,
      d.verdict, d.reasoning, d.confidence, d.adjusted_size_usd,
      d.adjusted_stop_pct, d.model_used, d.reasoning_latency_ms, d.resolution,
      o.realized_pnl_usd AS o_realized_pnl_usd,
      o.r_multiple       AS o_r_multiple,
      o.was_stop_hit     AS o_was_stop_hit,
      o.was_target_hit   AS o_was_target_hit,
      o.holding_minutes  AS o_holding_minutes,
      o.exit_reason      AS o_exit_reason,
      o.closed_at        AS o_closed_at,
      o.notes            AS o_notes,
      COALESCE((SELECT COUNT(*) FROM executions e WHERE e.decision_id = d.id), 0) AS exec_count,
      COALESCE((SELECT 1 FROM decision_embeddings emb WHERE emb.decision_id = d.id LIMIT 1), 0) AS rag_match_count
    FROM decisions d
    LEFT JOIN trade_outcomes o ON o.decision_id = d.id
    ${whereSql}
    ORDER BY d.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  try {
    const [countRes, pageRes] = await Promise.all([
      pool.query<{ total: string }>(countSql, params),
      pool.query<ExplorerDbRow>(pageSql, [...params, limit, offset]),
    ]);
    const total = Number(countRes.rows[0]?.total ?? 0);
    const rows = pageRes.rows.map(shapeListRow);

    res.json({
      data: { rows, total, limit, offset },
      meta: { available: true },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[explorer.decisions] query failed',
    );
    res.status(500).json({ error: 'explorer query failed' });
  }
});

// ── GET /decisions/:id — full detail ──────────────────────────────────

tradesExplorerRouter.get('/decisions/:id', async (req, res) => {
  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.status(503).json({
      error: 'memory DB unavailable',
      detail: 'MEMORY_DB_URL is not set — explorer detail requires the memory store',
    });
    return;
  }

  try {
    const decision = await getDecisionById(id);
    if (!decision) {
      res.status(404).json({ error: 'decision not found' });
      return;
    }

    const [executions, outcome] = await Promise.all([
      getExecutionsByDecisionId(id),
      getOutcomeByDecisionId(id),
    ]);

    // RAG retrievals — embed the original signal text and pull top-k similar
    // trades. We tolerate failures here since the main payload is still
    // useful without the citations.
    const symbol = extractSymbol(decision.signal);
    const action = isObject(decision.signal)
      ? pickString(decision.signal['action']) ?? pickString(decision.signal['side'])
      : null;
    const ragSignalText = `${decision.strategy} ${symbol ?? ''} ${action ?? ''} ${
      decision.reasoning ?? ''
    }`.slice(0, 4000);

    let ragRetrievals: Awaited<ReturnType<typeof retrieveSimilarTrades>> = [];
    try {
      ragRetrievals = await retrieveSimilarTrades(ragSignalText, {
        k: 8,
        minSimilarity: 0,
        onlyClosed: false,
      });
      // Drop the candidate's own row if present
      ragRetrievals = ragRetrievals.filter((t) => t.decisionId !== id);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, id },
        '[explorer.detail] RAG retrieval failed — continuing without citations',
      );
    }

    // Active heuristics as of now (we don't snapshot them at decision time
    // today — best we can do is show the current set so the user knows what
    // would influence a *similar* decision today).
    let activeHeuristics: Array<{ id: string; lesson: string; impact?: string }> = [];
    try {
      const file = readHeuristics();
      activeHeuristics = file.active.map((l) => ({
        id: l.id,
        lesson: l.lesson,
        ...(l.impact ? { impact: l.impact } : {}),
      }));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        '[explorer.detail] could not read heuristics file',
      );
    }

    res.json({
      data: {
        decision: {
          id: decision.id,
          createdAt: decision.createdAt.toISOString(),
          resolvedAt: decision.resolvedAt ? decision.resolvedAt.toISOString() : null,
          strategy: decision.strategy,
          signal: decision.signal,
          context: decision.context,
          verdict: decision.verdict,
          reasoning: decision.reasoning,
          confidence: decision.confidence,
          adjustedSizeUsd: decision.adjustedSizeUsd,
          adjustedStopPct: decision.adjustedStopPct,
          modelUsed: decision.modelUsed,
          reasoningLatencyMs: decision.reasoningLatencyMs,
          resolution: decision.resolution,
          symbol,
          action,
          regime: extractRegime(decision.context),
          sector: extractSector(decision.context, symbol),
          scoutRank: extractScoutRank(decision.context),
        },
        executions: executions.map((e) => ({
          id: e.id,
          createdAt: e.createdAt.toISOString(),
          assetClass: e.assetClass,
          symbol: e.symbol,
          side: e.side,
          quantity: e.quantity,
          fillPrice: e.fillPrice,
          fillStatus: e.fillStatus,
          broker: e.broker,
          rawResponse: e.rawResponse,
        })),
        outcome: outcome
          ? {
              decisionId: outcome.decisionId,
              closedAt: outcome.closedAt.toISOString(),
              realizedPnlUsd: outcome.realizedPnlUsd,
              rMultiple: outcome.rMultiple,
              wasStopHit: outcome.wasStopHit,
              wasTargetHit: outcome.wasTargetHit,
              holdingMinutes: outcome.holdingMinutes,
              exitReason: outcome.exitReason,
              notes: outcome.notes,
            }
          : null,
        ragRetrievals,
        activeHeuristics,
      },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, id },
      '[explorer.detail] failed',
    );
    res.status(500).json({ error: 'explorer detail failed' });
  }
});

// ── GET /aggregates — group-by stats over the filtered set ────────────

interface BucketStats {
  bucketKey: string;
  n: number;
  closed: number;
  winRate: number;        // 0..1 over closed
  avgRMultiple: number;   // mean over closed with rMultiple !== null
  avgPnlUsd: number;      // mean realized over closed
  totalPnlUsd: number;
  approves: number;
  vetoes: number;
  escalations: number;
}

interface AggregateDbRow {
  id: string;
  strategy: string;
  verdict: string | null;
  confidence: number | null;
  signal: unknown;
  context: unknown;
  created_at: Date;
  realized_pnl_usd: number | null;
  r_multiple: number | null;
}

function emptyStats(key: string): BucketStats {
  return {
    bucketKey: key,
    n: 0,
    closed: 0,
    winRate: 0,
    avgRMultiple: 0,
    avgPnlUsd: 0,
    totalPnlUsd: 0,
    approves: 0,
    vetoes: 0,
    escalations: 0,
  };
}

function aggregateBucket(rows: AggregateDbRow[], key: string): BucketStats {
  const stats = emptyStats(key);
  stats.n = rows.length;
  const pnls: number[] = [];
  const rMultiples: number[] = [];
  let wins = 0;
  for (const r of rows) {
    if (r.verdict === 'approve') stats.approves += 1;
    else if (r.verdict === 'veto') stats.vetoes += 1;
    else if (r.verdict === 'escalate') stats.escalations += 1;
    if (r.realized_pnl_usd !== null && r.realized_pnl_usd !== undefined) {
      stats.closed += 1;
      const pnl = Number(r.realized_pnl_usd);
      pnls.push(pnl);
      stats.totalPnlUsd += pnl;
      if (pnl > 0) wins += 1;
    }
    if (r.r_multiple !== null && r.r_multiple !== undefined) {
      rMultiples.push(Number(r.r_multiple));
    }
  }
  stats.winRate = stats.closed > 0 ? wins / stats.closed : 0;
  stats.avgPnlUsd = pnls.length > 0 ? stats.totalPnlUsd / pnls.length : 0;
  stats.avgRMultiple =
    rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
  return stats;
}

function bucketKeyForRow(
  row: AggregateDbRow,
  groupBy: z.infer<typeof AggregateQuerySchema>['groupBy'],
): string | null {
  switch (groupBy) {
    case 'strategy':
      return row.strategy ?? 'unknown';
    case 'verdict':
      return row.verdict ?? 'pending';
    case 'regime':
      return extractRegime(row.context);
    case 'sector':
      return extractSector(row.context, extractSymbol(row.signal));
    case 'symbol':
      return extractSymbol(row.signal);
    case 'confidence_bucket': {
      const c: ConfidenceBucketKey | null = bucketizeConfidence(
        row.confidence === null ? null : Number(row.confidence),
      );
      return c;
    }
    case 'hour': {
      // ET hour bucket — same approximation calibration uses
      const utcHour = row.created_at.getUTCHours();
      return hourBucket((utcHour - 5 + 24) % 24);
    }
  }
}

tradesExplorerRouter.get('/aggregates', async (req, res) => {
  const parsed = AggregateQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid query', detail: parsed.error.flatten() });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.json({
      data: { groupBy: parsed.data.groupBy, buckets: [], totals: emptyStats('all') },
      meta: { available: false },
    });
    return;
  }

  const { groupBy, ...filters } = parsed.data;
  const { sql: whereSql, params } = buildWhere(filters, 1);

  const sql = `
    SELECT d.id, d.strategy, d.verdict, d.confidence, d.signal, d.context, d.created_at,
           o.realized_pnl_usd, o.r_multiple
      FROM decisions d
      LEFT JOIN trade_outcomes o ON o.decision_id = d.id
      ${whereSql}
  `;

  try {
    const result = await pool.query<AggregateDbRow>(sql, params);
    const rows = result.rows;
    const groups = new Map<string, AggregateDbRow[]>();
    for (const r of rows) {
      const k = bucketKeyForRow(r, groupBy);
      if (k === null) continue;
      const arr = groups.get(k);
      if (arr) arr.push(r);
      else groups.set(k, [r]);
    }
    const buckets = Array.from(groups.entries())
      .map(([k, v]) => aggregateBucket(v, k))
      .sort((a, b) => b.n - a.n);
    const totals = aggregateBucket(rows, 'all');

    res.json({
      data: { groupBy, buckets, totals },
      meta: { available: true },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[explorer.aggregates] query failed',
    );
    res.status(500).json({ error: 'explorer aggregates failed' });
  }
});
