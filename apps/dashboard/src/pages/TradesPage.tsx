import { useState, useMemo } from 'react';
import { ArrowLeftRight, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePortfolioStore, type RecentTrade } from '@/stores/portfolio-store';

const PAGE_SIZE = 15;
const MARKETS = ['All', 'crypto', 'prediction', 'equity'] as const;

// Extended mock trades for history
function generateMockTrades(): RecentTrade[] {
  const instruments = {
    crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD'],
    equity: ['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ', 'META', 'TSLA'],
    prediction: ['POLYMARKET-1', 'POLYMARKET-2'],
  };
  const strategies = [
    'trend-following',
    'mean-reversion',
    'breakout',
    'momentum',
    'arbitrage',
  ];

  const trades: RecentTrade[] = [];
  for (let i = 0; i < 75; i++) {
    const market = (['crypto', 'equity', 'prediction'] as const)[
      Math.floor(Math.random() * 3)
    ];
    const instrumentList = instruments[market];
    const instrument =
      instrumentList[Math.floor(Math.random() * instrumentList.length)];
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const price =
      market === 'crypto'
        ? 100 + Math.random() * 95000
        : market === 'equity'
          ? 50 + Math.random() * 900
          : 0.1 + Math.random() * 0.9;
    const pnl =
      side === 'sell'
        ? (Math.random() - 0.35) * 500
        : 0;

    trades.push({
      id: `trade-${i}`,
      instrument,
      market,
      side,
      quantity: parseFloat((Math.random() * 100).toFixed(2)),
      price: parseFloat(price.toFixed(2)),
      pnl: parseFloat(pnl.toFixed(2)),
      strategyId: strategies[Math.floor(Math.random() * strategies.length)],
      executedAt: new Date(
        Date.now() - i * 1200000 - Math.random() * 600000,
      ).toISOString(),
    });
  }
  return trades;
}

const allTrades = generateMockTrades();

export function TradesPage() {
  const storeTrades = usePortfolioStore((s) => s.recentTrades);
  const [marketFilter, setMarketFilter] = useState<string>('All');
  const [strategyFilter, setStrategyFilter] = useState<string>('All');
  const [page, setPage] = useState(0);

  const combinedTrades = useMemo(
    () => [...storeTrades, ...allTrades],
    [storeTrades],
  );

  const strategies = useMemo(() => {
    const set = new Set(combinedTrades.map((t) => t.strategyId));
    return ['All', ...Array.from(set).sort()];
  }, [combinedTrades]);

  const filtered = useMemo(() => {
    return combinedTrades.filter((t) => {
      if (marketFilter !== 'All' && t.market !== marketFilter) return false;
      if (strategyFilter !== 'All' && t.strategyId !== strategyFilter)
        return false;
      return true;
    });
  }, [combinedTrades, marketFilter, strategyFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
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
      </div>
    </div>
  );
}
