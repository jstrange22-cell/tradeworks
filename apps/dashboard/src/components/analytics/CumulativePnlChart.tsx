import { useEffect, useRef, useMemo } from 'react';
import { createChart, type IChartApi, ColorType, LineStyle } from 'lightweight-charts';
import { TrendingUp } from 'lucide-react';
import type { TradeData } from '@/types/analytics';

interface CumulativePnlChartProps {
  trades: TradeData[];
}

export function CumulativePnlChart({ trades }: CumulativePnlChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const lineData = useMemo(() => {
    if (trades.length === 0) return [];
    const sorted = [...trades].sort((a, b) =>
      new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
    );
    // Build cumulative series, then deduplicate timestamps (keep last value per second)
    let cumulative = 0;
    const byTime = new Map<number, number>();
    for (const t of sorted) {
      cumulative += t.pnl;
      const sec = Math.floor(new Date(t.executedAt).getTime() / 1000);
      byTime.set(sec, cumulative);
    }
    return Array.from(byTime.entries())
      .sort(([a], [b]) => a - b)
      .map(([sec, value]) => ({
        time: sec as unknown as import('lightweight-charts').Time,
        value,
      }));
  }, [trades]);

  const finalPnl = lineData.length > 0 ? lineData[lineData.length - 1].value : 0;
  const isPositive = finalPnl >= 0;

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(51,65,85,0.3)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(51,65,85,0.3)', style: LineStyle.Dotted },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(51,65,85,0.5)' },
      timeScale: { borderColor: 'rgba(51,65,85,0.5)', timeVisible: true },
      height: 200,
    });

    chartRef.current = chart;

    const series = chart.addLineSeries({
      color: isPositive ? '#4ade80' : '#f87171',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    if (lineData.length > 0) {
      series.setData(lineData);
      chart.timeScale().fitContent();
    }

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [lineData, isPositive]);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <TrendingUp className="h-4 w-4 text-blue-400" />
          Cumulative P&amp;L
        </div>
        <span className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}${finalPnl.toFixed(2)}
        </span>
      </div>
      {lineData.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">
          No trade data yet
        </div>
      ) : (
        <div ref={containerRef} className="w-full" />
      )}
    </div>
  );
}
