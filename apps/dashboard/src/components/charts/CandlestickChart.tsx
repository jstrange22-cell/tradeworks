import { useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts';
import { sma, ema, macd, rsi, bollinger } from '@tradeworks/indicators';
import type { CryptoCandle } from '@/lib/crypto-api';
import { sortCandles, parseCandlesForChart, toLineData } from '@/lib/chart-utils';
import { type IndicatorId, IndicatorToolbar } from './IndicatorToolbar';
import { RsiPanel, MacdPanel } from './IndicatorPanels';

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

  const parsed = useMemo(() => {
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

    if (parsed) {
      candleSeries.setData(parsed.candles);
      volumeSeries.setData(parsed.volumes);
      renderOverlayIndicators(chart, parsed.times, parsed.closes, activeIndicators, indicatorSeriesRef);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: isFullscreen ? window.innerHeight - 80 : 560 });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); chart.remove(); chartRef.current = null; indicatorSeriesRef.current.clear(); };
  }, [instrument, timeframe, parsed, activeIndicators, isFullscreen]);

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

  return (
    <>
      <div ref={chartWrapperRef} className={`rounded-lg border border-slate-800 bg-[#0b1120] overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
        <IndicatorToolbar timeframe={timeframe} onTimeframeChange={onTimeframeChange} activeIndicators={activeIndicators} onToggleIndicator={onToggleIndicator} isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} />
        <div ref={chartContainerRef} className="w-full" />
      </div>
      {(activeIndicators.has('rsi') || activeIndicators.has('macd')) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {activeIndicators.has('rsi') && rsiValue !== null && <RsiPanel value={rsiValue} />}
          {activeIndicators.has('macd') && macdValue !== null && <MacdPanel values={macdValue} />}
        </div>
      )}
    </>
  );
}

/* ── Indicator rendering helper ── */

function renderOverlayIndicators(
  chart: IChartApi,
  times: Time[],
  closes: number[],
  active: Set<IndicatorId>,
  seriesRef: React.MutableRefObject<Map<string, ISeriesApi<'Line' | 'Histogram'>>>,
) {
  if (active.has('sma20')) {
    const s = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceScaleId: 'right' });
    s.setData(toLineData(sma(closes, 20), times)); seriesRef.current.set('sma20', s);
  }
  if (active.has('sma50')) {
    const s = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, priceScaleId: 'right' });
    s.setData(toLineData(sma(closes, 50), times)); seriesRef.current.set('sma50', s);
  }
  if (active.has('ema12')) {
    const s = chart.addLineSeries({ color: '#06b6d4', lineWidth: 1, priceScaleId: 'right' });
    s.setData(toLineData(ema(closes, 12), times)); seriesRef.current.set('ema12', s);
  }
  if (active.has('ema26')) {
    const s = chart.addLineSeries({ color: '#ec4899', lineWidth: 1, priceScaleId: 'right' });
    s.setData(toLineData(ema(closes, 26), times)); seriesRef.current.set('ema26', s);
  }
  if (active.has('boll')) {
    const result = bollinger(closes, 20, 2);
    const upper = chart.addLineSeries({ color: 'rgba(100, 116, 139, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right' });
    const middle = chart.addLineSeries({ color: 'rgba(148, 163, 184, 0.5)', lineWidth: 1, priceScaleId: 'right' });
    const lower = chart.addLineSeries({ color: 'rgba(100, 116, 139, 0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'right' });
    upper.setData(toLineData(result.upper, times)); middle.setData(toLineData(result.middle, times)); lower.setData(toLineData(result.lower, times));
    seriesRef.current.set('boll-upper', upper); seriesRef.current.set('boll-middle', middle); seriesRef.current.set('boll-lower', lower);
  }
}
