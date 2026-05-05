/**
 * 90-day equity-curve sparkline. Recharts is already in deps, so we lean on
 * `<ResponsiveContainer>` + `<LineChart>` for retina-correct rendering.
 *
 * Color picks itself from the curve direction (green if last >= first, rose
 * otherwise). No axes, no grid — this is a sparkline, not a chart.
 */
import { useId, useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { EquityPoint } from './types';
import { Card, CardBody, CardHeader, formatUsd, Skeleton } from './primitives';

interface Props {
  points: EquityPoint[] | undefined;
  isLoading: boolean;
}

function takeLast<T>(arr: T[], n: number): T[] {
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}

export function EquityCurveCard({ points, isLoading }: Props) {
  const titleId = useId();
  const series = useMemo(() => takeLast(points ?? [], 90), [points]);

  const direction = useMemo(() => {
    if (series.length < 2) return 'flat' as const;
    const first = series[0];
    const last = series[series.length - 1];
    if (!first || !last) return 'flat' as const;
    if (last.equity > first.equity) return 'up' as const;
    if (last.equity < first.equity) return 'down' as const;
    return 'flat' as const;
  }, [series]);

  const stroke =
    direction === 'up' ? '#34d399' : direction === 'down' ? '#fb7185' : '#94a3b8';

  const range = useMemo(() => {
    if (series.length === 0) return { lo: 0, hi: 0, delta: 0 };
    const lo = Math.min(...series.map((p) => p.equity));
    const hi = Math.max(...series.map((p) => p.equity));
    return { lo, hi, delta: hi - lo };
  }, [series]);

  return (
    <Card className="h-full">
      <CardHeader
        title="Equity Curve"
        subtitle="Last 90 days"
        right={
          series.length > 0 ? (
            <span className="text-[11px] font-semibold tabular-nums text-slate-300">
              {formatUsd(series[series.length - 1]?.equity ?? 0)}
            </span>
          ) : null
        }
      />
      <CardBody className="h-44">
        <h3 id={titleId} className="sr-only">
          90 day equity curve
        </h3>
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : series.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            No equity history yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={series}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              aria-labelledby={titleId}
            >
              <Tooltip
                cursor={{ stroke: '#475569', strokeDasharray: '3 3' }}
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid rgba(51,65,85,0.6)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#e2e8f0',
                }}
                labelFormatter={(label) => String(label)}
                formatter={(value: number) => [formatUsd(value), 'Equity']}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke={stroke}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}

        {series.length > 0 ? (
          <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
            <span>Range {formatUsd(range.delta)}</span>
            <span>
              {formatUsd(range.lo)} → {formatUsd(range.hi)}
            </span>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
