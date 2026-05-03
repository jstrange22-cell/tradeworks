/**
 * Deterministic scoring for the candidate universe.
 *
 * The scout picks tickers most likely to fire actionable TradeVisor signals
 * in the near term. TradeVisor V2 is a Keltner-channel-based pullback engine
 * — it rewards range expansion, momentum continuation, and volatility
 * breakouts. We score on three axes that correlate with that:
 *
 *   1. Momentum     — 5d/20d/60d returns vs SPY (relative strength)
 *   2. Vol expansion — current ATR vs 60d-avg ATR (>1.0 = expanding)
 *   3. Liquidity     — avg dollar volume (filter, not score)
 *
 * Final score is a weighted blend; ties broken by recency of breakout.
 */

import YahooFinance from 'yahoo-finance2';
import { yahooFormat } from './universe.js';

// yahoo-finance2 v3 requires explicit instantiation. One client is reused for
// all requests so any internal cookie/CSRF state is shared and we don't get
// re-throttled per call.
const yahooFinance = new YahooFinance();

export interface CandleSet {
  ticker: string;
  // Most-recent-last. Each: open, high, low, close, volume
  candles: Array<{ date: Date; open: number; high: number; low: number; close: number; volume: number }>;
}

export interface ScoredTicker {
  ticker: string;
  score: number;
  rs5d: number; // 5d return minus SPY 5d return
  rs20d: number;
  atrExpansion: number; // current ATR / 60d avg ATR
  avgDollarVol: number;
  reason: string;
}

// 200 calendar days gives us ~140 trading days — enough for a meaningful
// 60d ATR baseline against a 14d recent ATR. With an 80d lookback, the 60d
// ATR was hitting the "not enough data" fallback and atrExp collapsed to 1.0.
const LOOKBACK_DAYS = 200;

export async function fetchCandles(ticker: string): Promise<CandleSet | null> {
  try {
    const result = await yahooFinance.chart(yahooFormat(ticker), {
      period1: new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
      interval: '1d',
    });
    const quotes = result.quotes ?? [];
    const candles = quotes
      .filter((q) => q.open != null && q.close != null && q.high != null && q.low != null)
      .map((q) => ({
        date: q.date,
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
        volume: q.volume ?? 0,
      }));
    if (candles.length < 30) return null;
    return { ticker, candles };
  } catch {
    return null;
  }
}

function periodReturn(candles: CandleSet['candles'], days: number): number {
  if (candles.length < days + 1) return 0;
  const latest = candles[candles.length - 1]!.close;
  const prior = candles[candles.length - 1 - days]!.close;
  if (prior <= 0) return 0;
  return (latest - prior) / prior;
}

function trueRange(c: CandleSet['candles'][number], prev: CandleSet['candles'][number] | undefined): number {
  if (!prev) return c.high - c.low;
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prev.close),
    Math.abs(c.low - prev.close),
  );
}

function atr(candles: CandleSet['candles'], period: number): number {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(trueRange(candles[i]!, candles[i - 1]));
  }
  if (trs.length < period) return 0;
  const recent = trs.slice(-period);
  return recent.reduce((s, x) => s + x, 0) / recent.length;
}

function avgDollarVolume(candles: CandleSet['candles'], days: number): number {
  const tail = candles.slice(-days);
  if (tail.length === 0) return 0;
  const sum = tail.reduce((s, c) => s + c.close * c.volume, 0);
  return sum / tail.length;
}

export function scoreCandidate(set: CandleSet, spy: CandleSet | null): ScoredTicker {
  const c = set.candles;
  const r5 = periodReturn(c, 5);
  const r20 = periodReturn(c, 20);
  const r60 = periodReturn(c, 60);

  const spyR5 = spy ? periodReturn(spy.candles, 5) : 0;
  const spyR20 = spy ? periodReturn(spy.candles, 20) : 0;

  const rs5 = r5 - spyR5;
  const rs20 = r20 - spyR20;

  const atr14 = atr(c, 14);
  const atr60 = atr(c, 60);
  const atrExp = atr60 > 0 ? atr14 / atr60 : 1;

  const dollarVol = avgDollarVolume(c, 20);

  // Composite score: momentum dominates, vol expansion is a secondary kicker.
  // We accept negative momentum as a SHORT candidate too (TradeVisor fires
  // SELL signals). Use absolute value to favor strong moves in either dir.
  const momentumScore = Math.abs(rs5) * 0.35 + Math.abs(rs20) * 0.45 + Math.abs(r60) * 0.2;
  const volScore = Math.max(0, atrExp - 1.0); // 0 if contracting, positive if expanding
  const composite = momentumScore + volScore * 0.5;

  const dir = rs20 >= 0 ? 'long-bias' : 'short-bias';
  const reason = [
    `rs5d=${(rs5 * 100).toFixed(1)}%`,
    `rs20d=${(rs20 * 100).toFixed(1)}%`,
    `atrExp=${atrExp.toFixed(2)}x`,
    dir,
  ].join(' ');

  return {
    ticker: set.ticker,
    score: composite,
    rs5d: rs5,
    rs20d: rs20,
    atrExpansion: atrExp,
    avgDollarVol: dollarVol,
    reason,
  };
}

const MIN_DOLLAR_VOLUME = 50_000_000; // $50M/day — eliminates illiquid names

export function liquidityFilter(scored: ScoredTicker[]): ScoredTicker[] {
  return scored.filter((s) => s.avgDollarVol >= MIN_DOLLAR_VOLUME);
}

export function rankAndTake(scored: ScoredTicker[], n: number): ScoredTicker[] {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, n);
}
