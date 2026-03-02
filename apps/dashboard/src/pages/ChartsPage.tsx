import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { CandlestickChart, Loader2, ShoppingCart, Search } from 'lucide-react';
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
  { id: 'boll', label: 'Bollinger', color: '#64748b', type: 'overlay' },
  { id: 'rsi', label: 'RSI 14', color: '#a855f7', type: 'panel' },
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
} {
  const chartCandles: CandlestickData<Time>[] = [];
  const chartVolumes: HistogramData<Time>[] = [];
  const times: Time[] = [];
  const closes: number[] = [];

  for (const c of candles) {
    const time = Math.floor(c.timestamp / 1000) as Time;
    times.push(time);
    closes.push(c.close);

    chartCandles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    chartVolumes.push({
      time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
    });
  }

  return { candles: chartCandles, volumes: chartVolumes, times, closes };
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

function formatPrice(price: string): string {
  const p = parseFloat(price);
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatQty(qty: string): string {
  const q = parseFloat(qty);
  if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return q.toFixed(4);
}

export function ChartsPage() {
  const [instrument, setInstrument] = useState('BTC-USD');
  const [instrumentMarket, setInstrumentMarket] = useState<string>('crypto');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set());
  const [showTradePanel, setShowTradePanel] = useState(false);
  const [showInstrumentSearch, setShowInstrumentSearch] = useState(false);
  const { query: instrumentQuery, setQuery: setInstrumentQuery, results: instrumentResults, isLoading: searchingInstruments } = useInstrumentSearch();
  const instrumentSearchRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
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

  const { data: candleData, isLoading, error } = useQuery({
    queryKey: ['candles', instrument, timeframe],
    queryFn: () => getCandlesticks(instrument, timeframe),
    refetchInterval: 60_000,
  });

  const { data: bookData } = useQuery({
    queryKey: ['orderbook', instrument],
    queryFn: () => getOrderBook(instrument, 10),
    refetchInterval: 15_000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ['recent-trades', instrument],
    queryFn: () => getRecentTrades(instrument, 20),
    refetchInterval: 15_000,
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

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true },
      width: chartContainerRef.current.clientWidth,
      height: 500,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });

    // Volume series
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

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
          color: '#64748b', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right',
        });
        const middleSeries = chart.addLineSeries({
          color: '#94a3b8', lineWidth: 1, priceScaleId: 'right',
        });
        const lowerSeries = chart.addLineSeries({
          color: '#64748b', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right',
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
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      indicatorSeriesRef.current.clear();
    };
  }, [instrument, timeframe, parsed, activeIndicators]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CandlestickChart className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Charts</h1>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
            LIVE
          </span>
          <button
            onClick={() => setShowTradePanel(true)}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <ShoppingCart className="h-4 w-4" />
            Trade
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-4">
        <div className="relative flex items-center gap-2" ref={instrumentSearchRef}>
          <label className="text-xs text-slate-500">Instrument:</label>
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
              placeholder="Search BTC, AAPL, ETH..."
              className="input w-52 py-1.5 pl-8 text-sm"
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

        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                timeframe === tf
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          Failed to load chart data: {(error as Error).message}
        </div>
      )}

      {/* Chart */}
      <div className="card p-0 overflow-hidden">
        <div ref={chartContainerRef} className="w-full" />
      </div>

      {/* Indicator Toggles */}
      <div className="card">
        <div className="card-header">Indicators</div>
        <div className="flex flex-wrap gap-2">
          {INDICATORS.map((ind) => {
            const isActive = activeIndicators.has(ind.id);
            return (
              <button
                key={ind.id}
                onClick={() => toggleIndicator(ind.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all border ${
                  isActive
                    ? 'border-current text-white'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
                style={isActive ? { borderColor: ind.color, color: ind.color } : undefined}
              >
                {ind.label}
              </button>
            );
          })}
        </div>

        {/* RSI Panel */}
        {activeIndicators.has('rsi') && rsiValues !== null && (
          <div className="mt-4 rounded-lg bg-slate-800/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">RSI (14)</span>
              <span className={`text-sm font-bold ${
                rsiValues > 70 ? 'text-red-400' : rsiValues < 30 ? 'text-green-400' : 'text-slate-200'
              }`}>
                {rsiValues.toFixed(1)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-700">
              <div
                className={`h-2 rounded-full transition-all ${
                  rsiValues > 70 ? 'bg-red-500' : rsiValues < 30 ? 'bg-green-500' : 'bg-purple-500'
                }`}
                style={{ width: `${rsiValues}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-600">
              <span>0 (Oversold)</span>
              <span>30</span>
              <span>70</span>
              <span>100 (Overbought)</span>
            </div>
          </div>
        )}

        {/* MACD Panel */}
        {activeIndicators.has('macd') && macdValues !== null && (
          <div className="mt-4 rounded-lg bg-slate-800/50 p-3">
            <div className="text-xs text-slate-400 mb-2">MACD (12, 26, 9)</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-slate-500">MACD Line</div>
                <div className={`text-sm font-bold ${macdValues.macd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {macdValues.macd.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Signal</div>
                <div className="text-sm font-bold text-blue-400">
                  {macdValues.signal.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Histogram</div>
                <div className={`text-sm font-bold ${macdValues.histogram >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {macdValues.histogram.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500 text-center">
              {macdValues.macd > macdValues.signal ? 'Bullish crossover' : 'Bearish crossover'}
            </div>
          </div>
        )}
      </div>

      {/* Order Book + Recent Trades */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">Order Book</div>
          {bookData ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-2 flex justify-between text-xs text-slate-500">
                  <span>Bid Price</span><span>Qty</span>
                </div>
                {bookData.bids.slice(0, 8).map((bid: CryptoBookEntry, i: number) => (
                  <div key={i} className="flex justify-between py-0.5 text-xs">
                    <span className="font-mono text-green-400">{formatPrice(bid.price)}</span>
                    <span className="font-mono text-slate-400">{formatQty(bid.quantity)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-2 flex justify-between text-xs text-slate-500">
                  <span>Ask Price</span><span>Qty</span>
                </div>
                {bookData.asks.slice(0, 8).map((ask: CryptoBookEntry, i: number) => (
                  <div key={i} className="flex justify-between py-0.5 text-xs">
                    <span className="font-mono text-red-400">{formatPrice(ask.price)}</span>
                    <span className="font-mono text-slate-400">{formatQty(ask.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Loading order book...</p>
          )}
        </div>

        <div className="card">
          <div className="card-header">Recent Trades</div>
          {tradesData && tradesData.length > 0 ? (
            <div className="space-y-0">
              <div className="mb-2 grid grid-cols-4 text-xs text-slate-500">
                <span>Price</span><span>Qty</span><span>Side</span><span>Time</span>
              </div>
              {tradesData.slice(0, 15).map((trade: CryptoTrade, i: number) => (
                <div key={i} className="grid grid-cols-4 py-0.5 text-xs">
                  <span className={`font-mono ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPrice(trade.price)}
                  </span>
                  <span className="font-mono text-slate-400">{formatQty(trade.quantity)}</span>
                  <span className={trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>
                    {trade.side}
                  </span>
                  <span className="text-slate-500">
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Loading trades...</p>
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
