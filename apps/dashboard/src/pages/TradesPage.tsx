import { useState, useMemo, useRef } from 'react';
import { ArrowLeftRight, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { apiClient } from '@/lib/api-client';

const MARKETS = ['All', 'crypto', 'prediction', 'equity'] as const;
const ESTIMATED_ROW_HEIGHT = 44;

interface Trade {
  id: string;
  instrument: string;
  market: 'crypto' | 'prediction' | 'equity';
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  pnl: number;
  strategyId: string;
  executedAt: string;
}

interface TradesResponse {
  data: Trade[];
  total: number;
}

export function TradesPage() {
  const [marketFilter, setMarketFilter] = useState<string>('All');
  const [strategyFilter, setStrategyFilter] = useState<string>('All');
  const parentRef = useRef<HTMLDivElement>(null);

  // Fetch trades from the real API
  const { data: tradesData, isLoading } = useQuery<TradesResponse>({
    queryKey: ['trades-history'],
    queryFn: () => apiClient.get<TradesResponse>('/trades?limit=200'),
    refetchInterval: 30_000,
  });

  const allTrades: Trade[] = tradesData?.data ?? [];

  const strategies = useMemo(() => {
    const set = new Set(allTrades.map((t) => t.strategyId).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [allTrades]);

  const filtered = useMemo(() => {
    return allTrades.filter((t) => {
      if (marketFilter !== 'All' && t.market !== marketFilter) return false;
      if (strategyFilter !== 'All' && t.strategyId !== strategyFilter)
        return false;
      return true;
    });
  }, [allTrades, marketFilter, strategyFilter]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-slate-100">Trade History</h1>
        </div>
        <div className="text-sm text-slate-500">
          {filtered.length} trades total
        </div>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-4">
        <Filter className="h-4 w-4 text-slate-400" />

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Market:</label>
          <select
            value={marketFilter}
            onChange={(e) => {
              setMarketFilter(e.target.value);
              virtualizer.scrollToIndex(0);
            }}
            className="input py-1 text-xs"
          >
            {MARKETS.map((m) => (
              <option key={m} value={m}>
                {m === 'All' ? 'All Markets' : m.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Strategy:</label>
          <select
            value={strategyFilter}
            onChange={(e) => {
              setStrategyFilter(e.target.value);
              virtualizer.scrollToIndex(0);
            }}
            className="input py-1 text-xs"
          >
            {strategies.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All Strategies' : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Trades Table */}
      <div className="card">
        <div className="overflow-x-auto">
          {/* Sticky header */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="pb-3 pr-4">Time</th>
                <th className="pb-3 pr-4">Instrument</th>
                <th className="pb-3 pr-4">Market</th>
                <th className="pb-3 pr-4">Side</th>
                <th className="pb-3 pr-4 text-right">Qty</th>
                <th className="pb-3 pr-4 text-right">Price</th>
                <th className="pb-3 pr-4 text-right">P&L</th>
                <th className="pb-3">Strategy</th>
              </tr>
            </thead>
          </table>

          {isLoading && (
            <div className="py-8 text-center text-sm text-slate-500">
              Loading trades...
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-500">
              No trades yet. Place your first trade from the Charts page.
            </div>
          )}

          {/* Virtualized scrollable body */}
          {!isLoading && filtered.length > 0 && (
            <div ref={parentRef} className="h-[600px] overflow-y-auto">
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const trade = filtered[virtualItem.index];
                  return (
                    <div
                      key={virtualItem.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <table className="w-full text-sm">
                        <tbody>
                          <tr className="table-row">
                            <td className="py-2.5 pr-4 text-slate-400">
                              {new Date(trade.executedAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-2.5 pr-4 font-medium text-slate-200">
                              {trade.instrument}
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className="badge-info text-xs">
                                {trade.market.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                                  trade.side === 'buy'
                                    ? 'bg-green-500/10 text-green-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}
                              >
                                {trade.side.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-right text-slate-300">
                              {trade.quantity}
                            </td>
                            <td className="py-2.5 pr-4 text-right text-slate-300">
                              ${trade.price.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                              })}
                            </td>
                            <td
                              className={`py-2.5 pr-4 text-right font-medium ${
                                trade.pnl > 0
                                  ? 'text-green-400'
                                  : trade.pnl < 0
                                    ? 'text-red-400'
                                    : 'text-slate-500'
                              }`}
                            >
                              {trade.pnl !== 0
                                ? `${trade.pnl > 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`
                                : '--'}
                            </td>
                            <td className="py-2.5 text-slate-500">{trade.strategyId}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
