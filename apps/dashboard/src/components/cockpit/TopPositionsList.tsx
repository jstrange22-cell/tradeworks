/**
 * Open positions sorted by unrealized P&L (winners first, big losers stand
 * out at the bottom). Source: /api/v1/portfolio.openPositions.
 */
import { useMemo } from 'react';
import { Card, CardBody, CardHeader, formatUsd, pnlColor, Skeleton } from './primitives';
import type { PortfolioPosition } from './types';

interface Props {
  positions: PortfolioPosition[] | undefined;
  isLoading: boolean;
}

function pctReturn(p: PortfolioPosition): number {
  const cost = p.averageEntry * p.quantity;
  if (cost === 0) return 0;
  return p.unrealizedPnl / Math.abs(cost);
}

export function TopPositionsList({ positions, isLoading }: Props) {
  const sorted = useMemo(() => {
    if (!positions) return [];
    return [...positions].sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
  }, [positions]);

  return (
    <Card className="h-full">
      <CardHeader
        title="Open Positions"
        subtitle={
          sorted.length > 0
            ? `${sorted.length} active`
            : 'No open positions'
        }
      />
      <CardBody className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">
            No open positions. New entries will appear here as they fill.
          </p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-slate-700/40 overflow-y-auto">
            {sorted.map((p) => {
              const pct = pctReturn(p);
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-slate-800/40"
                >
                  <span className="w-16 flex-shrink-0 font-semibold text-slate-200">
                    {p.instrument}
                  </span>
                  <span
                    className={`rounded px-1 text-[10px] font-bold uppercase ${
                      p.side === 'sell' || p.side === 'short'
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'bg-sky-500/15 text-sky-300'
                    }`}
                  >
                    {p.side}
                  </span>
                  <span className="hidden flex-shrink-0 tabular-nums text-slate-500 sm:inline">
                    qty {p.quantity.toLocaleString()}
                  </span>
                  <span className="ml-auto tabular-nums text-slate-500">
                    {formatUsd(p.currentPrice)}
                  </span>
                  <span
                    className={`w-20 flex-shrink-0 text-right font-semibold tabular-nums ${pnlColor(p.unrealizedPnl)}`}
                  >
                    {formatUsd(p.unrealizedPnl, { signed: true })}
                  </span>
                  <span
                    className={`hidden w-16 flex-shrink-0 text-right text-[11px] tabular-nums sm:inline ${pnlColor(p.unrealizedPnl)}`}
                  >
                    {pct >= 0 ? '+' : ''}
                    {(pct * 100).toFixed(2)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
