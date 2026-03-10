import { useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts';
import {
  sma,
  ema,
  macd,
  rsi,
  bollinger,
  supertrend,
  vwap,
  keltner,
  stochastic,
  cci,
  obv,
} from '@tradeworks/indicators';
import type { CryptoCandle } from '@/lib/crypto-api';
import { sortCandles, parseCandlesForChart, toLineData } from '@/lib/chart-utils';
import { type IndicatorId, IndicatorToolbar } from './IndicatorToolbar';
import { RsiPanel, MacdPanel, StochasticPanel, CciPanel, ObvPanel } from './IndicatorPanels';

interface ParsedChartData {
  candles: ReturnType<typeof parseCandlesForChart>['candles'];
  volumes: ReturnType<typeof parseCandlesForChart>['volumes'];
  times: Time[];
  closes: number[];
  highs: number[];
  lows: number[];
  opens: number[];
}

interface CandlestickChartProps {
  instrument: string;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  candleData: CryptoCandle[] | undefined;
  activeIndicators: Set<IndicatorId>;
  onToggleIndicator: (id: IndicatorId) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  chartWrapperRef: React.RefObject<HTMLDivElement | null>;
}

export function CandlestickChart({
  instrument,
  timeframe,
  onTimeframeChange,
  candleData,
  activeIndicators,
  onToggleIndicator,
  isFullscreen,
  onToggleFullscreen,
  chartWrapperRef,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line' | 'Histogram'>>>(new Map());

  const sortedCandles = useMemo(() => {
    if (!candleData || candleData.length === 0) return null;
    return sortCandles(candleData);
  }, [candleData]);

  const parsed = useMemo<ParsedChartData | null>(() => {
    if (!sortedCandles) return null;
    return parseCandlesForChart(sortedCandles);
  }, [sortedCandles]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      indicatorSeriesRef.current.clear();
    }

    const chartHeight = isFullscreen ? window.innerHeight - 80 : 560;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0b1120' }, textColor: '#64748b', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(30, 41, 59, 0.5)' }, horzLines: { color: 'rgba(30, 41, 59, 0.5)' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(100, 116, 139, 0.4)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
        horzLine: { color: 'rgba(100, 116, 139, 0.4)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#1e293b', scaleMargins: { top: 0.1, bottom: 0.2 } },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false, barSpacing: 8 },
      width: chartContainerRef.current.clientWidth,
      height: chartHeight,
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#4ade80', wickDownColor: '#f87171',
    });
    const volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    if (parsed && sortedCandles) {
      candleSeries.setData(parsed.candles);
      volumeSeries.setData(parsed.volumes);
      renderOverlayIndicators(chart, parsed, sortedCandles, activeIndicators, indicatorSeriesRef);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: isFullscreen ? window.innerHeight - 80 : 560 });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); chart.remove(); chartRef.current = null; indicatorSeriesRef.current.clear(); };
  }, [instrument, timeframe, parsed, sortedCandles, activeIndicators, isFullscreen]);

  /* ── Panel value computations ── */

  const rsiValue = useMemo(() => {
    if (!parsed || !activeIndicators.has('rsi')) return null;
    const values = rsi(parsed.closes, 14);
    const lastValid = values.filter(v => !isNaN(v));
    return lastValid.length > 0 ? lastValid[lastValid.length - 1] : null;
  }, [parsed, activeIndicators]);

  const macdValue = useMemo(() => {
    if (!parsed || !activeIndicators.has('macd')) return null;
    const result = macd(parsed.closes, 12, 26, 9);
    const lastIdx = result.macd.length - 1;
    if (lastIdx < 0 || isNaN(result.macd[lastIdx])) return null;
    return { macd: result.macd[lastIdx], signal: result.signal[lastIdx], histogram: result.histogram[lastIdx] };
  }, [parsed, activeIndicators]);

  const stochasticValue = useMemo(() => {
    if (!sortedCandles || !activeIndicators.has('stochastic')) return null;
    const result = stochastic(sortedCandles, 14, 3);
    const lastK = findLastValid(result.k);
    const lastD = findLastValid(result.d);
    if (lastK === null || lastD === null) return null;
    return { k: lastK, d: lastD };
  }, [sortedCandles, activeIndicators]);

  const cciValue = useMemo(() => {
    if (!sortedCandles || !activeIndicators.has('cci')) return null;
    const values = cci(sortedCandles, 20);
    return findLastValid(values);
  }, [sortedCandles, activeIndicators]);

  const obvValue = useMemo(() => {
    if (!sortedCandles || !activeIndicators.has('obv')) return null;
    const values = obv(sortedCandles);
    if (values.length < 2) return null;
    const current = values[values.length - 1];
    const previous = values[values.length - 2];
    // Determine trend using a 5-period lookback
    const lookback = Math.min(5, values.length - 1);
    const older = values[values.length - 1 - lookback];
    const diff = current - older;
    const threshold = Math.abs(older) * 0.005; // 0.5% threshold for "flat"
    const trend: 'rising' | 'falling' | 'flat' =
      diff > threshold ? 'rising' : diff < -threshold ? 'falling' : 'flat';
    return { current, previous, trend };
  }, [sortedCandles, activeIndicators]);

  const hasPanels = activeIndicators.has('rsi') || activeIndicators.has('macd')
    || activeIndicators.has('stochastic') || activeIndicators.has('cci')
    || activeIndicators.has('obv');

  return (
    <>
      <div ref={chartWrapperRef} className={`rounded-lg border border-slate-800 bg-[#0b1120] overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
        <IndicatorToolbar timeframe={timeframe} onTimeframeChange={onTimeframeChange} activeIndicators={activeIndicators} onToggleIndicator={onToggleIndicator} isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} />
        <div ref={chartContainerRef} className="w-full" />
      </div>
      {hasPanels && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeIndicators.has('rsi') && rsiValue !== null && <RsiPanel value={rsiValue} />}
          {activeIndicators.has('macd') && macdValue !== null && <MacdPanel values={macdValue} />}
          {activeIndicators.has('stochastic') && stochasticValue !== null && <StochasticPanel values={stochasticValue} />}
          {activeIndicators.has('cci') && cciValue !== null && <CciPanel value={cciValue} />}
          {activeIndicators.has('obv') && obvValue !== null && <ObvPanel values={obvValue} />}
        </div>
      )}
    </>
  );
}

/* ── Helpers ── */

function findLastValid(values: number[]): number | null {
  for (let idx = values.length - 1; idx >= 0; idx--) {
    if (!isNaN(values[idx])) return values[idx];
  }
  return null;
}

function toColoredLineData(
  values: number[],
  directions: number[],
  times: Time[],
  upColor: string,
  downColor: string,
): LineData<Time>[] {
  const data: LineData<Time>[] = [];
  for (let idx = 0; idx < values.length; idx++) {
    if (!isNaN(values[idx])) {
      data.push({
        time: times[idx],
        value: values[idx],
        color: directions[idx] === 1 ? upColor : downColor,
      });
    }
  }
  return data;
}

/* ── Overlay indicator rendering ── */

function renderOverlayIndicators(
  chart: IChartApi,
  parsed: ParsedChartData,
  rawCandles: CryptoCandle[],
  active: Set<IndicatorId>,
  seriesRef: React.MutableRefObject<Map<string, ISeriesApi<'Line' | 'Histogram'>>>,
) {
  const { times, closes } = parsed;

  // SMA 20
  if (active.has('sma20')) {
    const lineSeries = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceScaleId: 'right' });
    lineSeries.setData(toLineData(sma(closes, 20), times));
    seriesRef.current.set('sma20', lineSeries);
  }

  // SMA 50
  if (active.has('sma50')) {
    const lineSeries = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, priceScaleId: 'right' });
    lineSeries.setData(toLineData(sma(closes, 50), times));
    seriesRef.current.set('sma50', lineSeries);
  }

  // EMA 12
  if (active.has('ema12')) {
    const lineSeries = chart.addLineSeries({ color: '#06b6d4', lineWidth: 1, priceScaleId: 'right' });
    lineSeries.setData(toLineData(ema(closes, 12), times));
    seriesRef.current.set('ema12', lineSeries);
  }

  // EMA 26
  if (active.has('ema26')) {
    const lineSeries = chart.addLineSeries({ color: '#ec4899', lineWidth: 1, priceScaleId: 'right' });
    lineSeries.setData(toLineData(ema(closes, 26), times));
    seriesRef.current.set('ema26', lineSeries);
  }

  // Bollinger Bands
  if (active.has('boll')) {
    const result = bollinger(closes, 20, 2);
    const upper = chart.addLineSeries({ color: 'rgba(100, 116, 139, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right' });
    const middle = chart.addLineSeries({ color: 'rgba(148, 163, 184, 0.5)', lineWidth: 1, priceScaleId: 'right' });
    const lower = chart.addLineSeries({ color: 'rgba(100, 116, 139, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right' });
    upper.setData(toLineData(result.upper, times));
    middle.setData(toLineData(result.middle, times));
    lower.setData(toLineData(result.lower, times));
    seriesRef.current.set('boll-upper', upper);
    seriesRef.current.set('boll-middle', middle);
    seriesRef.current.set('boll-lower', lower);
  }

  // SuperTrend — color changes based on trend direction (cyan=up, red=down)
  if (active.has('supertrend')) {
    const result = supertrend(rawCandles, 10, 3);
    const lineSeries = chart.addLineSeries({ color: '#22d3ee', lineWidth: 2, priceScaleId: 'right' });
    lineSeries.setData(toColoredLineData(result.trend, result.direction, times, '#22d3ee', '#ef4444'));
    seriesRef.current.set('supertrend', lineSeries);
  }

  // VWAP — pink/magenta line
  if (active.has('vwap')) {
    const result = vwap(rawCandles);
    const lineSeries = chart.addLineSeries({ color: '#f472b6', lineWidth: 2, priceScaleId: 'right' });
    // Filter out zero values (VWAP returns 0 when cumulative volume is 0)
    const vwapLineData: LineData<Time>[] = [];
    for (let idx = 0; idx < result.length; idx++) {
      if (result[idx] > 0) {
        vwapLineData.push({ time: times[idx], value: result[idx] });
      }
    }
    lineSeries.setData(vwapLineData);
    seriesRef.current.set('vwap', lineSeries);
  }

  // Keltner Channels — 3 teal lines (upper/middle/lower)
  if (active.has('keltner')) {
    const result = keltner(rawCandles, 20, 10, 2);
    const upper = chart.addLineSeries({ color: 'rgba(45, 212, 191, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right' });
    const middle = chart.addLineSeries({ color: 'rgba(45, 212, 191, 0.8)', lineWidth: 1, priceScaleId: 'right' });
    const lower = chart.addLineSeries({ color: 'rgba(45, 212, 191, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right' });
    upper.setData(toLineData(result.upper, times));
    middle.setData(toLineData(result.middle, times));
    lower.setData(toLineData(result.lower, times));
    seriesRef.current.set('keltner-upper', upper);
    seriesRef.current.set('keltner-middle', middle);
    seriesRef.current.set('keltner-lower', lower);
  }
}
