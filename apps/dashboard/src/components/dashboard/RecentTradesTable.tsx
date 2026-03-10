import type { RecentTrade } from '@/stores/portfolio-store';

interface RecentTradesTableProps {
  recentTrades: RecentTrade[];
}

export function RecentTradesTable({ recentTrades }: RecentTradesTableProps) {
  return (
    <div className="card">
      <div className="card-header">Recent Trades</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
              <th className="pb-3 pr-4">Time</th>
              <th className="pb-3 pr-4">Instrument</th>
              <th className="pb-3 pr-4">Side</th>
              <th className="pb-3 pr-4 text-right">Qty</th>
              <th className="pb-3 pr-4 text-right">Price</th>
              <th className="pb-3 pr-4 text-right">P&L</th>
              <th className="pb-3">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {recentTrades.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                  No trades yet. Place your first trade from the Charts page.
                </td>
              </tr>
            )}
            {recentTrades.slice(0, 10).map((trade) => (
              <tr key={trade.id} className="table-row">
                <td className="py-2.5 pr-4 text-slate-400">
                  {new Date(trade.executedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="py-2.5 pr-4 font-medium text-slate-200">
                  {trade.instrument}
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
    </div>
  );
}
