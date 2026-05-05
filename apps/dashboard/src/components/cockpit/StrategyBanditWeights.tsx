/**
 * Horizontal stacked bar of bandit weight allocation per strategy.
 *
 * Sources /api/v1/bandit/weights — each entry already carries a `weight` ∈ [0,1]
 * with the floor/cap applied. We render colored segments + a row legend.
 */
import { useId, useMemo } from 'react';
import { Card, CardBody, CardHeader, Skeleton } from './primitives';
import type { BanditWeightsFile, StrategyWeightEntry } from './types';

interface Props {
  data: BanditWeightsFile | undefined;
  isLoading: boolean;
}

// Stable color per known strategy name (cycled for unknown names).
const PALETTE = [
  '#60a5fa', // blue
  '#34d399', // emerald
  '#a78bfa', // violet
  '#fbbf24', // amber
  '#f472b6', // pink
  '#22d3ee', // cyan
  '#fb7185', // rose
  '#a3e635', // lime
];

interface Row {
  name: string;
  weight: number;
  source: StrategyWeightEntry['source'];
  sampleSize: number;
  color: string;
}

function buildRows(data: BanditWeightsFile | undefined): Row[] {
  if (!data) return [];
  const entries = Object.entries(data.strategies);
  return entries
    .map(([name, e], idx) => ({
      name,
      weight: e.weight,
      source: e.source,
      sampleSize: e.sampleSize90d,
      color: PALETTE[idx % PALETTE.length] ?? '#60a5fa',
    }))
    .sort((a, b) => b.weight - a.weight);
}

export function StrategyBanditWeights({ data, isLoading }: Props) {
  const labelId = useId();
  const rows = useMemo(() => buildRows(data), [data]);

  return (
    <Card>
      <CardHeader
        title="Strategy Bandit Weights"
        subtitle={
          data
            ? `Updated ${new Date(data.updatedAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : undefined
        }
      />
      <CardBody className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-6 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500">
            Bandit weights not yet computed.
          </p>
        ) : (
          <>
            <h3 id={labelId} className="sr-only">
              Strategy weight allocation
            </h3>
            <div
              role="img"
              aria-labelledby={labelId}
              className="flex h-6 overflow-hidden rounded-md bg-slate-800/60 ring-1 ring-slate-700/50"
            >
              {rows.map((r) => (
                <div
                  key={r.name}
                  title={`${r.name}: ${(r.weight * 100).toFixed(1)}%`}
                  className="h-full transition-all duration-700"
                  style={{ width: `${r.weight * 100}%`, background: r.color }}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3 lg:grid-cols-4">
              {rows.map((r) => (
                <li
                  key={r.name}
                  className="flex items-center gap-2 truncate text-slate-300"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                    style={{ background: r.color }}
                  />
                  <span className="font-mono text-slate-400">{r.name}</span>
                  <span className="ml-auto tabular-nums text-slate-200">
                    {(r.weight * 100).toFixed(0)}%
                  </span>
                  {r.source === 'cold_start' ? (
                    <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] uppercase text-amber-300">
                      cold
                    </span>
                  ) : null}
                  {r.source === 'override' ? (
                    <span className="ml-1 rounded bg-sky-500/15 px-1 text-[9px] uppercase text-sky-300">
                      ovr
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
