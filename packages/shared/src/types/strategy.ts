import type { MarketType } from './market-data.js';

export type StrategyType =
  | 'trend_following'
  | 'mean_reversion'
  | 'breakout'
  | 'momentum'
  | 'pairs_trading'
  | 'options_spread'
  | 'arbitrage'
  | 'event_driven'
  | 'market_making'
  | 'ema_crossover'
  | 'rsi_divergence'
  | 'bollinger_squeeze'
  | 'macd_histogram_reversal'
  | 'vwap_reversion'
  | 'supertrend'
  | 'smart_money_concepts'
  | 'multi_timeframe_momentum';

export interface Strategy {
  id: string;
  name: string;
  market: MarketType;
  strategyType: StrategyType;
  params: Record<string, unknown>;
  enabled: boolean;
  maxAllocation: number; // max % of portfolio (e.g. 10.00)
  riskPerTrade: number; // e.g. 0.01 = 1%
  minRiskReward: number; // e.g. 3.0 = 1:3
  createdAt: Date;
  updatedAt: Date;
}

export interface IndicatorSignal {
  indicator: string;
  value: number;
  signal: 'buy' | 'sell' | 'neutral';
  confidence: number; // 0-1
}

export interface TradingSignal {
  instrument: string;
  market: MarketType;
  action: 'buy' | 'sell' | 'hold' | 'close';
  confidence: number; // 0-1
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  indicators: IndicatorSignal[];
  reasoning: string;
  strategyId: string;
  timestamp: number;
}

export interface StrategyParams {
  [key: string]: number | string | boolean | number[];
}

export interface BacktestRun {
  id: string;
  strategyId: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number | null;
  totalTrades: number | null;
  winRate: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number | null;
  profitFactor: number | null;
  calmarRatio: number | null;
  params: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  results: Record<string, unknown> | null;
  createdAt: Date;
}
