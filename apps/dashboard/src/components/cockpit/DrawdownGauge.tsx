/**
 * Drawdown gauge — current daily / weekly DD plotted against the kill-switch
 * thresholds (-3% daily, -6% weekly).
 *
 * Inputs come from /api/v1/kill-switches/status.metrics. The bar fills toward
 * the limit; once usage crosses 70% the bar flips to amber, ≥ 100% to rose.
 */
import { useId } from 'react';
import { Card, CardBody, CardHeader, Skeleton } from './primitives';
import type { KillSwitchStatus } from './types';

interface Props {
  data: KillSwitchStatus | undefined;
  isLoading: boolean;
}

const DAILY_LIMIT_PCT = -3;
const WEEKLY_LIMIT_PCT = -6;

interface RowConfig {
  label: string;
  pct: number; // -0.012 = -1.2%
  limitPct: number; // -3 etc (display units)
}

function pickColor(usage: number): string {
  if (usage >= 1) return 'bg-rose-500';
  if (usage >= 0.7) return 'bg-amber-400';
  return 'bg-emerald-400';
}

function GaugeRow({ row }: { row: RowConfig }) {
  const labelId = useId();
  const pctDisplay = (row.pct * 100).toFixed(2);
  const usage = row.pct < 0 ? Math.min(1.5, Math.abs(row.pct * 100) / Math.abs(row.limitPct)) : 0;
  const widthPct = Math.min(100, usage * 100);
  const color = pickColor(usage);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span id={labelId} className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {row.label}
        </span>
        <span className="text-xs tabular-nums text-slate-300">
          {row.pct > 0 ? '+' : ''}
          {pctDisplay}% / {row.limitPct.toFixed(1)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={Math.abs(row.limitPct)}
        aria-valuenow={Math.abs(row.pct * 100)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-700/60"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

export function DrawdownGauge({ data, isLoading }: Props) {
  const rows: RowConfig[] = [
    {
      label: 'Daily',
      pct: data?.metrics.dailyPnlPct ?? 0,
      limitPct: DAILY_LIMIT_PCT,
    },
    {
      label: 'Weekly',
      pct: data?.metrics.weeklyPnlPct ?? 0,
      limitPct: WEEKLY_LIMIT_PCT,
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader title="Drawdown" subtitle="vs kill-switch limits" />
      <CardBody className="space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : (
          rows.map((r) => <GaugeRow key={r.label} row={r} />)
        )}
      </CardBody>
    </Card>
  );
}
