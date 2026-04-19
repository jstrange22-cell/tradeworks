/**
 * Arb Validator — Fee-Adjusted Profitability + Position Sizing
 *
 * Every opportunity passes through here before brain approves.
 * Returns profitability verdict and recommended size.
 */

import type { ArbOpportunity, ValidationResult, ArbConfig } from './models.js';
import { calculateNetProfit } from './fee-calculator.js';

export function validateOpportunity(
  opp: ArbOpportunity,
  config: ArbConfig,
): ValidationResult {
  // For single-leg arbs (Type 7), totalCost is just price_a
  const isSingleLeg = opp.arbType === 'type7_options_implied';
  const effectiveCost = isSingleLeg ? opp.price_a : opp.totalCost;
  const qty = Math.min(opp.fillableQuantity, Math.floor(config.maxPerTradeUsd / Math.max(effectiveCost, 0.01)));

  const result = calculateNetProfit({
    venue_a: opp.venue_a,
    price_a: opp.price_a,
    venue_b: opp.venue_b,
    price_b: isSingleLeg ? (opp.optionsImpliedProb ?? opp.price_b) : opp.price_b,
    quantity: qty,
    slippageCents: config.slippageCents,
    singleLeg: isSingleLeg,
  });

  return result;
}

/**
 * Calculate final position size based on profitability, config, and memory adjustments.
 */
export function calculateFinalSize(
  opp: ArbOpportunity,
  validation: ValidationResult,
  config: ArbConfig,
  memoryMultiplier = 1.0,
): number {
  if (!validation.profitable) return 0;

  let qty = validation.recommendedQuantity;

  // Apply memory multiplier (reduced if past performance was bad)
  qty = Math.floor(qty * memoryMultiplier);

  // Apply opportunity's own size multiplier
  qty = Math.floor(qty * opp.sizeMultiplier);

  // Cap at max per trade
  const maxQty = Math.floor(config.maxPerTradeUsd / Math.max(opp.totalCost, 0.01));
  qty = Math.min(qty, maxQty);

  // Minimum viable: at least 5 contracts
  if (qty < 5) return 0;

  return qty;
}
