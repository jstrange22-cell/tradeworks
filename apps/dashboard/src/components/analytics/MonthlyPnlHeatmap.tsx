import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import type { TradeData } from '@/types/analytics';

interface MonthlyPnlHeatmapProps {
  trades: TradeData[];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function getPnlColor(pnl: number, maxAbsPnl: number): string {
  if (pnl === 0) return 'bg-slate-800/50';
  const intensity = Math.min(Math.abs(pnl) / maxAbsPnl, 1);
  if (pnl > 0) {
    if (intensity > 0.7) return 'bg-green-500/80';
    if (intensity > 0.4) return 'bg-green-500/50';
    return 'bg-green-500/25';
  }
  if (intensity > 0.7) return 'bg-red-500/80';
  if (intensity > 0.4) return 'bg-red-500/50';
  return 'bg-red-500/25';
}

export function MonthlyPnlHeatmap({ trades }: MonthlyPnlHeatmapProps) {
  const { weeks, maxAbsPnl, monthLabel } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const label = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Aggregate P&L by day
    const pnlMap = new Map<string, number>();
    for (const trade of trades) {
      const dateKey = trade.executedAt.slice(0, 10);
      pnlMap.set(dateKey, (pnlMap.get(dateKey) ?? 0) + trade.pnl);
    }

    // Build calendar grid for current month
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Shift so Monday = 0
    const startDow = (firstDay.getDay() + 6) % 7;

    const cells: Array<{ day: number; pnl: number; dateKey: string } | null> = [];
    // Fill leading empty cells
    for (let idx = 0; idx < startDow; idx++) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({ day, pnl: pnlMap.get(dateKey) ?? 0, dateKey });
    }

    // Chunk into weeks (rows of 7)
    const weekRows: Array<typeof cells> = [];
    for (let idx = 0; idx < cells.length; idx += 7) {
      const row = cells.slice(idx, idx + 7);
      while (row.length < 7) row.push(null);
      weekRows.push(row);
    }

    const maxAbs = Math.max(
      1,
      ...Array.from(pnlMap.values()).map((val) => Math.abs(val))
    );

    return { dailyPnl: pnlMap, weeks: weekRows, maxAbsPnl: maxAbs, monthLabel: label };
  }, [trades]);

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-blue-400" />
        Monthly P&L Heatmap
        <span className="ml-auto text-xs normal-case tracking-normal text-slate-500">
          {monthLabel}
        </span>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="text-center text-[10px] text-slate-500 font-medium">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="space-y-1">
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="grid grid-cols-7 gap-1">
            {week.map((cell, cellIdx) => (
              <div
                key={cellIdx}
                className={`relative flex h-9 items-center justify-center rounded text-xs font-medium transition-colors ${
                  cell ? getPnlColor(cell.pnl, maxAbsPnl) : 'bg-transparent'
                }`}
                title={
                  cell
                    ? `${cell.dateKey}: ${cell.pnl >= 0 ? '+' : ''}$${cell.pnl.toFixed(2)}`
                    : undefined
                }
              >
                {cell && (
                  <>
                    <span className="text-slate-300">{cell.day}</span>
                    {cell.pnl !== 0 && (
                      <span className={`absolute -bottom-0.5 text-[8px] ${
                        cell.pnl > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {cell.pnl > 0 ? '+' : ''}{cell.pnl.toFixed(0)}
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-slate-500">
        <span>Loss</span>
        <div className="flex gap-0.5">
          <div className="h-3 w-3 rounded bg-red-500/80" />
          <div className="h-3 w-3 rounded bg-red-500/50" />
          <div className="h-3 w-3 rounded bg-red-500/25" />
          <div className="h-3 w-3 rounded bg-slate-800/50" />
          <div className="h-3 w-3 rounded bg-green-500/25" />
          <div className="h-3 w-3 rounded bg-green-500/50" />
          <div className="h-3 w-3 rounded bg-green-500/80" />
        </div>
        <span>Profit</span>
      </div>
    </div>
  );
}
