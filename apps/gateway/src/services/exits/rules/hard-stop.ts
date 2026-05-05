/**
 * hard-stop rule
 *
 * The defensive backstop: if price has crossed the position's stop, close.
 * Always wins priority over every other rule — we'd rather honour a stop a
 * tick late than override it with a profit-target target on a fakeout.
 *
 *   long:  bar.low  <= stopPrice  → exit at stopPrice
 *   short: bar.high >= stopPrice  → exit at stopPrice
 *
 * Note we exit AT stopPrice, not at bar.close — modelling the assumption
 * that the stop limit order would have filled at the level. For paper
 * trading this is conservative; a real broker may slip past the stop in a
 * fast market, which is fine because the writer just records the fill.
 */
import type { ExitDecision, ExitRule } from '../types.js';

export const hardStopRule: ExitRule = (ctx): ExitDecision => {
  const { position, bar } = ctx;
  if (position.stopPrice <= 0 || !Number.isFinite(position.stopPrice)) {
    return { shouldExit: false };
  }

  if (position.side === 'long') {
    if (bar.low <= position.stopPrice) {
      return {
        shouldExit: true,
        reason: 'stop',
        exitPrice: position.stopPrice,
        notes: `hard stop hit (low=${bar.low.toFixed(4)} <= stop=${position.stopPrice.toFixed(4)})`,
      };
    }
  } else {
    if (bar.high >= position.stopPrice) {
      return {
        shouldExit: true,
        reason: 'stop',
        exitPrice: position.stopPrice,
        notes: `hard stop hit (high=${bar.high.toFixed(4)} >= stop=${position.stopPrice.toFixed(4)})`,
      };
    }
  }
  return { shouldExit: false };
};
