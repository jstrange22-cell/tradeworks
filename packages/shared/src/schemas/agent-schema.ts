import { z } from 'zod';

export const IndicatorSignalSchema = z.object({
  indicator: z.string(),
  value: z.number(),
  signal: z.enum(['buy', 'sell', 'neutral']),
  confidence: z.number().min(0).max(1),
});

export const PatternDetectionSchema = z.object({
  name: z.string(),
  type: z.enum(['bullish', 'bearish']),
  reliability: z.number().min(0).max(1),
});

export const SmartMoneyAnalysisSchema = z.object({
  orderBlocks: z.array(z.object({ price: z.number(), type: z.string() })),
  liquidityVoids: z.array(z.object({ from: z.number(), to: z.number() })),
  institutionalBias: z.enum(['accumulation', 'distribution', 'neutral']),
});

export const QuantAnalysisSchema = z.object({
  instrument: z.string(),
  timeframe: z.string(),
  trend: z.enum(['bullish', 'bearish', 'neutral']),
  trendStrength: z.number().min(0).max(1),
  signals: z.array(IndicatorSignalSchema),
  patterns: z.array(PatternDetectionSchema),
  smartMoneyAnalysis: SmartMoneyAnalysisSchema.nullable(),
  recommendedEntry: z.number().nullable(),
  recommendedStop: z.number().nullable(),
  recommendedTarget: z.number().nullable(),
});

export const SentimentAnalysisSchema = z.object({
  instrument: z.string(),
  overallScore: z.number().min(-1).max(1),
  magnitude: z.number().min(0).max(1),
  sources: z.array(z.object({
    name: z.string(),
    score: z.number(),
    articleCount: z.number(),
  })),
  keyThemes: z.array(z.string()),
  trending: z.boolean(),
});

export const MacroAnalysisSchema = z.object({
  outlook: z.enum(['bullish', 'bearish', 'neutral']),
  keyEvents: z.array(z.object({
    event: z.string(),
    date: z.string(),
    impact: z.enum(['high', 'medium', 'low']),
    expectedEffect: z.string(),
  })),
  rateImpact: z.enum(['tightening', 'easing', 'neutral']),
  riskFactors: z.array(z.string()),
});

export const RiskAssessmentSchema = z.object({
  approved: z.boolean(),
  reason: z.string(),
  currentPortfolioHeat: z.number(),
  proposedPositionRisk: z.number(),
  maxPositionSize: z.number(),
  adjustedStopLoss: z.number().nullable(),
  var95Impact: z.number(),
  correlationWarning: z.string().nullable(),
  circuitBreakerTriggered: z.boolean(),
});

export const ExecutionResultSchema = z.object({
  filled: z.boolean(),
  orderId: z.string(),
  fillPrice: z.number().nullable(),
  fillQuantity: z.number().nullable(),
  slippage: z.number(),
  fees: z.number(),
  exchangeRef: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const TradingDecisionSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold', 'close']),
  instrument: z.string(),
  market: z.enum(['crypto', 'prediction', 'equity']),
  confidence: z.number().min(0).max(1),
  positionSizePercent: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0),
  takeProfitPercent: z.number().min(0),
  reasoning: z.string(),
  supportingIndicators: z.array(IndicatorSignalSchema),
  riskAssessment: RiskAssessmentSchema,
});

export type QuantAnalysisOutput = z.infer<typeof QuantAnalysisSchema>;
export type SentimentAnalysisOutput = z.infer<typeof SentimentAnalysisSchema>;
export type MacroAnalysisOutput = z.infer<typeof MacroAnalysisSchema>;
export type RiskAssessmentOutput = z.infer<typeof RiskAssessmentSchema>;
export type ExecutionResultOutput = z.infer<typeof ExecutionResultSchema>;
export type TradingDecisionOutput = z.infer<typeof TradingDecisionSchema>;
