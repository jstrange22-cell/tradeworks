import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { CandlestickChart, Loader2, ShoppingCart, Search, Maximize2, Minimize2, TrendingUp, TrendingDown } from 'lucide-react';
import { TradePanel } from '@/components/trade/TradePanel';
import { useQuery } from '@tanstack/react-query';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts';
import {
  getCandlesticks,
  getOrderBook,
  getRecentTrades,
  type CryptoCandle,
  type CryptoBookEntry,
  type CryptoTrade,
} from '@/lib/crypto-api';
import { sma, ema, rsi, macd, bollinger } from '@tradeworks/indicators';
import { useInstrumentSearch, type InstrumentInfo } from '@/hooks/useInstrumentSearch';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

// Indicator definitions with colors
const INDICATORS = [
  { id: 'sma20', label: 'SMA 20', color: '#f59e0b', type: 'overlay' },
  { id: 'sma50', label: 'SMA 50', color: '#8b5cf6', type: 'overlay' },
  { id: 'ema12', label: 'EMA 12', color: '#06b6d4', type: 'overlay' },
  { id: 'ema26', label: 'EMA 26', color: '#ec4899', type: 'overlay' },
  { id: 'boll', label: 'BB', color: '#64748b', type: 'overlay' },
  { id: 'rsi', label: 'RSI', color: '#a855f7', type: 'panel' },
  { id: 'macd', label: 'MACD', color: '#3b82f6', type: 'panel' },
] as const;

type IndicatorId = typeof INDICATORS[number]['id'];

function sortCandles(candles: CryptoCandle[]): CryptoCandle[] {
  return [...candles].sort((a, b) => a.timestamp - b.timestamp);
}

function parseCandlesForChart(candles: CryptoCandle[]): {
  candles: CandlestickData<Time>[];
  volumes: HistogramData<Time>[];
  times: Time[];
  closes: number[];
  highs: number[];
  lows: number[];
  opens: number[];
} {
  const chartCandles: CandlestickData<Time>[] = [];
  const chartVolumes: HistogramData<Time>[] = [];
  const times: Time[] = [];
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const opens: number[] = [];

  for (const c of candles) {
    const time = Math.floor(c.timestamp / 1000) as Time;
    times.push(time);
    closes.push(c.close);
    highs.push(c.high);
    lows.push(c.low);
    opens.push(c.open);

    chartCandles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    chartVolumes.push({
      time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
    });
  }

  return { candles: chartCandles, volumes: chartVolumes, times, closes, highs, lows, opens };
}

function toLineData(values: number[], times: Time[]): LineData<Time>[] {
  const data: LineData<Time>[] = [];
  for (let i = 0; i < values.length; i++) {
    if (!isNaN(values[i])) {
      data.push({ time: times[i], value: values[i] });
    }
  }
  return data;
}

