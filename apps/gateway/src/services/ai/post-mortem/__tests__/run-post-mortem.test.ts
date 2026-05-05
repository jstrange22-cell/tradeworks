/**
 * End-to-end test: 5 synthetic losing trades → clustering → mocked Claude
 * → heuristics-store writes a parseable .md → reasoner-side reader picks
 * up the active lessons after approval.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runPostMortem,
  approveLesson,
  renderActiveForPrompt,
  parseHeuristics,
  type ExtractClient,
  type LossExample,
} from '../index.js';
import type { DecisionRow, OutcomeRow } from '../../../memory/types.js';

let tmpDir: string;
let path: string;

function mkLoss(id: string, sector = 'tech'): LossExample {
  const decision: DecisionRow = {
    id,
    createdAt: new Date(),
    resolvedAt: null,
    strategy: 'tradevisor',
    signal: { symbol: 'AAPL', action: 'buy', price: 100, score: 5, grade: 'strong' },
    context: {
      signal: { symbol: 'AAPL', action: 'buy', assetClass: 'stock' },
      macro: { regime: 'risk-off' },
      portfolio: { equityPositions: [{ symbol: 'AAPL', sector, shares: 1, entryPrice: 100, currentPrice: 95, unrealizedPnl: -5 }] },
      scout: { rank: 35, totalStocks: 40 },
    },
    verdict: 'approve',
    reasoning: 'looked good',
    confidence: 0.6,
    adjustedSizeUsd: 250,
    adjustedStopPct: -5,
    modelUsed: 'claude-sonnet-4-6',
    reasoningLatencyMs: 700,
    resolution: 'executed',
  };
  const outcome: OutcomeRow = {
    decisionId: id,
    closedAt: new Date(),
    realizedPnlUsd: -100,
    rMultiple: -1,
    wasStopHit: true,
    wasTargetHit: false,
    holdingMinutes: 60,
    exitReason: 'stop',
    notes: null,
  };
  return { decision, outcome };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'post-mortem-e2e-'));
  path = join(tmpDir, 'learned_heuristics.md');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runPostMortem — end-to-end', () => {
  it('clusters losses, calls (mocked) Claude, writes pending lessons to a parseable .md, and the reasoner reader sees only Active', async () => {
    // 5 losing trades, all in one cluster (same strategy/regime/sector/exit)
    const losses = [
      mkLoss('a'), mkLoss('b'), mkLoss('c'), mkLoss('d'), mkLoss('e'),
    ];

    const fakeClient: ExtractClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              lesson: 'Veto BUY in risk-off when scout rank > 30',
              evidence: '5/5 such trades stopped out',
              applies_to: 'buy',
              estimated_impact: 'medium',
            }),
          }],
        }),
      },
    };

    const result = await runPostMortem({
      losses,
      heuristicsFilePath: path,
      extractClient: fakeClient,
      skipStaleDeprecation: true,
    });

    expect(result.skippedReason).toBeUndefined();
    expect(result.clustersAnalysed).toBe(1);
    expect(result.lessonsCreated).toHaveLength(1);
    expect(result.lessonsCreated[0]!.lesson).toContain('Veto BUY');

    // The .md file is on disk and parseable
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('## Pending Review');
    expect(text).toContain('## Active');
    expect(text).toContain('## Rejected');
    const parsed = parseHeuristics(text);
    expect(parsed.pending).toHaveLength(1);
    expect(parsed.active).toHaveLength(0);

    // Reasoner-side rendering returns nothing yet (still in Pending)
    expect(renderActiveForPrompt(path)).toBe('');

    // Approve the lesson — reasoner reader should now see it
    const lessonId = parsed.pending[0]!.id;
    const approved = approveLesson(lessonId, 'jason', path);
    expect(approved?.status).toBe('active');

    const rendered = renderActiveForPrompt(path);
    expect(rendered).toContain('## LEARNED HEURISTICS (from post-mortem analysis)');
    expect(rendered).toContain('Veto BUY');
  });

  it('skips when fewer than minLossesToRun losses are present', async () => {
    const losses = [mkLoss('a'), mkLoss('b')]; // only 2
    const result = await runPostMortem({
      losses,
      heuristicsFilePath: path,
      extractClient: null,
    });
    expect(result.skippedReason).toBe('not-enough-losses');
    expect(result.lessonsCreated).toHaveLength(0);
  });

  it('skips when extraction returns INSUFFICIENT_SIGNAL', async () => {
    const losses = [mkLoss('a'), mkLoss('b'), mkLoss('c'), mkLoss('d'), mkLoss('e')];
    const fakeClient: ExtractClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              lesson: 'INSUFFICIENT_SIGNAL',
              evidence: 'too noisy',
              applies_to: 'all',
              estimated_impact: 'low',
            }),
          }],
        }),
      },
    };
    const result = await runPostMortem({
      losses,
      heuristicsFilePath: path,
      extractClient: fakeClient,
      skipStaleDeprecation: true,
    });
    expect(result.lessonsCreated).toHaveLength(0);
  });
});
