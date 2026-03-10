import { TrendingUp, TrendingDown } from 'lucide-react';
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
  });

  if (!data) return <div className="h-10 w-20" />;

  const strokeColor = isPositive
    ? (theme === 'dark' ? '#4ade80' : '#16a34a')
    : (theme === 'dark' ? '#f87171' : '#dc2626');

  return (
    <div className="h-10 w-20">
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

export function CryptoMarketRow({ ticker, rank }: CryptoMarketRowProps) {
  const displayName = toDisplayName(ticker.instrument_name);
  const symbol = extractSymbol(ticker.instrument_name);
  const price = parseFloat(ticker.last);
  const change = parseFloat(ticker.change);
  const isPositive = change >= 0;
  const volumeValue = parseFloat(ticker.volume_value);

  return (
    <div className="table-row flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
      {/* Rank */}
      <span className="w-6 shrink-0 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
        {rank}
      </span>

      {/* Symbol + Name */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {symbol}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {displayName}
        </p>
      </div>

      {/* Sparkline (hidden on small screens) */}
      <div className="hidden sm:block">
        <SparklineChart instrument={displayName} isPositive={isPositive} />
      </div>

      {/* Price */}
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {formatPrice(price)}
        </p>
      </div>

      {/* 24h Change */}
      <div
        className={`flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-xs font-semibold ${
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

      {/* Volume (hidden on mobile) */}
      <div className="hidden w-20 shrink-0 text-right md:block">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {formatVolume(volumeValue)}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Vol</p>
      </div>
    </div>
  );
}
