/**
 * RAG retrieval over the v2 memory store.
 *
 * `retrieveSimilarTrades` embeds the caller's signal text, runs a top-k
 * pgvector similarity search, joins each hit's outcome row, and shapes the
 * result into something the reasoner prompt can render directly.
 *
 * Designed so it can no-op cleanly when the memory DB is absent — callers
 * get [] back instead of an exception.
 */

import { getPool } from './db.js';
import { logger } from '../../lib/logger.js';
import { embedText, EMBEDDING_DIMENSIONS } from './embedder.js';

// ── Public types ───────────────────────────────────────────────────────

export interface SignalSummary {
  symbol: string;
  action: string;            // 'buy' | 'sell' | 'short' | 'cover' | etc.
  strategy: string;
  grade: string | null;
  score: number | null;
  regime: string | null;
}

export interface SimilarTradeOutcome {
  realizedPnlUsd: number;
  rMultiple: number | null;
  exitReason: string;
  holdingMinutes: number;
}

export interface SimilarTrade {
  decisionId: string;
  similarity: number;        // cosine similarity in [0..1]
  signal: SignalSummary;
  contextSnippet: string;    // ~200-char human-readable
  outcome: SimilarTradeOutcome | null;
  createdAt: string;
}

export interface RetrieveOptions {
  k?: number;                // default 10
  minSimilarity?: number;    // default 0.5
  onlyClosed?: boolean;      // default true (drop rows without trade_outcomes)
}

// ── DB row shape (raw join) ────────────────────────────────────────────

interface RagDbRow {
  decision_id: string;
  similarity: number;
  created_at: Date;
  strategy: string;
  signal: unknown;
  context: unknown;
  o_realized_pnl_usd: number | null;
  o_r_multiple: number | null;
  o_exit_reason: string | null;
  o_holding_minutes: number | null;
  o_closed_at: Date | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Pull a SignalSummary out of the JSONB signal+context blob. Best-effort —
 * we don't know the exact shape (it's whatever the reasoner persisted),
 * but the TradeVisor agent stores both `signal` (IncomingSignal) and
 * `context` (SignalContext.macro etc.).
 */
function shapeSignalSummary(
  strategy: string,
  signal: unknown,
  context: unknown,
): SignalSummary {
  const s = isObject(signal) ? signal : {};
  const ctx = isObject(context) ? context : {};
  const macro = isObject(ctx['macro']) ? (ctx['macro'] as Record<string, unknown>) : {};

  return {
    symbol: pickString(s['symbol']) || pickString(s['ticker']) || 'UNKNOWN',
    action: pickString(s['action']) || pickString(s['side']) || 'unknown',
    strategy,
    grade: typeof s['grade'] === 'string' ? s['grade'] : null,
    score: pickNumber(s['score']),
    regime: typeof macro['regime'] === 'string' ? (macro['regime'] as string) : null,
  };
}

/**
 * Build a compact context snippet — the top facts that mattered for the
 * decision. Capped at ~200 chars.
 */
function shapeContextSnippet(context: unknown): string {
  if (!isObject(context)) return '';
  const macro = isObject(context['macro']) ? (context['macro'] as Record<string, unknown>) : {};
  const scout = isObject(context['scout']) ? (context['scout'] as Record<string, unknown>) : null;
  const news = Array.isArray(context['news']) ? context['news'] : [];

  const parts: string[] = [];
  const regime = typeof macro['regime'] === 'string' ? macro['regime'] : null;
  if (regime) parts.push(`regime=${regime}`);
  if (scout && typeof scout['rank'] === 'number') {
    parts.push(`scout#${scout['rank']}`);
  }
  if (news.length > 0) {
    const first = news[0];
    if (isObject(first) && typeof first['headline'] === 'string') {
      parts.push(`news="${first['headline'].slice(0, 60)}"`);
    } else {
      parts.push(`news=${news.length}`);
    }
  }
  return parts.join(' ').slice(0, 200);
}

