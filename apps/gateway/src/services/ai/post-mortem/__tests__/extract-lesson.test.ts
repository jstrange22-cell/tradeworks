/**
 * Unit tests for extract-lesson.ts.
 * Mocks the Claude SDK so the test runs offline and deterministically.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  extractLesson,
  parseExtraction,
  buildClusterPrompt,
  type ExtractClient,
} from '../extract-lesson.js';
import type { LossCluster, LossExample } from '../cluster-losses.js';
import type { DecisionRow, OutcomeRow } from '../../../memory/types.js';

function fakeLoss(id: string): LossExample {
  const decision: DecisionRow = {
    id,
    createdAt: new Date(),
    resolvedAt: null,
    strategy: 'tradevisor',
    signal: { symbol: 'AAPL', action: 'buy', price: 100, score: 5, grade: 'strong' },
    context: {
      signal: { symbol: 'AAPL', action: 'buy', assetClass: 'stock' },
      macro: { regime: 'risk-off' },
      portfolio: { equityPositions: [{ symbol: 'AAPL', sector: 'tech' }] },
      scout: { rank: 35, totalStocks: 40 },
    },
    verdict: 'approve',
    reasoning: 'Strong grade buy with positive news flow.',
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

function fakeCluster(): LossCluster {
  return {
    key: 'tradevisor|risk-off|tech|stop',
    strategy: 'tradevisor',
    regime: 'risk-off',
    sectorBucket: 'tech',
    exitReason: 'stop',
    examples: [fakeLoss('a'), fakeLoss('b'), fakeLoss('c'), fakeLoss('d')],
    totalLossUsd: -400,
    avgRMultiple: -1,
  };
}

describe('parseExtraction', () => {
  it('parses a clean JSON object', () => {
    const raw = JSON.stringify({
      lesson: 'Veto BUY in risk-off when scout rank > 30',
      evidence: '4/5 such trades closed at -1R',
      applies_to: 'buy',
      estimated_impact: 'medium',
    });
    const parsed = parseExtraction(raw);
    expect(parsed?.lesson).toBe('Veto BUY in risk-off when scout rank > 30');
    expect(parsed?.appliesTo).toBe('buy');
    expect(parsed?.impact).toBe('medium');
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"lesson":"x","evidence":"y","applies_to":"all","estimated_impact":"low"}\n```';
    const parsed = parseExtraction(raw);
    expect(parsed?.lesson).toBe('x');
  });

  it('returns null on garbage', () => {
    expect(parseExtraction('not json at all')).toBeNull();
    expect(parseExtraction('')).toBeNull();
    expect(parseExtraction('{ "lesson": ')).toBeNull();
  });

  it('returns null when lesson is empty', () => {
    const raw = JSON.stringify({ lesson: '', evidence: 'e', applies_to: 'buy', estimated_impact: 'low' });
    expect(parseExtraction(raw)).toBeNull();
  });

  it('coerces invalid applies_to/impact to defaults', () => {
    const raw = JSON.stringify({ lesson: 'x', evidence: 'y', applies_to: 'banana', estimated_impact: 'massive' });
    const parsed = parseExtraction(raw);
    expect(parsed?.appliesTo).toBe('all');
    expect(parsed?.impact).toBe('low');
  });
});

describe('buildClusterPrompt', () => {
  it('embeds cluster summary, examples, and JSON schema', () => {
    const prompt = buildClusterPrompt(fakeCluster());
    expect(prompt).toContain('strategy=tradevisor');
    expect(prompt).toContain('regime=risk-off');
    expect(prompt).toContain('AAPL');
    expect(prompt).toContain('"applies_to"');
  });
});

describe('extractLesson', () => {
  it('returns parsed lesson when client succeeds', async () => {
    const fakeClient: ExtractClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                lesson: 'Veto BUY in risk-off when scout rank > 30',
                evidence: '4/5 trades stopped out',
                applies_to: 'buy',
                estimated_impact: 'medium',
              }),
            },
          ],
        }),
      },
    };
    const out = await extractLesson(fakeCluster(), fakeClient);
    expect(out).not.toBeNull();
    expect(out?.lesson).toBe('Veto BUY in risk-off when scout rank > 30');
    expect(fakeClient.messages.create).toHaveBeenCalledTimes(1);
  });

  it('returns null when client is null (no API key)', async () => {
    const out = await extractLesson(fakeCluster(), null);
    expect(out).toBeNull();
  });

  it('returns null on unparseable response', async () => {
    const fakeClient: ExtractClient = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'completely not json' }] }),
      },
    };
    const out = await extractLesson(fakeCluster(), fakeClient);
    expect(out).toBeNull();
  });

  it('returns null when Claude reports INSUFFICIENT_SIGNAL', async () => {
    const fakeClient: ExtractClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: JSON.stringify({
              lesson: 'INSUFFICIENT_SIGNAL',
              evidence: 'Only 2 trades, too noisy',
              applies_to: 'all',
              estimated_impact: 'low',
            }),
          }],
        }),
      },
    };
    const out = await extractLesson(fakeCluster(), fakeClient);
    expect(out).toBeNull();
  });

  it('returns null on thrown error', async () => {
    const fakeClient: ExtractClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('rate limit')),
      },
    };
    const out = await extractLesson(fakeCluster(), fakeClient);
    expect(out).toBeNull();
  });
});
