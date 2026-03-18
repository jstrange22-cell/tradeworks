/**
 * Shared types for the Multi-Timeframe Technical Analysis Engine.
 */

// ── Candle Data ─────────────────────────────────────────────────────────

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Indicator Output ────────────────────────────────────────────────────

export interface IndicatorSignal {
  name: string;
  value: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-100
}

// ── Market Regime ───────────────────────────────────────────────────────

export type MarketRegime =
  | 'trending_up'
  | 'trending_down'
  | 'ranging'
  | 'high_volatility'
  | 'low_volatility';

// ── Candlestick Patterns ────────────────────────────────────────────────

export interface PatternSignal {
  pattern: string;
  type: 'bullish' | 'bearish' | 'neutral';
  reliability: number; // 0-100
}

// ── Timeframe Definitions ───────────────────────────────────────────────

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  '1m': 0.05,
  '5m': 0.15,
  '15m': 0.25,
  '1h': 0.30,
  '4h': 0.25,
};

/** Minimum candles required for a timeframe to be included */
export const MIN_CANDLES_REQUIRED = 20;

// ── Analysis Result ─────────────────────────────────────────────────────

export interface AnalysisResult {
  /** Composite score 0-100 (higher = more bullish) */
  score: number;
  /** All indicator signals across timeframes */
  signals: IndicatorSignal[];
  /** Detected market regime */
  regime: MarketRegime;
  /** Per-timeframe scores */
  timeframeScores: Record<string, number>;
  /** Candle counts per timeframe (for transparency) */
  candleCount: Record<string, number>;
}
