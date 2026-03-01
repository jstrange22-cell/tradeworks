import { z } from 'zod';
import type { EngineTradeDecision } from '../orchestrator.js';
import { isCircuitBreakerTripped } from './circuit-breaker.js';

/**
 * Pre-trade validation hook.
 * Runs a 4-layer validation pipeline before any trade is executed.
 */

export interface PreTradeValidationResult {
  passed: boolean;
  reason: string;
  layer: string;
  details: Record<string, unknown>;
}

/**
 * Zod schema for trade decision validation.
 */
const TradeDecisionSchema = z.object({
  instrument: z.string().min(1, 'Instrument is required'),
  side: z.enum(['buy', 'sell'], { message: 'Side must be buy or sell' }),
  quantity: z.number().positive('Quantity must be positive'),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  timestamp: z.date().or(z.string().transform((s) => new Date(s))),
});

/**
 * Layer 1: Schema validation using Zod.
 * Ensures the trade decision has all required fields with correct types.
 */
async function validateSchema(decision: EngineTradeDecision): Promise<PreTradeValidationResult> {
  try {
    TradeDecisionSchema.parse(decision);
    return {
      passed: true,
      reason: 'Schema validation passed',
      layer: 'schema',
      details: {},
    };
  } catch (error) {
    const zodError = error as z.ZodError;
    return {
      passed: false,
      reason: `Schema validation failed: ${zodError.errors.map((e) => e.message).join(', ')}`,
      layer: 'schema',
      details: { errors: zodError.errors },
    };
  }
}

/**
 * Layer 2: Risk check (circuit breaker, position limits).
 * Validates against real-time risk constraints.
 */
async function validateRisk(decision: EngineTradeDecision): Promise<PreTradeValidationResult> {
  // Check circuit breaker
  const circuitBroken = await isCircuitBreakerTripped();
  if (circuitBroken) {
    return {
      passed: false,
      reason: 'Circuit breaker is tripped - all trading halted',
      layer: 'risk',
      details: { circuitBreaker: true },
    };
  }

  // Check minimum confidence threshold
  if (decision.confidence !== undefined && decision.confidence < 0.5) {
    return {
      passed: false,
      reason: `Confidence too low: ${decision.confidence} (minimum: 0.5)`,
      layer: 'risk',
      details: { confidence: decision.confidence, minimum: 0.5 },
    };
  }

  // Check for zero/negative quantity
  if (decision.quantity <= 0) {
    return {
      passed: false,
      reason: 'Quantity must be positive',
      layer: 'risk',
      details: { quantity: decision.quantity },
    };
  }

  return {
    passed: true,
    reason: 'Risk validation passed',
    layer: 'risk',
    details: {},
  };
}

/**
 * Layer 3: Transaction simulation.
 * Simulates the trade to estimate execution outcome.
 */
async function validateSimulation(_decision: EngineTradeDecision): Promise<PreTradeValidationResult> {
  // TODO: Implement transaction simulation
  // - Estimate slippage based on order book depth
  // - Check if the trade would move the market significantly
  // - Verify sufficient liquidity for the order size
  // - Simulate execution at estimated fill price

  return {
    passed: true,
    reason: 'Simulation validation passed (placeholder)',
    layer: 'simulation',
    details: { simulated: true },
  };
}

/**
 * Layer 4: Guardrail check (daily limits, whitelists).
 * Enforces operational guardrails.
 */
async function validateGuardrails(decision: EngineTradeDecision): Promise<PreTradeValidationResult> {
  // Check instrument whitelist
  const whitelist = getInstrumentWhitelist();
  if (whitelist.length > 0 && !whitelist.includes(decision.instrument)) {
    return {
      passed: false,
      reason: `Instrument ${decision.instrument} is not in the whitelist`,
      layer: 'guardrails',
      details: { instrument: decision.instrument, whitelist },
    };
  }

  // Check daily trade count limit
  const dailyTradeCount = await getDailyTradeCount();
  const maxDailyTrades = parseInt(process.env.MAX_DAILY_TRADES ?? '50', 10);
  if (dailyTradeCount >= maxDailyTrades) {
    return {
      passed: false,
      reason: `Daily trade limit reached: ${dailyTradeCount}/${maxDailyTrades}`,
      layer: 'guardrails',
      details: { dailyTradeCount, maxDailyTrades },
    };
  }

  // Check trading hours (if applicable)
  const tradingAllowed = isTradingAllowed(decision.instrument);
  if (!tradingAllowed) {
    return {
      passed: false,
      reason: `Trading not allowed for ${decision.instrument} at current time`,
      layer: 'guardrails',
      details: { instrument: decision.instrument, currentTime: new Date().toISOString() },
    };
  }

  return {
    passed: true,
    reason: 'Guardrail validation passed',
    layer: 'guardrails',
    details: {},
  };
}

/**
 * Run the complete 4-layer pre-trade validation pipeline.
 */
export async function runPreTradeValidation(decision: EngineTradeDecision): Promise<PreTradeValidationResult> {
  console.log(`[PreTradeHook] Validating trade: ${decision.instrument} ${decision.side} x${decision.quantity}`);

  // Layer 1: Schema
  const schemaResult = await validateSchema(decision);
  if (!schemaResult.passed) {
    console.warn(`[PreTradeHook] FAILED at schema layer: ${schemaResult.reason}`);
    return schemaResult;
  }

  // Layer 2: Risk
  const riskResult = await validateRisk(decision);
  if (!riskResult.passed) {
    console.warn(`[PreTradeHook] FAILED at risk layer: ${riskResult.reason}`);
    return riskResult;
  }

  // Layer 3: Simulation
  const simResult = await validateSimulation(decision);
  if (!simResult.passed) {
    console.warn(`[PreTradeHook] FAILED at simulation layer: ${simResult.reason}`);
    return simResult;
  }

  // Layer 4: Guardrails
  const guardrailResult = await validateGuardrails(decision);
  if (!guardrailResult.passed) {
    console.warn(`[PreTradeHook] FAILED at guardrail layer: ${guardrailResult.reason}`);
    return guardrailResult;
  }

  console.log('[PreTradeHook] All 4 validation layers passed');
  return {
    passed: true,
    reason: 'All pre-trade validations passed',
    layer: 'all',
    details: {
      schema: schemaResult.passed,
      risk: riskResult.passed,
      simulation: simResult.passed,
      guardrails: guardrailResult.passed,
    },
  };
}

// Helper functions

function getInstrumentWhitelist(): string[] {
  const whitelist = process.env.INSTRUMENT_WHITELIST;
  if (!whitelist) return []; // Empty = all allowed
  return whitelist.split(',').map((s) => s.trim());
}

async function getDailyTradeCount(): Promise<number> {
  // TODO: Query database for today's trade count
  return 0;
}

function isTradingAllowed(instrument: string): boolean {
  // Crypto trades 24/7
  const cryptoPatterns = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'DOGE', 'LINK'];
  if (cryptoPatterns.some((p) => instrument.toUpperCase().includes(p))) {
    return true;
  }

  // Equities: check market hours (simplified)
  const now = new Date();
  const hour = now.getUTCHours();
  // US market: 14:30 - 21:00 UTC (9:30 AM - 4:00 PM ET)
  if (hour >= 14 && hour < 21) {
    return true;
  }

  // Prediction markets: generally 24/7
  if (instrument.startsWith('0x') || instrument.includes('polymarket')) {
    return true;
  }

  return false;
}
