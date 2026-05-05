/**
 * time-stop rule
 *
 * Close the position after a strategy-specific number of days regardless
 * of P&L. Exists because the worst trades aren't the ones that hit a stop
 * — those at least free capital for the next setup. The worst trades sit
 * at -2% for 6 months tying up margin and conviction, ending in either a
 * mean-reverted scratch or a death-spiral stop after the catalyst is
 * priced in.
 *
 * Strategy → days mapping is loaded from config (StrategyExitConfig). This
 * rule receives the `days` value as a closure parameter so it stays pure.
 *
 * `null` days disables the rule (e.g. funding_basis, range_grid which are
 * open-ended carry plays).
 *
 * For options the brief calls vol_rank_options=21d. We use entry-based age
 * here; the legacy options monitor closes 1 day before expiry too — that
 * close path is left in place in stock-agent's position-monitor so the
 * two safeties stack.
 */
import type { ExitDecision, ExitRule } from '../types.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface TimeStopOptions {
  /** Days after which to exit; null disables. */
  days: number | null;
}

export function makeTimeStopRule(opts: TimeStopOptions): ExitRule {
  const { days } = opts;
  return (ctx): ExitDecision => {
    if (days == null || days <= 0) return { shouldExit: false };

    const { position, bar, now } = ctx;
    const openedMs = new Date(position.openedAt).getTime();
    if (!Number.isFinite(openedMs)) return { shouldExit: false };
    const ageDays = (now.getTime() - openedMs) / MS_PER_DAY;

    if (ageDays < days) return { shouldExit: false };

    return {
      shouldExit: true,
      reason: 'time',
      exitPrice: bar.close,
      notes: `time stop fired (age=${ageDays.toFixed(1)}d >= ${days}d, strategy=${position.strategy})`,
    };
  };
}
