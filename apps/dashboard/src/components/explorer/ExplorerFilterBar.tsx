/**
 * Filter bar for the trades & decisions explorer.
 *
 * Each control writes through to the parent's filter state, which is
 * already URL-bound (see `useUrlFilters` in `TradesExplorerPage.tsx`),
 * so the view is shareable.
 */
import { Filter, X } from 'lucide-react';
import type { ExplorerListFilters, Verdict } from '@/types/explorer';

interface ExplorerFilterBarProps {
  filters: ExplorerListFilters;
  onChange: (next: ExplorerListFilters) => void;
  strategies: string[];
  regimes: string[];
  sectors: string[];
}

const VERDICTS: Array<{ value: Verdict; label: string; tone: string }> = [
  { value: 'approve', label: 'Approve', tone: 'text-green-400' },
  { value: 'veto', label: 'Veto', tone: 'text-red-400' },
  { value: 'escalate', label: 'Escalate', tone: 'text-amber-400' },
];

export function ExplorerFilterBar({
  filters,
  onChange,
  strategies,
  regimes,
  sectors,
}: ExplorerFilterBarProps) {
  const update = (patch: Partial<ExplorerListFilters>) => {
    const next: ExplorerListFilters = { ...filters };
    for (const [k, v] of Object.entries(patch)) {
      const key = k as keyof ExplorerListFilters;
      if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) {
        delete next[key];
      } else {
        // Type-narrowing isn't possible here without a switch; trust the caller
        (next as Record<string, unknown>)[key] = v;
      }
    }
    onChange(next);
  };

  const clearAll = () => onChange({});

  const activeCount = Object.keys(filters).filter(
    (k) => filters[k as keyof ExplorerListFilters] !== undefined,
  ).length;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <Filter className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-400">
              {activeCount} active
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-200"
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label="Strategy"
          value={filters.strategy ?? ''}
          onChange={(v) => update({ strategy: v || undefined })}
          options={strategies}
        />

        <FilterSelect
          label="Verdict"
          value={filters.verdict ?? ''}
          onChange={(v) => update({ verdict: (v as Verdict) || undefined })}
          options={VERDICTS.map((v) => v.value)}
          renderOption={(v) => {
            const found = VERDICTS.find((x) => x.value === v);
            return found ? found.label : v;
          }}
        />

        <FilterSelect
          label="Regime"
          value={filters.regime ?? ''}
          onChange={(v) => update({ regime: v || undefined })}
          options={regimes}
        />

        <FilterSelect
          label="Sector"
          value={filters.sector ?? ''}
          onChange={(v) => update({ sector: v || undefined })}
          options={sectors}
        />

        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
            Symbol
          </label>
          <input
            value={filters.symbol ?? ''}
            onChange={(e) => update({ symbol: e.target.value.toUpperCase() || undefined })}
            placeholder="AAPL, BTC..."
            className="input w-full py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
            Confidence
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={filters.minConfidence ?? ''}
              onChange={(e) =>
                update({ minConfidence: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              placeholder="min"
              className="input w-full py-1.5 text-sm"
            />
            <span className="text-xs text-slate-500">→</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={filters.maxConfidence ?? ''}
              onChange={(e) =>
                update({ maxConfidence: e.target.value === '' ? undefined : Number(e.target.value) })
              }
              placeholder="max"
              className="input w-full py-1.5 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
            Start
          </label>
          <input
            type="date"
            value={filters.startDate ?? ''}
            onChange={(e) => update({ startDate: e.target.value || undefined })}
            className="input w-full py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
            End
          </label>
          <input
            type="date"
            value={filters.endDate ?? ''}
            onChange={(e) => update({ endDate: e.target.value || undefined })}
            className="input w-full py-1.5 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  renderOption?: (v: string) => string;
}

function FilterSelect({ label, value, onChange, options, renderOption }: FilterSelectProps) {
  return (
    <div>
      <label className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full py-1.5 text-sm"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {renderOption ? renderOption(opt) : opt}
          </option>
        ))}
      </select>
    </div>
  );
}
