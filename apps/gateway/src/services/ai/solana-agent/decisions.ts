/**
 * Decision store for the Solana agent. Mirrors tradevisor-agent/decisions.ts —
 * in-memory ring (last 500) + JSONL persistence, restore on boot, separate
 * pending-escalations Map.
 *
 * Both agents log to different files so they don't trample each other:
 *   stocks: ./data/tradevisor-decisions.jsonl
 *   solana: ./data/solana-decisions.jsonl
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { logger } from '../../../lib/logger.js';
import type { SolanaDecision } from './types.js';

const STORE_FILE = resolve(process.env['SOLANA_DECISIONS_FILE'] ?? './data/solana-decisions.jsonl');
const RING_CAP = 500;

const ring: SolanaDecision[] = [];
const pendingEscalations = new Map<string, SolanaDecision>();

(function restore(): void {
  if (!existsSync(STORE_FILE)) return;
  try {
    const lines = readFileSync(STORE_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-RING_CAP);
    for (const line of recent) {
      try {
        const d = JSON.parse(line) as SolanaDecision & { _event?: string };
        if (d._event === 'resolved') continue; // resolution events are journal-only
        ring.push(d);
        if (d.verdict === 'escalate' && !d.resolvedAt) pendingEscalations.set(d.id, d);
      } catch { /* skip corrupt line */ }
    }
    logger.info({ restored: ring.length, pending: pendingEscalations.size }, '[SolanaAgent] decisions restored from disk');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[SolanaAgent] decision restore failed');
  }
})();

export function recordDecision(d: SolanaDecision): void {
  ring.push(d);
  if (ring.length > RING_CAP) ring.shift();
  if (d.verdict === 'escalate') pendingEscalations.set(d.id, d);
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    appendFileSync(STORE_FILE, JSON.stringify(d) + '\n');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[SolanaAgent] decision persist failed');
  }
}

export function getRecentDecisions(limit = 50): SolanaDecision[] {
  return ring.slice(-limit).reverse();
}

export function getPendingEscalations(): SolanaDecision[] {
  return Array.from(pendingEscalations.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDecisionById(id: string): SolanaDecision | undefined {
  return ring.find((d) => d.id === id);
}

export function resolveEscalation(
  id: string,
  resolution: 'approved' | 'vetoed',
  resolvedBy: 'human' | 'auto-timeout' = 'human',
): SolanaDecision | null {
  const d = pendingEscalations.get(id);
  if (!d) return null;
  d.resolvedAt = new Date().toISOString();
  d.resolvedBy = resolvedBy;
  d.resolution = resolution;
  pendingEscalations.delete(id);
  try { appendFileSync(STORE_FILE, JSON.stringify({ ...d, _event: 'resolved' }) + '\n'); } catch { /* ignore */ }
  logger.info({ id, resolution, resolvedBy }, '[SolanaAgent] escalation resolved');
  return d;
}

export function getDecisionStats(): {
  total: number; approved: number; vetoed: number; escalated: number;
  pendingEscalations: number; approvalRate: number;
} {
  const total = ring.length;
  const approved = ring.filter((d) => d.verdict === 'approve').length;
  const vetoed = ring.filter((d) => d.verdict === 'veto').length;
  const escalated = ring.filter((d) => d.verdict === 'escalate').length;
  return {
    total, approved, vetoed, escalated,
    pendingEscalations: pendingEscalations.size,
    approvalRate: total > 0 ? approved / total : 0,
  };
}
