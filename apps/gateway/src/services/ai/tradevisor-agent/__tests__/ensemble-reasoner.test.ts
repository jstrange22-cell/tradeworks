/**
 * End-to-end test for the ensemble reasoner with mocked model fan-out.
 *
 * Validates the full path:
 *   - 3 mocked models return predetermined verdicts
 *   - reasonAboutSignalEnsemble parses, applies consensus, returns Decision
 *   - 3-way disagreement → escalate
 *   - 2 model failures + fail-closed → veto
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignalContext, IncomingSignal } from '../types.js';

// Mock the fan-out so we never make real API calls. We control what each
// model "returns" and assert the ensemble reasoner does the right thing.
const fanOutMock = vi.fn<(arg: unknown) => unknown>();
const recordSpendMock = vi.fn<(arg: unknown) => unknown>(
  () => ({ added: 0, total: 0, budget: 20, overBudget: false }),
);
const isOverBudgetMock = vi.fn<() => boolean>(() => false);

vi.mock('../../ensemble/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ensemble/index.js')>();
  return {
    ...actual,
    callModelsParallel: (arg: unknown): unknown => fanOutMock(arg),
    isEnabled: () => true,
    recordEnsembleSpend: (arg: unknown): unknown => recordSpendMock(arg),
    isOverBudget: (): boolean => isOverBudgetMock(),
  };
});

// Mock the solo reasoner — used by the budget-fallback path
vi.mock('../reasoner.js', () => ({
  reasonAboutSignal: vi.fn(async (ctx: SignalContext) => ({
    id: 'solo-fallback-id',
    signal: ctx.signal,
    context: ctx,
    verdict: 'approve' as const,
    reasoning: 'solo fallback',
    confidence: 0.7,
    adjustedSize: 100,
    adjustedStopPct: -5,
    modelUsed: 'claude-sonnet-4-6',
    reasoningLatencyMs: 100,
    createdAt: new Date().toISOString(),
  })),
}));

// Now import — after mocks are registered.
import { reasonAboutSignalEnsemble } from '../ensemble-reasoner.js';

beforeEach(() => {
  fanOutMock.mockReset();
  recordSpendMock.mockReset();
  isOverBudgetMock.mockReset();
  isOverBudgetMock.mockReturnValue(false);
  // Ensure fail mode is closed for these tests (the default).
  delete process.env['TRADEVISOR_FAIL_MODE'];
  // Test API keys present (so isEnabled returns true).
  process.env['ANTHROPIC_API_KEY'] = 'test';
  process.env['OPENAI_API_KEY'] = 'test';
  process.env['GEMINI_API_KEY'] = 'test';
});

function makeSignal(overrides: Partial<IncomingSignal> = {}): IncomingSignal {
  return {
    symbol: 'AAPL',
    action: 'buy',
    price: 180,
    score: 5,
    grade: 'strong',
    timeframe: '15',
    exchange: 'NASDAQ',
    sourceLabel: 'BUY S',
    receivedAt: new Date().toISOString(),
    assetClass: 'stock',
    ...overrides,
  };
}

function makeCtx(signal = makeSignal()): SignalContext {
  return {
    signal,
    chart: null,
    news: [],
    portfolio: {
      cashUsd: 10000,
      equityPositions: [],
      totalPositions: 0,
      maxPositions: 10,
      sectorCount: {},
      sectorCap: 2,
      alreadyHolding: false,
    },
    scout: null,
    macro: {
      regime: 'risk-on',
      regimeTag: 'calm',
      regimeConfidence: 0.7,
      regimeRationale: 'test default',
      spyRs5d: 0.02,
      spyRs20d: 0.05,
      notes: 'stable bull',
    },
    dailyPnl: { pct: 0, limitPct: -3, remaining: 3 },
  };
}

function modelReply(model: string, payload: object) {
  return {
    model,
    reply: JSON.stringify(payload),
    latencyMs: 200,
  };
}

describe('reasonAboutSignalEnsemble', () => {
  it('returns approve when all 3 models agree on approve', async () => {
    fanOutMock.mockResolvedValueOnce({
      anyOk: true,
      totalLatencyMs: 500,
      responses: [
        modelReply('claude-sonnet-4-6', { verdict: 'approve', reasoning: 'looks good', confidence: 0.9, adjustedSizeUsd: 250, adjustedStopPct: -5 }),
        modelReply('gpt-4o', { verdict: 'approve', reasoning: 'agree', confidence: 0.85, adjustedSizeUsd: 200, adjustedStopPct: -5 }),
        modelReply('gemini-2.5-flash', { verdict: 'approve', reasoning: 'concur', confidence: 0.8, adjustedSizeUsd: 250, adjustedStopPct: -5 }),
      ],
    });

    const decision = await reasonAboutSignalEnsemble(makeCtx());
    expect(decision.verdict).toBe('approve');
    expect(decision.confidence).toBeCloseTo(0.85, 2);
    expect(decision.modelUsed).toContain('ensemble:');
    expect(decision.adjustedSize).toBe(250);
  });

  it('returns the majority verdict on 2-of-3 with dissent recorded', async () => {
    fanOutMock.mockResolvedValueOnce({
      anyOk: true,
      totalLatencyMs: 500,
      responses: [
        modelReply('claude-sonnet-4-6', { verdict: 'approve', reasoning: 'good signal', confidence: 0.85, adjustedSizeUsd: 250, adjustedStopPct: -5 }),
        modelReply('gpt-4o', { verdict: 'approve', reasoning: 'concur', confidence: 0.8, adjustedSizeUsd: 200, adjustedStopPct: -5 }),
        modelReply('gemini-2.5-flash', { verdict: 'veto', reasoning: 'news risk', confidence: 0.9, adjustedSizeUsd: null, adjustedStopPct: -5 }),
      ],
    });

    const decision = await reasonAboutSignalEnsemble(makeCtx());
    expect(decision.verdict).toBe('approve');
    expect(decision.reasoning).toContain('DISSENT');
    expect(decision.reasoning).toContain('gemini');
    // 2-of-3 confidence = 0.7 × mean(0.85, 0.8) ≈ 0.5775
    expect(decision.confidence).toBeCloseTo(0.5775, 2);
  });

  it('ALWAYS escalates on 3-way disagreement', async () => {
    fanOutMock.mockResolvedValueOnce({
      anyOk: true,
      totalLatencyMs: 500,
      responses: [
        modelReply('claude-sonnet-4-6', { verdict: 'approve', reasoning: 'bull', confidence: 0.9, adjustedSizeUsd: 250, adjustedStopPct: -5 }),
        modelReply('gpt-4o', { verdict: 'veto', reasoning: 'bear', confidence: 0.9, adjustedSizeUsd: null, adjustedStopPct: -5 }),
        modelReply('gemini-2.5-flash', { verdict: 'escalate', reasoning: 'unclear', confidence: 0.9, adjustedSizeUsd: null, adjustedStopPct: -5 }),
      ],
    });

    const decision = await reasonAboutSignalEnsemble(makeCtx());
    expect(decision.verdict).toBe('escalate');
    expect(decision.confidence).toBe(0);
    expect(decision.reasoning).toContain('3-way disagreement');
  });

  it('fails CLOSED with VETO when 2+ models return invalid output', async () => {
    fanOutMock.mockResolvedValueOnce({
      anyOk: true,
      totalLatencyMs: 500,
      responses: [
        modelReply('claude-sonnet-4-6', { verdict: 'approve', reasoning: 'good', confidence: 0.9, adjustedSizeUsd: 250, adjustedStopPct: -5 }),
        { model: 'gpt-4o', reply: 'completely broken not-json output', latencyMs: 200 },
        { model: 'gemini-2.5-flash', reply: '', latencyMs: 0, error: 'timeout' },
      ],
    });

    const decision = await reasonAboutSignalEnsemble(makeCtx());
    expect(decision.verdict).toBe('veto');
    expect(decision.confidence).toBe(0);
    expect(decision.reasoning).toContain('fail-closed');
    expect(decision.modelUsed).toContain('ensemble-degraded');
  });

  it('falls back to solo when daily budget is exceeded', async () => {
    isOverBudgetMock.mockReturnValue(true);
    const decision = await reasonAboutSignalEnsemble(makeCtx());
    expect(fanOutMock).not.toHaveBeenCalled();
    expect(decision.verdict).toBe('approve'); // from the mocked solo reasoner
    expect(decision.modelUsed).toContain('budget-fallback');
  });

  it('records per-model metadata on the Decision for memory analysis', async () => {
    fanOutMock.mockResolvedValueOnce({
      anyOk: true,
      totalLatencyMs: 500,
      responses: [
        modelReply('claude-sonnet-4-6', { verdict: 'approve', reasoning: 'good', confidence: 0.9, adjustedSizeUsd: 250, adjustedStopPct: -5 }),
        modelReply('gpt-4o', { verdict: 'approve', reasoning: 'good', confidence: 0.85, adjustedSizeUsd: 200, adjustedStopPct: -5 }),
        modelReply('gemini-2.5-flash', { verdict: 'veto', reasoning: 'risk', confidence: 0.9, adjustedSizeUsd: null, adjustedStopPct: -5 }),
      ],
    });

    const decision = await reasonAboutSignalEnsemble(makeCtx());
    interface DecisionWithMeta {
      ensemble?: {
        perModel: Array<{ model: string; ok: boolean; verdict?: string }>;
        agreement?: number;
        dissenters?: Array<{ model: string; verdict: string }>;
      };
    }
    const ensembleMeta = (decision as unknown as DecisionWithMeta).ensemble;
    expect(ensembleMeta).toBeDefined();
    expect(ensembleMeta?.perModel).toHaveLength(3);
    expect(ensembleMeta?.dissenters?.[0]?.model).toContain('gemini');
  });
});
