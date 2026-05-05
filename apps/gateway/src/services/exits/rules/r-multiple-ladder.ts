/**
 * r-multiple-ladder rule
 *
 * Once the position is up at least +1R unrealized, take 50% off the table
 * and mark the remaining 50% with a stop at breakeven (entryPrice).
 *
 * This is the single biggest behaviour change vs. the legacy 5%-flat-stop
 * monitor: by partialling at +1R we lock in a non-negative trade outcome on
 * any subsequent reversal AND the breakeven stop on the runner converts a
 * winner-that-mean-reverts into a 0R rather than a 1R loss.
 *
 * Mechanics:
 *   1R = abs(entryPrice - stopPrice) per share/contract.
 *   profit unit = (close - entry) * sideMultiplier.
 *   if profit unit >= 1R → exit partialQty = floor(qty / 2 * SCALE) / SCALE
 *
 * The CALLER (rules engine + monitor) is responsible for:
 *   - Tracking that the partial fired (so we don't fire it again on the
 *     remaining shares — handled via position.ladderPartialDone).
 *   - Migrating the stop to breakeven on the runner. We surface that
 *     intent through `notes` so the monitor can pick it up; the rule
 *     itself doesn't mutate the stop because rules are pure.
 *
 * For fractional-only assets (crypto), the partial qty is a halving with
 * 8-decimal rounding to keep books readable. Equity/option qty rounds to
 * whole shares/contracts.
 */
import type { ExitDecision, ExitRule } from '../types.js';

const CRYPTO_QTY_SCALE = 1e8;

function halfQty(position: { assetClass: string; qty: number }): number {
  // Equities: integer shares. Options: integer contracts. Crypto: 8-decimal float.
  if (position.assetClass === 'equity') {
    return Math.floor(position.qty / 2);
  }
  if (position.assetClass === 'option') {
    return Math.floor(position.qty / 2);
  }
  // crypto-cex / crypto-dex
  return Math.floor((position.qty / 2) * CRYPTO_QTY_SCALE) / CRYPTO_QTY_SCALE;
}

export const rMultipleLadderRule: ExitRule = (ctx): ExitDecision => {
  const { position, bar } = ctx;
  if (position.ladderPartialDone) return { shouldExit: false };
  if (position.entryPrice <= 0 || !Number.isFinite(position.entryPrice)) return { shouldExit: false };

  const riskPerUnit = Math.abs(position.entryPrice - position.stopPrice);
  if (riskPerUnit <= 0 || !Number.isFinite(riskPerUnit)) {
    // No risk basis → no R-multiple. Skip silently (other rules still run).
    return { shouldExit: false };
  }

  const direction = position.side === 'long' ? 1 : -1;
  const profitPerUnit = (bar.close - position.entryPrice) * direction;
  if (profitPerUnit < riskPerUnit) return { shouldExit: false };

  // qty=1 (single contract / share / nearly-empty crypto bag) → splitting
  // is impossible. Skip the partial; the runner will exit via target /
  // trail / stop instead.
  const partialQty = halfQty(position);
  if (partialQty <= 0) return { shouldExit: false };
  if (partialQty >= position.qty) return { shouldExit: false };

  return {
    shouldExit: true,
    reason: 'r_ladder',
    exitPrice: bar.close,
    partialQty,
    // The notes string is parsed by the monitor for the move-stop-to-BE
    // side effect. Don't change the prefix without updating the monitor.
    notes: `r_ladder +1R partial — move stop to breakeven (${position.entryPrice.toFixed(4)})`,
  };
};
