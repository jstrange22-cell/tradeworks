/**
 * Unit tests for the ensemble consensus algorithm.
 *
 * Covers:
 *   - Full consensus (3-of-3) → mean confidence
 *   - 2-of-3 consensus → 0.7 × mean, dissenter recorded
 *   - 3-way disagreement → ALWAYS escalate, confidence=0
 *   - Single voice → lone-voice penalty + insufficient flag
 *   - Empty input → veto + insufficient flag
 */
import { describe, it, expect } from 'vitest';
import { detectConsensus } from '../consensus.js';
import type { ModelVerdict } from '../consensus.js';

function v(model: string, verdict: 'approve' | 'veto' | 'escalate', confidence = 0.8, size: number | null = 250, stopPct = -5): ModelVerdict {
  return {
    model,
    verdict,
    confidence,
    reasoning: `${model} thinks ${verdict}`,
    adjustedSizeUsd: size,
    adjustedStopPct: stopPct,
  };
}

describe('detectConsensus', () => {
  it('returns full agreement for 3-of-3 approve', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.9, 250),
      v('gpt-4o', 'approve', 0.8, 200),
      v('gemini', 'approve', 0.7, 300),
    ]);
    expect(result.verdict).toBe('approve');
    expect(result.agreement).toBe(1);
    expect(result.dissenters).toHaveLength(0);
    expect(result.agreeing).toHaveLength(3);
    // Mean of 0.9, 0.8, 0.7 = 0.8
    expect(result.confidence).toBeCloseTo(0.8, 2);
    // Median size = 250
    expect(result.adjustedSizeUsd).toBe(250);
    expect(result.insufficient).toBe(false);
  });

  it('returns 2-of-3 consensus with dissenter recorded', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.8),
      v('gpt-4o', 'approve', 0.6),
      v('gemini', 'veto', 0.9),
    ]);
    expect(result.verdict).toBe('approve');
    expect(result.agreement).toBeCloseTo(2 / 3, 2);
    expect(result.dissenters).toHaveLength(1);
    expect(result.dissenters[0]?.model).toBe('gemini');
    // 2-of-3 confidence = 0.7 × mean(0.8, 0.6) = 0.7 × 0.7 = 0.49
    expect(result.confidence).toBeCloseTo(0.49, 2);
    expect(result.insufficient).toBe(false);
  });

  it('ALWAYS escalates on a 3-way disagreement, regardless of confidence', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.95),
      v('gpt-4o', 'veto', 0.95),
      v('gemini', 'escalate', 0.95),
    ]);
    expect(result.verdict).toBe('escalate');
    expect(result.confidence).toBe(0);
    expect(result.dissenters).toHaveLength(3);
    expect(result.agreement).toBeCloseTo(1 / 3, 2);
    expect(result.summary).toContain('3-way disagreement');
    expect(result.insufficient).toBe(false);
  });

  it('handles a single valid response with lone-voice penalty', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.9, 250),
    ]);
    expect(result.verdict).toBe('approve');
    expect(result.confidence).toBeCloseTo(0.9 * 0.7, 2);
    expect(result.insufficient).toBe(true); // caller should still treat as low-trust
    expect(result.adjustedSizeUsd).toBe(250);
  });

  it('returns veto + insufficient on empty input', () => {
    const result = detectConsensus([]);
    expect(result.verdict).toBe('veto');
    expect(result.confidence).toBe(0);
    expect(result.insufficient).toBe(true);
  });

  it('nullifies adjustedSize for non-approve verdicts', () => {
    const result = detectConsensus([
      v('claude', 'veto', 0.9, 500),
      v('gpt-4o', 'veto', 0.85, 600),
      v('gemini', 'approve', 0.7, 300),
    ]);
    expect(result.verdict).toBe('veto');
    expect(result.adjustedSizeUsd).toBeNull(); // even though majority offered sizes
  });

  it('handles 2-of-2 perfect agreement (e.g. when 1 model failed)', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.85),
      v('gpt-4o', 'approve', 0.75),
    ]);
    expect(result.verdict).toBe('approve');
    expect(result.agreement).toBe(1);
    expect(result.confidence).toBeCloseTo(0.8, 2);
  });

  it('handles 1-of-2 split as 50/50 — picks majority deterministically', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.8),
      v('gpt-4o', 'veto', 0.8),
    ]);
    // With exactly 2 verdicts split 1/1, neither bucket is dominant by count.
    // The implementation picks whichever bucket was iterated first (Map insertion order).
    // Either verdict is acceptable here — what matters is dissent is recorded.
    expect(['approve', 'veto']).toContain(result.verdict);
    expect(result.agreement).toBe(0.5);
    expect(result.dissenters).toHaveLength(1);
  });

  it('clamps confidence to [0, 1]', () => {
    const result = detectConsensus([
      v('claude', 'approve', 1.5), // out of bounds
      v('gpt-4o', 'approve', 0.9),
      v('gemini', 'approve', 0.9),
    ]);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('uses median for size and stop selection in agreeing bucket', () => {
    const result = detectConsensus([
      v('claude', 'approve', 0.8, 100, -3),
      v('gpt-4o', 'approve', 0.8, 200, -5),
      v('gemini', 'approve', 0.8, 300, -7),
    ]);
    expect(result.adjustedSizeUsd).toBe(200);
    expect(result.adjustedStopPct).toBe(-5);
  });
});
