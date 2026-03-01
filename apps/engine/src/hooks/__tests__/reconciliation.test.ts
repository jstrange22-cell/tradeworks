import { describe, it, expect, vi } from 'vitest';
import { reconcilePositions, runFullReconciliation } from '../../reconciliation.js';
import type { EnginePosition } from '../../engines/crypto/coinbase-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePosition(instrument: string, qty: number, side: 'buy' | 'sell' = 'buy'): EnginePosition {
  return {
    instrument,
    side,
    quantity: qty,
    entryPrice: 100,
    currentPrice: 105,
    unrealizedPnl: qty * 5,
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// reconcilePositions
// ---------------------------------------------------------------------------

describe('reconcilePositions', () => {
  it('should return reconciled=true when positions match exactly', async () => {
    const exchange = [makePosition('BTC_USDT', 0.5)];
    const db = [makePosition('BTC_USDT', 0.5)];

    const result = await reconcilePositions('coinbase', exchange, db);

    expect(result.reconciled).toBe(true);
    expect(result.newPositions).toHaveLength(0);
    expect(result.stalePositions).toHaveLength(0);
    expect(result.mismatchedPositions).toHaveLength(0);
  });

  it('should detect new positions (exchange-only)', async () => {
    const exchange = [makePosition('BTC_USDT', 0.5), makePosition('ETH_USDT', 2.0)];
    const db = [makePosition('BTC_USDT', 0.5)];

    const result = await reconcilePositions('coinbase', exchange, db);

    expect(result.reconciled).toBe(false);
    expect(result.newPositions).toHaveLength(1);
    expect(result.newPositions[0].instrument).toBe('ETH_USDT');
  });

  it('should detect stale positions (DB-only)', async () => {
    const exchange = [makePosition('BTC_USDT', 0.5)];
    const db = [makePosition('BTC_USDT', 0.5), makePosition('SOL_USDT', 10)];

    const result = await reconcilePositions('coinbase', exchange, db);

    expect(result.reconciled).toBe(false);
    expect(result.stalePositions).toHaveLength(1);
    expect(result.stalePositions[0].instrument).toBe('SOL_USDT');
  });

  it('should detect mismatched quantities', async () => {
    const exchange = [makePosition('BTC_USDT', 0.5)];
    const db = [makePosition('BTC_USDT', 0.3)];

    const result = await reconcilePositions('coinbase', exchange, db);

    expect(result.reconciled).toBe(false);
    expect(result.mismatchedPositions).toHaveLength(1);
    expect(result.mismatchedPositions[0].exchangeQty).toBe(0.5);
    expect(result.mismatchedPositions[0].dbQty).toBe(0.3);
    expect(result.mismatchedPositions[0].diff).toBeCloseTo(0.2, 8);
  });

  it('should ignore floating-point noise below epsilon', async () => {
    const exchange = [makePosition('BTC_USDT', 0.5)];
    const db = [makePosition('BTC_USDT', 0.5 + 1e-10)];

    const result = await reconcilePositions('coinbase', exchange, db);

    expect(result.reconciled).toBe(true);
    expect(result.mismatchedPositions).toHaveLength(0);
  });

  it('should handle empty exchange and empty DB', async () => {
    const result = await reconcilePositions('coinbase', [], []);

    expect(result.reconciled).toBe(true);
    expect(result.exchange).toBe('coinbase');
  });

  it('should handle empty exchange with DB positions', async () => {
    const db = [makePosition('BTC_USDT', 1.0)];
    const result = await reconcilePositions('coinbase', [], db);

    expect(result.reconciled).toBe(false);
    expect(result.stalePositions).toHaveLength(1);
  });

  it('should handle exchange positions with empty DB', async () => {
    const exchange = [makePosition('BTC_USDT', 1.0)];
    const result = await reconcilePositions('coinbase', exchange, []);

    expect(result.reconciled).toBe(false);
    expect(result.newPositions).toHaveLength(1);
  });

  it('should detect all three discrepancy types simultaneously', async () => {
    const exchange = [
      makePosition('BTC_USDT', 0.5),  // match (but qty differs)
      makePosition('ETH_USDT', 2.0),  // new (exchange-only)
    ];
    const db = [
      makePosition('BTC_USDT', 0.3),  // mismatch
      makePosition('SOL_USDT', 10),    // stale (DB-only)
    ];

    const result = await reconcilePositions('coinbase', exchange, db);

    expect(result.reconciled).toBe(false);
    expect(result.newPositions).toHaveLength(1);
    expect(result.stalePositions).toHaveLength(1);
    expect(result.mismatchedPositions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// runFullReconciliation
// ---------------------------------------------------------------------------

describe('runFullReconciliation', () => {
  it('should reconcile multiple engines', async () => {
    const engines = {
      coinbase: {
        getPositions: vi.fn().mockResolvedValue([makePosition('BTC_USDT', 0.5)]),
      },
      alpaca: {
        getPositions: vi.fn().mockResolvedValue([makePosition('AAPL', 10)]),
      },
    };

    const dbPositions = [makePosition('BTC_USDT', 0.5), makePosition('AAPL', 10)];
    const getDbPositions = vi.fn().mockResolvedValue(dbPositions);

    const results = await runFullReconciliation(engines, getDbPositions);

    expect(results).toHaveLength(2);
    expect(results[0].reconciled).toBe(true);
    expect(results[1].reconciled).toBe(true);
    expect(getDbPositions).toHaveBeenCalledOnce();
  });

  it('should continue if one engine fails', async () => {
    const engines = {
      coinbase: {
        getPositions: vi.fn().mockRejectedValue(new Error('API down')),
      },
      alpaca: {
        getPositions: vi.fn().mockResolvedValue([makePosition('AAPL', 10)]),
      },
    };

    const getDbPositions = vi.fn().mockResolvedValue([makePosition('AAPL', 10)]);

    const results = await runFullReconciliation(engines, getDbPositions);

    // Only the successful engine should have a result
    expect(results).toHaveLength(1);
    expect(results[0].exchange).toBe('alpaca');
  });

  it('should abort if DB fetch fails', async () => {
    const engines = {
      coinbase: {
        getPositions: vi.fn().mockResolvedValue([]),
      },
    };

    const getDbPositions = vi.fn().mockRejectedValue(new Error('DB connection failed'));

    const results = await runFullReconciliation(engines, getDbPositions);

    expect(results).toHaveLength(0);
    expect(engines.coinbase.getPositions).not.toHaveBeenCalled();
  });

  it('should handle no engines', async () => {
    const getDbPositions = vi.fn().mockResolvedValue([]);
    const results = await runFullReconciliation({}, getDbPositions);

    expect(results).toHaveLength(0);
    expect(getDbPositions).not.toHaveBeenCalled();
  });

  it('should call autoCorrect callback when discrepancies found', async () => {
    const engines = {
      coinbase: {
        getPositions: vi.fn().mockResolvedValue([makePosition('BTC_USDT', 0.5)]),
      },
    };

    const getDbPositions = vi.fn().mockResolvedValue([]); // Empty DB = discrepancy
    const updateDbPositions = vi.fn().mockResolvedValue(undefined);

    const results = await runFullReconciliation(engines, getDbPositions, {
      autoCorrect: true,
      updateDbPositions,
    });

    expect(results).toHaveLength(1);
    expect(results[0].reconciled).toBe(false);
    expect(updateDbPositions).toHaveBeenCalledWith('coinbase', [expect.objectContaining({ instrument: 'BTC_USDT' })]);
  });

  it('should not call autoCorrect when positions match', async () => {
    const engines = {
      coinbase: {
        getPositions: vi.fn().mockResolvedValue([makePosition('BTC_USDT', 0.5)]),
      },
    };

    const getDbPositions = vi.fn().mockResolvedValue([makePosition('BTC_USDT', 0.5)]);
    const updateDbPositions = vi.fn().mockResolvedValue(undefined);

    await runFullReconciliation(engines, getDbPositions, {
      autoCorrect: true,
      updateDbPositions,
    });

    expect(updateDbPositions).not.toHaveBeenCalled();
  });
});
