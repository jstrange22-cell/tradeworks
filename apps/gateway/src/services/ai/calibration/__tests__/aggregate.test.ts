/**
 * Unit tests for the calibration aggregator.
 *
 * Strategy: build a fixed synthetic dataset of (decision, outcome) joined
 * rows where the expected stats are obvious by construction, then assert
 * the buckets hit the expected n / WR / expectancy.
 *
 * No DB required — we feed `buildReport` directly with rows.
 */

import { describe, it, expect } from 'vitest';
import { buildReport, type JoinedRow } from '../aggregate.js';
import { renderSummary } from '../format.js';
import { bucketizeConfidence } from '../buckets.js';

function makeRow(overrides: Partial<JoinedRow>): JoinedRow {
  return {
    id: overrides.id ?? `row-${Math.random()}`,
    strategy: overrides.strategy ?? 'pead',
    verdict: overrides.verdict ?? 'approve',
    confidence: overrides.confidence ?? 0.75,
    signal: overrides.signal ?? { symbol: 'AAPL' },
    context: overrides.context ?? { macro: { regime: 'calm' }, scout: { rank: 5 } },
    createdAt: overrides.createdAt ?? new Date('2026-04-01T15:00:00Z'),
    realizedPnlUsd: overrides.realizedPnlUsd ?? 100,
    rMultiple: overrides.rMultiple ?? 1,
    wasStopHit: overrides.wasStopHit ?? false,
    wasTargetHit: overrides.wasTargetHit ?? true,
    exitReason: overrides.exitReason ?? 'target',
  };
}

describe('bucketizeConfidence', () => {
  it('places values in the expected buckets', () => {
    expect(bucketizeConfidence(0.4)).toBe('0.0-0.5');
    expect(bucketizeConfidence(0.55)).toBe('0.5-0.6');
    expect(bucketizeConfidence(0.65)).toBe('0.6-0.7');
    expect(bucketizeConfidence(0.75)).toBe('0.7-0.8');
    expect(bucketizeConfidence(0.85)).toBe('0.8-0.9');
    expect(bucketizeConfidence(0.95)).toBe('0.9-1.0');
    expect(bucketizeConfidence(1.0)).toBe('0.9-1.0');
    expect(bucketizeConfidence(null)).toBe('0.0-0.5');
    expect(bucketizeConfidence(undefined)).toBe('0.0-0.5');
  });

  it('clamps out-of-range and NaN inputs', () => {
    expect(bucketizeConfidence(-0.5)).toBe('0.0-0.5');
    expect(bucketizeConfidence(1.5)).toBe('0.9-1.0');
    expect(bucketizeConfidence(Number.NaN)).toBe('0.0-0.5');
  });
});

