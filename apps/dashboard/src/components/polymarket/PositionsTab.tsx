import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface PolymarketPosition {
  conditionId?: string;
  title?: string;
  question?: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  currentValue?: number;
  initialValue?: number;
  curPrice?: number;
}

interface PositionsResponse {
  data: PolymarketPosition[];
}

export function PositionsTab() {
  const positionsQuery = useQuery({
    queryKey: ['polymarket-positions'],
    queryFn: () => apiClient.get<PositionsResponse>('/polymarket/positions'),
    refetchInterval: 30_000,
  });

  const positions: PolymarketPosition[] = positionsQuery.data?.data ?? [];

  if (positionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (positionsQuery.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
        <p className="text-sm text-red-300">Failed to load positions.</p>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-2">
        <TrendingUp className="h-8 w-8 text-slate-600" />
        <p className="text-slate-400 text-sm">No open positions.</p>
        <p className="text-slate-500 text-xs">Buy YES or NO on any market to open a position.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{positions.length} open position{positions.length !== 1 ? 's' : ''}</p>
      {positions.map((pos, idx) => {
        const currentVal = pos.currentValue ?? (pos.size ?? 0) * (pos.curPrice ?? 0);
        const entryVal = pos.initialValue ?? (pos.size ?? 0) * (pos.avgPrice ?? 0);
        const pnl = currentVal - entryVal;
        const pnlPct = entryVal > 0 ? (pnl / entryVal) * 100 : 0;
        const isProfit = pnl >= 0;

        return (
          <div
            key={pos.conditionId ?? idx}
            className="rounded-lg border border-slate-700 bg-slate-800/50 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 line-clamp-1">
                  {pos.title ?? pos.question ?? 'Unknown Market'}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    pos.outcome === 'Yes' || pos.outcome === 'YES'
                      ? 'bg-green-600/20 text-green-400'
                      : 'bg-red-600/20 text-red-400'
                  }`}>
                    {pos.outcome}
                  </span>
                  {pos.size !== undefined && (
                    <span className="text-xs text-slate-500">{pos.size?.toFixed(2)} shares</span>
                  )}
                  {pos.avgPrice !== undefined && (
                    <span className="text-xs text-slate-500">@ {(pos.avgPrice * 100).toFixed(1)}¢</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold text-slate-100">
                  ${currentVal.toFixed(2)}
                </p>
                {entryVal > 0 && (
                  <div className={`flex items-center gap-1 justify-end text-xs ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    <span>{isProfit ? '+' : ''}{pnl.toFixed(2)} ({pnlPct.toFixed(1)}%)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
