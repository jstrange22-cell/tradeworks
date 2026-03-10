import { useEffect, useRef, useState, useCallback } from 'react';
import { TradePanel } from '@/components/trade/TradePanel';
import { useQuery } from '@tanstack/react-query';
import { getCandlesticks, getOrderBook, getRecentTrades } from '@/lib/crypto-api';
import { CandlestickChart } from '@/components/charts/CandlestickChart';
import { OrderBookPanel } from '@/components/charts/OrderBookPanel';
import { RecentTradesPanel } from '@/components/charts/RecentTradesPanel';
import { PriceHeaderBar } from '@/components/charts/PriceHeaderBar';
import { type IndicatorId } from '@/components/charts/IndicatorToolbar';

export function ChartsPage() {
  const [instrument, setInstrument] = useState('BTC-USD');
  const [instrumentMarket, setInstrumentMarket] = useState<string>('crypto');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set());
  const [showTradePanel, setShowTradePanel] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartWrapperRef = useRef<HTMLDivElement>(null);

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

  const { data: candleData, isLoading, error } = useQuery({
    queryKey: ['candles', instrument, timeframe],
    queryFn: () => getCandlesticks(instrument, timeframe),
    refetchInterval: 30_000,
  });

  const { data: bookData } = useQuery({
    queryKey: ['orderbook', instrument],
    queryFn: () => getOrderBook(instrument, 10),
    refetchInterval: 10_000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ['recent-trades', instrument],
    queryFn: () => getRecentTrades(instrument, 20),
    refetchInterval: 10_000,
  });

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
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          Failed to load chart data: {(error as Error).message}
        </div>
      )}

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
      />

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
