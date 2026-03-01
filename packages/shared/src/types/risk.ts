export interface RiskSnapshot {
  id: string;
  portfolioId: string;
  timestamp: Date;
  totalEquity: number;
  cashBalance: number;
  grossExposure: number;
  netExposure: number;
  var95: number | null;
  var99: number | null;
  maxDrawdown: number | null;
  dailyPnl: number;
  sharpe30d: number | null;
  portfolioHeat: number;
  positionsCount: number;
  circuitBreaker: boolean;
  metadata: Record<string, unknown>;
}

export interface RiskLimits {
  maxRiskPerTrade: number; // 0.01 = 1%
  dailyLossCap: number; // 0.03 = 3%
  weeklyLossCap: number; // 0.07 = 7%
  maxPortfolioHeat: number; // 0.06 = 6%
  minRiskReward: number; // 3.0 = 1:3
  maxCorrelationExposure: number; // 0.40 = 40%
  maxPerMarketAllocation: Record<string, number>;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPerTrade: 0.01,
  dailyLossCap: 0.03,
  weeklyLossCap: 0.07,
  maxPortfolioHeat: 0.06,
  minRiskReward: 3.0,
  maxCorrelationExposure: 0.40,
  maxPerMarketAllocation: {
    crypto: 0.40,
    prediction: 0.30,
    equity: 0.40,
  },
};

export interface PositionSizeParams {
  totalCapital: number;
  riskPercentage: number;
  entryPrice: number;
  stopLossPrice: number;
}

export interface PositionSizeResult {
  positionSize: number;
  riskAmount: number;
  stopLossDistance: number;
  riskRewardRatio: number | null;
}

export interface Guardrail {
  id: string;
  guardrailType: 'daily_loss' | 'per_trade' | 'weekly_loss' | 'address_whitelist' | 'max_position';
  value: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CircuitBreakerState {
  triggered: boolean;
  reason: string | null;
  triggeredAt: Date | null;
  dailyPnl: number;
  weeklyPnl: number;
  portfolioHeat: number;
  maxDrawdownCurrent: number;
}
