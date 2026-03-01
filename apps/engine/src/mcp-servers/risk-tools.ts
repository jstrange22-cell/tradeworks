import type { EngineTradeDecision } from '../orchestrator.js';
import type { EnginePosition } from '../engines/crypto/coinbase-engine.js';

/**
 * MCP tool definitions for risk management.
 * These tools are exposed to the Risk Guardian agent.
 */

export interface RiskCheckResult {
  passed: boolean;
  reason: string;
  checks: Array<{
    name: string;
    passed: boolean;
    value: number;
    limit: number;
    message: string;
  }>;
}

export interface PortfolioHeat {
  totalHeat: number; // Sum of all position risks as % of equity
  positionHeat: Array<{
    instrument: string;
    heat: number; // Risk as % of equity
    riskAmount: number; // Dollar risk
  }>;
  correlationAdjustedHeat: number;
  heatLimit: number; // Maximum allowed heat
  headroom: number; // Remaining heat capacity
}

export interface PositionSizeResult {
  instrument: string;
  recommendedSize: number;
  maxSize: number;
  riskPerUnit: number;
  totalRisk: number;
  riskPercent: number;
  method: string;
}

export interface VaRResult {
  oneDay: number; // 1-day VaR in dollars
  fiveDay: number; // 5-day VaR in dollars
  oneDayPercent: number; // 1-day VaR as % of portfolio
  fiveDayPercent: number; // 5-day VaR as % of portfolio
  confidenceLevel: number; // Usually 0.95 or 0.99
  method: 'historical' | 'parametric' | 'monte_carlo';
}

/**
 * Validate a proposed trade against all risk limits.
 */
