/**
 * Drawdown monitoring and tracking.
 * Tracks peak equity, current drawdown, and maximum drawdown.
 */

export interface DrawdownState {
  peakEquity: number;
  currentEquity: number;
  currentDrawdown: number; // as decimal (e.g., 0.05 = 5%)
  currentDrawdownAbsolute: number;
  maxDrawdown: number; // worst drawdown seen
  maxDrawdownAbsolute: number;
  drawdownDuration: number; // consecutive periods in drawdown
  recoveryNeeded: number; // % gain needed to recover to peak
}

export class DrawdownMonitor {
  private peakEquity: number;
  private maxDrawdown: number = 0;
  private maxDrawdownAbsolute: number = 0;
  private drawdownStartPeriod: number = 0;
  private currentPeriod: number = 0;
  private inDrawdown: boolean = false;

  constructor(initialEquity: number) {
    this.peakEquity = initialEquity;
  }

  /**
   * Update with new equity value and return current state.
   */
  update(equity: number): DrawdownState {
    this.currentPeriod++;

    if (equity > this.peakEquity) {
      this.peakEquity = equity;
      this.inDrawdown = false;
      this.drawdownStartPeriod = this.currentPeriod;
    }

    const currentDrawdownAbsolute = this.peakEquity - equity;
    const currentDrawdown = this.peakEquity > 0
      ? currentDrawdownAbsolute / this.peakEquity
      : 0;

    if (currentDrawdown > 0 && !this.inDrawdown) {
      this.inDrawdown = true;
      this.drawdownStartPeriod = this.currentPeriod;
    }

    if (currentDrawdown > this.maxDrawdown) {
      this.maxDrawdown = currentDrawdown;
      this.maxDrawdownAbsolute = currentDrawdownAbsolute;
    }

    const drawdownDuration = this.inDrawdown
      ? this.currentPeriod - this.drawdownStartPeriod
      : 0;

    const recoveryNeeded = equity > 0 && currentDrawdownAbsolute > 0
      ? (this.peakEquity - equity) / equity
      : 0;

    return {
      peakEquity: this.peakEquity,
      currentEquity: equity,
      currentDrawdown,
      currentDrawdownAbsolute,
      maxDrawdown: this.maxDrawdown,
      maxDrawdownAbsolute: this.maxDrawdownAbsolute,
      drawdownDuration,
      recoveryNeeded,
    };
  }

  /**
   * Reset the monitor (e.g., after a circuit breaker reset).
   */
  reset(equity: number): void {
    this.peakEquity = equity;
    this.maxDrawdown = 0;
    this.maxDrawdownAbsolute = 0;
    this.drawdownStartPeriod = 0;
    this.currentPeriod = 0;
    this.inDrawdown = false;
  }
}

/**
 * Calculate maximum drawdown from an equity curve.
 */
export function calculateMaxDrawdown(equityCurve: number[]): {
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
} {
  if (equityCurve.length < 2) {
    return { maxDrawdown: 0, peakIndex: 0, troughIndex: 0 };
  }

  let maxDrawdown = 0;
  let peak = equityCurve[0]!;
  let peakIndex = 0;
  let resultPeakIndex = 0;
  let resultTroughIndex = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    const value = equityCurve[i]!;

    if (value > peak) {
      peak = value;
      peakIndex = i;
    }

    const drawdown = peak > 0 ? (peak - value) / peak : 0;

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      resultPeakIndex = peakIndex;
      resultTroughIndex = i;
    }
  }

  return { maxDrawdown, peakIndex: resultPeakIndex, troughIndex: resultTroughIndex };
}
