/**
 * regime-exit rule
 *
 * Risk-off flat. When the macro regime tag flips to 'crisis', any LONG
 * position whose strategy has `regimeExitEnabled` will close at market.
 *
 * Funding/basis and range/grid disable this in their config because they're
 * dollar-neutral by construction — flipping them flat in a panic defeats
 * the entire reason for running them. Trend / PEAD / sector rotation lean
 * directional, so they get cut first.
 *
 * Shorts are NOT auto-closed on crisis — if you opened a short, panic
 * confirms your thesis. This is intentional; flipping a short flat in
 * crisis would print a max-pain exit on the wrong tick.
 */
import type { ExitDecision, ExitRule } from '../types.js';

export const regimeExitRule: ExitRule = (ctx): ExitDecision => {
  const { position, bar, regime } = ctx;
  if (regime !== 'crisis') return { shouldExit: false };
  if (position.side !== 'long') return { shouldExit: false };

  // Exit at the close of the current bar — this is the "market on close"
  // approximation. The monitor doesn't have access to the bid/ask spread
  // here, so close is the best honest fill price we can simulate.
  return {
    shouldExit: true,
    reason: 'regime',
    exitPrice: bar.close,
    notes: 'regime crisis — risk-off flat',
  };
};
