/**
 * Tests for the daily AI spend tracker.
 *
 * Validates:
 *   - Estimated cost is non-zero for valid responses
 *   - Failed responses don't count against the budget
 *   - Spend accumulates across calls
 *   - isOverBudget() trips when total ≥ TRADEVISOR_DAILY_AI_BUDGET_USD
 *   - The 50-call simulation hits the cap as expected
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import {
  estimateCallCostUsd,
  recordEnsembleSpend,
  isOverBudget,
  getDailyBudgetUsd,
  resetSpendForTesting,
} from '../cost-tracker.js';
import type { ModelResponse } from '../types.js';

const ORIGINAL_FILE = process.env['TRADEVISOR_AI_SPEND_FILE'];
const ORIGINAL_BUDGET = process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'];

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ai-spend-test-'));
  process.env['TRADEVISOR_AI_SPEND_FILE'] = resolve(tmpDir, 'ai-spend.json');
  process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'] = '20';
  resetSpendForTesting();
  return () => {
    if (ORIGINAL_FILE === undefined) delete process.env['TRADEVISOR_AI_SPEND_FILE'];
    else process.env['TRADEVISOR_AI_SPEND_FILE'] = ORIGINAL_FILE;
    if (ORIGINAL_BUDGET === undefined) delete process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'];
    else process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'] = ORIGINAL_BUDGET;
    rmSync(tmpDir, { recursive: true, force: true });
  };
});

function r(model: string, opts: { reply?: string; tokensIn?: number; tokensOut?: number; error?: string } = {}): ModelResponse {
  const result: ModelResponse = {
    model,
    reply: opts.reply ?? 'ok',
    latencyMs: 100,
  };
  if (typeof opts.tokensIn === 'number') result.tokensIn = opts.tokensIn;
  if (typeof opts.tokensOut === 'number') result.tokensOut = opts.tokensOut;
  if (opts.error) {
    result.error = opts.error;
    result.reply = '';
  }
  return result;
}

describe('cost-tracker', () => {
  it('estimates non-zero cost for a successful response', () => {
    const cost = estimateCallCostUsd(r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 }));
    // Sonnet pricing: 5000/1M * $3 + 500/1M * $15 = 0.015 + 0.0075 = 0.0225
    expect(cost).toBeCloseTo(0.0225, 4);
  });

  it('falls back to flat per-call when token counts are unknown', () => {
    const cost = estimateCallCostUsd(r('claude-sonnet-4-6'));
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.10);
  });

  it('does not record spend for failed responses', () => {
    const result = recordEnsembleSpend([
      r('claude-sonnet-4-6', { error: 'timeout' }),
      r('gpt-4o', { error: 'HTTP 500' }),
      r('gemini-2.5-flash', { error: 'no-api-key' }),
    ]);
    expect(result.added).toBe(0);
    expect(result.total).toBe(0);
    expect(isOverBudget()).toBe(false);
  });

  it('accumulates spend across calls', () => {
    recordEnsembleSpend([r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 })]);
    const second = recordEnsembleSpend([r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 })]);
    expect(second.total).toBeCloseTo(0.045, 3); // 2× 0.0225
  });

  it('reads default daily budget of $20', () => {
    expect(getDailyBudgetUsd()).toBe(20);
  });

  it('flips isOverBudget when total exceeds budget', () => {
    process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'] = '0.05';
    expect(isOverBudget()).toBe(false);
    recordEnsembleSpend([r('claude-sonnet-4-6', { tokensIn: 10000, tokensOut: 1000 })]);
    // 10000/1M * 3 + 1000/1M * 15 = 0.03 + 0.015 = 0.045 < 0.05
    expect(isOverBudget()).toBe(false);
    recordEnsembleSpend([r('claude-sonnet-4-6', { tokensIn: 10000, tokensOut: 1000 })]);
    // Now total = 0.090 ≥ 0.05
    expect(isOverBudget()).toBe(true);
  });

  it('simulates 50 ensemble calls below budget — does NOT fall back', () => {
    // Each ensemble call ≈ $0.04. 50 × $0.04 = $2.00, well below $5 budget.
    process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'] = '5';
    let breachedAtCall: number | null = null;
    for (let i = 0; i < 50; i++) {
      if (isOverBudget()) {
        if (breachedAtCall === null) breachedAtCall = i;
        recordEnsembleSpend([r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 })]);
      } else {
        recordEnsembleSpend([
          r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 }),
          r('gpt-4o', { tokensIn: 5000, tokensOut: 500 }),
          r('gemini-2.5-flash', { tokensIn: 5000, tokensOut: 500 }),
        ]);
      }
    }
    // With a comfortable budget, 50 calls stay in ensemble mode — no breach.
    expect(breachedAtCall).toBeNull();
  });

  it('simulates 50 ensemble calls with a tight $1 budget — verifies fall-back triggers', () => {
    process.env['TRADEVISOR_DAILY_AI_BUDGET_USD'] = '1';
    let ensembleCalls = 0;
    let soloCalls = 0;
    for (let i = 0; i < 50; i++) {
      if (isOverBudget()) {
        soloCalls += 1;
        recordEnsembleSpend([r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 })]);
      } else {
        ensembleCalls += 1;
        recordEnsembleSpend([
          r('claude-sonnet-4-6', { tokensIn: 5000, tokensOut: 500 }),
          r('gpt-4o', { tokensIn: 5000, tokensOut: 500 }),
          r('gemini-2.5-flash', { tokensIn: 5000, tokensOut: 500 }),
        ]);
      }
    }
    expect(ensembleCalls).toBeGreaterThan(0);
    expect(soloCalls).toBeGreaterThan(0); // confirms fall-back kicked in
    expect(ensembleCalls + soloCalls).toBe(50);
  });
});
