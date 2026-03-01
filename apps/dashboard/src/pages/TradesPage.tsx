import { useState, useMemo } from 'react';
import { ArrowLeftRight, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

const PAGE_SIZE = 15;
const MARKETS = ['All', 'crypto', 'prediction', 'equity'] as const;

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
  const [page, setPage] = useState(0);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
              setPage(0);
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
              setPage(0);
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
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-slate-500">
                    Loading trades...
                  </td>
                </tr>
              )}
              {!isLoading && paginated.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-slate-500">
                    No trades yet. Place your first trade from the Charts page.
                  </td>
                </tr>
              )}
              {paginated.map((trade) => (
                <tr key={trade.id} className="table-row">
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
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-700/50 pt-4">
            <div className="text-xs text-slate-500">
              Page {page + 1} of {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-ghost p-1.5"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn-ghost p-1.5"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