function formatPrice(price: string | number): string {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatQty(qty: string): string {
  const q = parseFloat(qty);
  if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return q.toFixed(4);
}

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function ChartsPage() {
  const [instrument, setInstrument] = useState('BTC-USD');
  const [instrumentMarket, setInstrumentMarket] = useState<string>('crypto');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set());
  const [showTradePanel, setShowTradePanel] = useState(false);
  const [showInstrumentSearch, setShowInstrumentSearch] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { query: instrumentQuery, setQuery: setInstrumentQuery, results: instrumentResults, isLoading: searchingInstruments } = useInstrumentSearch();
  const instrumentSearchRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line' | 'Histogram'>>>(new Map());

  // Close instrument search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (instrumentSearchRef.current && !instrumentSearchRef.current.contains(e.target as Node)) {
        setShowInstrumentSearch(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fullscreen toggle
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

  // Compute sorted candle data
  const sortedCandles = useMemo(() => {
    if (!candleData || candleData.length === 0) return null;
    return sortCandles(candleData);
  }, [candleData]);

  const parsed = useMemo(() => {
    if (!sortedCandles) return null;
    return parseCandlesForChart(sortedCandles);
  }, [sortedCandles]);

  // Current price + 24h stats
  const priceInfo = useMemo(() => {
    if (!parsed || parsed.closes.length === 0) return null;
    const current = parsed.closes[parsed.closes.length - 1];
    const open24h = parsed.opens[0];
    const high24h = Math.max(...parsed.highs);
    const low24h = Math.min(...parsed.lows);
    const change = current - open24h;
    const changePct = (change / open24h) * 100;
    const totalVolume = sortedCandles?.reduce((s, c) => s + (c.volume * c.close), 0) ?? 0;
    return { current, change, changePct, high24h, low24h, totalVolume };
  }, [parsed, sortedCandles]);

  // Toggle indicator on/off
  const toggleIndicator = useCallback((id: IndicatorId) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build chart and render everything
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      indicatorSeriesRef.current.clear();
    }

    const chartHeight = isFullscreen ? window.innerHeight - 80 : 560;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b1120' },
        textColor: '#64748b',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.5)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(100, 116, 139, 0.4)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(100, 116, 139, 0.4)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
      },
      width: chartContainerRef.current.clientWidth,
      height: chartHeight,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#4ade80', wickDownColor: '#f87171',
    });

    // Volume series
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // Set candle and volume data
    if (parsed) {
      candleSeries.setData(parsed.candles);
      volumeSeries.setData(parsed.volumes);

      const { times, closes } = parsed;

      // Render active overlay indicators
      if (activeIndicators.has('sma20')) {
        const values = sma(closes, 20);
        const series = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceScaleId: 'right' });
        series.setData(toLineData(values, times));
        indicatorSeriesRef.current.set('sma20', series);
      }

      if (activeIndicators.has('sma50')) {
        const values = sma(closes, 50);
        const series = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, priceScaleId: 'right' });
        series.setData(toLineData(values, times));
        indicatorSeriesRef.current.set('sma50', series);
      }

      if (activeIndicators.has('ema12')) {
        const values = ema(closes, 12);
        const series = chart.addLineSeries({ color: '#06b6d4', lineWidth: 1, priceScaleId: 'right' });
        series.setData(toLineData(values, times));
        indicatorSeriesRef.current.set('ema12', series);
      }

      if (activeIndicators.has('ema26')) {
        const values = ema(closes, 26);
        const series = chart.addLineSeries({ color: '#ec4899', lineWidth: 1, priceScaleId: 'right' });
        series.setData(toLineData(values, times));
        indicatorSeriesRef.current.set('ema26', series);
      }

      if (activeIndicators.has('boll')) {
        const result = bollinger(closes, 20, 2);
        const upperSeries = chart.addLineSeries({
          color: 'rgba(100, 116, 139, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right',
        });
        const middleSeries = chart.addLineSeries({
          color: 'rgba(148, 163, 184, 0.5)', lineWidth: 1, priceScaleId: 'right',
        });
        const lowerSeries = chart.addLineSeries({
          color: 'rgba(100, 116, 139, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right',
        });
        upperSeries.setData(toLineData(result.upper, times));
        middleSeries.setData(toLineData(result.middle, times));
        lowerSeries.setData(toLineData(result.lower, times));
        indicatorSeriesRef.current.set('boll-upper', upperSeries);
        indicatorSeriesRef.current.set('boll-middle', middleSeries);
        indicatorSeriesRef.current.set('boll-lower', lowerSeries);
      }

      chart.timeScale().fitContent();
    }

    // Resize handler
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: isFullscreen ? window.innerHeight - 80 : 560,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      indicatorSeriesRef.current.clear();
    };
  }, [instrument, timeframe, parsed, activeIndicators, isFullscreen]);

  // Compute RSI and MACD for panel display
  const rsiValues = useMemo(() => {
    if (!parsed || !activeIndicators.has('rsi')) return null;
    const values = rsi(parsed.closes, 14);
    const lastValid = values.filter(v => !isNaN(v));
    return lastValid.length > 0 ? lastValid[lastValid.length - 1] : null;
  }, [parsed, activeIndicators]);

  const macdValues = useMemo(() => {
    if (!parsed || !activeIndicators.has('macd')) return null;
    const result = macd(parsed.closes, 12, 26, 9);
    const lastIdx = result.macd.length - 1;
    if (lastIdx < 0 || isNaN(result.macd[lastIdx])) return null;
    return {
      macd: result.macd[lastIdx],
      signal: result.signal[lastIdx],
      histogram: result.histogram[lastIdx],
    };
  }, [parsed, activeIndicators]);

  const isUp = (priceInfo?.changePct ?? 0) >= 0;

  return (
    <div className="space-y-3">
      {/* ── Price Header Bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative" ref={instrumentSearchRef}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={showInstrumentSearch ? instrumentQuery : instrument}
              onChange={(e) => {
                setInstrumentQuery(e.target.value);
                setShowInstrumentSearch(true);
              }}
              onFocus={() => {
                setInstrumentQuery(instrument);
                setShowInstrumentSearch(true);
              }}
              placeholder="Search..."
              className="input w-44 py-1.5 pl-8 text-sm font-semibold"
            />
            {searchingInstruments && (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-blue-400" />
            )}
          </div>
          {showInstrumentSearch && instrumentResults.length > 0 && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
              {instrumentResults.map((r: InstrumentInfo) => (
                <button
                  key={r.symbol}
                  onClick={() => {
                    setInstrument(r.symbol);
                    setInstrumentMarket(r.market);
                    setShowInstrumentSearch(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-slate-700"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{r.symbol}</span>
                    <span className="ml-2 truncate text-xs text-slate-500">{r.displayName}</span>
                  </div>
                  <span className="ml-2 shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {r.market}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Current Price */}
        {priceInfo && (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-slate-100">
              ${formatPrice(priceInfo.current)}
            </span>
            <span className={`flex items-center gap-0.5 rounded-md px-2 py-0.5 text-sm font-semibold ${
              isUp ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}>
              {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {isUp ? '+' : ''}{priceInfo.changePct.toFixed(2)}%
            </span>
          </div>
        )}

        {/* 24h Stats */}
        {priceInfo && (
          <div className="hidden items-center gap-4 text-[11px] text-slate-500 md:flex">
            <span>24h H: <span className="text-green-400">${formatPrice(priceInfo.high24h)}</span></span>
            <span>24h L: <span className="text-red-400">${formatPrice(priceInfo.low24h)}</span></span>
            <span>Vol: <span className="text-slate-300">{formatLargeNumber(priceInfo.totalVolume)}</span></span>
          </div>
        )}

        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}

        <div className="ml-auto flex items-center gap-2">
          <span className="rounded bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
            LIVE
          </span>
          <button
            onClick={() => setShowTradePanel(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Trade
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          Failed to load chart data: {(error as Error).message}
        </div>
      )}

      {/* ── Chart Area ── */}
      <div
        ref={chartWrapperRef}
        className={`rounded-lg border border-slate-800 bg-[#0b1120] overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}
      >
        {/* Toolbar inside chart area */}
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
          {/* Timeframe Pills */}
          <div className="flex items-center gap-0.5 rounded-md bg-slate-800/50 p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Indicator Chips */}
          <div className="flex items-center gap-1">
            {INDICATORS.map((ind) => {
              const isActive = activeIndicators.has(ind.id);
              return (
                <button
                  key={ind.id}
                  onClick={() => toggleIndicator(ind.id)}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-all ${
                    isActive
                      ? 'text-white'
                      : 'text-slate-600 hover:text-slate-400'
                  }`}
                  style={isActive ? { backgroundColor: ind.color + '20', color: ind.color } : undefined}
                >
                  {ind.label}
                </button>
              );
            })}
          </div>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>

        <div ref={chartContainerRef} className="w-full" />
      </div>

      {/* ── RSI + MACD Panels (below chart) ── */}
      {(activeIndicators.has('rsi') || activeIndicators.has('macd')) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* RSI Panel */}
          {activeIndicators.has('rsi') && rsiValues !== null && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400">RSI (14)</span>
                <span className={`text-lg font-bold ${
                  rsiValues > 70 ? 'text-red-400' : rsiValues < 30 ? 'text-green-400' : 'text-slate-200'
                }`}>
                  {rsiValues.toFixed(1)}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-800">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    rsiValues > 70 ? 'bg-red-500' : rsiValues < 30 ? 'bg-green-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${rsiValues}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                <span>Oversold</span>
                <span>{rsiValues > 70 ? 'OVERBOUGHT' : rsiValues < 30 ? 'OVERSOLD' : 'Neutral'}</span>
                <span>Overbought</span>
              </div>
            </div>
          )}

          {/* MACD Panel */}
          {activeIndicators.has('macd') && macdValues !== null && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <div className="text-xs font-semibold text-slate-400 mb-2">MACD (12, 26, 9)</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-[10px] text-slate-600">MACD</div>
                  <div className={`text-sm font-bold ${macdValues.macd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {macdValues.macd.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">Signal</div>
                  <div className="text-sm font-bold text-blue-400">
                    {macdValues.signal.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600">Histogram</div>
                  <div className={`text-sm font-bold ${macdValues.histogram >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {macdValues.histogram.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-center text-[10px] font-semibold">
                <span className={macdValues.macd > macdValues.signal ? 'text-green-400' : 'text-red-400'}>
                  {macdValues.macd > macdValues.signal ? 'BULLISH CROSSOVER' : 'BEARISH CROSSOVER'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Order Book + Recent Trades ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-400">Order Book</div>
          {bookData ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1.5 flex justify-between text-[10px] font-semibold text-slate-600">
                  <span>BID</span><span>SIZE</span>
                </div>
                {bookData.bids.slice(0, 10).map((bid: CryptoBookEntry, i: number) => {
                  const maxQty = Math.max(...bookData.bids.slice(0, 10).map((b: CryptoBookEntry) => parseFloat(b.quantity)));
                  const pct = (parseFloat(bid.quantity) / maxQty) * 100;
                  return (
                    <div key={i} className="relative flex justify-between py-0.5 text-[11px]">
                      <div className="absolute inset-0 right-0 opacity-15" style={{ background: `linear-gradient(to left, #22c55e ${pct}%, transparent ${pct}%)` }} />
                      <span className="relative font-mono text-green-400">{formatPrice(bid.price)}</span>
                      <span className="relative font-mono text-slate-500">{formatQty(bid.quantity)}</span>
                    </div>
                  );
                })}
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-[10px] font-semibold text-slate-600">
                  <span>ASK</span><span>SIZE</span>
                </div>
                {bookData.asks.slice(0, 10).map((ask: CryptoBookEntry, i: number) => {
                  const maxQty = Math.max(...bookData.asks.slice(0, 10).map((a: CryptoBookEntry) => parseFloat(a.quantity)));
                  const pct = (parseFloat(ask.quantity) / maxQty) * 100;
                  return (
                    <div key={i} className="relative flex justify-between py-0.5 text-[11px]">
                      <div className="absolute inset-0 right-0 opacity-15" style={{ background: `linear-gradient(to left, #ef4444 ${pct}%, transparent ${pct}%)` }} />
                      <span className="relative font-mono text-red-400">{formatPrice(ask.price)}</span>
                      <span className="relative font-mono text-slate-500">{formatQty(ask.quantity)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600">Loading order book...</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-400">Recent Trades</div>
          {tradesData && tradesData.length > 0 ? (
            <div>
              <div className="mb-1.5 grid grid-cols-4 text-[10px] font-semibold text-slate-600">
                <span>PRICE</span><span>SIZE</span><span>SIDE</span><span>TIME</span>
              </div>
              {tradesData.slice(0, 15).map((trade: CryptoTrade, i: number) => (
                <div key={i} className="grid grid-cols-4 py-0.5 text-[11px]">
                  <span className={`font-mono ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPrice(trade.price)}
                  </span>
                  <span className="font-mono text-slate-500">{formatQty(trade.quantity)}</span>
                  <span className={`font-semibold ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.side}
                  </span>
                  <span className="text-slate-600">
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600">Loading trades...</p>
          )}
        </div>
      </div>

      {/* Trade Panel */}
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
