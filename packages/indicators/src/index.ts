// ── Trend ──────────────────────────────────────────────────────────────
export { sma } from './trend/sma.js';
export { ema } from './trend/ema.js';
export { macd } from './trend/macd.js';
export type { MACDResult } from './trend/macd.js';
export { supertrend } from './trend/supertrend.js';
export type { SuperTrendResult } from './trend/supertrend.js';

// ── Momentum ──────────────────────────────────────────────────────────
export { rsi } from './momentum/rsi.js';
export { stochastic } from './momentum/stochastic.js';
export type { StochasticResult } from './momentum/stochastic.js';
export { cci } from './momentum/cci.js';

// ── Volatility ────────────────────────────────────────────────────────
export { bollinger } from './volatility/bollinger.js';
export type { BollingerResult } from './volatility/bollinger.js';
export { atr } from './volatility/atr.js';
export { keltner } from './volatility/keltner.js';
export type { KeltnerResult } from './volatility/keltner.js';

// ── Volume ────────────────────────────────────────────────────────────
export { vwap } from './volume/vwap.js';
export { obv } from './volume/obv.js';
export { volumeProfile } from './volume/volume-profile.js';
export type { VolumeProfileLevel } from './volume/volume-profile.js';

// ── Patterns ──────────────────────────────────────────────────────────
export { detectCandlestickPatterns } from './patterns/candlestick.js';
export type { CandlestickPattern } from './patterns/candlestick.js';
export { fibonacciRetracement, fibonacciExtension } from './patterns/fibonacci.js';
export type { FibonacciLevel } from './patterns/fibonacci.js';
export {
  detectOrderBlocks,
  detectFairValueGaps,
  detectLiquidityZones,
} from './patterns/smart-money.js';
export type {
  OrderBlock,
  FairValueGap,
  LiquidityZone,
} from './patterns/smart-money.js';

// ── Composite ─────────────────────────────────────────────────────────
export { aggregateSignals } from './composite/signal-aggregator.js';
export type { AggregatedSignal } from './composite/signal-aggregator.js';
