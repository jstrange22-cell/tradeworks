/**
 * Arbitrage Fee Calculator — Exact Math
 *
 * Kalshi: fee = ceil(0.07 × contracts × price × (1 - price))  [cents]
 * Polymarket Trading: FREE (0 fees)
 * Polymarket Settlement: 2% on WINNING positions
 *
 * All calculations in cents to avoid floating point errors.
 */

import type { Venue, ValidationResult } from './models.js';

// ── Kalshi Fee ──────────────────────────────────────────────────────────

export function kalshiFee(contracts: number, price: number): number {
  // Kalshi fee = ceil(0.07 × contracts × price × (1 - price)) cents
  // price is 0.00–1.00
  const feeCents = Math.ceil(0.07 * contracts * price * (1 - price));
  return feeCents / 100; // return in dollars
}

// ── Polymarket Fee ──────────────────────────────────────────────────────

export function polymarketTradingFee(): number {
  return 0; // Polymarket has NO trading fees
}

export function polymarketSettlementFee(winnings: number): number {
  // 2% on winning position value
  return winnings * 0.02;
}

// ── Net Arb Profit Calculator ───────────────────────────────────────────

export interface FeeCalcInput {
  venue_a: Venue;
  price_a: number;          // 0.00–1.00
  venue_b: Venue;
  price_b: number;          // 0.00–1.00
  quantity: number;          // contracts
  slippageCents?: number;    // default 2
  singleLeg?: boolean;       // true for Type 7 (buy prediction market only, venue_b is signal source)
}

/**
 * Calculate net profit after all fees and slippage.
 *
 * Two modes:
 * - 2-leg arb (default): buy YES + buy NO → payout $1.00/contract guaranteed.
 * - 1-leg signal (singleLeg=true): buy on prediction market based on external signal.
 *   Cost = price_a × qty. Expected payout = modelProbability × $1.00 per contract.
 *   Edge = (modelProbability - price_a) × qty.
 */
export function calculateNetProfit(input: FeeCalcInput): ValidationResult {
  const { venue_a, price_a, venue_b, price_b, quantity } = input;
  const slippageCents = input.slippageCents ?? 2;
  const slippage = (slippageCents / 100) * quantity;

  let totalCost: number;
  let grossProfit: number;

  if (input.singleLeg) {
    // Single-leg: buy at price_a, price_b is the model's estimated true probability
    // Edge = (trueProb - buyPrice) per contract
    totalCost = price_a * quantity;
    const expectedPayout = price_b * quantity; // price_b = model probability of winning
    grossProfit = expectedPayout - totalCost;
  } else {
    // 2-leg arb: buy both sides, payout $1.00/contract guaranteed
    totalCost = (price_a + price_b) * quantity;
    const payout = 1.0 * quantity;
    grossProfit = payout - totalCost;
  }

  // Calculate fees per venue
  let kalshiFeeTotal = 0;
  let polySettlementFee = 0;

  if (venue_a === 'kalshi') {
    kalshiFeeTotal += kalshiFee(quantity, price_a);
  }
  if (venue_b === 'kalshi') {
    kalshiFeeTotal += kalshiFee(quantity, price_b);
  }

  // Polymarket settlement: 2% on the winning leg
  // In a YES+NO arb, one leg always wins (pays $1), one loses (pays $0)
  // The winning leg pays 2% settlement fee on the payout minus cost
  if (venue_a === 'polymarket' || venue_b === 'polymarket') {
    // Winning side gets $1.00 per contract, settlement fee on that
    const polyWinnings = quantity * 1.0;
    polySettlementFee = polymarketSettlementFee(polyWinnings);
  }

  const totalFees = kalshiFeeTotal + polySettlementFee;
  const netProfit = grossProfit - totalFees - slippage;

  // Recommended quantity: how many contracts for this to be worth it
  // Minimum net profit $1.00 or 0.5% return
  const minProfitableQty = totalFees > 0
    ? Math.ceil(totalFees / Math.max(grossProfit / quantity - totalFees / quantity, 0.001))
    : quantity;

  return {
    profitable: netProfit > 0,
    grossProfit: Math.round(grossProfit * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    slippage: Math.round(slippage * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    feeBreakdown: {
      kalshiFee: Math.round(kalshiFeeTotal * 100) / 100,
      polySettlementFee: Math.round(polySettlementFee * 100) / 100,
    },
    recommendedQuantity: Math.min(minProfitableQty, quantity),
  };
}

/**
 * Calculate minimum viable spread (in cents) for a given venue pair.
 * Below this spread, fees eat all profit.
 */
export function minimumViableSpread(venue_a: Venue, venue_b: Venue, quantity = 100): number {
  // Binary search for minimum spread where net > 0
  let low = 0;
  let high = 20; // 20 cents max
  while (high - low > 0.1) {
    const mid = (low + high) / 2;
    const price_a = 0.50;
    const price_b = 0.50 - mid / 100;
    const result = calculateNetProfit({ venue_a, price_a, venue_b, price_b, quantity });
    if (result.profitable) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return Math.round(high * 10) / 10;
}
