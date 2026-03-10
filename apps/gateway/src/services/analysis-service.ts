// ---------------------------------------------------------------------------
// Analysis Service — Technical indicators and instrument analysis
// ---------------------------------------------------------------------------

import { fetchTicker, fetchCandles } from './market-data-service.js';

// Inline SMA — average of last N values
export function calcSma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Inline RSI — relative strength index
export function calcRsi(values: number[], period: number): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface InstrumentAnalysis {
  instrument: string;
  price: number;
  change24h: number;
  sma20: number;
  rsiValue: number;
  priceAboveSma: boolean;
  signals: Array<{ indicator: string; direction: 'long' | 'short'; confidence: number }>;
}

export async function analyzeInstrument(instrument: string): Promise<InstrumentAnalysis | null> {
  const [ticker, closes] = await Promise.all([
    fetchTicker(instrument),
    fetchCandles(instrument),
  ]);

  if (!ticker || closes.length < 25) return null;

  const currentPrice = ticker.last;
  const sma20 = calcSma(closes, 20);
  const rsiValue = calcRsi(closes, 14);
  const priceAboveSma = currentPrice > sma20;

  const signals: InstrumentAnalysis['signals'] = [];

  // SMA 20 Trend signal
  const smaDistance = (currentPrice - sma20) / sma20;
  if (Math.abs(smaDistance) > 0.005) {
    signals.push({
      indicator: 'SMA 20 Trend',
      direction: smaDistance > 0 ? 'long' : 'short',
      confidence: Math.round(Math.min(0.5 + Math.abs(smaDistance) * 8, 0.9) * 100) / 100,
    });
  }

  // RSI signal
  if (rsiValue < 30) {
    signals.push({
      indicator: 'RSI Oversold',
      direction: 'long',
      confidence: Math.round(Math.min(0.6 + (30 - rsiValue) / 80, 0.85) * 100) / 100,
    });
  } else if (rsiValue > 70) {
    signals.push({
      indicator: 'RSI Overbought',
      direction: 'short',
      confidence: Math.round(Math.min(0.6 + (rsiValue - 70) / 80, 0.85) * 100) / 100,
    });
  }

  // 24h Momentum signal
  if (Math.abs(ticker.change24h) > 0.02) {
    signals.push({
      indicator: '24h Momentum',
      direction: ticker.change24h > 0 ? 'long' : 'short',
      confidence: Math.round(Math.min(0.5 + Math.abs(ticker.change24h) * 3, 0.85) * 100) / 100,
    });
  }

  return { instrument, price: currentPrice, change24h: ticker.change24h, sma20, rsiValue, priceAboveSma, signals };
}
