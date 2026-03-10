import { useMemo } from 'react';
import { Trophy, Skull } from 'lucide-react';
import type { TradeData } from '@/types/analytics';

interface BestWorstTradesProps {
  trades: TradeData[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TradeRow({ trade, rank }: { trade: TradeData; rank: number }) {
  const isPositive = trade.pnl > 0;
  return (
    <tr className="border-b border-slate-700/30 last:border-0">
      <td className="py-2 pr-3 text-xs text-slate-500">{rank}</td>
      <td className="py-2 pr-3 text-sm font-medium text-slate-200">{trade.instrument}</td>
      <td className="py-2 pr-3 text-xs text-slate-400">{formatDate(trade.executedAt)}</td>
      <td className="py-2 pr-3 text-xs text-slate-400">{trade.strategyId || 'Manual'}</td>
      <td className={`py-2 text-right text-sm font-bold ${
        isPositive ? 'text-green-400' : 'text-red-400'
      }`}>
        {isPositive ? '+' : ''}${trade.pnl.toFixed(2)}
      </td>
    </tr>
  );
}

export function BestWorstTrades({ trades }: BestWorstTradesProps) {
  const { best, worst } = useMemo(() => {
    const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);
    return {
      best: sorted.filter((t) => t.pnl > 0).slice(0, 5),
      worst: sorted.filter((t) => t.pnl < 0).slice(-5).reverse(),
    };
  }, [trades]);

  const hasData = best.length > 0 || worst.length > 0;

  if (!hasData) {
    return (
      <div className="card">
        <div className="card-header">Best / Worst Trades</div>
        <div className="flex h-32 items-center justify-center text-sm text-slate-500">
          No closed trades with P&L data
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Best Trades */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Trophy className="h-4 w-4 text-green-400" />
          Top 5 Best Trades
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
              <th className="pb-2 pr-3">#</th>
              <th className="pb-2 pr-3">Instrument</th>
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Strategy</th>
              <th className="pb-2 text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {best.map((trade, idx) => (
              <TradeRow key={trade.id} trade={trade} rank={idx + 1} />
            ))}
            {best.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-xs text-slate-500">
                  No winning trades yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Worst Trades */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Skull className="h-4 w-4 text-red-400" />
          Top 5 Worst Trades
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
              <th className="pb-2 pr-3">#</th>
              <th className="pb-2 pr-3">Instrument</th>
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Strategy</th>
              <th className="pb-2 text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {worst.map((trade, idx) => (
              <TradeRow key={trade.id} trade={trade} rank={idx + 1} />
            ))}
            {worst.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-xs text-slate-500">
                  No losing trades yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
