import type { Timeframe } from '../types/market-data.js';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '4h': 14_400,
  '1d': 86_400,
  '1w': 604_800,
};

export const ENGINE_CYCLE_INTERVAL_MS = 300_000; // 5 minutes
export const RISK_SNAPSHOT_INTERVAL_MS = 60_000; // 1 minute
export const EQUITY_CURVE_INTERVAL_MS = 300_000; // 5 minutes
export const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds
