import { useState } from 'react';
import { Globe, TrendingUp, TrendingDown, Loader2, RefreshCw, Key, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';
import { getMultipleTickers, getCandlesticks, toDisplayName, type CryptoTicker } from '@/lib/crypto-api';
import { useInstruments, type InstrumentInfo } from '@/hooks/useInstrumentSearch';
import { apiClient } from '@/lib/api-client';

type TabType = 'crypto' | 'prediction' | 'equity';

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

function PredictionMarketCard({ instrument }: { instrument: InstrumentInfo }) {
  return (
    <div className="card transition-all hover:border-slate-600/50">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
          <Globe className="h-4 w-4 text-purple-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-snug text-slate-200">
            {instrument.displayName}
          </h3>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
              PREDICTION
            </span>
            <span className="text-xs text-slate-500">{instrument.exchange}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EquityMarketCard({ instrument }: { instrument: InstrumentInfo }) {
  return (
    <div className="card transition-all hover:border-slate-600/50">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">{instrument.symbol}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{instrument.displayName}</p>
        </div>
        <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
          EQUITY
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <span className="capitalize">{instrument.exchange}</span>
        {instrument.tradable && (
          <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
            Tradable
          </span>
        )}
      </div>
    </div>
  );
}

function ConnectExchangeCard({ exchange, description }: { exchange: string; description: string }) {
  return (
    <div className="col-span-full card border-dashed border-slate-700 bg-slate-900/20 py-6 text-center">
      <Key className="mx-auto h-8 w-8 text-slate-600" />
      <p className="mt-2 text-sm text-slate-400">
        Connect your {exchange} account to trade live {description}
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

interface ApiKeysResponse {
  data: Array<{ service: string }>;
}

export function MarketsPage() {
  const [tab, setTab] = useState<TabType>('crypto');
  const [searchQuery, setSearchQuery] = useState('');
  const tabs: TabType[] = ['crypto', 'prediction', 'equity'];

  // Fetch instruments dynamically per market
  const { data: cryptoInstruments } = useInstruments('crypto', 50);
  const { data: predictionInstruments, isLoading: loadingPrediction } = useInstruments('prediction', 100);
  const { data: equityInstruments, isLoading: loadingEquity } = useInstruments('equities', 100);

  // Check which exchanges are connected
  const { data: apiKeysData } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys-status'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
    staleTime: 60_000,
  });

  const connectedExchanges = new Set(apiKeysData?.data?.map((k) => k.service) ?? []);
  const hasPolymarket = connectedExchanges.has('polymarket');
  const hasAlpaca = connectedExchanges.has('alpaca');

  // Build crypto instrument list from dynamic data
  const cryptoSymbols = (cryptoInstruments?.data ?? [])
    .slice(0, 20)
    .map((i) => i.symbol);

  const { data: tickers, isLoading, refetch } = useQuery({
    queryKey: ['market-tickers', cryptoSymbols],
    queryFn: () => getMultipleTickers(cryptoSymbols),
    refetchInterval: 10_000,
    enabled: tab === 'crypto' && cryptoSymbols.length > 0,
  });

  // Filter predictions and equities by search
  const filteredPredictions = (predictionInstruments?.data ?? []).filter((i) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return i.displayName.toLowerCase().includes(q) || i.symbol.toLowerCase().includes(q);
  });

  const filteredEquities = (equityInstruments?.data ?? []).filter((i) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return i.displayName.toLowerCase().includes(q) || i.symbol.toLowerCase().includes(q);
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
            onClick={() => { setTab(t); setSearchQuery(''); }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'equity' ? 'Equities' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Search (for prediction & equity tabs) */}
      {(tab === 'prediction' || tab === 'equity') && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tab === 'prediction' ? 'Search prediction markets...' : 'Search stocks and ETFs...'}
            className="input w-full pl-9"
          />
        </div>
      )}

      {/* Market Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Crypto Tab */}
        {tab === 'crypto' && tickers?.map((ticker) => (
          <CryptoMarketCard key={ticker.instrument_name} ticker={ticker} />
        ))}
        {tab === 'crypto' && !tickers && !isLoading && (
          <div className="col-span-full text-center text-sm text-slate-500">
            No market data available. Check connection.
          </div>
        )}

        {/* Prediction Tab */}
        {tab === 'prediction' && loadingPrediction && (
          <div className="col-span-full flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            <span className="ml-2 text-sm text-slate-400">Loading prediction markets...</span>
          </div>
        )}
        {tab === 'prediction' && !loadingPrediction && filteredPredictions.length > 0 && (
          <>
            {!hasPolymarket && (
              <ConnectExchangeCard
                exchange="Polymarket"
                description="prediction markets"
              />
            )}
            {filteredPredictions.slice(0, 40).map((inst) => (
              <PredictionMarketCard key={inst.symbol} instrument={inst} />
            ))}
            {filteredPredictions.length > 40 && (
              <div className="col-span-full text-center text-xs text-slate-500">
                Showing 40 of {filteredPredictions.length} markets. Use search to narrow results.
              </div>
            )}
          </>
        )}
        {tab === 'prediction' && !loadingPrediction && filteredPredictions.length === 0 && (
          <div className="col-span-full text-center text-sm text-slate-500 py-8">
            {searchQuery ? 'No prediction markets match your search.' : 'No prediction markets available.'}
          </div>
        )}

        {/* Equity Tab */}
        {tab === 'equity' && loadingEquity && (
          <div className="col-span-full flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            <span className="ml-2 text-sm text-slate-400">Loading equities...</span>
          </div>
        )}
        {tab === 'equity' && !loadingEquity && filteredEquities.length > 0 && (
          <>
            {!hasAlpaca && (
              <ConnectExchangeCard
                exchange="Alpaca"
                description="stocks and ETFs"
              />
            )}
            {filteredEquities.slice(0, 60).map((inst) => (
              <EquityMarketCard key={inst.symbol} instrument={inst} />
            ))}
            {filteredEquities.length > 60 && (
              <div className="col-span-full text-center text-xs text-slate-500">
                Showing 60 of {filteredEquities.length} instruments. Use search to narrow results.
              </div>
            )}
          </>
        )}
        {tab === 'equity' && !loadingEquity && filteredEquities.length === 0 && (
          <div className="col-span-full text-center text-sm text-slate-500 py-8">
            {searchQuery ? 'No equities match your search.' : 'No equity instruments available.'}
          </div>
        )}
      </div>
    </div>
  );
}
