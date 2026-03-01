import { useEffect, useRef, useState } from 'react';
import { CandlestickChart } from 'lucide-react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  ColorType,
} from 'lightweight-charts';

const INSTRUMENTS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'AVAX-USD',
  'LINK-USD',
  'AAPL',
  'MSFT',
  'NVDA',
  'SPY',
  'QQQ',
];

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

// Generate mock candlestick data
function generateCandleData(
  instrument: string,
  _timeframe: string,
  count: number,
): { candles: CandlestickData<Time>[]; volumes: HistogramData<Time>[] } {
  const candles: CandlestickData<Time>[] = [];
  const volumes: HistogramData<Time>[] = [];

  let basePrice: number;
  if (instrument.includes('BTC')) basePrice = 96000;
  else if (instrument.includes('ETH')) basePrice = 3400;
  else if (instrument.includes('SOL')) basePrice = 185;
  else if (instrument.includes('AVAX')) basePrice = 42;
  else if (instrument.includes('LINK')) basePrice = 18;
  else if (instrument === 'AAPL') basePrice = 240;
  else if (instrument === 'MSFT') basePrice = 420;
  else if (instrument === 'NVDA') basePrice = 875;
  else if (instrument === 'SPY') basePrice = 600;
  else if (instrument === 'QQQ') basePrice = 510;
  else basePrice = 100;

  let current = basePrice;

  for (let i = 0; i < count; i++) {
    const timestamp = (Math.floor(Date.now() / 1000) - (count - i) * 3600) as Time;
    const change = (Math.random() - 0.48) * (basePrice * 0.01);
    const open = current;
    const close = current + change;
    const high = Math.max(open, close) + Math.random() * Math.abs(change) * 0.5;
    const low = Math.min(open, close) - Math.random() * Math.abs(change) * 0.5;
    const volume = Math.random() * 1000000 + 100000;

    candles.push({
      time: timestamp,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
    });

    volumes.push({
      time: timestamp,
      value: volume,
      color: close >= open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
    });

    current = close;
  }

  return { candles, volumes };
}

export function ChartsPage() {
  const [instrument, setInstrument] = useState('BTC-USD');
  const [timeframe, setTimeframe] = useState<string>('1h');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up previous chart
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
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    // Volume series
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume',
    });
    volumeSeriesRef.current = volumeSeries;

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    // Generate and set data
    const { candles, volumes } = generateCandleData(instrument, timeframe, 200);
    candleSeries.setData(candles);
    volumeSeries.setData(volumes);

    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [instrument, timeframe]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CandlestickChart className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Charts</h1>
      </div>

      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-4">
        {/* Instrument Selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Instrument:</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="input py-1.5 text-sm"
          >
            {INSTRUMENTS.map((inst) => (
              <option key={inst} value={inst}>
                {inst}
              </option>
            ))}
          </select>
        </div>

        {/* Timeframe Selector */}
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

      {/* Chart */}
      <div className="card p-0 overflow-hidden">
        <div ref={chartContainerRef} className="w-full" />
      </div>

      {/* Placeholder for indicators */}
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
          Indicator overlays will be rendered on the chart when the API connection is active.
        </p>
      </div>
    </div>
  );
}
