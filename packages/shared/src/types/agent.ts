import type { IndicatorSignal } from './strategy.js';
import type { MarketType } from './market-data.js';

export type AgentType = 'quant' | 'sentiment' | 'macro' | 'risk' | 'execution';
export type CycleStatus = 'running' | 'completed' | 'error' | 'circuit_breaker';

export interface AgentLog {
  id: string;
  agentType: AgentType;
  sessionId: string;
  action: string;
  inputSummary: string | null;
  outputSummary: string | null;
  decision: Record<string, unknown> | null;
  tokensUsed: number | null;
  costUsd: number | null;
  durationMs: number | null;
  parentCycleId: string | null;
  createdAt: Date;
}

export interface TradingCycle {
  id: string;
  cycleNumber: number;
  startedAt: Date;
  completedAt: Date | null;
  marketSnapshot: Record<string, unknown> | null;
  decisions: TradingDecision[];
  ordersPlaced: number;
  totalCostUsd: number | null;
  status: CycleStatus;
  errorMessage: string | null;
  createdAt: Date;
}

export interface TradingDecision {
  action: 'buy' | 'sell' | 'hold' | 'close';
  instrument: string;
  market: MarketType;
  confidence: number; // 0-1
  positionSizePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  reasoning: string;
  supportingIndicators: IndicatorSignal[];
  riskAssessment: RiskAssessment;
}

export interface QuantAnalysis {
  instrument: string;
  timeframe: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  trendStrength: number; // 0-1
  signals: IndicatorSignal[];
  patterns: PatternDetection[];
  smartMoneyAnalysis: SmartMoneyAnalysis | null;
  recommendedEntry: number | null;
  recommendedStop: number | null;
  recommendedTarget: number | null;
}

export interface PatternDetection {
  name: string;
  type: 'bullish' | 'bearish';
  reliability: number; // 0-1
}

export interface SmartMoneyAnalysis {
  orderBlocks: Array<{ price: number; type: string }>;
  liquidityVoids: Array<{ from: number; to: number }>;
  institutionalBias: 'accumulation' | 'distribution' | 'neutral';
}

export interface SentimentAnalysis {
  instrument: string;
  overallScore: number; // -1.0 to 1.0
  magnitude: number; // 0 to 1.0
  sources: Array<{
    name: string;
    score: number;
    articleCount: number;
  }>;
  keyThemes: string[];
  trending: boolean;
}

export interface MacroAnalysis {
  outlook: 'bullish' | 'bearish' | 'neutral';
  keyEvents: Array<{
    event: string;
    date: string;
    impact: 'high' | 'medium' | 'low';
    expectedEffect: string;
  }>;
  rateImpact: 'tightening' | 'easing' | 'neutral';
  riskFactors: string[];
}

export interface RiskAssessment {
  approved: boolean;
  reason: string;
  currentPortfolioHeat: number;
  proposedPositionRisk: number;
  maxPositionSize: number;
  adjustedStopLoss: number | null;
  var95Impact: number;
  correlationWarning: string | null;
  circuitBreakerTriggered: boolean;
}

export interface ExecutionResult {
  filled: boolean;
  orderId: string;
  fillPrice: number | null;
  fillQuantity: number | null;
  slippage: number;
  fees: number;
  exchangeRef: string | null;
  errorMessage: string | null;
}

export interface AgentStatus {
  agentType: AgentType;
  status: 'idle' | 'analyzing' | 'deciding' | 'executing' | 'error';
  lastActivityAt: Date;
  currentTask: string | null;
  cyclesCompleted: number;
  errorsToday: number;
}
