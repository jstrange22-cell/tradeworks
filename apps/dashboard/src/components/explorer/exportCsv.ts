/**
 * CSV export helper for the trades & decisions explorer.
 *
 * Builds a filename that encodes the active filter state so subsequent
 * exports are self-describing (e.g.
 *   `decisions-pead-volatile-2026-04-01_2026-05-04.csv`).
 */
import type { ExplorerListFilters, ExplorerListRow } from '@/types/explorer';

const COLUMNS: Array<{ key: keyof ExplorerListRow; label: string }> = [
  { key: 'createdAt', label: 'created_at' },
  { key: 'resolvedAt', label: 'resolved_at' },
  { key: 'strategy', label: 'strategy' },
  { key: 'symbol', label: 'symbol' },
  { key: 'action', label: 'action' },
  { key: 'verdict', label: 'verdict' },
  { key: 'confidence', label: 'confidence' },
  { key: 'modelUsed', label: 'model' },
  { key: 'reasoningLatencyMs', label: 'latency_ms' },
  { key: 'adjustedSizeUsd', label: 'size_usd' },
  { key: 'adjustedStopPct', label: 'stop_pct' },
  { key: 'regime', label: 'regime' },
  { key: 'sector', label: 'sector' },
  { key: 'scoutRank', label: 'scout_rank' },
  { key: 'realizedPnlUsd', label: 'realized_pnl_usd' },
  { key: 'rMultiple', label: 'r_multiple' },
  { key: 'exitReason', label: 'exit_reason' },
  { key: 'closedAt', label: 'closed_at' },
  { key: 'execCount', label: 'execs' },
  { key: 'ragMatchCount', label: 'rag_matches' },
  { key: 'resolution', label: 'resolution' },
  { key: 'reasoningSnippet', label: 'reasoning' },
  { key: 'id', label: 'id' },
];

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else s = String(v);
  // Escape per RFC 4180
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: ExplorerListRow[]): string {
  const header = COLUMNS.map((c) => c.label).join(',');
  const lines = rows.map((r) =>
    COLUMNS.map((c) => escapeCell(r[c.key])).join(','),
  );
  return [header, ...lines].join('\n');
}

export function buildFilename(filters: ExplorerListFilters): string {
  const parts: string[] = ['decisions'];
  if (filters.strategy) parts.push(filters.strategy);
  if (filters.verdict) parts.push(filters.verdict);
  if (filters.regime) parts.push(filters.regime);
  if (filters.sector) parts.push(filters.sector);
  if (filters.symbol) parts.push(filters.symbol.toLowerCase());
  if (filters.startDate || filters.endDate) {
    parts.push(`${filters.startDate ?? 'start'}_${filters.endDate ?? 'end'}`);
  } else {
    parts.push(new Date().toISOString().slice(0, 10));
  }
  return parts
    .map((p) => p.replace(/[^a-z0-9_-]+/gi, '-'))
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') + '.csv';
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
