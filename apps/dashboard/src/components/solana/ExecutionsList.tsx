import { useState, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import type { SnipeExecution } from '@/types/solana';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/** Re-render every 5s so time-ago labels stay fresh */
function useTickEvery5s() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
}

interface ExecutionsListProps {
  executions: SnipeExecution[] | undefined;
  title?: string;
}

export function ExecutionsList({ executions, title = 'Live Activity' }: ExecutionsListProps) {
  useTickEvery5s();
  const all = executions ?? [];

  // Newest first, cap at 30 rows
  const items = [...all].reverse().slice(0, 30);

  // Build cumulative per-mint buy cost so sell rows can show PnL %
  const buyMap = new Map<string, number>();
  for (const e of all) {
    if (e.action === 'buy') {
      buyMap.set(e.mint, (buyMap.get(e.mint) ?? 0) + e.amountSol);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/50">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-100 dark:border-slate-700/40">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-200">{title}</h3>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-slate-500">
          {all.length} total trades
        </span>
      </div>

      {/* Feed */}
      <div className="max-h-[400px] overflow-y-auto px-3 py-2.5">
        <div className="space-y-1">
          {items.map((ex, idx) => {
            const isBuy = ex.action === 'buy';
            const buyCost = buyMap.get(ex.mint) ?? 0;
            const pnlPct =
              !isBuy && buyCost > 0
                ? ((ex.amountSol - buyCost) / buyCost) * 100
                : null;
            const isNewest = idx === 0;

            return (
              <div
                key={ex.id}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${
                  isNewest && isBuy
                    ? 'border-emerald-400/50 bg-emerald-500/10 dark:bg-emerald-500/10'
                    : isNewest && !isBuy
                    ? 'border-sky-400/40 bg-sky-500/8 dark:bg-sky-500/8'
                    : isBuy
                    ? 'border-emerald-500/15 bg-emerald-500/5'
                    : 'border-slate-200/80 bg-slate-50 dark:border-slate-700/30 dark:bg-slate-900/20'
                }`}
              >
                {/* Direction icon */}
                {isBuy ? (
                  <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-sky-500 dark:text-sky-400" />
                )}

                {/* BUY / SELL */}
                <span
                  className={`w-7 shrink-0 font-extrabold tracking-wide ${
                    isBuy ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'
                  }`}
                >
                  {isBuy ? 'BUY' : 'SELL'}
                </span>

                {/* Token name */}
                <span className="max-w-[72px] truncate font-semibold text-gray-900 dark:text-slate-100">
                  {ex.symbol}
                </span>

                {/* Trigger badge */}
                {ex.trigger && (
                  <span className="hidden shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-500 dark:bg-slate-700 dark:text-slate-400 sm:block max-w-[56px] truncate">
                    {ex.trigger}
                  </span>
                )}

                {/* PnL % on sells */}
                {pnlPct !== null && (
                  <span
                    className={`shrink-0 font-bold tabular-nums ${
                      pnlPct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                    }`}
                  >
                    {pnlPct >= 0 ? '+' : ''}
                    {pnlPct.toFixed(1)}%
                  </span>
                )}

                <span className="flex-1" />

                {/* SOL amount */}
                <span className="shrink-0 font-mono text-gray-500 dark:text-slate-400">
                  {ex.amountSol.toFixed(4)} SOL
                </span>

                {/* Time ago */}
                <span className="w-[52px] shrink-0 text-right text-[10px] text-gray-400 dark:text-slate-500">
                  {timeAgo(ex.timestamp)}
                </span>

                {/* Solscan link */}
                {ex.signature && (
                  <a
                    href={`https://solscan.io/tx/${ex.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-gray-300 transition hover:text-blue-400 dark:text-slate-600 dark:hover:text-blue-400"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="py-8 text-center text-[11px] text-gray-400 dark:text-slate-500">
              Waiting for first trade…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
