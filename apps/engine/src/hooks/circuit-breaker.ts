/**
 * Circuit breaker hook.
 * Monitors portfolio health and halts all trading when critical thresholds are breached.
 *
 * The circuit breaker can be tripped by:
 * 1. Daily loss exceeding the maximum threshold (default: 3%)
 * 2. Maximum drawdown from equity peak (default: 10%)
 * 3. Consecutive losing trades (default: 5)
 * 4. Manual override via environment variable or API
 * 5. System error rate exceeding threshold
 */

export interface CircuitBreakerState {
  tripped: boolean;
  reason: string | null;
  trippedAt: Date | null;
  canResumeAt: Date | null;
  stats: {
    dailyLossPercent: number;
    drawdownPercent: number;
    consecutiveLosses: number;
    errorRate: number;
  };
}

// In-memory circuit breaker state
let state: CircuitBreakerState = {
  tripped: false,
  reason: null,
  trippedAt: null,
  canResumeAt: null,
  stats: {
    dailyLossPercent: 0,
    drawdownPercent: 0,
    consecutiveLosses: 0,
    errorRate: 0,
  },
};

// Configuration from environment
const CONFIG = {
  maxDailyLossPercent: parseFloat(process.env.CB_MAX_DAILY_LOSS ?? '3.0'),
  maxDrawdownPercent: parseFloat(process.env.CB_MAX_DRAWDOWN ?? '10.0'),
  maxConsecutiveLosses: parseInt(process.env.CB_MAX_CONSECUTIVE_LOSSES ?? '5', 10),
  maxErrorRate: parseFloat(process.env.CB_MAX_ERROR_RATE ?? '0.5'),
  cooldownMinutes: parseInt(process.env.CB_COOLDOWN_MINUTES ?? '60', 10),
  manualOverride: process.env.CB_MANUAL_OVERRIDE === 'true',
};

/**
 * Check if the circuit breaker is currently tripped.
 */
export async function isCircuitBreakerTripped(): Promise<boolean> {
  // Check manual override
  if (CONFIG.manualOverride) {
    return true;
  }

  // Check if previously tripped and cooldown has passed
  if (state.tripped && state.canResumeAt) {
    if (new Date() >= state.canResumeAt) {
      console.log('[CircuitBreaker] Cooldown expired. Resetting circuit breaker.');
      resetCircuitBreaker();
      return false;
    }
  }

  return state.tripped;
}

/**
 * Update circuit breaker state with new data.
 * Call this after each trade or at regular intervals.
 */
export async function updateCircuitBreaker(params: {
  dailyLossPercent?: number;
  drawdownPercent?: number;
  lastTradeResult?: 'win' | 'loss' | 'breakeven';
  errorOccurred?: boolean;
}): Promise<CircuitBreakerState> {
  // Update stats
  if (params.dailyLossPercent !== undefined) {
    state.stats.dailyLossPercent = params.dailyLossPercent;
  }
  if (params.drawdownPercent !== undefined) {
    state.stats.drawdownPercent = params.drawdownPercent;
  }
  if (params.lastTradeResult === 'loss') {
    state.stats.consecutiveLosses++;
  } else if (params.lastTradeResult === 'win') {
    state.stats.consecutiveLosses = 0;
  }
  if (params.errorOccurred) {
    state.stats.errorRate = Math.min(state.stats.errorRate + 0.1, 1.0);
  } else {
    state.stats.errorRate = Math.max(state.stats.errorRate - 0.05, 0);
  }

  // Check trip conditions
  if (!state.tripped) {
    if (state.stats.dailyLossPercent >= CONFIG.maxDailyLossPercent) {
      tripCircuitBreaker(`Daily loss limit reached: ${state.stats.dailyLossPercent.toFixed(2)}%`);
    } else if (state.stats.drawdownPercent >= CONFIG.maxDrawdownPercent) {
      tripCircuitBreaker(`Maximum drawdown reached: ${state.stats.drawdownPercent.toFixed(2)}%`);
    } else if (state.stats.consecutiveLosses >= CONFIG.maxConsecutiveLosses) {
      tripCircuitBreaker(`${state.stats.consecutiveLosses} consecutive losses`);
    } else if (state.stats.errorRate >= CONFIG.maxErrorRate) {
      tripCircuitBreaker(`Error rate too high: ${(state.stats.errorRate * 100).toFixed(0)}%`);
    }
  }

  return { ...state };
}

/**
 * Trip the circuit breaker.
 */
function tripCircuitBreaker(reason: string): void {
  console.error(`[CircuitBreaker] TRIPPED: ${reason}`);

  const now = new Date();
  state.tripped = true;
  state.reason = reason;
  state.trippedAt = now;
  state.canResumeAt = new Date(now.getTime() + CONFIG.cooldownMinutes * 60 * 1000);

  console.error(`[CircuitBreaker] Trading halted until ${state.canResumeAt.toISOString()}`);

  // TODO: Send critical alert via notification system
  // TODO: Publish circuit breaker event via Redis
}

/**
 * Reset the circuit breaker (manual or after cooldown).
 */
export function resetCircuitBreaker(): void {
  console.log('[CircuitBreaker] Resetting circuit breaker');

  state = {
    tripped: false,
    reason: null,
    trippedAt: null,
    canResumeAt: null,
    stats: {
      dailyLossPercent: 0,
      drawdownPercent: 0,
      consecutiveLosses: 0,
      errorRate: 0,
    },
  };
}

/**
 * Get the current circuit breaker state.
 */
export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...state };
}

/**
 * Manually trip the circuit breaker via API.
 */
export function manualTrip(reason: string): void {
  tripCircuitBreaker(`Manual override: ${reason}`);
}
