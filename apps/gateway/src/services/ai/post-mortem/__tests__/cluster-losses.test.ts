/**
 * Unit tests for cluster-losses.ts — pure clustering logic only.
 */
import { describe, it, expect } from 'vitest';
import { clusterLossesPure, type LossExample } from '../cluster-losses.js';
import type { DecisionRow, OutcomeRow } from '../../../memory/types.js';

function mkLoss(overrides: {
  id: string;
  strategy?: string;
  symbol?: string;
  sector?: string;
  regime?: string;
  exitReason?: 'stop' | 'target' | 'trail' | 'time' | 'apex_close' | 'manual';
  pnl: number;
  rMultiple?: number | null;
  action?: 'buy' | 'sell';
}): LossExample {
  const decision: DecisionRow = {
    id: overrides.id,
    createdAt: new Date(),
    resolvedAt: null,
    strategy: overrides.strategy ?? 'tradevisor',
    signal: { symbol: overrides.symbol ?? 'AAPL', action: overrides.action ?? 'buy', price: 100, score: 5, grade: 'strong' },
    context: {
      signal: { symbol: overrides.symbol ?? 'AAPL', action: overrides.action ?? 'buy', assetClass: 'stock' },
      macro: { regime: overrides.regime ?? 'risk-off' },
      portfolio: {
        equityPositions: [{ symbol: overrides.symbol ?? 'AAPL', sector: overrides.sector ?? 'tech', shares: 1, entryPrice: 100, currentPrice: 95, unrealizedPnl: -5 }],
      },
    },
    verdict: 'approve',
    reasoning: 'looked good at the time',
    confidence: 0.6,
    adjustedSizeUsd: 100,
    adjustedStopPct: -5,
    modelUsed: 'claude-sonnet-4-6',
    reasoningLatencyMs: 800,
    resolution: 'executed',
  };
  const outcome: OutcomeRow = {
    decisionId: overrides.id,
    closedAt: new Date(),
    realizedPnlUsd: overrides.pnl,
    rMultiple: overrides.rMultiple ?? -1,
    wasStopHit: overrides.exitReason === 'stop',
    wasTargetHit: overrides.exitReason === 'target',
    holdingMinutes: 60,
    exitReason: overrides.exitReason ?? 'stop',
    notes: null,
  };
  return { decision, outcome };
}

describe('clusterLossesPure', () => {
  it('groups trades sharing strategy + regime + sector + exitReason', () => {
    const losses: LossExample[] = [
      mkLoss({ id: '1', symbol: 'AAPL', sector: 'tech', exitReason: 'stop', pnl: -100 }),
      mkLoss({ id: '2', symbol: 'MSFT', sector: 'tech', exitReason: 'stop', pnl: -120 }),
      mkLoss({ id: '3', symbol: 'NVDA', sector: 'tech', exitReason: 'stop', pnl: -80 }),
    ];
    const clusters = clusterLossesPure(losses);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.examples.length).toBe(3);
    expect(clusters[0]?.totalLossUsd).toBe(-300);
    expect(clusters[0]?.sectorBucket).toBe('tech');
    expect(clusters[0]?.exitReason).toBe('stop');
  });

  it('drops singletons (clusters of 1)', () => {
    const losses: LossExample[] = [
      mkLoss({ id: '1', sector: 'tech', exitReason: 'stop', pnl: -100 }),
      mkLoss({ id: '2', sector: 'energy', exitReason: 'time', pnl: -50 }),
    ];
    const clusters = clusterLossesPure(losses);
    expect(clusters).toHaveLength(0);
  });

  it('separates clusters that differ on any one dimension', () => {
    const losses: LossExample[] = [
      mkLoss({ id: '1', sector: 'tech', exitReason: 'stop', pnl: -100 }),
      mkLoss({ id: '2', sector: 'tech', exitReason: 'stop', pnl: -100 }),
      mkLoss({ id: '3', sector: 'tech', exitReason: 'time', pnl: -50 }),
      mkLoss({ id: '4', sector: 'tech', exitReason: 'time', pnl: -50 }),
    ];
    const clusters = clusterLossesPure(losses);
    expect(clusters).toHaveLength(2);
    const stopCluster = clusters.find((c) => c.exitReason === 'stop');
    const timeCluster = clusters.find((c) => c.exitReason === 'time');
    expect(stopCluster?.examples.length).toBe(2);
    expect(timeCluster?.examples.length).toBe(2);
  });

  it('sorts clusters by worst total loss first', () => {
    const losses: LossExample[] = [
      mkLoss({ id: '1', sector: 'energy', exitReason: 'stop', pnl: -50 }),
      mkLoss({ id: '2', sector: 'energy', exitReason: 'stop', pnl: -50 }),
      mkLoss({ id: '3', sector: 'tech', exitReason: 'stop', pnl: -500 }),
      mkLoss({ id: '4', sector: 'tech', exitReason: 'stop', pnl: -500 }),
    ];
    const clusters = clusterLossesPure(losses);
    expect(clusters[0]?.sectorBucket).toBe('tech');
    expect(clusters[1]?.sectorBucket).toBe('energy');
  });

  it('caps output at maxClusters', () => {
    const losses: LossExample[] = [];
    for (const sector of ['tech', 'energy', 'financials', 'healthcare', 'industrials', 'utilities']) {
      losses.push(mkLoss({ id: `${sector}-1`, sector, pnl: -100 }));
      losses.push(mkLoss({ id: `${sector}-2`, sector, pnl: -100 }));
    }
    const clusters = clusterLossesPure(losses, { maxClusters: 3 });
    expect(clusters.length).toBe(3);
  });

  it('caps examples per cluster', () => {
    const losses: LossExample[] = [];
    for (let i = 0; i < 10; i++) {
      losses.push(mkLoss({ id: `t${i}`, sector: 'tech', exitReason: 'stop', pnl: -10 }));
    }
    const clusters = clusterLossesPure(losses, { maxExamplesPerCluster: 4 });
    expect(clusters[0]?.examples.length).toBe(4);
    // total loss should still reflect ALL 10 losses, not just the 4 examples
    expect(clusters[0]?.totalLossUsd).toBe(-100);
  });

  it('computes average R-multiple from examples', () => {
    const losses: LossExample[] = [
      mkLoss({ id: '1', sector: 'tech', exitReason: 'stop', pnl: -100, rMultiple: -1 }),
      mkLoss({ id: '2', sector: 'tech', exitReason: 'stop', pnl: -150, rMultiple: -1.5 }),
    ];
    const clusters = clusterLossesPure(losses);
    expect(clusters[0]?.avgRMultiple).toBeCloseTo(-1.25, 2);
  });

  it('falls back to asset:<class> when no sector found', () => {
    const losses: LossExample[] = [
      mkLoss({ id: '1', symbol: 'BTC', sector: 'tech', exitReason: 'stop', pnl: -100 }),
      mkLoss({ id: '2', symbol: 'ETH', sector: 'tech', exitReason: 'stop', pnl: -100 }),
    ];
    // Override: remove the equityPositions so sector resolution fails
    for (const l of losses) {
      const ctx = l.decision.context as Record<string, unknown>;
      (ctx['portfolio'] as Record<string, unknown>)['equityPositions'] = [];
    }
    const clusters = clusterLossesPure(losses);
    expect(clusters[0]?.sectorBucket).toBe('asset:stock');
  });
});
