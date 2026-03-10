import { useEffect, useRef, useState } from 'react';
import { Loader2, ShoppingCart, Search, TrendingUp, TrendingDown } from 'lucide-react';
import { useInstrumentSearch, type InstrumentInfo } from '@/hooks/useInstrumentSearch';
import { formatPrice, formatLargeNumber } from '@/lib/chart-utils';

interface PriceHeaderBarProps {
  instrument: string;
  onInstrumentChange: (symbol: string, market: string) => void;
  priceInfo: {
    current: number;
    changePct: number;
    high24h: number;
    low24h: number;
    totalVolume: number;
  } | null;
  isLoading: boolean;
  onOpenTradePanel: () => void;
}

export function PriceHeaderBar({
  instrument,
  onInstrumentChange,
  priceInfo,
  isLoading,
  onOpenTradePanel,
}: PriceHeaderBarProps) {
  const [showSearch, setShowSearch] = useState(false);
  const { query, setQuery, results, isLoading: searching } = useInstrumentSearch();
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isUp = (priceInfo?.changePct ?? 0) >= 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative" ref={searchRef}>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={showSearch ? query : instrument}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSearch(true);
            }}
            onFocus={() => {
              setQuery(instrument);
              setShowSearch(true);
            }}
            placeholder="Search..."
            className="input w-44 py-1.5 pl-8 text-sm font-semibold"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-blue-400" />
          )}
        </div>
        {showSearch && results.length > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
            {results.map((r: InstrumentInfo) => (
              <button
                key={r.symbol}
                onClick={() => {
                  onInstrumentChange(r.symbol, r.market);
                  setShowSearch(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-slate-700"
              >
                <div className="min-w-0">
                  <span className="font-medium">{r.symbol}</span>
                  <span className="ml-2 truncate text-xs text-slate-500">{r.displayName}</span>
                </div>
                <span className="ml-2 shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {r.market}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {priceInfo && (
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-slate-100">
            ${formatPrice(priceInfo.current)}
          </span>
          <span className={`flex items-center gap-0.5 rounded-md px-2 py-0.5 text-sm font-semibold ${
            isUp ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {isUp ? '+' : ''}{priceInfo.changePct.toFixed(2)}%
          </span>
        </div>
      )}

      {priceInfo && (
        <div className="hidden items-center gap-4 text-[11px] text-slate-500 md:flex">
          <span>24h H: <span className="text-green-400">${formatPrice(priceInfo.high24h)}</span></span>
          <span>24h L: <span className="text-red-400">${formatPrice(priceInfo.low24h)}</span></span>
          <span>Vol: <span className="text-slate-300">{formatLargeNumber(priceInfo.totalVolume)}</span></span>
        </div>
      )}

      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}

      <div className="ml-auto flex items-center gap-2">
        <span className="rounded bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
          LIVE
        </span>
        <button
          onClick={onOpenTradePanel}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          Trade
        </button>
      </div>
    </div>
  );
}