export async function checkRisk(params: {
  decision: EngineTradeDecision;
  portfolioEquity: number;
  openPositions: EnginePosition[];
  dailyPnl: number;
  maxDrawdownFromPeak: number;
}): Promise<RiskCheckResult> {
  console.log(`[RiskTools] Checking risk for ${params.decision.instrument} ${params.decision.side}`);

  const checks: RiskCheckResult['checks'] = [];
  let allPassed = true;

  // 1. Per-trade risk check (1% rule)
  const tradeRisk = params.decision.quantity * (params.decision.stopLoss ?? 0);
  const tradeRiskPercent = (tradeRisk / params.portfolioEquity) * 100;
  const maxTradeRisk = params.decision.confidence && params.decision.confidence > 0.85 ? 1.5 : 1.0;

  checks.push({
    name: 'per_trade_risk',
    passed: tradeRiskPercent <= maxTradeRisk,
    value: tradeRiskPercent,
    limit: maxTradeRisk,
    message: `Trade risk: ${tradeRiskPercent.toFixed(2)}% (limit: ${maxTradeRisk}%)`,
  });
  if (tradeRiskPercent > maxTradeRisk) allPassed = false;

  // 2. Daily loss limit (3% rule)
  const dailyLossPercent = Math.abs(Math.min(params.dailyPnl, 0)) / params.portfolioEquity * 100;
  checks.push({
    name: 'daily_loss_limit',
    passed: dailyLossPercent < 3.0,
    value: dailyLossPercent,
    limit: 3.0,
    message: `Daily loss: ${dailyLossPercent.toFixed(2)}% (limit: 3%)`,
  });
  if (dailyLossPercent >= 3.0) allPassed = false;

  // 3. Portfolio heat check (6% limit)
  const currentHeat = params.openPositions.reduce((sum, p) => {
    const positionRisk = Math.abs(p.unrealizedPnl ?? 0);
    return sum + (positionRisk / params.portfolioEquity) * 100;
  }, 0);
  const projectedHeat = currentHeat + tradeRiskPercent;

  checks.push({
    name: 'portfolio_heat',
    passed: projectedHeat <= 6.0,
    value: projectedHeat,
    limit: 6.0,
    message: `Projected heat: ${projectedHeat.toFixed(2)}% (limit: 6%)`,
  });
  if (projectedHeat > 6.0) allPassed = false;

  // 4. Drawdown check (10% maximum)
  checks.push({
    name: 'max_drawdown',
    passed: params.maxDrawdownFromPeak < 10.0,
    value: params.maxDrawdownFromPeak,
    limit: 10.0,
    message: `Drawdown: ${params.maxDrawdownFromPeak.toFixed(2)}% (limit: 10%)`,
  });
  if (params.maxDrawdownFromPeak >= 10.0) allPassed = false;

  // 5. Position concentration check (10% per instrument)
  const existingPosition = params.openPositions.find((p) => p.instrument === params.decision.instrument);
  const existingValue = existingPosition ? existingPosition.quantity * existingPosition.currentPrice : 0;
  const newValue = params.decision.quantity * (params.decision.entryPrice ?? 0);
  const concentrationPercent = ((existingValue + newValue) / params.portfolioEquity) * 100;

  checks.push({
    name: 'position_concentration',
    passed: concentrationPercent <= 10.0,
    value: concentrationPercent,
    limit: 10.0,
    message: `Concentration: ${concentrationPercent.toFixed(2)}% (limit: 10%)`,
  });
  if (concentrationPercent > 10.0) allPassed = false;

  return {
    passed: allPassed,
    reason: allPassed
      ? 'All risk checks passed'
      : `Failed checks: ${checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
    checks,
  };
}

/**
 * Get current portfolio heat (sum of all position risks as % of equity).
 */
export async function getPortfolioHeat(params: {
  positions: EnginePosition[];
  portfolioEquity: number;
}): Promise<PortfolioHeat> {
  console.log('[RiskTools] Calculating portfolio heat...');

  const positionHeat = params.positions.map((p) => {
    const risk = Math.abs(p.unrealizedPnl ?? 0);
    const heat = (risk / params.portfolioEquity) * 100;
    return {
      instrument: p.instrument,
      heat,
      riskAmount: risk,
    };
  });

  const totalHeat = positionHeat.reduce((sum, p) => sum + p.heat, 0);

  // Simple correlation adjustment: if correlated positions exist, multiply by 1.5
  // TODO: Implement proper correlation matrix from @tradeworks/risk
  const correlationAdjustedHeat = totalHeat * 1.0; // No adjustment until correlations are computed

  const heatLimit = 6.0;

  return {
    totalHeat,
    positionHeat,
    correlationAdjustedHeat,
    heatLimit,
    headroom: Math.max(0, heatLimit - correlationAdjustedHeat),
  };
}

/**
 * Calculate proper position size based on risk parameters.
 */
export async function calculatePositionSize(params: {
  instrument: string;
  entryPrice: number;
  stopLoss: number;
  portfolioEquity: number;
  riskPercent?: number;
  atr?: number;
  atrMultiplier?: number;
}): Promise<PositionSizeResult> {
  console.log(`[RiskTools] Calculating position size for ${params.instrument}`);

  const riskPercent = params.riskPercent ?? 1.0;
  const riskAmount = params.portfolioEquity * (riskPercent / 100);

  let riskPerUnit: number;
  let method: string;

  if (params.atr && params.atrMultiplier) {
    // ATR-based position sizing
    riskPerUnit = params.atr * params.atrMultiplier;
    method = `ATR-based (ATR=${params.atr}, multiplier=${params.atrMultiplier})`;
  } else {
    // Stop-loss based position sizing
    riskPerUnit = Math.abs(params.entryPrice - params.stopLoss);
    method = 'Stop-loss based';
  }

  const recommendedSize = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;

  // Max position size: 10% of equity
  const maxSize = (params.portfolioEquity * 0.10) / params.entryPrice;

  const finalSize = Math.min(recommendedSize, maxSize);

  return {
    instrument: params.instrument,
    recommendedSize: finalSize,
    maxSize,
    riskPerUnit,
    totalRisk: finalSize * riskPerUnit,
    riskPercent: (finalSize * riskPerUnit / params.portfolioEquity) * 100,
    method,
  };
}

/**
 * Get current Value at Risk for the portfolio.
 */
export async function getVaR(params: {
  positions: EnginePosition[];
  portfolioEquity: number;
  confidenceLevel?: number;
  method?: 'historical' | 'parametric' | 'monte_carlo';
}): Promise<VaRResult> {
  console.log('[RiskTools] Calculating Value at Risk...');

  const confidenceLevel = params.confidenceLevel ?? 0.95;
  const method = params.method ?? 'parametric';

  // TODO: Integrate with @tradeworks/risk for proper VaR calculation
  // For now, use a simplified parametric VaR estimate
  // Assuming normal distribution and using position-level risk

  const totalPositionValue = params.positions.reduce(
    (sum, p) => sum + p.quantity * p.currentPrice,
    0,
  );

  // Simplified: assume 2% daily volatility (will be replaced with actual computation)
  const dailyVolatility = 0.02;
  const zScore = confidenceLevel === 0.99 ? 2.326 : 1.645; // 99% or 95%

  const oneDayVaR = totalPositionValue * dailyVolatility * zScore;
  const fiveDayVaR = oneDayVaR * Math.sqrt(5);

  return {
    oneDay: oneDayVaR,
    fiveDay: fiveDayVaR,
    oneDayPercent: params.portfolioEquity > 0 ? (oneDayVaR / params.portfolioEquity) * 100 : 0,
    fiveDayPercent: params.portfolioEquity > 0 ? (fiveDayVaR / params.portfolioEquity) * 100 : 0,
    confidenceLevel,
    method,
  };
}

/**
 * MCP tool schema definitions for agent consumption.
 */
export const RISK_TOOL_SCHEMAS = {
  checkRisk: {
    name: 'checkRisk',
    description: 'Validate a proposed trade against all risk limits (1% rule, daily loss, portfolio heat, drawdown)',
    parameters: {
      type: 'object',
      properties: {
        decision: { type: 'object', description: 'The trade decision to validate' },
        portfolioEquity: { type: 'number', description: 'Current portfolio equity in USD' },
        openPositions: { type: 'array', description: 'Current open positions' },
        dailyPnl: { type: 'number', description: 'Current daily P&L in USD' },
        maxDrawdownFromPeak: { type: 'number', description: 'Current drawdown from equity peak (%)' },
      },
      required: ['decision', 'portfolioEquity', 'openPositions', 'dailyPnl', 'maxDrawdownFromPeak'],
    },
  },
  getPortfolioHeat: {
    name: 'getPortfolioHeat',
    description: 'Get current portfolio heat (sum of all position risks as percentage of equity)',
    parameters: {
      type: 'object',
      properties: {
        positions: { type: 'array', description: 'Current open positions' },
        portfolioEquity: { type: 'number', description: 'Current portfolio equity in USD' },
      },
      required: ['positions', 'portfolioEquity'],
    },
  },
  calculatePositionSize: {
    name: 'calculatePositionSize',
    description: 'Calculate proper position size based on risk parameters and ATR',
    parameters: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Instrument symbol' },
        entryPrice: { type: 'number', description: 'Planned entry price' },
        stopLoss: { type: 'number', description: 'Stop loss price' },
        portfolioEquity: { type: 'number', description: 'Current portfolio equity' },
        riskPercent: { type: 'number', description: 'Risk per trade as % (default: 1.0)' },
        atr: { type: 'number', description: 'Current ATR value' },
        atrMultiplier: { type: 'number', description: 'ATR multiplier for stop distance (default: 2.0)' },
      },
      required: ['instrument', 'entryPrice', 'stopLoss', 'portfolioEquity'],
    },
  },
  getVaR: {
    name: 'getVaR',
    description: 'Get current Value at Risk (1-day and 5-day) for the portfolio',
    parameters: {
      type: 'object',
      properties: {
        positions: { type: 'array', description: 'Current open positions' },
        portfolioEquity: { type: 'number', description: 'Current portfolio equity' },
        confidenceLevel: { type: 'number', description: 'VaR confidence level (0.95 or 0.99)' },
        method: { type: 'string', enum: ['historical', 'parametric', 'monte_carlo'] },
      },
      required: ['positions', 'portfolioEquity'],
    },
  },
};
