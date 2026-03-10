import type { CryptoBookEntry } from '@/lib/crypto-api';
import { formatPrice, formatQty } from '@/lib/chart-utils';

interface OrderBookPanelProps {
  bookData: { bids: CryptoBookEntry[]; asks: CryptoBookEntry[] } | undefined;
}

export function OrderBookPanel({ bookData }: OrderBookPanelProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-400">Order Book</div>
      {bookData ? (
        <div className="grid grid-cols-2 gap-3">
          <BookSide entries={bookData.bids.slice(0, 10)} label="BID" color="#22c55e" textColor="text-green-400" />
          <BookSide entries={bookData.asks.slice(0, 10)} label="ASK" color="#ef4444" textColor="text-red-400" />
        </div>
      ) : (
        <p className="text-xs text-slate-600">Loading order book...</p>
      )}
    </div>
  );
}

function BookSide({ entries, label, color, textColor }: {
  entries: CryptoBookEntry[];
  label: string;
  color: string;
  textColor: string;
}) {
  const maxQty = Math.max(...entries.map((e) => parseFloat(e.quantity)));

  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[10px] font-semibold text-slate-600">
        <span>{label}</span><span>SIZE</span>
      </div>
      {entries.map((entry, idx) => {
        const pct = (parseFloat(entry.quantity) / maxQty) * 100;
        return (
          <div key={idx} className="relative flex justify-between py-0.5 text-[11px]">
            <div className="absolute inset-0 right-0 opacity-15" style={{ background: `linear-gradient(to left, ${color} ${pct}%, transparent ${pct}%)` }} />
            <span className={`relative font-mono ${textColor}`}>{formatPrice(entry.price)}</span>
            <span className="relative font-mono text-slate-500">{formatQty(entry.quantity)}</span>
          </div>
        );
      })}
    </div>
  );
}
