/**
 * Options Contract Selection Policy
 *
 * Given a TradeVisor action + spot price + IV rank + a Robinhood-shaped
 * chain, pick the single contract to paper-trade.
 *
 * Policy:
 *   - action 'buy'  → call
 *   - action 'sell' → put
 *   - Target DTE: 30 days (choose the nearest expiry in [28, 45] days)
 *   - Target delta: 0.50 default, shift to 0.65 ITM when ivRank > 80
 *     (blunts IV-crush risk on elevated-volatility names)
 *   - Strike selection: walk the chain at the chosen expiry and pick the
 *     strike whose |delta| is closest to the target.
 *
 * The caller supplies the raw chain rather than having this module fetch
 * it directly — this keeps the policy pure and easy to unit-test.
 */

export type OptionAction = 'buy' | 'sell';
export type OptionType = 'call' | 'put';

export interface OptionChainLeg {
  /** OCC-formatted option symbol (e.g. 'AAPL240517C00180000'). */
  occSymbol: string;
  strike: number;
  /** Expiration as YYYY-MM-DD. */
  expiry: string;
  type: OptionType;
  bid: number;
  ask: number;
  /** Signed delta as returned by the chain provider. Calls positive, puts negative. */
  delta: number;
  /** Implied volatility (0-1). */
  iv: number;
}

export interface SelectedContract {
  occSymbol: string;
  strike: number;
  expiry: string;
  type: OptionType;
  estDelta: number;
  estMid: number;
}

const TARGET_DTE = 30;
const MIN_DTE = 28;
const MAX_DTE = 45;
const DEFAULT_DELTA = 0.50;
const HIGH_IV_DELTA = 0.65;
const HIGH_IV_RANK_THRESHOLD = 80;

function daysUntil(expiryIso: string, from = new Date()): number {
  const expiry = new Date(expiryIso).getTime();
  const start = from.getTime();
  return Math.round((expiry - start) / (24 * 3600 * 1000));
}

/**
 * Select a single option contract from the provided chain based on the
 * action, IV rank, and policy defaults.
 *
 * @param symbol    Underlying ticker (unused today beyond error messages,
 *                  reserved for future per-ticker policy overrides).
 * @param action    TradeVisor action — 'buy' → call, 'sell' → put.
 * @param spotPrice Current underlying price. Currently informational;
 *                  retained to support spot-relative fallbacks when a
 *                  chain lacks accurate deltas.
 * @param ivRank    0-100 IV rank for the underlying. Triggers the ITM
 *                  shift above HIGH_IV_RANK_THRESHOLD.
 * @param chain     Fully-populated options chain. Must be non-empty.
 * @throws If the chain is empty or contains no viable expiries.
 */
export function selectOptionContract(
  symbol: string,
  action: OptionAction,
  spotPrice: number,
  ivRank: number,
  chain: OptionChainLeg[],
): SelectedContract {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error(`selectOptionContract: empty chain for ${symbol}`);
  }
  if (!spotPrice || spotPrice <= 0) {
    throw new Error(`selectOptionContract: invalid spotPrice for ${symbol}`);
  }

  const type: OptionType = action === 'buy' ? 'call' : 'put';
  const targetDelta = ivRank > HIGH_IV_RANK_THRESHOLD ? HIGH_IV_DELTA : DEFAULT_DELTA;

  // Filter to the right side of the chain + valid DTE window.
  const now = new Date();
  const viable = chain.filter(leg => {
    if (leg.type !== type) return false;
    const dte = daysUntil(leg.expiry, now);
    return dte >= MIN_DTE && dte <= MAX_DTE;
  });

  if (viable.length === 0) {
    throw new Error(`selectOptionContract: no ${type} legs in [${MIN_DTE},${MAX_DTE}] DTE window for ${symbol}`);
  }

  // Pick the expiry closest to TARGET_DTE.
  let chosenExpiry = viable[0].expiry;
  let bestDteDelta = Math.abs(daysUntil(chosenExpiry, now) - TARGET_DTE);
  for (const leg of viable) {
    const d = Math.abs(daysUntil(leg.expiry, now) - TARGET_DTE);
    if (d < bestDteDelta) {
      bestDteDelta = d;
      chosenExpiry = leg.expiry;
    }
  }

  const atExpiry = viable.filter(leg => leg.expiry === chosenExpiry);

  // Puts come back with negative deltas; compare against the signed
  // version of the target so we pick the strike closest in magnitude on
  // the correct side of the chain.
  const signedTarget = type === 'call' ? targetDelta : -targetDelta;

  let best = atExpiry[0];
  let bestScore = Math.abs(best.delta - signedTarget);
  for (const leg of atExpiry) {
    const score = Math.abs(leg.delta - signedTarget);
    if (score < bestScore) {
      bestScore = score;
      best = leg;
    }
  }

  const mid = Math.max(0, (best.bid + best.ask) / 2);

  return {
    occSymbol: best.occSymbol,
    strike: best.strike,
    expiry: best.expiry,
    type: best.type,
    estDelta: best.delta,
    estMid: mid,
  };
}
