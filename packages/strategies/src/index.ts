export { BaseStrategy } from './base-strategy.js';
export type { IndicatorConfig } from './base-strategy.js';

// Crypto strategies
export { TrendFollowingStrategy } from './crypto/trend-following.js';
export { MeanReversionStrategy } from './crypto/mean-reversion.js';
export { BreakoutStrategy } from './crypto/breakout.js';

// Prediction market strategies
export { PredictionArbitrageStrategy } from './prediction/arbitrage.js';
export { EventDrivenStrategy } from './prediction/event-driven.js';
export { MarketMakingStrategy } from './prediction/market-making.js';

// Equity strategies
export { MomentumStrategy } from './equity/momentum.js';
export { PairsTradingStrategy, calculateSpreadZScore } from './equity/pairs-trading.js';
export { OptionsSpreadStrategy } from './equity/options-spread.js';
