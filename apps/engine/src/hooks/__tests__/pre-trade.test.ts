import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @tradeworks/db before importing modules (circuit-breaker depends on it)
vi.mock('@tradeworks/db', () => ({
  getRedisClient: () => ({
    publish: vi.fn().mockResolvedValue(0),
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
}));

import { runPreTradeValidation } from '../pre-trade.js';
import { resetCircuitBreaker } from '../circuit-breaker.js';
import type { EngineTradeDecision } from '../../orchestrator.js';

/**
 * Build a valid trade decision with sensible defaults.
 * Override individual fields as needed in each test.
 */
function makeDecision(overrides: Partial<EngineTradeDecision> = {}): EngineTradeDecision {
  return {
    instrument: 'BTC_USDT',
    side: 'buy',
    quantity: 0.5,
    reason: 'Bullish breakout signal',
    confidence: 0.85,
    timestamp: new Date(),
    signalSources: ['quant-analyst'],
    ...overrides,
  };
}

describe('PreTradeValidation', () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  afterEach(() => {
    resetCircuitBreaker();
  });

  // --------------------------------------------------------------------------
  // 1. Should pass with a valid trade decision
  // --------------------------------------------------------------------------
  it('should pass with a valid trade decision', async () => {
    const decision = makeDecision();
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(true);
    expect(result.layer).toBe('all');
    expect(result.reason).toContain('All pre-trade validations passed');
  });

  // --------------------------------------------------------------------------
  // 2. Should fail schema validation with missing instrument
  // --------------------------------------------------------------------------
  it('should fail schema validation with missing instrument', async () => {
    const decision = makeDecision({ instrument: '' });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(false);
    expect(result.layer).toBe('schema');
    expect(result.reason).toContain('Schema validation failed');
  });

  // --------------------------------------------------------------------------
  // 3. Should fail schema validation with invalid side
  // --------------------------------------------------------------------------
  it('should fail schema validation with invalid side', async () => {
    const decision = makeDecision({ side: 'hold' as 'buy' | 'sell' });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(false);
    expect(result.layer).toBe('schema');
    expect(result.reason).toContain('Schema validation failed');
  });

  // --------------------------------------------------------------------------
  // 4. Should fail schema validation with zero/negative quantity
  // --------------------------------------------------------------------------
  it('should fail schema validation with zero quantity', async () => {
    const decision = makeDecision({ quantity: 0 });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(false);
    expect(result.layer).toBe('schema');
    expect(result.reason).toContain('Schema validation failed');
  });

  it('should fail schema validation with negative quantity', async () => {
    const decision = makeDecision({ quantity: -1 });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(false);
    expect(result.layer).toBe('schema');
    expect(result.reason).toContain('Schema validation failed');
  });

  // --------------------------------------------------------------------------
  // 5. Should fail risk validation with low confidence
  // --------------------------------------------------------------------------
  it('should fail risk validation with confidence below 0.5', async () => {
    const decision = makeDecision({ confidence: 0.3 });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(false);
    expect(result.layer).toBe('risk');
    expect(result.reason).toContain('Confidence too low');
    expect(result.details).toHaveProperty('confidence', 0.3);
    expect(result.details).toHaveProperty('minimum', 0.5);
  });

  // --------------------------------------------------------------------------
  // 6. Should pass for crypto instruments (24/7 trading)
  // --------------------------------------------------------------------------
  it('should pass for crypto instruments regardless of time of day', async () => {
    // Crypto instruments contain BTC, ETH, SOL etc. and trade 24/7
    const cryptoInstruments = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT'];

    for (const instrument of cryptoInstruments) {
      const decision = makeDecision({ instrument });
      const result = await runPreTradeValidation(decision);

      expect(result.passed).toBe(true);
      expect(result.layer).toBe('all');
    }
  });

  // --------------------------------------------------------------------------
  // Additional: should pass with exactly 0.5 confidence (edge case)
  // --------------------------------------------------------------------------
  it('should pass with exactly 0.5 confidence', async () => {
    const decision = makeDecision({ confidence: 0.5 });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(true);
    expect(result.layer).toBe('all');
  });

  // --------------------------------------------------------------------------
  // Additional: should pass when confidence is undefined (optional field)
  // --------------------------------------------------------------------------
  it('should pass when confidence is undefined', async () => {
    const decision = makeDecision({ confidence: undefined });
    const result = await runPreTradeValidation(decision);

    // Risk check only rejects when confidence is defined AND below 0.5
    expect(result.passed).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Additional: sell side should also pass validation
  // --------------------------------------------------------------------------
  it('should pass schema validation for sell side', async () => {
    const decision = makeDecision({ side: 'sell' });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(true);
    expect(result.layer).toBe('all');
  });

  // --------------------------------------------------------------------------
  // Additional: result object should contain the correct detail structure
  // --------------------------------------------------------------------------
  it('should include layer details in the passing result', async () => {
    const decision = makeDecision();
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(true);
    expect(result.details).toEqual({
      schema: true,
      risk: true,
      simulation: true,
      guardrails: true,
    });
  });

  // --------------------------------------------------------------------------
  // Additional: timestamp as ISO string should also be accepted by Zod schema
  // --------------------------------------------------------------------------
  it('should accept timestamp as a string via Zod transform', async () => {
    const decision = makeDecision({
      timestamp: new Date().toISOString() as unknown as Date,
    });
    const result = await runPreTradeValidation(decision);

    expect(result.passed).toBe(true);
  });
});
