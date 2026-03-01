/**
 * Simulated order executor for backtesting.
 * Models commission and slippage.
 */

export interface SimulatedFill {
  side: 'buy' | 'sell';
  requestedPrice: number;
  fillPrice: number;
  fillQuantity: number;
  slippage: number;
  commission: number;
  timestamp: number;
}

export class SimulatedExecutor {
  private commissionRate: number;
  private slippageBps: number;
  private fills: SimulatedFill[] = [];

  /**
   * @param commissionRate Commission as decimal (0.001 = 0.1%)
   * @param slippageBps Slippage in basis points (10 = 0.1%)
   */
  constructor(commissionRate: number, slippageBps: number) {
    this.commissionRate = commissionRate;
    this.slippageBps = slippageBps;
  }

  /**
   * Simulate a fill with slippage and commission.
   */
  simulateFill(
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    timestamp: number
  ): SimulatedFill {
    // Apply slippage: buys fill slightly higher, sells slightly lower
    const slippageMultiplier = this.slippageBps / 10000;
    const slippageAmount = price * slippageMultiplier;
    const fillPrice = side === 'buy'
      ? price + slippageAmount
      : price - slippageAmount;

    const notional = fillPrice * quantity;
    const commission = notional * this.commissionRate;

    const fill: SimulatedFill = {
      side,
      requestedPrice: price,
      fillPrice,
      fillQuantity: quantity,
      slippage: slippageAmount,
      commission,
      timestamp,
    };

    this.fills.push(fill);
    return fill;
  }

  getFills(): SimulatedFill[] {
    return [...this.fills];
  }

  reset(): void {
    this.fills = [];
  }
}
