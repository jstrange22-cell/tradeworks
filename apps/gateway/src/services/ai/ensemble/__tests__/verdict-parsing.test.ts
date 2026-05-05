/**
 * Tests for parseEnsembleVerdict — the JSON parser that extracts a
 * structured verdict from each ensemble model's raw text output.
 */
import { describe, it, expect } from 'vitest';
import { parseEnsembleVerdict } from '../../tradevisor-agent/ensemble-reasoner.js';
import type { ModelResponse } from '../types.js';

function r(reply: string, model = 'claude-sonnet-4-6'): ModelResponse {
  return { model, reply, latencyMs: 100 };
}

describe('parseEnsembleVerdict', () => {
  it('parses a clean JSON verdict', () => {
    const v = parseEnsembleVerdict(r(JSON.stringify({
      verdict: 'approve',
      reasoning: 'looks good',
      confidence: 0.85,
      adjustedSizeUsd: 250,
      adjustedStopPct: -5,
    })));
    expect(v).not.toBeNull();
    expect(v?.verdict).toBe('approve');
    expect(v?.confidence).toBe(0.85);
    expect(v?.adjustedSizeUsd).toBe(250);
    expect(v?.adjustedStopPct).toBe(-5);
  });

  it('strips markdown fences', () => {
    const v = parseEnsembleVerdict(r('```json\n{"verdict":"veto","reasoning":"news bad","confidence":0.9,"adjustedSizeUsd":null,"adjustedStopPct":-5}\n```'));
    expect(v?.verdict).toBe('veto');
  });

  it('returns null for invalid JSON', () => {
    expect(parseEnsembleVerdict(r('not json at all'))).toBeNull();
    expect(parseEnsembleVerdict(r('{ broken'))).toBeNull();
  });

  it('returns null for invalid verdict string', () => {
    expect(parseEnsembleVerdict(r(JSON.stringify({
      verdict: 'maybe',
      reasoning: 'meh',
      confidence: 0.5,
      adjustedSizeUsd: null,
      adjustedStopPct: -5,
    })))).toBeNull();
  });

  it('returns null when model errored', () => {
    expect(parseEnsembleVerdict({ model: 'gpt-4o', reply: '', latencyMs: 0, error: 'timeout' })).toBeNull();
  });

  it('clamps confidence to [0,1]', () => {
    const v = parseEnsembleVerdict(r(JSON.stringify({
      verdict: 'approve',
      reasoning: '',
      confidence: 1.5,
      adjustedSizeUsd: 100,
      adjustedStopPct: -5,
    })));
    expect(v?.confidence).toBe(1);
  });

  it('clamps stop pct to [-10, -1]', () => {
    const v = parseEnsembleVerdict(r(JSON.stringify({
      verdict: 'approve',
      reasoning: '',
      confidence: 0.8,
      adjustedSizeUsd: 100,
      adjustedStopPct: -50,
    })));
    expect(v?.adjustedStopPct).toBe(-10);
  });

  it('handles JSON embedded in surrounding prose', () => {
    const v = parseEnsembleVerdict(r('Here is my answer:\n{"verdict":"escalate","reasoning":"big trade","confidence":0.7,"adjustedSizeUsd":null,"adjustedStopPct":-5}\nLet me know.'));
    expect(v?.verdict).toBe('escalate');
  });
});
