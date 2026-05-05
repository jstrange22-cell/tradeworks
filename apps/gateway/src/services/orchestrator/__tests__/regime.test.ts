/**
 * Regime classifier tests — synthetic signals only.
 *
 * Covers all four regimes and edge cases at the threshold boundaries.
 * Live SPY/VIX fetchers are not exercised here (those are integration
 * concerns); we only test the pure `classify()` function and the
 * sizing/heat helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetRegimeCacheForTests,
  classify,
  getHeatBudgetScalar,
  isCrisisGate,
} from '../regime.js';
import type { RegimeSignals } from '../regime-types.js';

// Build a baseline "calm" signal — anything that doesn't trip a rule.
function calmSignals(overrides: Partial<RegimeSignals> = {}): RegimeSignals {
  return {
    spyClose: 500,
    spy200ma: 460, // SPY above 200 MA but no big move
    spy50ma: 490,
    vix: 15,
    btcDominance: 55,
    dxy: 104,
    spy20dReturn: 0.005,        // +0.5% — no decisive move
    spy20dRealizedVol: 0.12,    // 12% — well under volatile threshold
    ...overrides,
  };
}

describe('classify()', () => {
  describe('calm regime', () => {
    it('default calm signals → calm tag', () => {
      const result = classify(calmSignals());
      expect(result.tag).toBe('calm');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.rationale).toContain('calm');
    });

    it('SPY above 200 MA but flat 20d return → still calm', () => {
      const result = classify(calmSignals({ spy20dReturn: 0.02, vix: 14 }));
      // 20d return 2% is under the 3% trend threshold.
      expect(result.tag).toBe('calm');
    });

    it('VIX just under volatile threshold → calm with lower confidence', () => {
      const result = classify(calmSignals({ vix: 21 }));
      expect(result.tag).toBe('calm');
      // We're close to the volatile boundary, so confidence should be modest.
      expect(result.confidence).toBeLessThan(0.85);
    });
  });

  describe('trending regime', () => {
    it('SPY up >3% in 20d, above 200 MA, low VIX → trending', () => {
      const result = classify(calmSignals({ spy20dReturn: 0.05, vix: 14 }));
      expect(result.tag).toBe('trending');
      expect(result.rationale).toContain('trending');
    });

    it('SPY down >3% in 20d, above 200 MA, low VIX → trending (downside)', () => {
      // Even a downward 20d move counts as trending (|ret| > threshold).
      const result = classify(calmSignals({ spy20dReturn: -0.04, vix: 14 }));
      expect(result.tag).toBe('trending');
    });

    it('strong trend has higher confidence than borderline trend', () => {
      const borderline = classify(calmSignals({ spy20dReturn: 0.031, vix: 14 }));
      const strong = classify(calmSignals({ spy20dReturn: 0.08, vix: 12 }));
      expect(strong.confidence).toBeGreaterThan(borderline.confidence);
    });

    it('SPY below 200 MA blocks trending classification', () => {
      const result = classify(
        calmSignals({ spyClose: 450, spy200ma: 460, spy20dReturn: 0.05, vix: 14 }),
      );
      // Below 200 MA + VIX 14 is no rule → calm.
      expect(result.tag).toBe('calm');
    });
  });

  describe('volatile regime', () => {
    it('VIX just over 22 → volatile', () => {
      const result = classify(calmSignals({ vix: 23 }));
      expect(result.tag).toBe('volatile');
      expect(result.rationale).toContain('volatile');
    });

    it('VIX 24 borderline confidence ~0.6', () => {
      const result = classify(calmSignals({ vix: 24 }));
      expect(result.tag).toBe('volatile');
      expect(result.confidence).toBeGreaterThan(0.55);
      expect(result.confidence).toBeLessThan(0.75);
    });

    it('high realized vol triggers volatile even with low VIX', () => {
      const result = classify(calmSignals({ spy20dRealizedVol: 0.30, vix: 18 }));
      expect(result.tag).toBe('volatile');
    });

    it('volatile takes precedence over trending when VIX > 22', () => {
      // SPY up 5% AND VIX 23 — volatile rule fires first per spec
      // (trend rule requires VIX < 22).
      const result = classify(calmSignals({ spy20dReturn: 0.05, vix: 23 }));
      expect(result.tag).toBe('volatile');
    });
  });

  describe('crisis regime', () => {
    it('VIX > 35 → crisis', () => {
      const result = classify(calmSignals({ vix: 40 }));
      expect(result.tag).toBe('crisis');
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('VIX 50 → very high confidence crisis', () => {
      const result = classify(calmSignals({ vix: 50 }));
      expect(result.tag).toBe('crisis');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('SPY below 200 MA + VIX > 25 → crisis', () => {
      const result = classify(
        calmSignals({ spyClose: 450, spy200ma: 460, vix: 28 }),
      );
      expect(result.tag).toBe('crisis');
    });

    it('20d return < -10% → crisis', () => {
      const result = classify(calmSignals({ spy20dReturn: -0.12, vix: 18 }));
      expect(result.tag).toBe('crisis');
    });

    it('crisis dominates volatile (multiple rules fire)', () => {
      // VIX 40 fires both volatile and crisis; crisis wins.
      const result = classify(
        calmSignals({ spyClose: 450, spy200ma: 460, vix: 40, spy20dReturn: -0.15 }),
      );
      expect(result.tag).toBe('crisis');
    });

    it('borderline crisis (VIX exactly 36) confidence is moderate', () => {
      const result = classify(calmSignals({ vix: 36 }));
      expect(result.tag).toBe('crisis');
      expect(result.confidence).toBeGreaterThan(0.55);
      expect(result.confidence).toBeLessThan(0.85);
    });
  });

  describe('confidence scaling', () => {
    it('all confidences are in [0, 1]', () => {
      const cases: Array<Partial<RegimeSignals>> = [
        {},                                           // calm
        { spy20dReturn: 0.05, vix: 14 },              // trending
        { vix: 23 },                                  // volatile
        { vix: 50 },                                  // crisis
        { spy20dReturn: -0.30 },                      // crash
        { vix: 100 },                                 // pathological VIX
      ];
      for (const c of cases) {
        const r = classify(calmSignals(c));
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe('getHeatBudgetScalar()', () => {
  const ORIG_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('returns 1.0 for calm', () => {
    expect(getHeatBudgetScalar('calm')).toBe(1.0);
  });

  it('returns 1.0 for trending', () => {
    expect(getHeatBudgetScalar('trending')).toBe(1.0);
  });

  it('returns 0.6 default for volatile', () => {
    delete process.env['HEAT_REGIME_VOLATILE_SCALAR'];
    expect(getHeatBudgetScalar('volatile')).toBe(0.6);
  });

  it('returns 0.6 default for crisis', () => {
    delete process.env['HEAT_REGIME_VOLATILE_SCALAR'];
    expect(getHeatBudgetScalar('crisis')).toBe(0.6);
  });

  it('respects HEAT_REGIME_VOLATILE_SCALAR env var', () => {
    process.env['HEAT_REGIME_VOLATILE_SCALAR'] = '0.4';
    expect(getHeatBudgetScalar('crisis')).toBe(0.4);
    expect(getHeatBudgetScalar('volatile')).toBe(0.4);
  });

  it('ignores invalid scalar values', () => {
    process.env['HEAT_REGIME_VOLATILE_SCALAR'] = 'not-a-number';
    expect(getHeatBudgetScalar('volatile')).toBe(0.6);

    process.env['HEAT_REGIME_VOLATILE_SCALAR'] = '-0.5';
    expect(getHeatBudgetScalar('volatile')).toBe(0.6);

    process.env['HEAT_REGIME_VOLATILE_SCALAR'] = '2.0';
    expect(getHeatBudgetScalar('volatile')).toBe(0.6);
  });
});

describe('isCrisisGate()', () => {
  it('returns true only for crisis', () => {
    expect(isCrisisGate('crisis')).toBe(true);
    expect(isCrisisGate('calm')).toBe(false);
    expect(isCrisisGate('trending')).toBe(false);
    expect(isCrisisGate('volatile')).toBe(false);
  });
});

describe('regime cache reset (test-only helper)', () => {
  beforeEach(() => {
    _resetRegimeCacheForTests();
  });

  it('does not throw and is idempotent', () => {
    expect(() => _resetRegimeCacheForTests()).not.toThrow();
    expect(() => _resetRegimeCacheForTests()).not.toThrow();
  });
});
