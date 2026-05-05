/**
 * Trades & Decisions Explorer — index page.
 *
 * Auditing surface for APEX. For each decision: signal in, retrieved
 * historical comparables, calibration data, regime context, model
 * verdict + reasoning, broker fills, realised outcome.
 *
 * Filter state is encoded in URL query params (`?strategy=…&verdict=…`)
 * so the view is shareable. Default sort: most recent first.
 */
import { useMemo } from 'react';
import { Activity, Download } from 'lucide-react';
import { ExplorerFilterBar } from '@/components/explorer/ExplorerFilterBar';
import { ExplorerRibbon } from '@/components/explorer/ExplorerRibbon';
import { ExplorerTable } from '@/components/explorer/ExplorerTable';
import { useExplorerAggregate, useExplorerList } from '@/hooks/useExplorer';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import {
  buildFilename,
  downloadCsv,
  rowsToCsv,
} from '@/components/explorer/exportCsv';
import type { ExplorerListFilters, Verdict } from '@/types/explorer';

const VERDICT_VALUES = new Set<Verdict>(['approve', 'veto', 'escalate']);

function parseVerdict(raw: string): Verdict | undefined {
  return VERDICT_VALUES.has(raw as Verdict) ? (raw as Verdict) : undefined;
}

export function TradesExplorerPage() {
  const [filters, setFilters] = useUrlFilters<ExplorerListFilters>({
    parsers: {
      strategy: (v) => v,
      verdict: (v) => parseVerdict(v),
      regime: (v) => v,
      sector: (v) => v,
      symbol: (v) => v,
      minConfidence: (v) => Number(v),
      maxConfidence: (v) => Number(v),
      startDate: (v) => v,
      endDate: (v) => v,
    },
  });

  const list = useExplorerList({ filters, limit: 500 });
  const agg = useExplorerAggregate({ filters, groupBy: 'strategy' });

  const rows = useMemo(() => list.data?.data.rows ?? [], [list.data]);
  const total = list.data?.data.total ?? 0;
  const available = list.data?.meta.available ?? false;

  // Pull dropdown options from the currently visible page; if the user
  // wants more they can filter manually. Cheap and robust against a stale
  // memory store.
  const strategies = useMemo(() => uniqueSorted(rows.map((r) => r.strategy)), [rows]);
  const regimes = useMemo(
    () => uniqueSorted(rows.map((r) => r.regime).filter(notNull)),
    [rows],
  );
  const sectors = useMemo(
    () => uniqueSorted(rows.map((r) => r.sector).filter(notNull)),
    [rows],
  );

  const handleExport = () => {
    if (rows.length === 0) return;
    const csv = rowsToCsv(rows);
    const fname = buildFilename(filters);
    downloadCsv(fname, csv);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Trades & Decisions Explorer</h1>
            <p className="text-xs text-slate-500">
              Every reasoning event APEX has logged. Filter, drill in, audit.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-500">
            <span className="font-medium text-slate-300">{total.toLocaleString()}</span>{' '}
            decisions match
            {available && rows.length < total && (
              <span> (showing first {rows.length.toLocaleString()})</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={rows.length === 0}
            className="btn-ghost gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </header>

      <ExplorerFilterBar
        filters={filters}
        onChange={setFilters}
        strategies={strategies}
        regimes={regimes}
        sectors={sectors}
      />

      <ExplorerRibbon
        totals={agg.data?.data.totals ?? null}
        isLoading={agg.isLoading}
        available={agg.data?.meta.available ?? false}
      />

      {!available && !list.isLoading && (
        <div className="card border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <span className="font-medium">Memory store offline.</span>
            <span className="text-amber-300/80">
              {list.data?.meta.reason ?? 'Set MEMORY_DB_URL in the gateway env to enable the explorer.'}
            </span>
          </div>
        </div>
      )}

      <ExplorerTable rows={rows} isLoading={list.isLoading} />
    </div>
  );
}

function uniqueSorted(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean))).sort();
}

function notNull<T>(v: T | null): v is T {
  return v !== null;
}