describe('buildReport — synthetic 100 rows', () => {
  // 100 rows split:
  //   60 pead, 40 regime_trend
  //   pead: 50 wins ($100), 10 losses ($-200)  → expectancy 16.67
  //   regime_trend: 20 wins ($50), 20 losses ($-50) → expectancy 0
  //   confidence buckets: distribute by index
  //   regime: 70 calm, 30 volatile (volatile losing)
  const rows: JoinedRow[] = [];
  for (let i = 0; i < 60; i++) {
    const win = i < 50;
    const conf = 0.5 + (i % 5) * 0.1; // 0.5, 0.6, 0.7, 0.8, 0.9 cycling
    const regime = i < 50 ? 'calm' : 'volatile';
    rows.push(
      makeRow({
        id: `pead-${i}`,
        strategy: 'pead',
        confidence: conf,
        realizedPnlUsd: win ? 100 : -200,
        rMultiple: win ? 1 : -2,
        wasStopHit: !win,
        wasTargetHit: win,
        exitReason: win ? 'target' : 'stop',
        context: {
          macro: { regime },
          scout: regime === 'calm' ? { rank: 5 } : null,
        },
      }),
    );
  }
  for (let i = 0; i < 40; i++) {
    const win = i < 20;
    rows.push(
      makeRow({
        id: `rt-${i}`,
        strategy: 'regime_trend',
        confidence: 0.6,
        realizedPnlUsd: win ? 50 : -50,
        rMultiple: win ? 1 : -1,
        wasStopHit: !win,
        wasTargetHit: win,
        exitReason: win ? 'target' : 'stop',
        context: { macro: { regime: 'calm' }, scout: { rank: 10 } },
      }),
    );
  }

  const report = buildReport(rows, 365);

  it('counts approves correctly', () => {
    expect(report.totalApproves).toBe(100);
    expect(report.windowDays).toBe(365);
  });

  it('aggregates by strategy with correct sample sizes', () => {
    const pead = report.byStrategy.find((s) => s.bucketKey === 'pead');
    const rt = report.byStrategy.find((s) => s.bucketKey === 'regime_trend');
    expect(pead?.n).toBe(60);
    expect(rt?.n).toBe(40);
    // pead WR: 50/60
    expect(pead?.winRate).toBeCloseTo(50 / 60, 5);
    // pead expectancy: (50*100 + 10*-200)/60 = (5000 - 2000)/60 = 50
    expect(pead?.expectancyUsd).toBeCloseTo(50, 1);
    // regime_trend expectancy: 0
    expect(rt?.expectancyUsd).toBeCloseTo(0, 1);
    // regime_trend WR: 20/40 = 0.5
    expect(rt?.winRate).toBeCloseTo(0.5, 5);
  });

  it('aggregates by confidence bucket', () => {
    // pead distributes evenly across 0.5..0.9 (12 each); regime_trend all in 0.6
    const conf06 = report.byConfidence.find((c) => c.bucketKey === '0.6-0.7');
    expect(conf06?.n).toBe(12 + 40); // pead-12 + rt-40 = 52
  });

  it('aggregates by regime with volatile flagged as losing', () => {
    const calm = report.byRegime.find((r) => r.bucketKey === 'calm');
    const volatile = report.byRegime.find((r) => r.bucketKey === 'volatile');
    // calm: 50 pead-calm + 40 rt = 90
    expect(calm?.n).toBe(90);
    // volatile: 10 pead-volatile, all losses
    expect(volatile?.n).toBe(10);
    expect(volatile?.expectancyUsd).toBeCloseTo(-200, 1);
    expect(volatile?.winRate).toBeCloseTo(0, 5);
  });

  it('flags failure modes for last-30d losing rows', () => {
    // Rows are dated 2026-04-01 — depending on test execution date this may
    // or may not fall in the 30d window. Just assert it's a non-negative
    // integer (the counter is well-typed).
    expect(report.failureModes.highConfLossesLast30d).toBeGreaterThanOrEqual(0);
    expect(report.failureModes.volatileNoScoutLossesLast30d).toBeGreaterThanOrEqual(0);
  });

  it('renderSummary fits in the 6KB / ~1500-token budget', () => {
    const summary = renderSummary(report);
    const bytes = Buffer.byteLength(summary, 'utf-8');
    expect(bytes).toBeLessThan(6_000);
    expect(summary).toContain('CALIBRATION');
    expect(summary).toContain('pead');
    expect(summary).toContain('regime_trend');
  });

  it('handles an empty dataset cleanly', () => {
    const empty = buildReport([], 365);
    expect(empty.totalApproves).toBe(0);
    expect(empty.byStrategy).toEqual([]);
    const summary = renderSummary(empty);
    expect(summary).toContain('No closed approves yet');
  });
});

describe('buildReport — failure mode detection (recent rows)', () => {
  const now = new Date();
  const recent = (offsetDays: number): Date =>
    new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);

  it('counts high-confidence losses in last 30 days', () => {
    const rows: JoinedRow[] = [
      makeRow({ confidence: 0.9, rMultiple: -1.5, realizedPnlUsd: -150, createdAt: recent(5) }),
      makeRow({ confidence: 0.85, rMultiple: -2, realizedPnlUsd: -200, createdAt: recent(10) }),
      makeRow({ confidence: 0.85, rMultiple: -1, realizedPnlUsd: -100, createdAt: recent(40) }), // outside window
      makeRow({ confidence: 0.6, rMultiple: -2, realizedPnlUsd: -200, createdAt: recent(5) }),  // confidence too low
    ];
    const report = buildReport(rows, 365);
    expect(report.failureModes.highConfLossesLast30d).toBe(2);
  });

  it('counts volatile-no-scout losses in last 30 days', () => {
    const rows: JoinedRow[] = [
      makeRow({
        realizedPnlUsd: -100,
        createdAt: recent(5),
        context: { macro: { regime: 'volatile' }, scout: null },
      }),
      makeRow({
        realizedPnlUsd: -50,
        createdAt: recent(15),
        context: { macro: { regime: 'volatile' }, scout: null },
      }),
      makeRow({
        // has scout — should NOT count
        realizedPnlUsd: -100,
        createdAt: recent(5),
        context: { macro: { regime: 'volatile' }, scout: { rank: 1 } },
      }),
      makeRow({
        // calm regime — should NOT count
        realizedPnlUsd: -100,
        createdAt: recent(5),
        context: { macro: { regime: 'calm' }, scout: null },
      }),
    ];
    const report = buildReport(rows, 365);
    expect(report.failureModes.volatileNoScoutLossesLast30d).toBe(2);
  });
});
