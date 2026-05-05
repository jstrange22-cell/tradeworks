/**
 * Exit rules engine.
 *
 * Composes the per-strategy rule stack (hard-stop → regime-exit →
 * r-multiple-ladder → atr-trailing → time-stop → profit-target) and
 * evaluates them in priority order against an open position. The first
 * rule that returns shouldExit=true wins; the rest are short-circuited.
 *
 * Priority is encoded as numbers (lower = higher priority) so a config
 * file can re-order without touching code.
 *
 * The engine itself is pure — no I/O, no side effects, no clock reads.
 * The monitoring loop wraps it with persistence (highSinceEntry,
 * ladderPartialDone) and broker calls.
 */
import type {
  ExitDecision,
  ExitRule,
  ExitRuleContext,
  ExitRuleEntry,
  StrategyExitConfig,
  StrategyTag,
} from './types.js';
import { hardStopRule } from './rules/hard-stop.js';
import { regimeExitRule } from './rules/regime-exit.js';
import { rMultipleLadderRule } from './rules/r-multiple-ladder.js';
import { makeAtrTrailingRule } from './rules/atr-trailing.js';
import { makeTimeStopRule } from './rules/time-stop.js';
import { makeProfitTargetRule } from './rules/profit-target.js';

// ── Priority order ─────────────────────────────────────────────────────
//
// Lower number = higher priority. Values are spaced out so a config file
// can slot a new rule in without renumbering everything.
export const PRIORITY = {
  HARD_STOP: 10,
  REGIME_EXIT: 20,
  R_LADDER: 30,
  ATR_TRAILING: 40,
  TIME_STOP: 50,
  PROFIT_TARGET: 60,
} as const;

// ── Rule-stack builder ─────────────────────────────────────────────────

/**
 * Build the rule stack for a single strategy. The monitor calls this
 * lazily per-position so a single tick can mix strategies cleanly.
 */
export function buildRuleStack(
  strategy: StrategyTag,
  config: StrategyExitConfig,
): ExitRuleEntry[] {
  const stack: ExitRuleEntry[] = [
    {
      id: 'hard_stop',
      priority: PRIORITY.HARD_STOP,
      rule: hardStopRule,
      enabled: true, // hard stop is always on
    },
    {
      id: 'regime_exit',
      priority: PRIORITY.REGIME_EXIT,
      rule: regimeExitRule,
      enabled: config.regimeExitEnabled,
    },
    {
      id: 'r_multiple_ladder',
      priority: PRIORITY.R_LADDER,
      rule: rMultipleLadderRule,
      enabled: config.rLadderEnabled,
    },
    {
      id: 'atr_trailing',
      priority: PRIORITY.ATR_TRAILING,
      rule: makeAtrTrailingRule({ multiple: config.atrTrailMultiple }),
      enabled: config.atrTrailEnabled,
    },
    {
      id: 'time_stop',
      priority: PRIORITY.TIME_STOP,
      rule: makeTimeStopRule({ days: config.timeStopDays }),
      // Disable when days is null/0 — the rule body skips silently anyway,
      // but flagging it lets `/api/v1/exits/positions` show the user what's
      // armed vs. dormant.
      enabled: config.timeStopDays != null && config.timeStopDays > 0,
    },
    {
      id: 'profit_target',
      priority: PRIORITY.PROFIT_TARGET,
      rule: makeProfitTargetRule({ pct: config.profitTargetPct }),
      enabled: config.profitTargetPct != null && config.profitTargetPct > 0,
    },
  ];

  // Mark `strategy` as intentionally captured for telemetry — the lint
  // rule "noUnusedParameters" needs us to use the arg even though the
  // current build doesn't switch on it.
  void strategy;

  return stack.sort((a, b) => a.priority - b.priority);
}

// ── Engine entry point ─────────────────────────────────────────────────

export interface EngineEvaluation {
  decision: ExitDecision;
  /** Rule that produced the decision (or 'none' if all passed). */
  triggeredBy: ExitRuleEntry['id'] | 'none';
  /** Snapshot of every rule's decision this tick — useful for the dashboard. */
  trace: Array<{ ruleId: ExitRuleEntry['id']; decision: ExitDecision; skipped: boolean }>;
}

/**
 * Run a context through the rule stack. Returns the first triggered exit
 * plus a full trace for debugging / dashboards.
 *
 * The trace is always populated — we keep evaluating disabled rules so
 * operators can see "this would have fired if you flipped the flag."
 */
export function evaluateExitRules(
  ctx: ExitRuleContext,
  stack: ExitRuleEntry[],
): EngineEvaluation {
  const trace: EngineEvaluation['trace'] = [];
  let firstHit: { entry: ExitRuleEntry; decision: ExitDecision } | null = null;

  for (const entry of stack) {
    const skipped = !entry.enabled;
    let decision: ExitDecision = { shouldExit: false };

    try {
      decision = entry.rule(ctx);
    } catch {
      // Defensive: a misbehaving rule must not nuke the whole eval.
      decision = { shouldExit: false };
    }

    trace.push({ ruleId: entry.id, decision, skipped });

    if (!skipped && decision.shouldExit && !firstHit) {
      firstHit = { entry, decision };
      // Don't break — finish the trace so dashboards see what other rules
      // were saying. The cost is microseconds per position.
    }
  }

  if (firstHit) {
    return {
      decision: firstHit.decision,
      triggeredBy: firstHit.entry.id,
      trace,
    };
  }
  return {
    decision: { shouldExit: false },
    triggeredBy: 'none',
    trace,
  };
}

// ── Convenience: evaluate with a single shared rule stack ──────────────
//
// Builds + evaluates in one call. Less efficient when you have 50
// positions of the same strategy (which will rebuild the stack 50×), but
// cleaner for tests. The monitor caches stacks per strategy.

export function evaluateForStrategy(
  ctx: ExitRuleContext,
  strategy: StrategyTag,
  config: StrategyExitConfig,
): EngineEvaluation {
  return evaluateExitRules(ctx, buildRuleStack(strategy, config));
}

// Re-export rule fns so tests can import from one place.
export {
  hardStopRule,
  regimeExitRule,
  rMultipleLadderRule,
  makeAtrTrailingRule,
  makeTimeStopRule,
  makeProfitTargetRule,
};

// Type re-exports for convenience.
export type { ExitRule, ExitRuleContext, ExitRuleEntry, ExitDecision };
