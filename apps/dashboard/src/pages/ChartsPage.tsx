import { useEffect, useRef, useState, useCallback } from 'react';
import { CandlestickChart, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  ColorType,
} from 'lightweight-charts';
import {
  getCandlesticks,
  getOrderBook,
  getRecentTrades,
  type CryptoCandle,
  type CryptoBookEntry,
  type CryptoTrade,
} from '@/lib/crypto-api';

const CRYPTO_INSTRUMENTS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'AVAX-USD',
  'LINK-USD',
  'DOGE-USD',
  'ADA-USD',
  'DOT-USD',
  'CRO-USD',
];

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

function parseCandles(candles: CryptoCandle[]): {
  candles: CandlestickData<Time>[];
  volumes: HistogramData<Time>[];
} {
  const chartCandles: CandlestickData<Time>[] = [];
  const chartVolumes: HistogramData<Time>[] = [];

  // Sort ascending by timestamp (oldest first) for the chart library
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  for (const c of sorted) {
    const time = Math.floor(c.timestamp / 1000) as Time;

    chartCandles.push({
      time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
    chartVolumes.push({
      time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
    });
  }

  return { candles: chartCandles, volumes: chartVolumes };
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
  const [timeframe, setTimeframe] = useState<string>('1h');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Fetch live candle data
  const { data: candleData, isLoading, error } = useQuery({
    queryKey: ['candles', instrument, timeframe],
    queryFn: () => getCandlesticks(instrument, timeframe),
    refetchInterval: timeframe === '1m' ? 10_000 : 30_000,
  });

  // Fetch order book
  const { data: bookData } = useQuery({
    queryKey: ['orderbook', instrument],
    queryFn: () => getOrderBook(instrument, 10),
    refetchInterval: 5_000,
  });

  // Fetch recent trades
  const { data: tradesData } = useQuery({
    queryKey: ['recent-trades', instrument],
    queryFn: () => getRecentTrades(instrument, 20),
    refetchInterval: 5_000,
  });

  const initChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true },
      width: chartContainerRef.current.clientWidth,
      height: 500,
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeriesRef.current = volumeSeries;

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    return chart;
  }, []);

  useEffect(() => {
    const chart = initChart();
    if (!chart) return;

    if (candleData && candleData.length > 0) {
      const { candles, volumes } = parseCandles(candleData);
      candleSeriesRef.current?.setData(candles);
      volumeSeriesRef.current?.setData(volumes);
      chart.timeScale().fitContent();
    }

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
    };
  }, [instrument, timeframe, candleData, initChart]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CandlestickChart className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Charts</h1>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
        <span className="ml-auto rounded bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
          LIVE
        </span>
      </div>

      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Instrument:</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="input py-1.5 text-sm"
          >
            {CRYPTO_INSTRUMENTS.map((inst) => (
              <option key={inst} value={inst}>{inst}</option>
            ))}
          </select>
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

      {/* Order Book + Recent Trades side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Order Book */}
        <div className="card">
          <div className="card-header">Order Book</div>
          {bookData ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-2 flex justify-between text-xs text-slate-500">
                  <span>Bid Price</span>
                  <span>Qty</span>
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
                  <span>Ask Price</span>
                  <span>Qty</span>
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

        {/* Recent Trades */}
        <div className="card">
          <div className="card-header">Recent Trades</div>
          {tradesData && tradesData.length > 0 ? (
            <div className="space-y-0">
              <div className="mb-2 grid grid-cols-4 text-xs text-slate-500">
                <span>Price</span>
                <span>Qty</span>
                <span>Side</span>
                <span>Time</span>
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

      {/* Indicators */}
      <div className="card">
        <div className="card-header">Indicators</div>
        <div className="flex flex-wrap gap-2">
          {['SMA 20', 'SMA 50', 'EMA 12', 'EMA 26', 'RSI 14', 'MACD', 'Bollinger Bands', 'VWAP', 'ATR'].map(
            (indicator) => (
              <button
                key={indicator}
                className="btn-ghost rounded-full px-3 py-1 text-xs"
              >
                {indicator}
              </button>
            ),
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Indicator overlays coming soon. Click to toggle on the chart.
        </p>
      </div>
    </div>
  );
}
