import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { getCandlesticks, toDisplayName, type CryptoTicker } from '@/lib/crypto-api';
import { useUIStore } from '@/stores/ui-store';

interface CryptoMarketRowProps {
  ticker: CryptoTicker;
  rank: number;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${(value / 1000).toFixed(0)}K`;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function extractSymbol(instrumentName: string): string {
  return instrumentName.replace(/_USDT$/, '').replace(/-USD$/, '');
}

function SparklineChart({ instrument, isPositive }: { instrument: string; isPositive: boolean }) {
  const theme = useUIStore((state) => state.theme);
  const { data } = useQuery({
    queryKey: ['sparkline', instrument],
    queryFn: async () => {
      const candles = await getCandlesticks(instrument, '1h');
      return candles
        .slice(0, 24)
        .reverse()
        .map((candle, index) => ({ x: index, y: candle.close }));
    },
    staleTime: 60_000,
    retry: 1,
  });

  if (!data) return <div className="h-10 w-full" />;

  const strokeColor = isPositive
    ? (theme === 'dark' ? '#4ade80' : '#16a34a')
    : (theme === 'dark' ? '#f87171' : '#dc2626');

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CryptoMarketRow({ ticker }: CryptoMarketRowProps) {
  const displayName = toDisplayName(ticker.instrument_name);
  const symbol = extractSymbol(ticker.instrument_name);
  const price = parseFloat(ticker.last);
  const change = parseFloat(ticker.change);
  const isPositive = change >= 0;
  const volumeValue = parseFloat(ticker.volume_value);

  const handleDexScreener = () => {
    window.open(`https://dexscreener.com/search?q=${symbol}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      onClick={handleDexScreener}
      className="group cursor-pointer rounded-lg border border-slate-200 bg-white p-3 transition hover:border-blue-400 hover:shadow-sm dark:border-slate-700/50 dark:bg-slate-800/50 dark:hover:border-blue-500/50"
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter') handleDexScreener(); }}
    >
      {/* Header: Symbol + DexScreener icon */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
            {symbol}
          </p>
          <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
            {displayName}
          </p>
        </div>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 transition group-hover:opacity-100 dark:text-slate-500" />
      </div>

      {/* Sparkline */}
      <div className="my-2">
        <SparklineChart instrument={ticker.instrument_name} isPositive={isPositive} />
      </div>

      {/* Price + Change */}
      <div className="flex items-end justify-between gap-2">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {formatPrice(price)}
        </p>
        <div
          className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
            isPositive
              ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400'
          }`}
        >
          {isPositive
            ? <TrendingUp className="h-3 w-3" />
            : <TrendingDown className="h-3 w-3" />}
          <span>{isPositive ? '+' : ''}{(change * 100).toFixed(2)}%</span>
        </div>
      </div>

      {/* Volume */}
      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
        Vol: {formatVolume(volumeValue)}
      </p>
    </div>
  );
}
