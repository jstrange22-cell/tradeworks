/**
 * Unit tests for the individual exit rules + the rules engine.
 *
 * Each rule is a pure function over (position, bar, tracker state, regime,
 * now) so tests just hand-roll the input shapes. No mocks, no I/O.
 */
import { describe, expect, it } from 'vitest';
import { hardStopRule } from '../rules/hard-stop.js';
import { regimeExitRule } from '../rules/regime-exit.js';
import { rMultipleLadderRule } from '../rules/r-multiple-ladder.js';
import { makeAtrTrailingRule } from '../rules/atr-trailing.js';
import { makeTimeStopRule } from '../rules/time-stop.js';
import { makeProfitTargetRule } from '../rules/profit-target.js';
import { buildRuleStack, evaluateExitRules } from '../rules-engine.js';
import { DEFAULT_STRATEGY_EXIT_CONFIG } from '../types.js';
import type { ExitRuleContext, OpenPosition, ExitBar, RegimeTag } from '../types.js';

// ── helpers ────────────────────────────────────────────────────────────

function makePos(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    decisionId: 'd-test',
    trackerId: 'equity:test-1',
    assetClass: 'equity',
    symbol: 'TEST',
    side: 'long',
    qty: 100,
    qtyAtEntry: 100,
    entryPrice: 100,
    stopPrice: 95,
    openedAt: new Date('2026-04-01T14:30:00Z').toISOString(),
    strategy: 'PEAD',
    atrAtEntry: 2.0,
    expiry: null,
    ladderPartialDone: false,
    ...overrides,
  };
}

function makeBar(close: number, high?: number, low?: number): ExitBar {
  return {
    close,
    high: high ?? close,
    low: low ?? close,
    ts: '2026-05-04T15:00:00Z',
  };
}

function makeCtx(
  position: OpenPosition,
  bar: ExitBar,
  opts: { high?: number; low?: number; regime?: RegimeTag; now?: Date } = {},
): ExitRuleContext {
  return {
    position,
    bar,
    highSinceEntry: opts.high ?? Math.max(position.entryPrice, bar.high),
    lowSinceEntry: opts.low ?? Math.min(position.entryPrice, bar.low),
    regime: opts.regime ?? 'neutral',
    now: opts.now ?? new Date('2026-05-04T15:00:00Z'),
  };
}

// ── hard-stop ──────────────────────────────────────────────────────────

