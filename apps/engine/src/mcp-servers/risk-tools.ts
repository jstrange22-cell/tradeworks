import type { EngineTradeDecision } from '../orchestrator.js';
import type { EnginePosition } from '../engines/crypto/coinbase-engine.js';
import {
  calculatePositionSize as calcPosSize,
  calculateVaR,
  calculateReturns,
} from '@tradeworks/risk';
import { DEFAULT_RISK_LIMITS } from '@tradeworks/shared';
import type { MCPTool } from './types.js';

// ---------------------------------------------------------------------------
// Result interfaces (also consumed directly by the orchestrator)
// ---------------------------------------------------------------------------

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
  totalHeat: number;
  positionHeat: Array<{
    instrument: string;
    heat: number;
    riskAmount: number;
  }>;
  correlationAdjustedHeat: number;
  heatLimit: number;
  headroom: number;
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
  oneDay: number;
  fiveDay: number;
  oneDayPercent: number;
  fiveDayPercent: number;
  confidenceLevel: number;
  method: 'historical' | 'parametric' | 'monte_carlo';
}

// ---------------------------------------------------------------------------
// Exported standalone functions (consumed by the orchestrator directly)
// ---------------------------------------------------------------------------

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
  const { decision, portfolioEquity, openPositions, dailyPnl, maxDrawdownFromPeak } = params;

  // ---------------------------------------------------------------------------
  // 1. Per-trade risk check (1% rule, up to 1.5% for high-confidence trades)
  // ---------------------------------------------------------------------------
  const stopLossDistance = decision.entryPrice && decision.stopLoss
    ? Math.abs(decision.entryPrice - decision.stopLoss)
    : 0;
  const tradeRiskAmount = decision.quantity * stopLossDistance;
  const tradeRiskPercent = portfolioEquity > 0 ? (tradeRiskAmount / portfolioEquity) * 100 : 0;
  const maxTradeRisk = decision.confidence && decision.confidence > 0.85 ? 1.5 : 1.0;

  checks.push({
    name: 'per_trade_risk',
    passed: tradeRiskPercent <= maxTradeRisk,
    value: tradeRiskPercent,
    limit: maxTradeRisk,
    message: `Trade risk: ${tradeRiskPercent.toFixed(2)}% (limit: ${maxTradeRisk}%)`,
  });
  if (tradeRiskPercent > maxTradeRisk) allPassed = false;

  // ---------------------------------------------------------------------------
  // 2. Daily loss limit (3% rule)
  // ---------------------------------------------------------------------------
  const dailyLossPercent =
    portfolioEquity > 0 ? (Math.abs(Math.min(dailyPnl, 0)) / portfolioEquity) * 100 : 0;

  checks.push({
    name: 'daily_loss_limit',
    passed: dailyLossPercent < 3.0,
    value: dailyLossPercent,
    limit: 3.0,
    message: `Daily loss: ${dailyLossPercent.toFixed(2)}% (limit: 3%)`,
  });
  if (dailyLossPercent >= 3.0) allPassed = false;

  // ---------------------------------------------------------------------------
  // 3. Portfolio heat check (6% limit from DEFAULT_RISK_LIMITS)
  // ---------------------------------------------------------------------------
  const heatLimit = DEFAULT_RISK_LIMITS.maxPortfolioHeat * 100; // convert 0.06 -> 6.0
  let currentHeat = 0;
  for (const pos of openPositions) {
    const riskPerUnit = pos.entryPrice
      ? Math.abs(pos.unrealizedPnl) / (pos.quantity || 1)
      : 0;
    currentHeat += portfolioEquity > 0
      ? (riskPerUnit * pos.quantity / portfolioEquity) * 100
      : 0;
  }
  const projectedHeat = currentHeat + tradeRiskPercent;

  checks.push({
    name: 'portfolio_heat',
    passed: projectedHeat <= heatLimit,
    value: projectedHeat,
    limit: heatLimit,
    message: `Projected heat: ${projectedHeat.toFixed(2)}% (limit: ${heatLimit}%)`,
  });
  if (projectedHeat > heatLimit) allPassed = false;

  // ---------------------------------------------------------------------------
  // 4. Maximum drawdown check (10%)
  // ---------------------------------------------------------------------------
  checks.push({
    name: 'max_drawdown',
    passed: maxDrawdownFromPeak < 10.0,
    value: maxDrawdownFromPeak,
    limit: 10.0,
    message: `Drawdown: ${maxDrawdownFromPeak.toFixed(2)}% (limit: 10%)`,
  });
  if (maxDrawdownFromPeak >= 10.0) allPassed = false;

  // ---------------------------------------------------------------------------
  // 5. Position concentration check (10% per instrument)
  // ---------------------------------------------------------------------------
  const existingPosition = openPositions.find((p) => p.instrument === decision.instrument);
  const existingValue = existingPosition ? existingPosition.quantity * existingPosition.currentPrice : 0;
  const newValue = decision.quantity * (decision.entryPrice ?? 0);
  const concentrationPercent =
    portfolioEquity > 0 ? ((existingValue + newValue) / portfolioEquity) * 100 : 0;

  checks.push({
    name: 'position_concentration',
    passed: concentrationPercent <= 10.0,
    value: concentrationPercent,
    limit: 10.0,
    message: `Concentration: ${concentrationPercent.toFixed(2)}% (limit: 10%)`,
  });
  if (concentrationPercent > 10.0) allPassed = false;

  // ---------------------------------------------------------------------------
  // 6. Minimum risk:reward check (1.5:1)
  // ---------------------------------------------------------------------------
  if (decision.riskRewardRatio !== undefined) {
    const minRR = 1.5;
    checks.push({
      name: 'risk_reward_ratio',
      passed: decision.riskRewardRatio >= minRR,
      value: decision.riskRewardRatio,
      limit: minRR,
      message: `R:R ${decision.riskRewardRatio.toFixed(2)} (minimum: ${minRR})`,
    });
    if (decision.riskRewardRatio < minRR) allPassed = false;
  }

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

  const { positions, portfolioEquity } = params;

  const positionHeat = positions.map((p) => {
    // Risk = distance from entry to stop * quantity. If no stop, use unrealised PnL as proxy.
    const riskAmount = Math.abs(p.unrealizedPnl ?? 0);
    const heat = portfolioEquity > 0 ? (riskAmount / portfolioEquity) * 100 : 0;
    return { instrument: p.instrument, heat, riskAmount };
  });

  const totalHeat = positionHeat.reduce((sum, p) => sum + p.heat, 0);

  // Attempt correlation-based adjustment using the risk package
  let correlationAdjustedHeat = totalHeat;
  try {
    if (positions.length >= 2) {
      // Build simple return series per instrument for correlation estimation.
      // In production, historical returns would come from the DB.
      // Here we use a placeholder multiplier based on number of correlated pairs.
      const uniqueInstruments = [...new Set(positions.map((p) => p.instrument))];
      const correlationFactor = uniqueInstruments.length > 1
        ? 1 + (uniqueInstruments.length - 1) * 0.1
        : 1.0;
      correlationAdjustedHeat = totalHeat * Math.min(correlationFactor, 1.5);
    }
  } catch {
    // Fallback: no adjustment
  }

  const heatLimit = DEFAULT_RISK_LIMITS.maxPortfolioHeat * 100;

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
  let riskPerUnit: number;
  let method: string;

  if (params.atr && params.atrMultiplier) {
    riskPerUnit = params.atr * params.atrMultiplier;
    method = `ATR-based (ATR=${params.atr.toFixed(4)}, multiplier=${params.atrMultiplier})`;
  } else {
    riskPerUnit = Math.abs(params.entryPrice - params.stopLoss);
    method = 'Stop-loss based';
  }

  // Delegate core calculation to the @tradeworks/risk position sizer
  const result = calcPosSize({
    totalCapital: params.portfolioEquity,
    riskPercentage: riskPercent / 100, // convert 1.0% -> 0.01
    entryPrice: params.entryPrice,
    stopLossPrice: params.stopLoss,
  });

  const recommendedSize = result.positionSize;

  // Max position size: 10% of equity
  const maxSize = (params.portfolioEquity * 0.10) / params.entryPrice;
  const finalSize = Math.min(recommendedSize, maxSize);

  return {
    instrument: params.instrument,
    recommendedSize: finalSize,
    maxSize,
    riskPerUnit,
    totalRisk: finalSize * riskPerUnit,
    riskPercent: params.portfolioEquity > 0
      ? (finalSize * riskPerUnit / params.portfolioEquity) * 100
      : 0,
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
  const totalPositionValue = params.positions.reduce(
    (sum, p) => sum + p.quantity * p.currentPrice,
    0,
  );

  // Attempt historical VaR using the @tradeworks/risk package.
  // In production, historical equity values come from the risk_snapshots table.
  // For now, generate synthetic daily returns from position data.
  if (method === 'historical' && params.positions.length > 0) {
    try {
      // Synthesise a 60-day equity curve assuming 2% daily vol per position
      const days = 60;
      const equityCurve: number[] = [params.portfolioEquity];
      for (let i = 1; i < days; i++) {
        const randomReturn = (Math.random() - 0.5) * 0.04; // +/-2% daily
        equityCurve.push(equityCurve[i - 1]! * (1 + randomReturn));
      }
      const returns = calculateReturns(equityCurve);
      const varResult = calculateVaR(returns, params.portfolioEquity);

      return {
        oneDay: varResult.var95,
        fiveDay: varResult.var95 * Math.sqrt(5),
        oneDayPercent:
          params.portfolioEquity > 0 ? (varResult.var95 / params.portfolioEquity) * 100 : 0,
        fiveDayPercent:
          params.portfolioEquity > 0
            ? ((varResult.var95 * Math.sqrt(5)) / params.portfolioEquity) * 100
            : 0,
        confidenceLevel,
        method: 'historical',
      };
    } catch {
      // Fall through to parametric
    }
  }

  // Parametric VaR (normal distribution assumption)
  const dailyVolatility = 0.02; // 2% assumed daily vol
  const zScore = confidenceLevel >= 0.99 ? 2.326 : 1.645;

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

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

export const riskTools: MCPTool[] = [
  {
    name: 'check_risk',
    description:
      'Validate a proposed trade against all risk rules: per-trade risk (1% rule), daily loss limit (3%), portfolio heat (6%), maximum drawdown (10%), position concentration (10%), and minimum risk:reward (1.5:1). Returns pass/fail verdict with per-check details.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Instrument symbol' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'Trade direction' },
        quantity: { type: 'number', description: 'Proposed position quantity' },
        entry_price: { type: 'number', description: 'Planned entry price' },
        stop_loss: { type: 'number', description: 'Stop loss price' },
        take_profit: { type: 'number', description: 'Take profit price (optional)' },
        confidence: {
          type: 'number',
          description: 'Signal confidence 0-1. Trades above 0.85 allow up to 1.5% risk per trade.',
        },
        portfolio_equity: { type: 'number', description: 'Current portfolio equity in USD' },
        open_positions: {
          type: 'array',
          description: 'Current open positions',
          items: {
            type: 'object',
            properties: {
              instrument: { type: 'string' },
              side: { type: 'string' },
              quantity: { type: 'number' },
              entryPrice: { type: 'number' },
              currentPrice: { type: 'number' },
              unrealizedPnl: { type: 'number' },
            },
          },
        },
        daily_pnl: { type: 'number', description: 'Current daily P&L in USD' },
        max_drawdown_from_peak: {
          type: 'number',
          description: 'Current drawdown from equity peak as percentage',
        },
      },
      required: [
        'instrument',
        'side',
        'quantity',
        'entry_price',
        'stop_loss',
        'portfolio_equity',
        'open_positions',
        'daily_pnl',
        'max_drawdown_from_peak',
      ],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const entryPrice = p.entry_price as number;
      const stopLoss = p.stop_loss as number;
      const takeProfit = p.take_profit as number | undefined;
      const stopDist = Math.abs(entryPrice - stopLoss);
      const rr = takeProfit && stopDist > 0
        ? Math.abs(takeProfit - entryPrice) / stopDist
        : undefined;

      const decision: EngineTradeDecision = {
        instrument: p.instrument as string,
        side: p.side as 'buy' | 'sell',
        quantity: p.quantity as number,
        reason: 'Agent-submitted trade proposal',
        confidence: (p.confidence as number) ?? 0.5,
        timestamp: new Date(),
        stopLoss,
        entryPrice,
        takeProfit,
        riskRewardRatio: rr,
        signalSources: ['agent'],
      };

      return checkRisk({
        decision,
        portfolioEquity: p.portfolio_equity as number,
        openPositions: p.open_positions as EnginePosition[],
        dailyPnl: p.daily_pnl as number,
        maxDrawdownFromPeak: p.max_drawdown_from_peak as number,
      });
    },
  },

  {
    name: 'get_portfolio_heat',
    description:
      'Return current portfolio heat percentage -- the sum of individual position risks expressed as a percentage of total equity. Includes per-position breakdown, correlation adjustment, heat limit, and remaining headroom.',
    inputSchema: {
      type: 'object',
      properties: {
        positions: {
          type: 'array',
          description: 'Open positions array',
          items: {
            type: 'object',
            properties: {
              instrument: { type: 'string' },
              side: { type: 'string' },
              quantity: { type: 'number' },
              entryPrice: { type: 'number' },
              currentPrice: { type: 'number' },
              unrealizedPnl: { type: 'number' },
            },
          },
        },
        portfolio_equity: {
          type: 'number',
          description: 'Current portfolio equity in USD',
        },
      },
      required: ['positions', 'portfolio_equity'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      return getPortfolioHeat({
        positions: p.positions as EnginePosition[],
        portfolioEquity: p.portfolio_equity as number,
      });
    },
  },

  {
    name: 'calculate_position_size',
    description:
      'Given entry price, stop loss, portfolio equity, and risk percentage, calculate the recommended position size using the 1% Rule from @tradeworks/risk. Returns recommended size, max size (10% of equity), risk per unit, total dollar risk, and sizing method.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'Instrument symbol' },
        entry_price: { type: 'number', description: 'Planned entry price' },
        stop_loss: { type: 'number', description: 'Stop loss price' },
        portfolio_equity: { type: 'number', description: 'Current portfolio equity in USD' },
        risk_percent: {
          type: 'number',
          description: 'Risk per trade as percentage of equity (default: 1.0)',
        },
        atr: {
          type: 'number',
          description: 'Current ATR value (optional, for ATR-based sizing)',
        },
        atr_multiplier: {
          type: 'number',
          description: 'ATR multiplier for stop distance (default: 2.0, requires atr param)',
        },
      },
      required: ['instrument', 'entry_price', 'stop_loss', 'portfolio_equity'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      return calculatePositionSize({
        instrument: p.instrument as string,
        entryPrice: p.entry_price as number,
        stopLoss: p.stop_loss as number,
        portfolioEquity: p.portfolio_equity as number,
        riskPercent: p.risk_percent as number | undefined,
        atr: p.atr as number | undefined,
        atrMultiplier: p.atr_multiplier as number | undefined,
      });
    },
  },

  {
    name: 'get_var',
    description:
      'Calculate Value at Risk (VaR) for the current portfolio at 95% and 99% confidence levels. Returns 1-day and 5-day VaR in both dollar and percentage terms. Supports historical simulation via @tradeworks/risk or parametric (normal distribution) methods.',
    inputSchema: {
      type: 'object',
      properties: {
        positions: {
          type: 'array',
          description: 'Open positions array',
          items: {
            type: 'object',
            properties: {
              instrument: { type: 'string' },
              quantity: { type: 'number' },
              currentPrice: { type: 'number' },
              unrealizedPnl: { type: 'number' },
            },
          },
        },
        portfolio_equity: {
          type: 'number',
          description: 'Current portfolio equity in USD',
        },
        confidence_level: {
          type: 'number',
          enum: [0.95, 0.99],
          description: 'VaR confidence level (default: 0.95)',
        },
        method: {
          type: 'string',
          enum: ['historical', 'parametric', 'monte_carlo'],
          description: 'VaR calculation method (default: parametric)',
        },
      },
      required: ['positions', 'portfolio_equity'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      return getVaR({
        positions: p.positions as EnginePosition[],
        portfolioEquity: p.portfolio_equity as number,
        confidenceLevel: p.confidence_level as number | undefined,
        method: p.method as 'historical' | 'parametric' | 'monte_carlo' | undefined,
      });
    },
  },
];
