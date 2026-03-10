import { useState, useMemo } from 'react';
import { Globe, Loader2, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getMultipleTickers, toDisplayName, type CryptoTicker } from '@/lib/crypto-api';
import { useInstruments } from '@/hooks/useInstrumentSearch';
import { apiClient } from '@/lib/api-client';
import {
  type CategoryName,
  type SortField,
  type SortDirection,
  CryptoTabContent,
  NonCryptoTabContent,
  PredictionMarketCard,
  EquityMarketCard,
  ConnectExchangeCard,
  extractSymbol,
  applyCategoryFilter,
  applySorting,
} from '@/components/markets';

type TabType = 'crypto' | 'prediction' | 'equity';

interface ApiKeysResponse {
  data: Array<{ service: string }>;
}

export function MarketsPage() {
  const [tab, setTab] = useState<TabType>('crypto');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryName>('All');
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const tabs: TabType[] = ['crypto', 'prediction', 'equity'];

  const { data: cryptoInstruments } = useInstruments('crypto', 100);
  const { data: predictionInstruments, isLoading: loadingPrediction } = useInstruments('prediction', 100);
  const { data: equityInstruments, isLoading: loadingEquity } = useInstruments('equities', 100);

  const { data: apiKeysData } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys-status'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
    staleTime: 60_000,
  });

  const connectedExchanges = new Set(apiKeysData?.data?.map((key) => key.service) ?? []);
  const hasPolymarket = connectedExchanges.has('polymarket');
  const hasAlpaca = connectedExchanges.has('alpaca');

  const cryptoSymbols = (cryptoInstruments?.data ?? []).slice(0, 50).map((inst) => inst.symbol);

  const { data: tickers, isLoading, refetch } = useQuery({
    queryKey: ['market-tickers', cryptoSymbols],
    queryFn: () => getMultipleTickers(cryptoSymbols),
    refetchInterval: 60_000,
    enabled: tab === 'crypto' && cryptoSymbols.length > 0,
  });

  const processedTickers = useMemo(() => {
    if (!tickers) return [] as CryptoTicker[];
    let result = [...tickers];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((ticker) =>
        ticker.instrument_name.toLowerCase().includes(query)
        || toDisplayName(ticker.instrument_name).toLowerCase().includes(query)
        || extractSymbol(ticker.instrument_name).toLowerCase().includes(query),
      );
    }

    result = applyCategoryFilter(result, activeCategory);
    return applySorting(result, sortField, sortDirection);
  }, [tickers, searchQuery, activeCategory, sortField, sortDirection]);

  const filteredPredictions = (predictionInstruments?.data ?? []).filter((inst) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return inst.displayName.toLowerCase().includes(query) || inst.symbol.toLowerCase().includes(query);
  });

  const filteredEquities = (equityInstruments?.data ?? []).filter((inst) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return inst.displayName.toLowerCase().includes(query) || inst.symbol.toLowerCase().includes(query);
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Market Overview</h1>
        {tab === 'crypto' && (
          <>
            <span className="text-xs font-medium text-green-600 dark:text-green-400">LIVE</span>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />}
            <button onClick={() => refetch()} className="btn-ghost ml-auto p-1.5" aria-label="Refresh market data">
              <RefreshCw className="h-4 w-4" />
            </button>
          </>
        )}
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/50" aria-label="Market type">
        {tabs.map((tabValue) => (
          <button
            key={tabValue}
            onClick={() => { setTab(tabValue); setSearchQuery(''); setActiveCategory('All'); }}
            aria-selected={tab === tabValue}
            role="tab"
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
              tab === tabValue
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {tabValue === 'equity' ? 'Equities' : tabValue.charAt(0).toUpperCase() + tabValue.slice(1)}
          </button>
        ))}
      </nav>

      {/* Crypto Tab */}
      {tab === 'crypto' && (
        <CryptoTabContent
          tickers={tickers ?? null}
          processedTickers={processedTickers}
          isLoading={isLoading}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          sortField={sortField}
          onSortFieldChange={setSortField}
          sortDirection={sortDirection}
          onSortDirectionToggle={() => setSortDirection((prev) => prev === 'asc' ? 'desc' : 'asc')}
        />
      )}

      {/* Prediction Tab */}
      {tab === 'prediction' && (
        <NonCryptoTabContent
          loading={loadingPrediction}
          items={filteredPredictions}
          totalItems={filteredPredictions.length}
          maxDisplay={40}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder="Search prediction markets..."
          emptyLabel="prediction markets"
          loadingLabel="Loading prediction markets..."
          connectCard={!hasPolymarket ? <ConnectExchangeCard exchange="Polymarket" description="prediction markets" /> : null}
          renderItem={(inst) => <PredictionMarketCard key={inst.symbol} instrument={inst} />}
        />
      )}

      {/* Equity Tab */}
      {tab === 'equity' && (
        <NonCryptoTabContent
          loading={loadingEquity}
          items={filteredEquities}
          totalItems={filteredEquities.length}
          maxDisplay={60}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder="Search stocks and ETFs..."
          emptyLabel="equities"
          loadingLabel="Loading equities..."
          connectCard={!hasAlpaca ? <ConnectExchangeCard exchange="Alpaca" description="stocks and ETFs" /> : null}
          renderItem={(inst) => <EquityMarketCard key={inst.symbol} instrument={inst} />}
        />
      )}
    </div>
  );
}