describe('hardStopRule', () => {
  it('long: fires when bar.low <= stopPrice', () => {
    const pos = makePos({ stopPrice: 95 });
    const bar = makeBar(96, 96.5, 94.9);
    const decision = hardStopRule(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe('stop');
    expect(decision.exitPrice).toBe(95);
  });

  it('long: holds when bar.low > stopPrice', () => {
    const pos = makePos({ stopPrice: 95 });
    const bar = makeBar(98, 99, 96);
    expect(hardStopRule(makeCtx(pos, bar)).shouldExit).toBe(false);
  });

  it('short: fires when bar.high >= stopPrice', () => {
    const pos = makePos({ side: 'short', stopPrice: 105 });
    const bar = makeBar(103, 105.5, 102);
    const decision = hardStopRule(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.exitPrice).toBe(105);
  });

  it('skips when stopPrice is invalid', () => {
    const pos = makePos({ stopPrice: 0 });
    const bar = makeBar(50);
    expect(hardStopRule(makeCtx(pos, bar)).shouldExit).toBe(false);
  });
});

// ── regime-exit ────────────────────────────────────────────────────────

describe('regimeExitRule', () => {
  it('fires for long when regime is crisis', () => {
    const pos = makePos();
    const bar = makeBar(100);
    const decision = regimeExitRule(makeCtx(pos, bar, { regime: 'crisis' }));
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe('regime');
    expect(decision.exitPrice).toBe(100);
  });

  it('does NOT fire for short in crisis', () => {
    const pos = makePos({ side: 'short' });
    const bar = makeBar(100);
    expect(regimeExitRule(makeCtx(pos, bar, { regime: 'crisis' })).shouldExit).toBe(false);
  });

  it('does NOT fire when regime is risk-off but not crisis', () => {
    const pos = makePos();
    const bar = makeBar(100);
    expect(regimeExitRule(makeCtx(pos, bar, { regime: 'risk_off' })).shouldExit).toBe(false);
  });
});

// ── r-multiple-ladder ──────────────────────────────────────────────────

describe('rMultipleLadderRule', () => {
  it('fires partial at +1R for long', () => {
    // entry=100, stop=95 → 1R = $5/share. close 105 = +1R unrealized.
    const pos = makePos({ qty: 100 });
    const bar = makeBar(105);
    const decision = rMultipleLadderRule(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe('r_ladder');
    expect(decision.partialQty).toBe(50); // half of 100
    expect(decision.notes).toMatch(/breakeven/);
  });

  it('does not fire below +1R', () => {
    const pos = makePos({ qty: 100 });
    const bar = makeBar(104.5); // +0.9R
    expect(rMultipleLadderRule(makeCtx(pos, bar)).shouldExit).toBe(false);
  });

  it('skips when ladderPartialDone=true', () => {
    const pos = makePos({ qty: 50, ladderPartialDone: true });
    const bar = makeBar(110); // +2R — would fire if not already done
    expect(rMultipleLadderRule(makeCtx(pos, bar)).shouldExit).toBe(false);
  });

  it('skips when qty=1 (cannot split)', () => {
    const pos = makePos({ qty: 1 });
    const bar = makeBar(105);
    expect(rMultipleLadderRule(makeCtx(pos, bar)).shouldExit).toBe(false);
  });

  it('halves crypto qty with 8-decimal precision', () => {
    const pos = makePos({
      qty: 0.5,
      qtyAtEntry: 0.5,
      entryPrice: 50_000,
      stopPrice: 47_500, // 1R = $2500
      assetClass: 'crypto-cex',
    });
    const bar = makeBar(52_500); // +1R
    const decision = rMultipleLadderRule(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.partialQty).toBe(0.25);
  });

  it('short: fires partial at +1R when price falls', () => {
    const pos = makePos({ side: 'short', stopPrice: 105 });
    const bar = makeBar(95); // entry 100, stop 105 → 1R=5; profit=(100-95)=5 → +1R
    const decision = rMultipleLadderRule(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.partialQty).toBe(50);
  });

  it('skips when stop equals entry (zero risk basis)', () => {
    const pos = makePos({ stopPrice: 100 });
    const bar = makeBar(110);
    expect(rMultipleLadderRule(makeCtx(pos, bar)).shouldExit).toBe(false);
  });
});

// ── atr-trailing ───────────────────────────────────────────────────────

describe('atrTrailingRule', () => {
  it('fires for long when bar.low pierces high - 1.5*ATR', () => {
    // ATR=2 → trail = high - 3. high=110 → trail=107.
    const pos = makePos({ atrAtEntry: 2.0 });
    const bar = makeBar(108, 108, 106.5);
    const decision = makeAtrTrailingRule()(makeCtx(pos, bar, { high: 110 }));
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe('trail');
    expect(decision.exitPrice).toBe(107);
  });

  it('skips when atrAtEntry is null', () => {
    const pos = makePos({ atrAtEntry: null });
    const bar = makeBar(95, 95, 90);
    expect(makeAtrTrailingRule()(makeCtx(pos, bar, { high: 110 })).shouldExit).toBe(false);
  });

  it('skips when trail would sit below the original hard stop', () => {
    // high=101, ATR=10, multiple=1.5 → trail=86. stop=95. trail < stop → skip.
    const pos = makePos({ atrAtEntry: 10, stopPrice: 95 });
    const bar = makeBar(95.5, 95.5, 95.2);
    expect(makeAtrTrailingRule()(makeCtx(pos, bar, { high: 101 })).shouldExit).toBe(false);
  });

  it('respects custom multiple', () => {
    const pos = makePos({ atrAtEntry: 2.0 });
    const bar = makeBar(106, 106, 105.5); // need trail above 95
    // mult=2 → trail = 110 - 4 = 106. low 105.5 <= 106 → fires.
    const decision = makeAtrTrailingRule({ multiple: 2.0 })(makeCtx(pos, bar, { high: 110 }));
    expect(decision.shouldExit).toBe(true);
    expect(decision.exitPrice).toBe(106);
  });

  it('short: fires when bar.high pierces low + 1.5*ATR', () => {
    // entry 100, stop 105, ATR=2 → trail = low + 3.
    // low since entry = 92 → trail = 95. bar.high crosses 95.
    const pos = makePos({ side: 'short', atrAtEntry: 2.0, stopPrice: 105 });
    const bar = makeBar(94, 95.5, 94);
    const decision = makeAtrTrailingRule()(makeCtx(pos, bar, { low: 92 }));
    expect(decision.shouldExit).toBe(true);
    expect(decision.exitPrice).toBe(95);
  });
});

// ── time-stop ──────────────────────────────────────────────────────────

describe('timeStopRule', () => {
  it('fires when age >= configured days', () => {
    const opened = new Date('2026-03-01T14:30:00Z');
    const now = new Date('2026-05-04T14:30:00Z'); // ~64 days later
    const pos = makePos({ openedAt: opened.toISOString(), strategy: 'PEAD' });
    const bar = makeBar(100);
    const decision = makeTimeStopRule({ days: 60 })(makeCtx(pos, bar, { now }));
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe('time');
  });

  it('holds when age < configured days', () => {
    const opened = new Date('2026-04-15T14:30:00Z');
    const now = new Date('2026-05-04T14:30:00Z'); // ~19 days
    const pos = makePos({ openedAt: opened.toISOString() });
    const bar = makeBar(100);
    expect(makeTimeStopRule({ days: 60 })(makeCtx(pos, bar, { now })).shouldExit).toBe(false);
  });

  it('disabled when days is null (open-ended carry)', () => {
    const opened = new Date('2024-01-01T00:00:00Z');
    const now = new Date('2026-05-04T00:00:00Z'); // 850+ days
    const pos = makePos({ openedAt: opened.toISOString() });
    const bar = makeBar(100);
    expect(makeTimeStopRule({ days: null })(makeCtx(pos, bar, { now })).shouldExit).toBe(false);
  });

  it('per-strategy mapping respects the brief (PEAD=60, vol_rank=21, etc.)', () => {
    const cfg = DEFAULT_STRATEGY_EXIT_CONFIG;
    expect(cfg.PEAD.timeStopDays).toBe(60);
    expect(cfg.regime_trend.timeStopDays).toBe(90);
    expect(cfg.vol_rank_options.timeStopDays).toBe(21);
    expect(cfg.sector_rotation.timeStopDays).toBe(30);
    expect(cfg.funding_basis.timeStopDays).toBeNull();
    expect(cfg.range_grid.timeStopDays).toBeNull();
  });
});

// ── profit-target ──────────────────────────────────────────────────────

describe('profitTargetRule', () => {
  it('fires for long when bar.high >= entry * (1+pct/100)', () => {
    const pos = makePos();
    const bar = makeBar(124, 125.5, 122);
    const decision = makeProfitTargetRule({ pct: 25 })(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe('target');
    expect(decision.exitPrice).toBe(125);
  });

  it('disabled when pct is null', () => {
    const pos = makePos();
    const bar = makeBar(200, 200, 200);
    expect(makeProfitTargetRule({ pct: null })(makeCtx(pos, bar)).shouldExit).toBe(false);
  });

  it('short: fires when bar.low <= entry * (1-pct/100)', () => {
    const pos = makePos({ side: 'short' });
    const bar = makeBar(76, 80, 74);
    const decision = makeProfitTargetRule({ pct: 25 })(makeCtx(pos, bar));
    expect(decision.shouldExit).toBe(true);
    expect(decision.exitPrice).toBe(75);
  });
});

// ── rules engine: priority ordering ────────────────────────────────────

describe('rules engine', () => {
  it('hard-stop wins over r-ladder when both could fire', () => {
    // Position is at +1R BUT the bar's low pierced the stop (gap-down with
    // intraday rally would be the realistic version). hard-stop should win.
    const pos = makePos({ qty: 100, stopPrice: 95 });
    const bar = makeBar(105.5, 106, 94.5); // low=94.5 < stop=95; close=105.5 = +1R
    const stack = buildRuleStack('PEAD', DEFAULT_STRATEGY_EXIT_CONFIG.PEAD);
    const result = evaluateExitRules(makeCtx(pos, bar), stack);
    expect(result.triggeredBy).toBe('hard_stop');
    expect(result.decision.exitPrice).toBe(95);
  });

  it('regime-exit wins over r-ladder when both fire', () => {
    const pos = makePos({ qty: 100 });
    const bar = makeBar(105, 105, 102); // +1R but no stop hit
    const stack = buildRuleStack('PEAD', DEFAULT_STRATEGY_EXIT_CONFIG.PEAD);
    const result = evaluateExitRules(
      makeCtx(pos, bar, { regime: 'crisis' }),
      stack,
    );
    expect(result.triggeredBy).toBe('regime_exit');
  });

  it('falls through to time-stop when nothing higher fires', () => {
    const opened = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-05-04T00:00:00Z'); // ~123 days
    const pos = makePos({
      openedAt: opened.toISOString(),
      stopPrice: 90,         // far from current price
      strategy: 'PEAD',
      atrAtEntry: 2.0,
    });
    const bar = makeBar(101, 101, 100.5);
    const stack = buildRuleStack('PEAD', DEFAULT_STRATEGY_EXIT_CONFIG.PEAD);
    const result = evaluateExitRules(makeCtx(pos, bar, { now, high: 101 }), stack);
    expect(result.triggeredBy).toBe('time_stop');
  });

  it('produces a full trace even when no rule fires', () => {
    const pos = makePos({ qty: 100 });
    const bar = makeBar(101, 101, 100);
    const stack = buildRuleStack('PEAD', DEFAULT_STRATEGY_EXIT_CONFIG.PEAD);
    const result = evaluateExitRules(makeCtx(pos, bar), stack);
    expect(result.triggeredBy).toBe('none');
    expect(result.trace.length).toBe(stack.length);
    expect(result.trace.every(t => t.decision.shouldExit === false)).toBe(true);
  });

  it('marks disabled rules as skipped in the trace', () => {
    const pos = makePos({ strategy: 'funding_basis' });
    const bar = makeBar(100);
    // funding_basis disables r-ladder, atr-trailing, regime-exit, time-stop.
    const stack = buildRuleStack('funding_basis', DEFAULT_STRATEGY_EXIT_CONFIG.funding_basis);
    const result = evaluateExitRules(makeCtx(pos, bar, { regime: 'crisis' }), stack);
    const skippedIds = result.trace.filter(t => t.skipped).map(t => t.ruleId);
    expect(skippedIds).toContain('regime_exit');
    expect(skippedIds).toContain('r_multiple_ladder');
    expect(skippedIds).toContain('atr_trailing');
    expect(skippedIds).toContain('time_stop');
  });

  it('an exception in one rule does not abort the engine', () => {
    const pos = makePos();
    const bar = makeBar(100);
    const throwingRule = (): never => { throw new Error('boom'); };
    const okRule = () => ({
      shouldExit: true,
      reason: 'time' as const,
      exitPrice: 100,
    });
    const stack = [
      { id: 'hard_stop' as const, priority: 10, rule: throwingRule, enabled: true },
      { id: 'time_stop' as const, priority: 20, rule: okRule, enabled: true },
    ];
    const result = evaluateExitRules(makeCtx(pos, bar), stack);
    expect(result.triggeredBy).toBe('time_stop');
  });
});

// ── strategy → rule wiring ─────────────────────────────────────────────

describe('buildRuleStack', () => {
  it('orders rules by priority (lower number first)', () => {
    const stack = buildRuleStack('PEAD', DEFAULT_STRATEGY_EXIT_CONFIG.PEAD);
    const priorities = stack.map(s => s.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
    expect(stack[0].id).toBe('hard_stop'); // always first
  });

  it('disables r-ladder for vol_rank_options', () => {
    const stack = buildRuleStack('vol_rank_options', DEFAULT_STRATEGY_EXIT_CONFIG.vol_rank_options);
    const ladder = stack.find(s => s.id === 'r_multiple_ladder');
    expect(ladder?.enabled).toBe(false);
  });

  it('disables time-stop when timeStopDays is null', () => {
    const stack = buildRuleStack('funding_basis', DEFAULT_STRATEGY_EXIT_CONFIG.funding_basis);
    const ts = stack.find(s => s.id === 'time_stop');
    expect(ts?.enabled).toBe(false);
  });
});
