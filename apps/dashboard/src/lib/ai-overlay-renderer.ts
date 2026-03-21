import {
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  LineStyle,
} from 'lightweight-charts';
import { ema as calcEma } from '@tradeworks/indicators';
import type { AISignalResult } from '@/lib/ai-signal-engine';
import type { CryptoCandle } from '@/lib/crypto-api';


type AISeries = ISeriesApi<'Line'> | ISeriesApi<'Area'>;

function makeTimes(candles: CryptoCandle[]): Time[] {
  return candles.map(c => Math.floor(c.timestamp / 1000) as unknown as Time);
}

type LinePoint = { time: Time; value: number };

function horizontalLine(candles: CryptoCandle[], value: number): LinePoint[] {
  return makeTimes(candles).map(time => ({ time, value }));
}

export function renderAIOverlays(
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
  signal: AISignalResult,
  candles: CryptoCandle[],
): AISeries[] {
  const added: AISeries[] = [];

  // ── Channel: EMA(highs, 8) upper / EMA(lows, 8) lower ───────────────────────
  // Using EMA of actual candle highs/lows means the channel wraps AROUND the
  // candles rather than centering on a lagging close-price EMA. The upper band
  // tracks highs, the lower band tracks lows, and the midline splits them.
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const emaHighs = calcEma(highs, 8);
  const emaLows  = calcEma(lows,  8);
  const times = makeTimes(candles);

  const midPoints: LinePoint[] = [];
  const upperPoints: LinePoint[] = [];
  const lowerPoints: LinePoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const hi = emaHighs[i];
    const lo = emaLows[i];
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    upperPoints.push({ time: times[i], value: hi });
    lowerPoints.push({ time: times[i], value: lo });
    midPoints.push({ time: times[i], value: (hi + lo) / 2 });
  }

  if (midPoints.length > 0) {
    // ── Green zone — upper band fades down, tints area above midline ──────────
    const upperArea = chart.addAreaSeries({
      topColor:    'rgba(34,197,94,0.20)',
      bottomColor: 'rgba(34,197,94,0.0)',
      lineColor:   'rgba(34,197,94,0.70)',
      lineWidth: 1,
      priceScaleId: 'right',
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    upperArea.setData(upperPoints);
    added.push(upperArea as unknown as AISeries);

    // ── Red zone — midline fades down, tints area below midline ──────────────
    const midArea = chart.addAreaSeries({
      topColor:    'rgba(220,38,38,0.22)',
      bottomColor: 'rgba(220,38,38,0.0)',
      lineColor:   '#ef4444',
      lineWidth: 2,
      priceScaleId: 'right',
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    midArea.setData(midPoints);
    added.push(midArea as unknown as AISeries);

    // ── Lower boundary line ───────────────────────────────────────────────────
    const lowerLine = chart.addLineSeries({
      color:     'rgba(153,27,27,0.60)',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceScaleId: 'right',
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    lowerLine.setData(lowerPoints);
    added.push(lowerLine);
  }

  // ── BUY / SELL markers ────────────────────────────────────────────────────
  const markers: SeriesMarker<Time>[] = signal.markers.map(m => ({
    time: m.time as unknown as Time,
    position: m.direction === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
    color: m.direction === 'buy' ? '#22c55e' : '#ef4444',
    shape: m.direction === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
    text: m.direction === 'buy' ? 'BUY 🚀' : 'SELL 🔥',
    size: 2,
  }));

  // Current signal marker on the last bar
  if (signal.direction !== 'neutral' && candles.length > 0) {
    const last = candles[candles.length - 1];
    markers.push({
      time: Math.floor(last.timestamp / 1000) as unknown as Time,
      position: signal.direction === 'buy' ? 'belowBar' : 'aboveBar',
      color: signal.direction === 'buy' ? '#22c55e' : '#ef4444',
      shape: signal.direction === 'buy' ? 'arrowUp' : 'arrowDown',
      text: signal.direction === 'buy' ? 'BUY 🚀' : 'SELL 🔥',
      size: 3,
    });
  }

  markers.sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number));
  candleSeries.setMarkers(markers);

  // ── Entry / SL / TP horizontal levels (only when signal is active) ─────────
  if (signal.direction !== 'neutral') {
    const tpColor = signal.direction === 'buy' ? '#4ade80' : '#f87171';
    const levels: { value: number; color: string; title: string }[] = [
      { value: signal.entryPrice, color: '#94a3b8', title: 'Entry' },
      { value: signal.stopLoss,   color: '#ef4444', title: 'SL'    },
      { value: signal.tp1,        color: tpColor,   title: 'TP1'   },
      { value: signal.tp2,        color: tpColor,   title: 'TP2'   },
      { value: signal.tp3,        color: tpColor,   title: 'TP3'   },
    ];

    for (const lvl of levels) {
      const line = chart.addLineSeries({
        color: lvl.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceScaleId: 'right',
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: lvl.title,
      });
      line.setData(horizontalLine(candles, lvl.value));
      added.push(line);
    }
  }

  // ── Order blocks ──────────────────────────────────────────────────────────
  for (const ob of signal.orderBlocks) {
    const obColor = ob.type === 'bullish' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)';
    const obCandles = candles.filter(c => Math.floor(c.timestamp / 1000) >= ob.time);
    if (obCandles.length === 0) continue;
    for (const val of [ob.high, ob.low]) {
      const s = chart.addLineSeries({
        color: obColor, lineWidth: 1, lineStyle: LineStyle.Dotted,
        priceScaleId: 'right', lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(horizontalLine(obCandles, val));
      added.push(s);
    }
  }

  // ── Fair value gaps ───────────────────────────────────────────────────────
  for (const fvg of signal.fvgs) {
    const fvgColor = fvg.type === 'bullish' ? 'rgba(96,165,250,0.35)' : 'rgba(251,146,60,0.35)';
    const fvgCandles = candles.filter(c => Math.floor(c.timestamp / 1000) >= fvg.time);
    if (fvgCandles.length === 0) continue;
    for (const val of [fvg.high, fvg.low]) {
      const s = chart.addLineSeries({
        color: fvgColor, lineWidth: 1, lineStyle: LineStyle.Dotted,
        priceScaleId: 'right', lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(horizontalLine(fvgCandles, val));
      added.push(s);
    }
  }

  return added;
}

export function clearAIOverlays(candleSeries: ISeriesApi<'Candlestick'>): void {
  candleSeries.setMarkers([]);
}