function rowToTrade(r: RagDbRow): SimilarTrade {
  const outcome: SimilarTradeOutcome | null = r.o_closed_at
    ? {
        realizedPnlUsd: r.o_realized_pnl_usd ?? 0,
        rMultiple: r.o_r_multiple,
        exitReason: r.o_exit_reason ?? 'unknown',
        holdingMinutes: r.o_holding_minutes ?? 0,
      }
    : null;

  return {
    decisionId: r.decision_id,
    similarity: r.similarity,
    signal: shapeSignalSummary(r.strategy, r.signal, r.context),
    contextSnippet: shapeContextSnippet(r.context),
    outcome,
    createdAt: r.created_at.toISOString(),
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Top-k historically similar trades for a signal text.
 *
 * Returns [] (no exception) when:
 *   - memory DB is unavailable
 *   - no rows pass minSimilarity / onlyClosed filters
 *   - the embedder returned a zero-vector (every row would tie at sim≈0)
 */
export async function retrieveSimilarTrades(
  signalText: string,
  options: RetrieveOptions = {},
): Promise<SimilarTrade[]> {
  const pool = getPool();
  if (!pool) return [];

  const k = Math.min(Math.max(1, options.k ?? 10), 100);
  const minSimilarity = options.minSimilarity ?? 0.5;
  const onlyClosed = options.onlyClosed ?? true;

  const vec = await embedText(signalText);
  if (vec.length !== EMBEDDING_DIMENSIONS) {
    logger.warn(
      { gotDim: vec.length },
      '[memory.rag] embedder returned wrong dim — skipping retrieval',
    );
    return [];
  }
  // Zero vector is a strong tell that the provider was 'none' or failed.
  // Every cosine similarity will be undefined / 0 — return [] so we don't
  // pollute the prompt with noise.
  if (vec.every((x) => x === 0)) return [];

  const sql = `
    SELECT
      d.id                              AS decision_id,
      1 - (e.embedding <=> $1::vector)  AS similarity,
      d.created_at                      AS created_at,
      d.strategy                        AS strategy,
      d.signal                          AS signal,
      d.context                         AS context,
      o.realized_pnl_usd                AS o_realized_pnl_usd,
      o.r_multiple                      AS o_r_multiple,
      o.exit_reason                     AS o_exit_reason,
      o.holding_minutes                 AS o_holding_minutes,
      o.closed_at                       AS o_closed_at
    FROM decision_embeddings e
    JOIN decisions d ON d.id = e.decision_id
    LEFT JOIN trade_outcomes o ON o.decision_id = d.id
    ${onlyClosed ? 'WHERE o.decision_id IS NOT NULL' : ''}
    ORDER BY e.embedding <=> $1::vector ASC, d.created_at DESC
    LIMIT $2
  `;

  try {
    const result = await pool.query<RagDbRow>(sql, [toPgVector(vec), k]);
    const rows = result.rows
      .map(rowToTrade)
      .filter((t) => t.similarity >= minSimilarity);
    return rows;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[memory.rag] retrieveSimilarTrades query failed',
    );
    return [];
  }
}

/**
 * Test-only: query without going through the embedder. Lets us inject a
 * synthetic vector against fixture data.
 */
export async function __retrieveByVectorForTest(
  vector: number[],
  options: RetrieveOptions = {},
): Promise<SimilarTrade[]> {
  const pool = getPool();
  if (!pool) return [];

  const k = Math.min(Math.max(1, options.k ?? 10), 100);
  const minSimilarity = options.minSimilarity ?? 0.5;
  const onlyClosed = options.onlyClosed ?? true;

  const sql = `
    SELECT
      d.id                              AS decision_id,
      1 - (e.embedding <=> $1::vector)  AS similarity,
      d.created_at                      AS created_at,
      d.strategy                        AS strategy,
      d.signal                          AS signal,
      d.context                         AS context,
      o.realized_pnl_usd                AS o_realized_pnl_usd,
      o.r_multiple                      AS o_r_multiple,
      o.exit_reason                     AS o_exit_reason,
      o.holding_minutes                 AS o_holding_minutes,
      o.closed_at                       AS o_closed_at
    FROM decision_embeddings e
    JOIN decisions d ON d.id = e.decision_id
    LEFT JOIN trade_outcomes o ON o.decision_id = d.id
    ${onlyClosed ? 'WHERE o.decision_id IS NOT NULL' : ''}
    ORDER BY e.embedding <=> $1::vector ASC, d.created_at DESC
    LIMIT $2
  `;
  const result = await pool.query<RagDbRow>(sql, [toPgVector(vector), k]);
  return result.rows.map(rowToTrade).filter((t) => t.similarity >= minSimilarity);
}
