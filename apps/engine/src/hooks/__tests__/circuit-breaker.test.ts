import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock @tradeworks/db before importing the module under test
vi.mock('@tradeworks/db', () => ({
  getRedisClient: () => ({
    publish: vi.fn().mockResolvedValue(0),
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
}));

import {
  isCircuitBreakerTripped,
  updateCircuitBreaker,
  getCircuitBreakerState,
  resetCircuitBreaker,
  manualTrip,
} from '../circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  afterEach(() => {
    resetCircuitBreaker();
  });

  // --------------------------------------------------------------------------
  // 1. Should not be tripped initially
  // --------------------------------------------------------------------------
  it('should not be tripped initially', async () => {
    const tripped = await isCircuitBreakerTripped();
    expect(tripped).toBe(false);

    const state = getCircuitBreakerState();
    expect(state.tripped).toBe(false);
    expect(state.reason).toBeNull();
    expect(state.trippedAt).toBeNull();
    expect(state.canResumeAt).toBeNull();
    expect(state.stats.dailyLossPercent).toBe(0);
    expect(state.stats.drawdownPercent).toBe(0);
    expect(state.stats.consecutiveLosses).toBe(0);
    expect(state.stats.errorRate).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 2. Should trip on daily loss exceeding threshold
  // --------------------------------------------------------------------------
  it('should trip on daily loss exceeding threshold', async () => {
    // Default CB_MAX_DAILY_LOSS is 3.0%
    const result = await updateCircuitBreaker({ dailyLossPercent: 3.5 });

    expect(result.tripped).toBe(true);
    expect(result.reason).toContain('Daily loss limit reached');
    expect(result.reason).toContain('3.50');
    expect(result.stats.dailyLossPercent).toBe(3.5);

    const tripped = await isCircuitBreakerTripped();
    expect(tripped).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 3. Should trip on max drawdown
  // --------------------------------------------------------------------------
  it('should trip on max drawdown', async () => {
    // Default CB_MAX_DRAWDOWN is 10.0%
    const result = await updateCircuitBreaker({ drawdownPercent: 12.0 });

    expect(result.tripped).toBe(true);
    expect(result.reason).toContain('Maximum drawdown reached');
    expect(result.reason).toContain('12.00');
    expect(result.stats.drawdownPercent).toBe(12.0);
  });

  // --------------------------------------------------------------------------
  // 4. Should trip on consecutive losses
  // --------------------------------------------------------------------------
  it('should trip on consecutive losses', async () => {
    // Default CB_MAX_CONSECUTIVE_LOSSES is 5
    for (let i = 0; i < 4; i++) {
      const intermediateResult = await updateCircuitBreaker({ lastTradeResult: 'loss' });
      expect(intermediateResult.tripped).toBe(false);
    }

    // 5th consecutive loss should trip the breaker
    const result = await updateCircuitBreaker({ lastTradeResult: 'loss' });

    expect(result.tripped).toBe(true);
    expect(result.reason).toContain('consecutive losses');
    expect(result.stats.consecutiveLosses).toBe(5);
  });

  // --------------------------------------------------------------------------
  // 5. Should trip on high error rate
  // --------------------------------------------------------------------------
  it('should trip on high error rate', async () => {
    // Default CB_MAX_ERROR_RATE is 0.5
    // Each errorOccurred: true adds 0.1, so 5 errors = 0.5
    for (let i = 0; i < 4; i++) {
      const intermediateResult = await updateCircuitBreaker({ errorOccurred: true });
      expect(intermediateResult.tripped).toBe(false);
    }

    // 5th error brings error rate to 0.5, which equals the threshold
    const result = await updateCircuitBreaker({ errorOccurred: true });

    expect(result.tripped).toBe(true);
    expect(result.reason).toContain('Error rate too high');
    expect(result.stats.errorRate).toBeGreaterThanOrEqual(0.5);
  });

  // --------------------------------------------------------------------------
  // 6. Should reset correctly
  // --------------------------------------------------------------------------
  it('should reset correctly', async () => {
    // Trip the circuit breaker
    await updateCircuitBreaker({ dailyLossPercent: 5.0 });

    const stateBeforeReset = getCircuitBreakerState();
    expect(stateBeforeReset.tripped).toBe(true);

    // Reset
    resetCircuitBreaker();

    const stateAfterReset = getCircuitBreakerState();
    expect(stateAfterReset.tripped).toBe(false);
    expect(stateAfterReset.reason).toBeNull();
    expect(stateAfterReset.trippedAt).toBeNull();
    expect(stateAfterReset.canResumeAt).toBeNull();
    expect(stateAfterReset.stats.dailyLossPercent).toBe(0);
    expect(stateAfterReset.stats.drawdownPercent).toBe(0);
    expect(stateAfterReset.stats.consecutiveLosses).toBe(0);
    expect(stateAfterReset.stats.errorRate).toBe(0);

    // Should not be tripped anymore
    const tripped = await isCircuitBreakerTripped();
    expect(tripped).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 7. Manual trip should work
  // --------------------------------------------------------------------------
  it('should allow manual trip with a reason', async () => {
    manualTrip('Suspicious market conditions');

    const state = getCircuitBreakerState();
    expect(state.tripped).toBe(true);
    expect(state.reason).toContain('Manual override');
    expect(state.reason).toContain('Suspicious market conditions');
    expect(state.trippedAt).toBeInstanceOf(Date);
    expect(state.canResumeAt).toBeInstanceOf(Date);

    const tripped = await isCircuitBreakerTripped();
    expect(tripped).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 8. Should track consecutive losses (reset on win)
  // --------------------------------------------------------------------------
  it('should track consecutive losses and reset counter on a win', async () => {
    // Accumulate 3 losses
    await updateCircuitBreaker({ lastTradeResult: 'loss' });
    await updateCircuitBreaker({ lastTradeResult: 'loss' });
    await updateCircuitBreaker({ lastTradeResult: 'loss' });

    let state = getCircuitBreakerState();
    expect(state.stats.consecutiveLosses).toBe(3);
    expect(state.tripped).toBe(false);

    // Win should reset the counter
    await updateCircuitBreaker({ lastTradeResult: 'win' });

    state = getCircuitBreakerState();
    expect(state.stats.consecutiveLosses).toBe(0);
    expect(state.tripped).toBe(false);

    // Accumulate losses again - should need 5 from zero
    for (let i = 0; i < 4; i++) {
      await updateCircuitBreaker({ lastTradeResult: 'loss' });
    }

    state = getCircuitBreakerState();
    expect(state.stats.consecutiveLosses).toBe(4);
    expect(state.tripped).toBe(false);

    // 5th loss should trip
    await updateCircuitBreaker({ lastTradeResult: 'loss' });

    state = getCircuitBreakerState();
    expect(state.stats.consecutiveLosses).toBe(5);
    expect(state.tripped).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Additional: breakeven should not increment or reset consecutive losses
  // --------------------------------------------------------------------------
  it('should not change consecutive losses count on breakeven', async () => {
    await updateCircuitBreaker({ lastTradeResult: 'loss' });
    await updateCircuitBreaker({ lastTradeResult: 'loss' });

    let state = getCircuitBreakerState();
    expect(state.stats.consecutiveLosses).toBe(2);

    // Breakeven should leave the counter unchanged
    await updateCircuitBreaker({ lastTradeResult: 'breakeven' });

    state = getCircuitBreakerState();
    expect(state.stats.consecutiveLosses).toBe(2);
    expect(state.tripped).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Additional: error rate should decrease when no error occurs
  // --------------------------------------------------------------------------
  it('should decrease error rate when no error occurs', async () => {
    // Add some errors
    await updateCircuitBreaker({ errorOccurred: true });
    await updateCircuitBreaker({ errorOccurred: true });

    let state = getCircuitBreakerState();
    expect(state.stats.errorRate).toBeCloseTo(0.2, 5);

    // Non-error event reduces error rate by 0.05
    await updateCircuitBreaker({ errorOccurred: false });

    state = getCircuitBreakerState();
    expect(state.stats.errorRate).toBeCloseTo(0.15, 5);
  });

  // --------------------------------------------------------------------------
  // Additional: top-level state properties are returned as a shallow copy
  // --------------------------------------------------------------------------
  it('should return a shallow copy of state so top-level mutations do not leak', () => {
    const state1 = getCircuitBreakerState();
    state1.tripped = true;
    state1.reason = 'tampered';

    const state2 = getCircuitBreakerState();
    // Top-level properties are spread-copied, so mutations do not propagate
    expect(state2.tripped).toBe(false);
    expect(state2.reason).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Additional: updateCircuitBreaker returns a copy of the updated state
  // --------------------------------------------------------------------------
  it('should return updated state from updateCircuitBreaker', async () => {
    const result = await updateCircuitBreaker({
      dailyLossPercent: 1.5,
      drawdownPercent: 2.0,
    });

    expect(result.stats.dailyLossPercent).toBe(1.5);
    expect(result.stats.drawdownPercent).toBe(2.0);
    expect(result.tripped).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Additional: should not re-trip when already tripped
  // --------------------------------------------------------------------------
  it('should not re-trip when already tripped', async () => {
    await updateCircuitBreaker({ dailyLossPercent: 5.0 });

    const state1 = getCircuitBreakerState();
    expect(state1.tripped).toBe(true);
    const originalTrippedAt = state1.trippedAt;

    // Send another breach; trippedAt should not change
    await updateCircuitBreaker({ drawdownPercent: 15.0 });

    const state2 = getCircuitBreakerState();
    expect(state2.tripped).toBe(true);
    expect(state2.trippedAt).toEqual(originalTrippedAt);
  });
});
