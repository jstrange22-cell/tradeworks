/**
 * Virtualized decisions table for the explorer.
 *
 * Each row can be expanded inline to show the truncated reasoning + RAG
 * citation count + a "View full" link to the detail page. Clicking the
 * row body navigates to the detail page directly.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, ExternalLink, Sparkles } from 'lucide-react';
import type { ExplorerListRow, Verdict } from '@/types/explorer';

interface ExplorerTableProps {
  rows: ExplorerListRow[];
  isLoading: boolean;
}

const ROW_HEIGHT_COLLAPSED = 52;
const ROW_HEIGHT_EXPANDED = 180;

export function ExplorerTable({ rows, isLoading }: ExplorerTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row && expanded.has(row.id) ? ROW_HEIGHT_EXPANDED : ROW_HEIGHT_COLLAPSED;
    },
    overscan: 8,
  });

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Recompute sizes since one row's height just changed
    virtualizer.measure();
  };

  if (isLoading) {
    return (
      <div className="card">
        <TableHeader />
        <div className="space-y-2 px-3 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded bg-slate-800/60"
            />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <TableHeader />
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/60">
            <Sparkles className="h-5 w-5 text-slate-500" />
          </div>
          <div className="text-sm font-medium text-slate-300">No decisions yet</div>
          <div className="mt-1 text-xs text-slate-500">
            Adjust your filters or wait for APEX to log its first reasoning event. Decisions are
            written to the memory store as signals are evaluated.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <TableHeader />
      <div ref={parentRef} className="h-[640px] overflow-y-auto">
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          className="w-full"
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];
            if (!row) return null;
            const isExpanded = expanded.has(row.id);
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className="border-b border-slate-200 dark:border-slate-700/50"
              >
                <RowDisplay
                  row={row}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(row.id)}
                  onNavigate={() => navigate(`/explorer/decisions/${row.id}`)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TableHeader() {
  return (
    <div className="grid grid-cols-[28px_140px_90px_70px_60px_60px_70px_80px_80px_60px_28px] items-center gap-2 border-b border-slate-200 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:border-slate-700/50">
      <div />
      <div>Time</div>
      <div>Strategy</div>
      <div>Symbol</div>
      <div>Verdict</div>
      <div>Conf</div>
      <div>Action</div>
      <div className="text-right">P&L</div>
      <div>Regime</div>
      <div className="text-center">RAG</div>
      <div />
    </div>
  );
}

interface RowDisplayProps {
  row: ExplorerListRow;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}

function RowDisplay({ row, isExpanded, onToggle, onNavigate }: RowDisplayProps) {
  const verdictTone = verdictColor(row.verdict);
  const confidencePct = row.confidence === null ? '—' : `${(row.confidence * 100).toFixed(0)}%`;
  const confidenceTone = confidenceColor(row.confidence);
  const pnlTone =
    row.realizedPnlUsd === null
      ? 'text-slate-600'
      : row.realizedPnlUsd > 0
        ? 'text-green-400'
        : row.realizedPnlUsd < 0
          ? 'text-red-400'
          : 'text-slate-500';

  return (
    <>
      <div
        className="grid grid-cols-[28px_140px_90px_70px_60px_60px_70px_80px_80px_60px_28px] items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-700/40 hover:text-slate-300"
          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <div className="cursor-pointer truncate text-slate-400" onClick={onNavigate}>
          {new Date(row.createdAt).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>

        <div className="cursor-pointer truncate text-slate-300" onClick={onNavigate}>
          {row.strategy}
        </div>

        <div className="cursor-pointer truncate font-medium text-slate-100" onClick={onNavigate}>
          {row.symbol ?? '—'}
        </div>

        <div onClick={onNavigate} className="cursor-pointer">
          {row.verdict ? (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${verdictTone}`}>
              {row.verdict.toUpperCase()}
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </div>

        <div onClick={onNavigate} className={`cursor-pointer font-medium ${confidenceTone}`}>
          {confidencePct}
        </div>

        <div onClick={onNavigate} className="cursor-pointer truncate text-slate-400">
          {row.action ?? '—'}
        </div>

        <div onClick={onNavigate} className={`cursor-pointer text-right font-medium ${pnlTone}`}>
          {row.realizedPnlUsd === null
            ? row.resolvedAt
              ? '—'
              : 'open'
            : `${row.realizedPnlUsd > 0 ? '+' : ''}$${row.realizedPnlUsd.toFixed(0)}`}
        </div>

        <div onClick={onNavigate} className="cursor-pointer truncate text-slate-500">
          {row.regime ?? '—'}
        </div>

        <div onClick={onNavigate} className="cursor-pointer text-center text-slate-400">
          {row.ragMatchCount > 0 ? (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
              ✓
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </div>

        <button
          type="button"
          onClick={onNavigate}
          aria-label="Open detail"
          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-700/40 hover:text-slate-200"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-200/60 bg-slate-50/40 px-12 py-3 text-xs dark:border-slate-700/40 dark:bg-slate-800/30">
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                Reasoning
              </div>
              <div className="text-slate-300">
                {row.reasoningSnippet ?? <span className="italic text-slate-600">no reasoning recorded</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>
                model: <span className="text-slate-300">{row.modelUsed ?? '—'}</span>
              </span>
              <span>•</span>
              <span>
                latency:{' '}
                <span className="text-slate-300">
                  {row.reasoningLatencyMs ? `${row.reasoningLatencyMs}ms` : '—'}
                </span>
              </span>
              <span>•</span>
              <span>
                size:{' '}
                <span className="text-slate-300">
                  {row.adjustedSizeUsd ? `$${row.adjustedSizeUsd.toFixed(0)}` : '—'}
                </span>
              </span>
              <span>•</span>
              <span>
                stop:{' '}
                <span className="text-slate-300">
                  {row.adjustedStopPct ? `${(row.adjustedStopPct * 100).toFixed(2)}%` : '—'}
                </span>
              </span>
              <span>•</span>
              <span>
                sector: <span className="text-slate-300">{row.sector ?? '—'}</span>
              </span>
              <span>•</span>
              <span>
                resolution: <span className="text-slate-300">{row.resolution ?? 'pending'}</span>
              </span>
            </div>
            <div>
              <button
                type="button"
                onClick={onNavigate}
                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
              >
                View full decision <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function verdictColor(v: Verdict | null): string {
  if (v === 'approve') return 'bg-green-500/15 text-green-400';
  if (v === 'veto') return 'bg-red-500/15 text-red-400';
  if (v === 'escalate') return 'bg-amber-500/15 text-amber-400';
  return 'bg-slate-500/15 text-slate-400';
}

function confidenceColor(c: number | null): string {
  if (c === null) return 'text-slate-500';
  if (c >= 0.8) return 'text-green-400';
  if (c >= 0.6) return 'text-emerald-400';
  if (c >= 0.4) return 'text-amber-400';
  return 'text-red-400';
}
