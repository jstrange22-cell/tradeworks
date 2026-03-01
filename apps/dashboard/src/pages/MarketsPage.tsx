import { useState } from 'react';
import { Globe, TrendingUp, TrendingDown, Loader2, RefreshCw, Key } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';
import { getMultipleTickers, getCandlesticks, toDisplayName, type CryptoTicker } from '@/lib/crypto-api';

type TabType = 'crypto' | 'prediction' | 'equity';

const CRYPTO_INSTRUMENTS = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD', 'DOGE-USD', 'CRO-USD',
];

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${(v / 1000).toFixed(0)}K`;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  return `$${price.toFixed(2)}`;
}

function SparklineChart({ instrument, isPositive }: { instrument: string; isPositive: boolean }) {
  const { data } = useQuery({
    queryKey: ['sparkline', instrument],
    queryFn: async () => {
      const candles = await getCandlesticks(instrument, '1h');
      return candles
        .slice(0, 24)
        .reverse()
        .map((c, i) => ({ x: i, y: c.close }));
    },
    staleTime: 60_000,
  });

  if (!data) return <div className="h-12" />;

  return (
    <div className="my-3 h-12">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={isPositive ? '#22c55e' : '#ef4444'}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CryptoMarketCard({ ticker }: { ticker: CryptoTicker }) {
  const displayName = toDisplayName(ticker.instrument_name);
  const price = parseFloat(ticker.last);
  const change = parseFloat(ticker.change);
  const isPositive = change >= 0;
  const high = parseFloat(ticker.high);
  const low = parseFloat(ticker.low);
  const volumeValue = parseFloat(ticker.volume_value);

  return (
    <div className="card transition-all hover:border-slate-600/50">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">{displayName}</h3>
          <div className="mt-1 text-xl font-bold text-slate-100">
            {formatPrice(price)}
          </div>
        </div>
        <div
          className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            isPositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {isPositive ? '+' : ''}{(change * 100).toFixed(2)}%
        </div>
      </div>

      <SparklineChart instrument={displayName} isPositive={isPositive} />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-500">24h Vol</span>
          <div className="font-medium text-slate-300">{formatVolume(volumeValue)}</div>
        </div>
        <div>
          <span className="text-slate-500">Spread</span>
          <div className="font-medium text-slate-300">
            ${(parseFloat(ticker.best_ask) - parseFloat(ticker.best_bid)).toFixed(2)}
          </div>
        </div>
        <div>
          <span className="text-slate-500">24h High</span>
          <div className="font-medium text-slate-300">{formatPrice(high)}</div>
        </div>
        <div>
          <span className="text-slate-500">24h Low</span>
          <div className="font-medium text-slate-300">{formatPrice(low)}</div>
        </div>
      </div>
    </div>
  );
}

function ConnectExchangeCard({ exchange, description }: { exchange: string; description: string }) {
  return (
    <div className="col-span-full card border-dashed border-slate-700 bg-slate-900/20 py-8 text-center">
      <Key className="mx-auto h-8 w-8 text-slate-600" />
      <p className="mt-2 text-sm text-slate-400">
        Connect your {exchange} account to see live {description} data
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Add your API keys in{' '}
        <a href="/settings" className="text-blue-400 underline hover:text-blue-300">
          Settings
        </a>{' '}
        to get started.
      </p>
    </div>
  );
}

export function MarketsPage() {
  const [tab, setTab] = useState<TabType>('crypto');
  const tabs: TabType[] = ['crypto', 'prediction', 'equity'];

  const { data: tickers, isLoading, refetch } = useQuery({
    queryKey: ['market-tickers', CRYPTO_INSTRUMENTS],
    queryFn: () => getMultipleTickers(CRYPTO_INSTRUMENTS),
    refetchInterval: 10_000,
    enabled: tab === 'crypto',
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Market Overview</h1>
        {tab === 'crypto' && (
          <>
            <span className="text-xs text-green-400">LIVE</span>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
            <button onClick={() => refetch()} className="ml-auto btn-ghost p-1.5">
              <RefreshCw className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Market Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tab === 'crypto' && tickers?.map((ticker) => (
          <CryptoMarketCard key={ticker.instrument_name} ticker={ticker} />
        ))}
        {tab === 'crypto' && !tickers && !isLoading && (
          <div className="col-span-full text-center text-sm text-slate-500">
            No market data available. Check connection.
          </div>
        )}
        {tab === 'prediction' && (
          <ConnectExchangeCard
            exchange="Polymarket"
            description="prediction market"
          />
        )}
        {tab === 'equity' && (
          <ConnectExchangeCard
            exchange="Alpaca"
            description="stock and ETF"
          />
        )}
      </div>
    </div>
  );
}
