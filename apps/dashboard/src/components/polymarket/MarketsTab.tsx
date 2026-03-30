import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, TrendingUp, Loader2, AlertCircle, ChevronRight } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface MarketToken {
  token_id: string;
  outcome: string;
  price?: number;
}

interface PolymarketMarket {
  condition_id?: string;
  market_slug?: string;
  question?: string;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  tokens?: MarketToken[];
  active?: boolean;
  closed?: boolean;
}

interface MarketsResponse {
  data: PolymarketMarket[];
  next_cursor: string;
}

interface OrderModalState {
  tokenID: string;
  outcome: string;
  question: string;
  side: 'BUY' | 'SELL';
}

function OrderModal({ state, onClose }: { state: OrderModalState; onClose: () => void }) {
  const [price, setPrice] = useState('0.50');
  const [size, setSize] = useState('10');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleOrder = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      await apiClient.post('/polymarket/order', {
        tokenID: state.tokenID,
        side: state.side,
        price: parseFloat(price),
        size: parseFloat(size),
      });
      setResult('Order placed successfully!');
    } catch (err) {
      setResult((err as Error).message ?? 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-100">
          {state.side} — {state.outcome}
        </h3>
        <p className="text-xs text-slate-400 line-clamp-2">{state.question}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Price (0.01 – 0.99)</label>
            <input
              type="number"
              min="0.01"
              max="0.99"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Size (shares)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {result && (
          <p className={`text-xs ${result.includes('success') ? 'text-green-400' : 'text-red-400'}`}>
            {result}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleOrder}
            disabled={submitting}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 ${
              state.side === 'BUY'
                ? 'bg-green-600 hover:bg-green-700 disabled:bg-slate-700'
                : 'bg-red-600 hover:bg-red-700 disabled:bg-slate-700'
            }`}
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            {state.side}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MarketsTab() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [orderModal, setOrderModal] = useState<OrderModalState | null>(null);

  const marketsQuery = useQuery({
    queryKey: ['polymarket-markets', debouncedSearch],
    queryFn: () =>
      apiClient.get<MarketsResponse>(`/polymarket/markets${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`),
    refetchInterval: 60_000,
  });

  const handleSearchChange = (value: string) => {
    setSearch(value);
    const timer = setTimeout(() => setDebouncedSearch(value), 500);
    return () => clearTimeout(timer);
  };

  const markets: PolymarketMarket[] = marketsQuery.data?.data ?? [];
  const activeMarkets = markets.filter(m => m.active && !m.closed);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search markets (e.g. 'election', 'bitcoin')…"
          className="w-full rounded-lg bg-slate-800 border border-slate-600 pl-10 pr-4 py-2.5 text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Loading */}
      {marketsQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
        </div>
      )}

      {/* Error */}
      {marketsQuery.isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">Failed to load markets. Check gateway connection.</p>
        </div>
      )}

      {/* Markets list */}
      {activeMarkets.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{activeMarkets.length} active markets</p>
          {activeMarkets.map((market, idx) => {
            const yesToken = market.tokens?.find(t => t.outcome === 'Yes');
            const noToken = market.tokens?.find(t => t.outcome === 'No');
            const yesPrice = yesToken?.price ?? null;
            const noPrice = noToken?.price ?? null;
            const vol24h = market.volume24hr ?? market.volume ?? 0;

            return (
              <div
                key={market.condition_id ?? idx}
                className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 line-clamp-2">
                      {market.question ?? market.market_slug ?? 'Unknown Market'}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      {yesPrice !== null && (
                        <span className="text-xs text-green-400 font-mono">
                          YES {(yesPrice * 100).toFixed(1)}¢
                        </span>
                      )}
                      {noPrice !== null && (
                        <span className="text-xs text-red-400 font-mono">
                          NO {(noPrice * 100).toFixed(1)}¢
                        </span>
                      )}
                      {vol24h > 0 && (
                        <span className="text-xs text-slate-500">
                          Vol ${vol24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {yesToken && (
                      <button
                        onClick={() => setOrderModal({
                          tokenID: yesToken.token_id,
                          outcome: 'YES',
                          question: market.question ?? '',
                          side: 'BUY',
                        })}
                        className="rounded-md bg-green-600/20 border border-green-600/40 px-3 py-1.5 text-xs text-green-400 hover:bg-green-600/30 transition-colors"
                      >
                        Buy YES
                      </button>
                    )}
                    {noToken && (
                      <button
                        onClick={() => setOrderModal({
                          tokenID: noToken.token_id,
                          outcome: 'NO',
                          question: market.question ?? '',
                          side: 'BUY',
                        })}
                        className="rounded-md bg-red-600/20 border border-red-600/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/30 transition-colors"
                      >
                        Buy NO
                      </button>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-600" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!marketsQuery.isLoading && activeMarkets.length === 0 && !marketsQuery.isError && (
        <div className="flex flex-col items-center justify-center py-12 space-y-2">
          <TrendingUp className="h-8 w-8 text-slate-600" />
          <p className="text-slate-400 text-sm">
            {search ? 'No markets match your search.' : 'No active markets found.'}
          </p>
        </div>
      )}

      {orderModal && (
        <OrderModal state={orderModal} onClose={() => setOrderModal(null)} />
      )}
    </div>
  );
}
