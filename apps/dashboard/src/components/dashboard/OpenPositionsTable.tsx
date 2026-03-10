import type { PortfolioPosition } from '@/stores/portfolio-store';

interface OpenPositionsTableProps {
  openPositions: PortfolioPosition[];
}

export function OpenPositionsTable({ openPositions }: OpenPositionsTableProps) {
  return (
    <div className="card">
      <div className="card-header">Open Positions</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
              <th className="pb-3 pr-4">Instrument</th>
              <th className="pb-3 pr-4">Market</th>
              <th className="pb-3 pr-4">Side</th>
              <th className="pb-3 pr-4 text-right">Qty</th>
              <th className="pb-3 pr-4 text-right">Entry</th>
              <th className="pb-3 pr-4 text-right">Current</th>
              <th className="pb-3 text-right">Unrealized P&L</th>
            </tr>
          </thead>
          <tbody>
            {openPositions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                  No open positions.
                </td>
              </tr>
            )}
            {openPositions.map((pos) => (
              <tr key={pos.id} className="table-row">
                <td className="py-2.5 pr-4 font-medium text-slate-200">
                  {pos.instrument}
                </td>
                <td className="py-2.5 pr-4">
                  <span className="badge-info">
                    {pos.market.toUpperCase()}
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                      pos.side === 'long'
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    {pos.side.toUpperCase()}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-right text-slate-300">
                  {pos.quantity}
                </td>
                <td className="py-2.5 pr-4 text-right text-slate-300">
                  ${pos.averageEntry.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </td>
                <td className="py-2.5 pr-4 text-right text-slate-300">
                  ${pos.currentPrice.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </td>
                <td
                  className={`py-2.5 text-right font-medium ${
                    pos.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {pos.unrealizedPnl >= 0 ? '+' : ''}$
                  {Math.abs(pos.unrealizedPnl).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
