import { useState, useRef, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePortfolioStore } from '@/stores/portfolio-store';
import { useInstrumentSearch } from '@/hooks/useInstrumentSearch';

interface TradePanelProps {
  instrument?: string;
  market?: string;
  onClose: () => void;
}

interface OrderResponse {
  data: {
    orderId: string;
    status: string;
    fillPrice: number;
    fillQuantity: number;
    market: string;
    message: string;
  };
  message: string;
}

export function TradePanel({ instrument: initialInstrument, market: initialMarket, onClose }: TradePanelProps) {
  const { paperTrading } = usePortfolioStore();
  const { setQuery, results } = useInstrumentSearch();
  const [instrument, setInstrument] = useState(initialInstrument ?? '');
  const [selectedMarket, setSelectedMarket] = useState(initialMarket ?? '');
  const [showDropdown, setShowDropdown] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [orderResult, setOrderResult] = useState<OrderResponse['data'] | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const orderMutation = useMutation({
    mutationFn: (data: {
      instrument: string;
      side: 'buy' | 'sell';
      quantity: number;
      orderType: string;
      price?: number;
      market?: string;
    }) => apiClient.post<OrderResponse>('/orders', data),
    onSuccess: (data) => {
      setOrderResult(data.data);
    },
  });

  const handleSubmit = () => {
    if (!instrument.trim() || !quantity.trim() || parseFloat(quantity) <= 0) return;

    const order: {
      instrument: string;
      side: 'buy' | 'sell';
      quantity: number;
      orderType: string;
      price?: number;
      market?: string;
    } = {
      instrument: instrument.trim(),
      side,
      quantity: parseFloat(quantity),
      orderType,
    };

    if (orderType !== 'market' && price) {
      order.price = parseFloat(price);
    }

    if (selectedMarket) {
      order.market = selectedMarket;
    }

    setOrderResult(null);
    orderMutation.mutate(order);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm border-l border-slate-700/50 bg-slate-800 shadow-2xl">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
          <h3 className="text-lg font-semibold text-slate-100">Place Order</h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              paperTrading ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'
            }`}>
              {paperTrading ? 'PAPER' : 'LIVE'}
            </span>
            <button onClick={onClose} className="btn-ghost p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Instrument */}
          <div className="relative" ref={dropdownRef}>
            <label className="text-xs font-medium text-slate-400">Instrument</label>
            <input
              type="text"
              value={instrument}
              onChange={(e) => {
                setInstrument(e.target.value);
                setQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => { setQuery(instrument); setShowDropdown(true); }}
              placeholder="Search BTC-USD, AAPL, SPY..."
              className="input mt-1 w-full"
            />
            {showDropdown && results.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-lg">
                {results.map((r) => (
                  <button
                    key={r.symbol}
                    onClick={() => {
                      setInstrument(r.symbol);
                      setSelectedMarket(r.market);
                      setShowDropdown(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
                  >
                    <div>
                      <span className="font-medium">{r.symbol}</span>
                      <span className="ml-2 text-xs text-slate-500">{r.displayName}</span>
                    </div>
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {r.market}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Buy / Sell Toggle */}
          <div>
            <label className="text-xs font-medium text-slate-400">Side</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                onClick={() => setSide('buy')}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                  side === 'buy'
                    ? 'bg-green-600 text-white'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <TrendingUp className="h-4 w-4" />
                BUY
              </button>
              <button
                onClick={() => setSide('sell')}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                  side === 'sell'
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <TrendingDown className="h-4 w-4" />
                SELL
              </button>
            </div>
          </div>

          {/* Order Type */}
          <div>
            <label className="text-xs font-medium text-slate-400">Order Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as 'market' | 'limit' | 'stop')}
              className="input mt-1 w-full"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
              <option value="stop">Stop</option>
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs font-medium text-slate-400">Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="input mt-1 w-full"
              min="0"
              step="any"
            />
          </div>

          {/* Price (for limit/stop) */}
          {orderType !== 'market' && (
            <div>
              <label className="text-xs font-medium text-slate-400">
                {orderType === 'limit' ? 'Limit Price' : 'Stop Price'}
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="input mt-1 w-full"
                min="0"
                step="any"
              />
            </div>
          )}

          {/* Order Result */}
          {orderResult && (
            <div className={`rounded-lg p-3 text-sm ${
              orderResult.status === 'filled'
                ? 'bg-green-500/10 text-green-400'
                : orderResult.status === 'rejected'
                ? 'bg-red-500/10 text-red-400'
                : 'bg-amber-500/10 text-amber-400'
            }`}>
              <div className="flex items-center gap-2">
                {orderResult.status === 'filled' ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <span className="font-medium">{orderResult.status.toUpperCase()}</span>
              </div>
              <p className="mt-1">{orderResult.message}</p>
              {orderResult.fillPrice > 0 && (
                <p className="mt-0.5 text-xs opacity-75">
                  Fill: {orderResult.fillQuantity} @ ${orderResult.fillPrice.toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {orderMutation.isError && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              Order failed: {orderMutation.error?.message || 'Unknown error'}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className="border-t border-slate-700/50 p-4">
          <button
            onClick={handleSubmit}
            disabled={orderMutation.isPending || !instrument.trim() || !quantity.trim()}
            className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold transition-colors ${
              side === 'buy'
                ? 'bg-green-600 text-white hover:bg-green-500 disabled:bg-green-600/30'
                : 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-600/30'
            } disabled:cursor-not-allowed`}
          >
            {orderMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                {side === 'buy' ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {side === 'buy' ? 'Buy' : 'Sell'} {instrument || '...'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
