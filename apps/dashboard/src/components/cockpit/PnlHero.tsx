/**
 * The headline P&L block that dominates the top of the cockpit.
 *
 * Today / WTD / MTD / ATD with giant numbers, color-coded green/red/neutral.
 * Today and WTD come straight from /api/v1/portfolio. MTD ≈ totalPnl when
 * we don't have a true monthly cohort window (the gateway P&L slice is
 * lifetime); ATD == totalPnl. Until the gateway exposes proper rolling
 * windows we surface what's available with honest labels.
 */
import { useId } from 'react';
import type { PortfolioSummary } from './types';
import { formatUsd, pnlColor, Skeleton } from './primitives';

interface Props {
  data: PortfolioSummary | undefined;
  isLoading: boolean;
}

interface Bucket {
  label: string;
  value: number | null;
}

function buildBuckets(data: PortfolioSummary | undefined): Bucket[] {
  if (!data) {
    return [
      { label: 'TODAY', value: null },
      { label: 'WTD', value: null },
      { label: 'MTD', value: null },
      { label: 'ATD', value: null },
    ];
  }
  return [
    { label: 'TODAY', value: data.dailyPnl },
    { label: 'WTD', value: data.weeklyPnl },
    // Gateway lacks a true monthly window today. Surface totalPnl under MTD
    // until /portfolio is split into rolling windows; ATD shows the same
    // figure so the user can spot the equivalence at a glance.
    { label: 'MTD', value: data.totalPnl },
    { label: 'ATD', value: data.totalPnl },
  ];
}

export function PnlHero({ data, isLoading }: Props) {
  const headingId = useId();
  const buckets = buildBuckets(data);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/40 p-6 backdrop-blur-md"
    >
      <h2 id={headingId} className="sr-only">
        Profit and loss overview
      </h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {buckets.map((b, idx) => (
          <PnlCell
            key={b.label}
            label={b.label}
            value={b.value}
            isLoading={isLoading}
            emphasis={idx === 0}
          />
        ))}
      </div>

      {data ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>
            Equity{' '}
            <span className="font-semibold text-slate-300">
              {formatUsd(data.equity)}
            </span>
          </span>
          <span aria-hidden="true">•</span>
          <span>
            Trades{' '}
            <span className="font-semibold text-slate-300">{data.totalTrades}</span>
          </span>
          <span aria-hidden="true">•</span>
          <span>
            Win rate{' '}
            <span className="font-semibold text-slate-300">
              {data.winRate.toFixed(1)}%
            </span>
          </span>
          <span aria-hidden="true">•</span>
          <span>
            Mode{' '}
            <span className="font-semibold text-slate-300">
              {data.paperTrading ? 'paper' : 'live'}
            </span>
          </span>
        </div>
      ) : null}
    </section>
  );
}

function PnlCell({
  label,
  value,
  isLoading,
  emphasis,
}: {
  label: string;
  value: number | null;
  isLoading: boolean;
  emphasis: boolean;
}) {
  const sizeCls = emphasis
    ? 'text-4xl md:text-5xl lg:text-6xl'
    : 'text-2xl md:text-3xl lg:text-4xl';

  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      {isLoading || value === null ? (
        <Skeleton className={emphasis ? 'h-12 w-40' : 'h-8 w-28'} />
      ) : (
        <div
          className={`font-bold tabular-nums tracking-tight ${sizeCls} ${pnlColor(value)}`}
        >
          {formatUsd(value, { signed: true })}
        </div>
      )}
    </div>
  );
}
