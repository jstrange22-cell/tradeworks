import type {
  CandlestickData,
  HistogramData,
  LineData,
  Time,
} from 'lightweight-charts';
import type { CryptoCandle } from '@/lib/crypto-api';

export function sortCandles(candles: CryptoCandle[]): CryptoCandle[] {
  return [...candles].sort((a, b) => a.timestamp - b.timestamp);
}

export function parseCandlesForChart(candles: CryptoCandle[]): {
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

export function toLineData(values: number[], times: Time[]): LineData<Time>[] {
  const data: LineData<Time>[] = [];
  for (let idx = 0; idx < values.length; idx++) {
    if (!isNaN(values[idx])) {
      data.push({ time: times[idx], value: values[idx] });
    }
  }
  return data;
}

export function formatPrice(price: string | number): string {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function formatQty(qty: string): string {
  const q = parseFloat(qty);
  if (q >= 1000) return q.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return q.toFixed(4);
}

export function formatLargeNumber(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
