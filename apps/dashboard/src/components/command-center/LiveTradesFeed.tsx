import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface TradeEntry {
  id: string;
  symbol: string;
  trigger: string;
  pnlSol: number;
  pnlPercent: number;
  timestamp: string;
  templateName: string;
}

interface StatusResponse {
  recentExecutions?: TradeEntry[];
}

export function LiveTradesFeed() {
  const { data } = useQuery<StatusResponse>({
    queryKey: ['sniper-status-feed'],
    queryFn: () => apiClient.get('/solana/sniper/status'),
    refetchInterval: 15_000,
  });

  const trades = (data?.recentExecutions ?? [])
    .filter((t) => t.pnlSol !== undefined && t.pnlSol !== null)
    .slice(0, 8);

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4 text-center text-sm text-slate-500">
        No recent trades
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Trades</h3>
      <div className="space-y-1.5">
        {trades.map((t) => {
          const isWin = t.pnlSol > 0;
          return (
            <div key={t.id} className="flex items-center justify-between rounded-lg bg-slate-700/20 px-3 py-2">
              <div className="flex items-center gap-2">
                {isWin ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />
                )}
                <span className="text-sm font-medium text-white">{t.symbol}</span>
                <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] text-slate-400">
                  {t.trigger}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isWin ? '+' : ''}{t.pnlSol.toFixed(4)}
                </span>
                <span className="text-[10px] text-slate-500">
                  {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
