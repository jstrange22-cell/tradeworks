import { useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, CircleDollarSign, Loader2, Eye, EyeOff } from 'lucide-react';
import { StatCard, formatCompact } from '@/components/solana/shared';
import { useHoldings } from '@/hooks/useSolana';

export function HoldingsTab() {
  const [showClosed, setShowClosed] = useState(false);
  const holdingsQuery = useHoldings(true);
  const holdings = holdingsQuery.data?.data ?? [];
  const summary = holdingsQuery.data?.summary;

  const displayed = showClosed ? holdings : holdings.filter((h) => h.isOpen);

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total Invested"
            value={`${summary.totalInvestedSol.toFixed(3)} SOL`}
            sub={`${summary.totalHoldings} trades`}
            icon={<CircleDollarSign className="h-4 w-4 text-blue-400" />}
          />
          <StatCard
            label="Total Returned"
            value={`${summary.totalReturnedSol.toFixed(3)} SOL`}
            sub={`${summary.closedPositions} closed`}
            icon={<Wallet className="h-4 w-4 text-green-400" />}
          />
          <StatCard
            label="Realized P&L"
            value={`${summary.realizedPnlSol >= 0 ? '+' : ''}${summary.realizedPnlSol.toFixed(4)} SOL`}
            sub={summary.realizedPnlSol >= 0 ? 'profit' : 'loss'}
            icon={summary.realizedPnlSol >= 0
              ? <TrendingUp className="h-4 w-4 text-green-400" />
              : <TrendingDown className="h-4 w-4 text-red-400" />}
          />
          <StatCard
            label="Open Positions"
            value={String(summary.openPositions)}
            sub="active"
            icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          />
        </div>
      )}

      {/* Holdings Table */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">Holdings</h2>
          <button
            onClick={() => setShowClosed((prev) => !prev)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600 transition hover:bg-gray-200 dark:hover:bg-slate-600"
          >
            {showClosed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showClosed ? 'Hide Closed' : 'Show Closed'}
          </button>
        </div>

        {holdingsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">
            {holdings.length === 0 ? 'No trades yet — start sniping!' : 'No open positions'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 dark:border-slate-700/50 dark:text-slate-400">
                  <th className="pb-2 pr-3">Token</th>
                  <th className="pb-2 pr-3 text-right">Invested</th>
                  <th className="pb-2 pr-3 text-right">Returned</th>
                  <th className="pb-2 pr-3 text-right">P&L (SOL)</th>
                  <th className="pb-2 pr-3 text-right">Current Price</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Strategy</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((holding) => {
                  const pnl = holding.isOpen
                    ? holding.unrealizedPnlPercent
                    : holding.totalBuySol > 0
                      ? ((holding.totalSellSol - holding.totalBuySol) / holding.totalBuySol) * 100
                      : 0;
                  const pnlSol = holding.realizedPnlSol;

                  return (
                    <tr key={holding.mint} className="border-b border-gray-100 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/20">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-800 dark:text-slate-200">{holding.symbol}</div>
                        <div className="text-[10px] text-gray-400 dark:text-slate-500">{holding.name.slice(0, 20)}</div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-gray-700 dark:text-slate-300">
                        {holding.totalBuySol.toFixed(3)} SOL
                        <div className="text-[10px] text-gray-400 dark:text-slate-500">{holding.totalBuyCount} buys</div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-gray-700 dark:text-slate-300">
                        {holding.totalSellSol.toFixed(3)} SOL
                        <div className="text-[10px] text-gray-400 dark:text-slate-500">{holding.totalSellCount} sells</div>
                      </td>
                      <td className={`py-2 pr-3 text-right font-mono ${pnlSol >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {pnlSol >= 0 ? '+' : ''}{pnlSol.toFixed(4)}
                        <div className="text-[10px]">
                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-gray-700 dark:text-slate-300">
                        {holding.currentPriceUsd > 0
                          ? `$${holding.currentPriceUsd < 0.01 ? holding.currentPriceUsd.toExponential(2) : holding.currentPriceUsd.toFixed(4)}`
                          : '—'}
                        {holding.currentValueUsd > 0 && (
                          <div className="text-[10px] text-gray-400 dark:text-slate-500">${formatCompact(holding.currentValueUsd)}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          holding.isOpen
                            ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                            : 'bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-500'
                        }`}>
                          {holding.isOpen ? 'OPEN' : 'CLOSED'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[10px] text-gray-400 dark:text-slate-500">
                        {holding.templateName ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
