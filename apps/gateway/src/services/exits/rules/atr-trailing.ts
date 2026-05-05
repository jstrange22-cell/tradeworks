/**
 * atr-trailing rule
 *
 * Dynamic stop that follows the high-water mark of the trade by a fixed
 * ATR multiple.
 *
 *   long  trail = highSinceEntry - atrMultiple * atrAtEntry
 *   short trail = lowSinceEntry  + atrMultiple * atrAtEntry
 *
 * If the bar pierces the trail, exit at the trail level (treating the
 * trail as a stop-limit). atrAtEntry is captured at entry so the rule
 * doesn't need a live ATR series at evaluation time — that keeps the rule
 * pure and the monitor cheap.
 *
 * The default multiple is 1.5, configurable per-strategy via
 * StrategyExitConfig.atrTrailMultiple. Skip silently when atrAtEntry is
 * missing or zero (e.g. options where Black-Scholes "ATR" is meaningless).
 *
 * This rule never overrides hard-stop priority — if the rules engine
 * already accepted a hard-stop, we never get evaluated.
 */
import type { ExitDecision, ExitRule } from '../types.js';

interface AtrTrailingOptions {
  /** ATR multiple. Default 1.5. */
  multiple?: number;
}

export function makeAtrTrailingRule(opts: AtrTrailingOptions = {}): ExitRule {
  const multiple = opts.multiple ?? 1.5;

  return (ctx): ExitDecision => {
    const { position, bar, highSinceEntry, lowSinceEntry } = ctx;
    const atr = position.atrAtEntry;
    if (atr == null || !Number.isFinite(atr) || atr <= 0) {
      return { shouldExit: false };
    }

    if (position.side === 'long') {
      const trail = highSinceEntry - multiple * atr;
      // Defensive: if highSinceEntry hasn't yet exceeded the entry by enough
      // for the trail to cross above the original stop, skip — the hard-stop
      // rule is already armed below it.
      if (trail <= position.stopPrice) return { shouldExit: false };
      if (bar.low <= trail) {
        return {
          shouldExit: true,
          reason: 'trail',
          exitPrice: trail,
          notes: `atr trail (high=${highSinceEntry.toFixed(4)} - ${multiple}×ATR=${atr.toFixed(4)} → ${trail.toFixed(4)})`,
        };
      }
      return { shouldExit: false };
    }

    // short
    const trail = lowSinceEntry + multiple * atr;
    if (trail >= position.stopPrice) return { shouldExit: false };
    if (bar.high >= trail) {
      return {
        shouldExit: true,
        reason: 'trail',
        exitPrice: trail,
        notes: `atr trail (low=${lowSinceEntry.toFixed(4)} + ${multiple}×ATR=${atr.toFixed(4)} → ${trail.toFixed(4)})`,
      };
    }
    return { shouldExit: false };
  };
}

// Sensible default export so callers can drop the rule in without
// configuring the multiple.
export const atrTrailingRule = makeAtrTrailingRule();
