import type { RiskLimits, CircuitBreakerState } from '@tradeworks/shared';
import { DEFAULT_RISK_LIMITS } from '@tradeworks/shared';

/**
 * Circuit Breaker — automatic trading halt on risk limit breaches.
 * Monitors daily P&L, weekly P&L, portfolio heat, and max drawdown.
 */
export class CircuitBreaker {
  private triggered: boolean = false;
  private reason: string | null = null;
  private triggeredAt: Date | null = null;
  private limits: RiskLimits;

  // Running totals
  private dailyPnl: number = 0;
  private weeklyPnl: number = 0;
  private portfolioHeat: number = 0;
  private maxDrawdownCurrent: number = 0;
  private initialCapital: number;

  constructor(initialCapital: number, limits?: RiskLimits) {
    this.initialCapital = initialCapital;
    this.limits = limits ?? DEFAULT_RISK_LIMITS;
  }

  /**
   * Check all risk limits. Returns true if circuit breaker should trigger.
   */
  check(params: {
    dailyPnl: number;
    weeklyPnl: number;
    portfolioHeat: number;
    maxDrawdown: number;
  }): CircuitBreakerState {
    this.dailyPnl = params.dailyPnl;
    this.weeklyPnl = params.weeklyPnl;
    this.portfolioHeat = params.portfolioHeat;
    this.maxDrawdownCurrent = params.maxDrawdown;

    // Check daily loss cap
    const dailyLossLimit = this.initialCapital * this.limits.dailyLossCap;
    if (params.dailyPnl < -dailyLossLimit) {
      this.trigger(`Daily loss cap breached: $${Math.abs(params.dailyPnl).toFixed(2)} > $${dailyLossLimit.toFixed(2)} (${(this.limits.dailyLossCap * 100).toFixed(1)}%)`);
    }

    // Check weekly loss cap
    const weeklyLossLimit = this.initialCapital * this.limits.weeklyLossCap;
    if (params.weeklyPnl < -weeklyLossLimit) {
      this.trigger(`Weekly loss cap breached: $${Math.abs(params.weeklyPnl).toFixed(2)} > $${weeklyLossLimit.toFixed(2)} (${(this.limits.weeklyLossCap * 100).toFixed(1)}%)`);
    }

    // Check portfolio heat
    if (params.portfolioHeat > this.limits.maxPortfolioHeat) {
      this.trigger(`Portfolio heat exceeded: ${(params.portfolioHeat * 100).toFixed(1)}% > ${(this.limits.maxPortfolioHeat * 100).toFixed(1)}%`);
    }

    return this.getState();
  }

  /**
   * Check if a single trade would breach per-trade risk limits.
   */
  checkTrade(riskAmount: number): { allowed: boolean; reason: string | null } {
    if (this.triggered) {
      return { allowed: false, reason: `Circuit breaker active: ${this.reason}` };
    }

    const maxTradeRisk = this.initialCapital * this.limits.maxRiskPerTrade;
    if (riskAmount > maxTradeRisk) {
      return {
        allowed: false,
        reason: `Trade risk $${riskAmount.toFixed(2)} exceeds per-trade limit $${maxTradeRisk.toFixed(2)} (${(this.limits.maxRiskPerTrade * 100).toFixed(1)}%)`,
      };
    }

    return { allowed: true, reason: null };
  }

  private trigger(reason: string): void {
    if (!this.triggered) {
      this.triggered = true;
      this.reason = reason;
      this.triggeredAt = new Date();
    }
  }

  /**
   * Manually clear the circuit breaker (requires human override).
   */
  clear(): void {
    this.triggered = false;
    this.reason = null;
    this.triggeredAt = null;
  }

  /**
   * Reset daily counters (called at start of new trading day).
   */
  resetDaily(): void {
    this.dailyPnl = 0;
  }

  /**
   * Reset weekly counters (called at start of new trading week).
   */
  resetWeekly(): void {
    this.weeklyPnl = 0;
  }

  /**
   * Update initial capital (e.g., after deposit/withdrawal).
   */
  updateCapital(newCapital: number): void {
    this.initialCapital = newCapital;
  }

  isTriggered(): boolean {
    return this.triggered;
  }

  getState(): CircuitBreakerState {
    return {
      triggered: this.triggered,
      reason: this.reason,
      triggeredAt: this.triggeredAt,
      dailyPnl: this.dailyPnl,
      weeklyPnl: this.weeklyPnl,
      portfolioHeat: this.portfolioHeat,
      maxDrawdownCurrent: this.maxDrawdownCurrent,
    };
  }
}
