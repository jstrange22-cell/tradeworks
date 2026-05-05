/**
 * RAG retrieval + format unit test.
 *
 * The DB is mocked at the `getPool()` boundary so we don't need a live pgvector
 * instance. We seed a synthetic 30-row result and assert:
 *   - retrieval shapes the join into SimilarTrade[] correctly
 *   - format produces the expected sectioned output (## SIMILAR PAST TRADES,
 *     summary line with W/L/avgR/expectancy, numbered match list, pattern note)
 *   - sample-size guard kicks in when n < 5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimilarTrade } from '../rag.js';

// ── Build deterministic 30-row fixture set ──────────────────────────────

interface FakeRow {
  decision_id: string;
  similarity: number;
  created_at: Date;
  strategy: string;
  signal: unknown;
  context: unknown;
  o_realized_pnl_usd: number | null;
  o_r_multiple: number | null;
  o_exit_reason: string | null;
  o_holding_minutes: number | null;
  o_closed_at: Date | null;
}

function makeRow(i: number, opts: {
  symbol: string;
  action: 'buy' | 'sell';
  regime: string;
  grade: string;
  rMultiple: number;
  pnlUsd: number;
  exitReason: string;
  holdingMinutes: number;
  similarity: number;
}): FakeRow {
  return {
    decision_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    similarity: opts.similarity,
    created_at: new Date(`2026-03-${String((i % 28) + 1).padStart(2, '0')}T14:30:00Z`),
    strategy: 'tradevisor',
    signal: {
      symbol: opts.symbol,
      action: opts.action,
      grade: opts.grade,
      score: 5,
    },
    context: {
      macro: { regime: opts.regime },
      scout: { rank: i + 1 },
      news: [{ headline: `News for ${opts.symbol}` }],
    },
    o_realized_pnl_usd: opts.pnlUsd,
    o_r_multiple: opts.rMultiple,
    o_exit_reason: opts.exitReason,
    o_holding_minutes: opts.holdingMinutes,
    o_closed_at: new Date(`2026-03-${String((i % 28) + 1).padStart(2, '0')}T20:00:00Z`),
  };
}

// 30 rows, sorted by similarity desc (the SQL ORDER BY does this in prod —
// the test mock returns them in the order we insert).
function buildFixture(): FakeRow[] {
  const rows: FakeRow[] = [];
  // 7 winners in 'calm' regime
  for (let i = 0; i < 7; i++) {
    rows.push(makeRow(i, {
      symbol: 'AAPL',
      action: 'buy',
      regime: 'calm',
      grade: 'strong',
      rMultiple: 1.5,
      pnlUsd: 150,
      exitReason: 'target_hit',
      holdingMinutes: 60 * 24 * 18,
      similarity: 0.95 - i * 0.01,
    }));
  }
  // 3 losers in 'volatile' regime
  for (let i = 0; i < 3; i++) {
    rows.push(makeRow(7 + i, {
      symbol: 'NVDA',
      action: 'buy',
      regime: 'volatile',
      grade: 'standard',
      rMultiple: -1.0,
      pnlUsd: -100,
      exitReason: 'stop',
      holdingMinutes: 60 * 24 * 4,
      similarity: 0.85 - i * 0.01,
    }));
  }
  // Filler rows just below the minSimilarity threshold to verify the filter.
  for (let i = 0; i < 20; i++) {
    rows.push(makeRow(10 + i, {
      symbol: 'XYZ',
      action: 'sell',
      regime: 'calm',
      grade: 'standard',
      rMultiple: 0,
      pnlUsd: 0,
      exitReason: 'time',
      holdingMinutes: 30,
      similarity: 0.30 - i * 0.001,
    }));
  }
  return rows;
}

// ── Module mocks ────────────────────────────────────────────────────────
//
// Mock `./db` so `getPool()` returns a fake pool. We capture the SQL +
// params just to assert on shape, and return the fixture rows.

const fakePool = {
  query: vi.fn(),
};

vi.mock('../db.js', () => ({
  getPool: () => fakePool,
  isAvailable: async () => true,
}));

// We don't need the embedder for the by-vector path, but `retrieveSimilarTrades`
// does call it. Force a non-zero vector so the early-out doesn't trip.
vi.mock('../embedder.js', async () => {
  const actual = await vi.importActual<typeof import('../embedder.js')>('../embedder.js');
  return {
    ...actual,
    embedText: vi.fn(async () => {
      const v = new Array<number>(actual.EMBEDDING_DIMENSIONS).fill(0);
      v[0] = 1; // any non-zero entry passes the zero-vector guard
      return v;
    }),
  };
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('memory/rag', () => {
  beforeEach(() => {
    fakePool.query.mockReset();
  });

  it('shapes top-5 closed trades from a synthetic 30-row fixture', async () => {
    const { retrieveSimilarTrades } = await import('../rag.js');
    const rows = buildFixture().slice(0, 5); // simulate SQL LIMIT 5
    fakePool.query.mockResolvedValueOnce({ rows });

    const trades = await retrieveSimilarTrades('buy AAPL grade=strong regime=calm', {
      k: 5,
      minSimilarity: 0.5,
      onlyClosed: true,
    });

    expect(trades).toHaveLength(5);
    const first = trades[0]!;
    expect(first.signal.symbol).toBe('AAPL');
    expect(first.signal.action).toBe('buy');
    expect(first.signal.regime).toBe('calm');
    expect(first.outcome).not.toBeNull();
    expect(first.outcome!.exitReason).toBe('target_hit');
    expect(first.similarity).toBeGreaterThan(0.5);

    // Make sure we hit the SQL with a vector + limit
    expect(fakePool.query).toHaveBeenCalledTimes(1);
    const [, params] = fakePool.query.mock.calls[0] as [string, unknown[]];
    expect(typeof params[0]).toBe('string');
    expect((params[0] as string).startsWith('[')).toBe(true);
    expect(params[1]).toBe(5);
  });

  it('drops rows below minSimilarity threshold', async () => {
    const { retrieveSimilarTrades } = await import('../rag.js');
    const rows = buildFixture(); // includes filler rows at sim≈0.30
    fakePool.query.mockResolvedValueOnce({ rows });

    const trades = await retrieveSimilarTrades('q', {
      k: 30,
      minSimilarity: 0.5,
      onlyClosed: true,
    });

    // Only the 10 win/loss rows should pass minSimilarity 0.5.
    expect(trades.length).toBe(10);
    expect(trades.every((t) => t.similarity >= 0.5)).toBe(true);
  });

  it('formats a multi-trade block with summary, list, and pattern observation', async () => {
    const { formatRagContext } = await import('../rag-format.js');
    const trades: SimilarTrade[] = (buildFixture().slice(0, 10)).map((r) => ({
      decisionId: r.decision_id,
      similarity: r.similarity,
      signal: {
        symbol: (r.signal as { symbol: string }).symbol,
        action: (r.signal as { action: string }).action,
        strategy: r.strategy,
        grade: (r.signal as { grade: string }).grade,
        score: 5,
        regime: ((r.context as { macro: { regime: string } }).macro).regime,
      },
      contextSnippet: '',
      outcome: {
        realizedPnlUsd: r.o_realized_pnl_usd as number,
        rMultiple: r.o_r_multiple,
        exitReason: r.o_exit_reason as string,
        holdingMinutes: r.o_holding_minutes as number,
      },
      createdAt: r.created_at.toISOString(),
    }));

    const block = formatRagContext(trades);
    expect(block).toContain('## SIMILAR PAST TRADES');
    expect(block).toContain('Closest matches:');
    expect(block).toMatch(/Across these 10 historically similar setups: 7 wins, 3 losses/);
    expect(block).toMatch(/expectancy \+\$\d+/);
    // First match line should reference the highest-similarity AAPL win
    expect(block).toMatch(/1\. \[sim=0\.\d{2}\] AAPL BUY/);
    // Pattern observation should fire because we have 7 calm + 3 volatile, both ≥2
    expect(block).toMatch(/Pattern: 'volatile' regime/);
  });

  it('formats with the low-confidence note when n<5', async () => {
    const { formatRagContext } = await import('../rag-format.js');
    const trades: SimilarTrade[] = [
      {
        decisionId: 'a',
        similarity: 0.9,
        signal: { symbol: 'AAPL', action: 'buy', strategy: 's', grade: 'strong', score: 5, regime: 'calm' },
        contextSnippet: '',
        outcome: { realizedPnlUsd: 100, rMultiple: 1, exitReason: 'target', holdingMinutes: 60 },
        createdAt: '2026-03-15T14:30:00Z',
      },
      {
        decisionId: 'b',
        similarity: 0.85,
        signal: { symbol: 'AAPL', action: 'buy', strategy: 's', grade: 'strong', score: 5, regime: 'calm' },
        contextSnippet: '',
        outcome: { realizedPnlUsd: -50, rMultiple: -0.5, exitReason: 'stop', holdingMinutes: 120 },
        createdAt: '2026-03-16T14:30:00Z',
      },
    ];
    const block = formatRagContext(trades);
    expect(block).toContain('low-confidence pattern; insufficient sample');
  });

  it('formats an empty result with a no-trades note', async () => {
    const { formatRagContext } = await import('../rag-format.js');
    const block = formatRagContext([]);
    expect(block).toContain('## SIMILAR PAST TRADES (none)');
    expect(block).toContain('No historically similar closed trades');
  });
});
