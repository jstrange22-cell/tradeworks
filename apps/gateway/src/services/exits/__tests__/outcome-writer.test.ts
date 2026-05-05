/**
 * Unit tests for the outcome-writer math + reason mapping.
 *
 * The writer itself talks to pg via memory.upsertOutcome — that path is
 * already covered by `memory/__smoke__.ts` and degrades to no-op when
 * MEMORY_DB_URL is unset. These tests pin the pure functions only.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  computePnlUsd,
  computeRMultiple,
  mapReasonToExitReason,
  writeOutcome,
  writeOutcomeFromTrade,
} from '../outcome-writer.js';

describe('computePnlUsd', () => {
  it('long: profitable trade returns positive P&L', () => {
    // long, 100 sh, entry 50, exit 55 → +500 (no fees)
    expect(computePnlUsd(50, 55, 100, 'long')).toBe(500);
  });

  it('long: losing trade returns negative P&L', () => {
    expect(computePnlUsd(50, 45, 100, 'long')).toBe(-500);
  });

  it('short: profitable trade (price falls) returns positive P&L', () => {
    // short, 100 sh, entry 50, exit 45 → +500 (we sold high, bought back low)
    expect(computePnlUsd(50, 45, 100, 'short')).toBe(500);
  });

  it('short: losing trade (price rises) returns negative P&L', () => {
    expect(computePnlUsd(50, 55, 100, 'short')).toBe(-500);
  });

  it('subtracts fees from realised P&L', () => {
    expect(computePnlUsd(50, 55, 100, 'long', 12.5)).toBe(487.5);
  });

  it('handles fractional qty (crypto)', () => {
    // 0.5 BTC, entry 50000, exit 51000 → +500
    expect(computePnlUsd(50_000, 51_000, 0.5, 'long')).toBe(500);
  });
});

describe('computeRMultiple', () => {
  it('long: +2R when realized P&L = 2x risk per trade', () => {
    // entry 100, stop 95, qty 10 → risk = 5 * 10 = $50; pnl = $100 → 2R
    expect(computeRMultiple(100, 100, 95, 10)).toBe(2);
  });

  it('long: -1R when realized P&L = full stop loss', () => {
    // entry 100, stop 95, qty 10 → risk = $50; pnl = -$50 → -1R
    expect(computeRMultiple(-50, 100, 95, 10)).toBe(-1);
  });

  it('short: +2R when realized P&L = 2x risk (stop above entry)', () => {
    // short entry 100, stop 105, qty 10 → risk = 5 * 10 = $50; pnl = $100 → 2R
    expect(computeRMultiple(100, 100, 105, 10)).toBe(2);
  });

  it('returns null for stopless trades (no risk basis)', () => {
    expect(computeRMultiple(100, 100, null, 10)).toBeNull();
    expect(computeRMultiple(100, 100, undefined, 10)).toBeNull();
    expect(computeRMultiple(100, 100, 0, 10)).toBeNull();
  });

  it('returns null for malformed qty', () => {
    expect(computeRMultiple(100, 100, 95, 0)).toBeNull();
    expect(computeRMultiple(100, 100, 95, NaN)).toBeNull();
  });

  it('returns null when entry equals stop (zero risk)', () => {
    expect(computeRMultiple(100, 100, 100, 10)).toBeNull();
  });
});

describe('mapReasonToExitReason', () => {
  it('maps stop variants', () => {
    expect(mapReasonToExitReason('stop')).toBe('stop');
    expect(mapReasonToExitReason('hard_stop')).toBe('stop');
    expect(mapReasonToExitReason('STOP_LOSS')).toBe('stop');
  });

  it('maps target / take-profit variants', () => {
    expect(mapReasonToExitReason('target')).toBe('target');
    expect(mapReasonToExitReason('profit_target')).toBe('target');
    expect(mapReasonToExitReason('take_profit')).toBe('target');
    expect(mapReasonToExitReason('TP')).toBe('target');
  });

  it('maps trailing variants', () => {
    expect(mapReasonToExitReason('trail')).toBe('trail');
    expect(mapReasonToExitReason('trailing_tp')).toBe('trail');
  });

  it('maps time / expiry / IV crush to time', () => {
    expect(mapReasonToExitReason('time_stop')).toBe('time');
    expect(mapReasonToExitReason('expiry')).toBe('time');
    expect(mapReasonToExitReason('iv_crush')).toBe('time');
  });

  it('maps APEX-driven closes', () => {
    expect(mapReasonToExitReason('apex_close')).toBe('apex_close');
    expect(mapReasonToExitReason('tv_sell')).toBe('apex_close');
    expect(mapReasonToExitReason('kill_switch')).toBe('apex_close');
  });

  it('falls back to manual for unknown reasons', () => {
    expect(mapReasonToExitReason('legacy')).toBe('manual');
    expect(mapReasonToExitReason('made-up-reason')).toBe('manual');
  });
});

describe('writeOutcome (memory wiring)', () => {
  it('returns null and does not throw when decisionId is missing', async () => {
    // No decisionId → no attribution. Memory is never touched.
    const result = await writeOutcome({
      decisionId: null,
      realizedPnlUsd: 123.45,
      exitReason: 'apex_close',
    });
    expect(result).toBeNull();
  });

  it('returns null and does not throw when decisionId is undefined', async () => {
    const result = await writeOutcome({
      decisionId: undefined,
      realizedPnlUsd: 123.45,
      exitReason: 'apex_close',
    });
    expect(result).toBeNull();
  });
});

describe('writeOutcomeFromTrade', () => {
  it('returns null for trades without a decisionId', async () => {
    const result = await writeOutcomeFromTrade({
      decisionId: null,
      entryPrice: 100,
      exitPrice: 105,
      qty: 10,
      openedAt: new Date(),
      exitReason: 'tv_sell',
    });
    expect(result).toBeNull();
  });

  it('does not throw when memory DB is offline (real-world path)', async () => {
    // Without MEMORY_DB_URL set, upsertOutcome returns null and logs a warn —
    // we just want to confirm the writer never propagates the failure.
    vi.stubEnv('MEMORY_DB_URL', '');
    await expect(
      writeOutcomeFromTrade({
        decisionId: '00000000-0000-0000-0000-000000000000',
        entryPrice: 100,
        exitPrice: 105,
        qty: 10,
        openedAt: new Date(),
        exitReason: 'tv_sell',
      }),
    ).resolves.toBeNull();
    vi.unstubAllEnvs();
  });
});
