/**
 * Portfolio heat panel — total open risk plus the worst sector and worst
 * factor utilizations. Color coding tracks the budget gauge in DrawdownGauge
 * for visual consistency.
 */
import { Card, CardBody, CardHeader, Skeleton } from './primitives';
import type { PortfolioHeat } from './types';

interface Props {
  data: PortfolioHeat | undefined;
  isLoading: boolean;
}

function pickColor(usage: number): string {
  if (usage >= 1) return 'bg-rose-500';
  if (usage >= 0.85) return 'bg-amber-400';
  if (usage >= 0.6) return 'bg-amber-500/80';
  return 'bg-emerald-400';
}

function HeatRow({
  label,
  pct,
  capPct,
  usage,
}: {
  label: string;
  pct: number;
  capPct: number;
  usage: number;
}) {
  const widthPct = Math.min(100, Math.max(0, usage * 100));
  const overBudget = usage >= 1;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <span className="text-xs tabular-nums text-slate-300">
          {(pct * 100).toFixed(2)}% / {(capPct * 100).toFixed(1)}%
          {overBudget ? <span className="ml-1 text-rose-400">⚠</span> : null}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(capPct * 100)}
        aria-valuenow={Math.round(pct * 100)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-700/60"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${pickColor(usage)}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

export function HeatPanel({ data, isLoading }: Props) {
  return (
    <Card className="h-full">
      <CardHeader
        title="Portfolio Heat"
        subtitle="Open risk vs budgets"
      />
      <CardBody className="space-y-4">
        {isLoading || !data ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : (
          <>
            <HeatRow
              label="Total"
              pct={data.totalOpenRiskPct}
              capPct={data.budgets.totalOpenRiskMaxPct}
              usage={data.utilization.total}
            />
            <HeatRow
              label={`Sector · ${data.utilization.worstSector.sector || '—'}`}
              pct={
                data.bySector[data.utilization.worstSector.sector]?.pct ?? 0
              }
              capPct={data.budgets.perSectorMaxPct}
              usage={data.utilization.worstSector.utilization}
            />
            <HeatRow
              label={`Factor · ${data.utilization.worstFactor.factor || '—'}`}
              pct={
                data.byFactor[data.utilization.worstFactor.factor]?.pct ?? 0
              }
              capPct={data.budgets.perFactorMaxPct}
              usage={data.utilization.worstFactor.utilization}
            />
            <p className="pt-1 text-[10px] text-slate-500">
              Total risk{' '}
              <span className="font-semibold text-slate-300">
                ${data.totalOpenRiskUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>{' '}
              of equity{' '}
              <span className="font-semibold text-slate-300">
                ${data.totalEquityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
