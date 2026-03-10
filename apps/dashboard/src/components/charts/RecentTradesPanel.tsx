import type { CryptoTrade } from '@/lib/crypto-api';
import { formatPrice, formatQty } from '@/lib/chart-utils';

interface RecentTradesPanelProps {
  tradesData: CryptoTrade[] | undefined;
}

export function RecentTradesPanel({ tradesData }: RecentTradesPanelProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-400">Recent Trades</div>
      {tradesData && tradesData.length > 0 ? (
        <div>
          <div className="mb-1.5 grid grid-cols-4 text-[10px] font-semibold text-slate-600">
            <span>PRICE</span><span>SIZE</span><span>SIDE</span><span>TIME</span>
          </div>
          {tradesData.slice(0, 15).map((trade: CryptoTrade, idx: number) => (
            <div key={idx} className="grid grid-cols-4 py-0.5 text-[11px]">
              <span className={`font-mono ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                {formatPrice(trade.price)}
              </span>
              <span className="font-mono text-slate-500">{formatQty(trade.quantity)}</span>
              <span className={`font-semibold ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                {trade.side}
              </span>
              <span className="text-slate-600">
                {new Date(trade.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-600">Loading trades...</p>
      )}
    </div>
  );
}
