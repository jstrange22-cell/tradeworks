import { TrendingUp, TrendingDown, Flame } from 'lucide-react';
import type { CryptoTicker } from '@/lib/crypto-api';

interface HotCoin {
  symbol: string;
  price: number;
  change: number;
}

interface HotCoinsBarProps {
  tickers: CryptoTicker[];
}

function extractSymbol(instrumentName: string): string {
  return instrumentName.replace(/_USDT$/, '').replace(/-USD$/, '');
}

function formatCompactPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function deriveHotCoins(tickers: CryptoTicker[]): { gainers: HotCoin[]; losers: HotCoin[] } {
  const mapped = tickers.map((ticker) => ({
    symbol: extractSymbol(ticker.instrument_name),
    price: parseFloat(ticker.last),
    change: parseFloat(ticker.change),
  }));

  const sorted = [...mapped].sort((a, b) => b.change - a.change);
  const gainers = sorted.filter((coin) => coin.change > 0).slice(0, 5);
  const losers = sorted.filter((coin) => coin.change < 0).slice(-5).reverse();

  return { gainers, losers };
}

function HotCoinCard({ coin }: { coin: HotCoin }) {
  const isPositive = coin.change >= 0;

  return (
    <div
      className={`flex min-w-[140px] snap-start flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors ${
        isPositive
          ? 'border-green-200 bg-green-50 dark:border-green-500/20 dark:bg-green-500/5'
          : 'border-red-200 bg-red-50 dark:border-red-500/20 dark:bg-red-500/5'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {coin.symbol}
        </span>
        {isPositive
          ? <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          : <TrendingDown className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
      </div>
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {formatCompactPrice(coin.price)}
      </span>
      <span
        className={`text-xs font-semibold ${
          isPositive
            ? 'text-green-700 dark:text-green-400'
            : 'text-red-700 dark:text-red-400'
        }`}
      >
        {isPositive ? '+' : ''}{(coin.change * 100).toFixed(2)}%
      </span>
    </div>
  );
}

export function HotCoinsBar({ tickers }: HotCoinsBarProps) {
  const { gainers, losers } = deriveHotCoins(tickers);

  if (gainers.length === 0 && losers.length === 0) return null;

  return (
    <section aria-label="Top gainers and losers">
      <div className="flex items-center gap-2 mb-2">
        <Flame className="h-4 w-4 text-orange-500" />
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Hot Coins</h2>
      </div>
      <div className="flex gap-6 overflow-x-auto pb-2 scrollbar-thin">
        {/* Gainers */}
        {gainers.length > 0 && (
          <div className="flex-shrink-0">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-green-700 dark:text-green-400">
              Top Gainers
            </p>
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto">
              {gainers.map((coin) => (
                <HotCoinCard key={coin.symbol} coin={coin} />
              ))}
            </div>
          </div>
        )}
        {/* Losers */}
        {losers.length > 0 && (
          <div className="flex-shrink-0">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-red-700 dark:text-red-400">
              Top Losers
            </p>
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto">
              {losers.map((coin) => (
                <HotCoinCard key={coin.symbol} coin={coin} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
