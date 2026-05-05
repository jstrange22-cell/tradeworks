/**
 * profit-target rule
 *
 * Optional fixed-percent profit target. Disabled by default — most v2
 * strategies prefer trailing exits to fixed targets because the latter
 * arbitrarily caps the right tail of a runner.
 *
 * Enable per-strategy via StrategyExitConfig.profitTargetPct (e.g. set to
 * 25 → exit at +25% from entry). The rule receives the pct as a closure
 * argument; null/undefined disables it.
 *
 *   long:  exit when bar.high >= entry * (1 + pct/100)  → exit at target
 *   short: exit when bar.low  <= entry * (1 - pct/100)  → exit at target
 *
 * Sets reason='target' so the writer can flag wasTargetHit=true.
 */
import type { ExitDecision, ExitRule } from '../types.js';

interface ProfitTargetOptions {
  /** Profit target percent (e.g. 25 for +25%). null disables. */
  pct: number | null;
}

export function makeProfitTargetRule(opts: ProfitTargetOptions): ExitRule {
  const { pct } = opts;
  return (ctx): ExitDecision => {
    if (pct == null || pct <= 0) return { shouldExit: false };

    const { position, bar } = ctx;
    if (position.entryPrice <= 0) return { shouldExit: false };

    if (position.side === 'long') {
      const targetPrice = position.entryPrice * (1 + pct / 100);
      if (bar.high >= targetPrice) {
        return {
          shouldExit: true,
          reason: 'target',
          exitPrice: targetPrice,
          notes: `profit target hit (+${pct}% → ${targetPrice.toFixed(4)})`,
        };
      }
      return { shouldExit: false };
    }

    const targetPrice = position.entryPrice * (1 - pct / 100);
    if (bar.low <= targetPrice) {
      return {
        shouldExit: true,
        reason: 'target',
        exitPrice: targetPrice,
        notes: `profit target hit (-${pct}% → ${targetPrice.toFixed(4)})`,
      };
    }
    return { shouldExit: false };
  };
}
