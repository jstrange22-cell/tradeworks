/**
 * Decision store for the TradeVisor agent.
 *
 * Two surfaces:
 *   - In-memory ring buffer (last RING_CAP decisions) for fast reads
 *   - Append-only JSONL on disk so decisions survive restarts and can be
 *     replayed for offline analysis / model fine-tuning later
 *
 * Escalations are tracked in a separate Map keyed by id; resolving one
 * removes it from the pending set and updates the corresponding decision
 * record.
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { logger } from '../../../lib/logger.js';
import type { Decision } from './types.js';
import { insertDecision as memoryInsertDecision } from '../../memory/decisions.js';
import { embedAndStore } from '../../memory/embeddings.js';
import { emitAppEvent } from '../../../lib/events-bus.js';

const STORE_FILE = resolve(process.env['TRADEVISOR_DECISIONS_FILE'] ?? './data/tradevisor-decisions.jsonl');
const RING_CAP = 500;

const ring: Decision[] = [];
const pendingEscalations = new Map<string, Decision>();

// ── Restore from disk on module load ────────────────────────────────────
(function restore(): void {
  if (!existsSync(STORE_FILE)) return;
  try {
    const lines = readFileSync(STORE_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-RING_CAP);
    for (const line of recent) {
      try {
        const d = JSON.parse(line) as Decision;
        ring.push(d);
        if (d.verdict === 'escalate' && !d.resolvedAt) {
          pendingEscalations.set(d.id, d);
        }
      } catch { /* skip corrupt line */ }
    }
    logger.info({ restored: ring.length, pendingEscalations: pendingEscalations.size }, '[TVAgent] decisions restored from disk');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[TVAgent] decision restore failed');
  }
})();

// ── Persist + index ────────────────────────────────────────────────────
export function recordDecision(d: Decision): void {
  ring.push(d);
  if (ring.length > RING_CAP) ring.shift();
  if (d.verdict === 'escalate') pendingEscalations.set(d.id, d);
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    appendFileSync(STORE_FILE, JSON.stringify(d) + '\n');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[TVAgent] decision persist failed');
  }

  // Mirror to the v2 memory DB + embed for future RAG retrieval. Fire and
  // forget — failures here MUST NOT block the JSONL persist or the caller.
  void persistToMemoryStore(d).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[TVAgent] memory mirror failed (non-fatal)',
    );
  });

  // Fan out to SSE subscribers. Synchronous, non-throwing — the dashboard's
  // decisions feed updates in <100 ms typical. If no clients are connected,
  // the emitter is a no-op.
  emitAppEvent('decision-created', { decision: d });
}

/**
 * Bridge a TradeVisor `Decision` into the v2 pgvector memory store and
 * persist its embedding. Async, side-effect-only, swallows its own errors.
 *
 * Note: the memory DB picks its own UUID; we use that for the embedding row
 * so the FK in `decision_embeddings` resolves cleanly. The TradeVisor ring
 * buffer keeps using `d.id` (its own UUID) — they don't need to match.
 */
async function persistToMemoryStore(d: Decision): Promise<void> {
  const signalText = buildEmbeddingText(d);
  let memoryDecisionId: string | null = null;
  try {
    const inserted = await memoryInsertDecision({
      strategy: 'tradevisor',
      signal: d.signal,
      context: d.context,
      verdict: d.verdict,
      reasoning: d.reasoning,
      confidence: d.confidence,
      adjustedSizeUsd: d.adjustedSize,
      adjustedStopPct: d.adjustedStopPct,
      modelUsed: d.modelUsed,
      reasoningLatencyMs: d.reasoningLatencyMs,
    });
    if (!inserted) return; // memory DB unavailable — already logged
    memoryDecisionId = inserted.id;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), decisionId: d.id },
      '[TVAgent] memory insertDecision failed',
    );
    return;
  }

  try {
    await embedAndStore(memoryDecisionId, signalText);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), memoryDecisionId },
      '[TVAgent] embedAndStore failed',
    );
  }
}

/**
 * Compose the text that gets embedded. Same shape as the RAG query so
 * retrieval matches what writers store.
 */
function buildEmbeddingText(d: Decision): string {
  const s = d.signal;
  const ctx = d.context;
  const parts: string[] = [
    `${s.action} ${s.symbol}`,
    `grade=${s.grade}`,
    `score=${s.score}`,
    `tf=${s.timeframe}`,
    `regime=${ctx.macro.regime}`,
  ];
  if (ctx.scout?.rationale) {
    parts.push(`scout: ${ctx.scout.rationale.slice(0, 200)}`);
  }
  return parts.join(' | ');
}

// ── Read APIs ──────────────────────────────────────────────────────────
export function getRecentDecisions(limit = 50): Decision[] {
  return ring.slice(-limit).reverse();
}

export function getPendingEscalations(): Decision[] {
  return Array.from(pendingEscalations.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDecisionById(id: string): Decision | undefined {
  return ring.find((d) => d.id === id);
}

// ── Escalation resolution ──────────────────────────────────────────────
// Returns the resolved Decision (with verdict still 'escalate' but resolution
// fields populated). The webhook caller is the one that translates a resolved
// escalation into actual execution.
export function resolveEscalation(
  id: string,
  resolution: 'approved' | 'vetoed',
  resolvedBy: 'human' | 'auto-timeout' = 'human',
): Decision | null {
  const d = pendingEscalations.get(id);
  if (!d) return null;
  d.resolvedAt = new Date().toISOString();
  d.resolvedBy = resolvedBy;
  d.resolution = resolution;
  pendingEscalations.delete(id);
  // Append a resolution line so the on-disk log reflects the outcome
  try {
    appendFileSync(STORE_FILE, JSON.stringify({ ...d, _event: 'resolved' }) + '\n');
  } catch { /* ignore */ }
  logger.info({ id, resolution, resolvedBy }, '[TVAgent] escalation resolved');

  // Fan out for the dashboard's escalations queue. Same non-throwing
  // contract as `decision-created`.
  emitAppEvent('decision-resolved', {
    decisionId: id,
    resolution,
    resolvedBy,
  });

  return d;
}

// ── Stats ──────────────────────────────────────────────────────────────
export function getDecisionStats(): {
  total: number;
  approved: number;
  vetoed: number;
  escalated: number;
  pendingEscalations: number;
  approvalRate: number;
} {
  const total = ring.length;
  const approved = ring.filter((d) => d.verdict === 'approve').length;
  const vetoed = ring.filter((d) => d.verdict === 'veto').length;
  const escalated = ring.filter((d) => d.verdict === 'escalate').length;
  return {
    total,
    approved,
    vetoed,
    escalated,
    pendingEscalations: pendingEscalations.size,
    approvalRate: total > 0 ? approved / total : 0,
  };
}
