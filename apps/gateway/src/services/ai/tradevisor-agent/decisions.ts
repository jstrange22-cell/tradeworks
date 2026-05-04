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
