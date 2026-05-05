import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { TradePanel } from '@/components/trade/TradePanel';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCandlesticks, getOrderBook, getRecentTrades } from '@/lib/crypto-api';
import { RefreshCw, AlertTriangle, Zap } from 'lucide-react';
import { TradingViewWidget } from '@/components/charts/TradingViewWidget';
import { CandlestickChart } from '@/components/charts/CandlestickChart';
import { OrderBookPanel } from '@/components/charts/OrderBookPanel';
import { RecentTradesPanel } from '@/components/charts/RecentTradesPanel';
import { PriceHeaderBar } from '@/components/charts/PriceHeaderBar';
import { type IndicatorId } from '@/components/charts/IndicatorToolbar';
import { useAISignal } from '@/hooks/useAISignal';

export function ChartsPage() {
  const [instrument, setInstrument] = useState('BTC-USD');
  const [instrumentMarket, setInstrumentMarket] = useState<string>('crypto');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set());
  const [showTradePanel, setShowTradePanel] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartMode, setChartMode] = useState<'tradingview' | 'internal'>('internal');
  const [showAISignals, setShowAISignals] = useState(() => {
    const stored = localStorage.getItem('showAISignals');
    return stored === null ? true : stored === 'true';
  });
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const lastSignalRef = useRef<string>('neutral');

  const toggleFullscreen = useCallback(() => {
    if (!chartWrapperRef.current) return;
    if (!document.fullscreenElement) {
      chartWrapperRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleIndicator = useCallback((id: IndicatorId) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleInstrumentChange = useCallback((symbol: string, market: string) => {
    setInstrument(symbol);
    setInstrumentMarket(market);
  }, []);

  const queryClient = useQueryClient();

  const { data: candleData, isLoading, error } = useQuery({
    queryKey: ['candles', instrument, timeframe],
    queryFn: () => getCandlesticks(instrument, timeframe),
    refetchInterval: 30_000,
    retry: 2,
    staleTime: 10_000,
  });

  const { data: bookData } = useQuery({
    queryKey: ['orderbook', instrument],
    queryFn: () => getOrderBook(instrument, 10),
    refetchInterval: 10_000,
    retry: 2,
  });

  const { data: tradesData } = useQuery({
    queryKey: ['recent-trades', instrument],
    queryFn: () => getRecentTrades(instrument, 20),
    refetchInterval: 10_000,
    retry: 2,
  });

  const aiSignal = useAISignal(candleData, instrument, timeframe, showAISignals);

  // Fire toast when signal direction changes to buy or sell
  useEffect(() => {
    if (!aiSignal || !showAISignals) return;
    const { direction, confidence, entryPrice, stopLoss, tp1, tp2, tp3 } = aiSignal;
    if (direction === 'neutral') return;
    if (direction === lastSignalRef.current) return;
    lastSignalRef.current = direction;

    const price = entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const sl = stopLoss.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const t1 = tp1.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const t2 = tp2.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const t3 = tp3.toLocaleString(undefined, { maximumFractionDigits: 2 });

    if (direction === 'buy') {
      toast.success(`BUY — ${instrument}`, {
        description: `@ $${price} · Confidence ${confidence}%\nSL $${sl} · TP1 $${t1} · TP2 $${t2} · TP3 $${t3}`,
        duration: 12_000,
      });
    } else {
      toast.error(`SELL — ${instrument}`, {
        description: `@ $${price} · Confidence ${confidence}%\nSL $${sl} · TP1 $${t1} · TP2 $${t2} · TP3 $${t3}`,
        duration: 12_000,
      });
    }
  }, [aiSignal, showAISignals, instrument]);

  // Reset last signal when instrument or timeframe changes
  useEffect(() => {
    lastSignalRef.current = 'neutral';
  }, [instrument, timeframe]);

  const priceInfo = (() => {
    if (!candleData || candleData.length === 0) return null;
    const sorted = [...candleData].sort((a, b) => a.timestamp - b.timestamp);
    const current = sorted[sorted.length - 1].close;
    const open24h = sorted[0].open;
    const high24h = Math.max(...sorted.map(c => c.high));
    const low24h = Math.min(...sorted.map(c => c.low));
    const changePct = ((current - open24h) / open24h) * 100;
    const totalVolume = sorted.reduce((s, c) => s + (c.volume * c.close), 0);
    return { current, changePct, high24h, low24h, totalVolume };
  })();

  return (
    <div className="space-y-3">
      <PriceHeaderBar
        instrument={instrument}
        onInstrumentChange={handleInstrumentChange}
        priceInfo={priceInfo}
        isLoading={isLoading}
        onOpenTradePanel={() => setShowTradePanel(true)}
      />

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Failed to load chart data: {(error as Error).message}
          </div>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['candles', instrument, timeframe] })}
            className="flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/20"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {/* Chart mode + AI toggle bar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-slate-700/50 bg-slate-800/50 p-1">
          <button
            onClick={() => setChartMode('internal')}
            className={`rounded px-3 py-1 text-xs font-semibold transition ${
              chartMode === 'internal' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Chart
          </button>
          <button
            onClick={() => setChartMode('tradingview')}
            className={`rounded px-3 py-1 text-xs font-semibold transition ${
              chartMode === 'tradingview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            TradingView
          </button>
        </div>

        <button
          onClick={() => setShowAISignals(v => { const next = !v; localStorage.setItem('showAISignals', String(next)); return next; })}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
            showAISignals
              ? 'border-purple-500/50 text-white'
              : 'border-slate-700/50 text-slate-400 hover:text-purple-300 hover:border-purple-500/30'
          }`}
          style={showAISignals ? { background: 'linear-gradient(135deg,#7c3aed,#4f46e5)' } : undefined}
        >
          <Zap className="h-3.5 w-3.5" />
          AI Signals
        </button>
      </div>

      {/* Chart */}
      {chartMode === 'internal' ? (
        <CandlestickChart
          instrument={instrument}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          candleData={candleData}
          activeIndicators={activeIndicators}
          onToggleIndicator={toggleIndicator}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          chartWrapperRef={chartWrapperRef}
          aiSignal={aiSignal}
          showAISignals={showAISignals}
          onToggleAISignals={() => setShowAISignals(v => { const next = !v; localStorage.setItem('showAISignals', String(next)); return next; })}
        />
      ) : (
        <TradingViewWidget
          symbol={instrument}
          timeframe={timeframe}
          theme="dark"
          height={580}
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <OrderBookPanel bookData={bookData} />
        <RecentTradesPanel tradesData={tradesData} />
      </div>

      {showTradePanel && (
        <TradePanel
          instrument={instrument}
          market={instrumentMarket}
          onClose={() => setShowTradePanel(false)}
        />
      )}
    </div>
  );
}
