/**
 * TradeVisor Agent HTTP API.
 *   GET  /api/v1/tradevisor-agent/status        — operating mode + recent stats
 *   GET  /api/v1/tradevisor-agent/decisions     — recent decisions (?limit=N)
 *   GET  /api/v1/tradevisor-agent/decisions/:id — single decision (full context)
 *   GET  /api/v1/tradevisor-agent/escalations   — pending escalations
 *   POST /api/v1/tradevisor-agent/escalations/:id/approve — resolve as approved
 *   POST /api/v1/tradevisor-agent/escalations/:id/veto    — resolve as vetoed
 */
import { Router, type Router as RouterType } from 'express';
import {
  getAgentMode,
  getRecentDecisions,
  getPendingEscalations,
  getDecisionById,
  resolveEscalation,
  getDecisionStats,
} from '../services/ai/tradevisor-agent/index.js';

export const tradevisorAgentRouter: RouterType = Router();

tradevisorAgentRouter.get('/status', (_req, res) => {
  res.json({
    data: {
      mode: getAgentMode(),
      stats: getDecisionStats(),
    },
  });
});

tradevisorAgentRouter.get('/decisions', (req, res) => {
  const limit = Math.min(500, parseInt((req.query['limit'] as string) ?? '50', 10) || 50);
  // Compact view — drop the full context blob; clients can fetch /:id for that
  const compact = getRecentDecisions(limit).map((d) => ({
    id: d.id,
    symbol: d.signal.symbol,
    action: d.signal.action,
    verdict: d.verdict,
    confidence: d.confidence,
    reasoning: d.reasoning,
    adjustedSize: d.adjustedSize,
    adjustedStopPct: d.adjustedStopPct,
    modelUsed: d.modelUsed,
    latencyMs: d.reasoningLatencyMs,
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt,
    resolution: d.resolution,
  }));
  res.json({ data: compact });
});

tradevisorAgentRouter.get('/decisions/:id', (req, res) => {
  const d = getDecisionById(req.params['id'] as string);
  if (!d) {
    res.status(404).json({ error: 'decision not found' });
    return;
  }
  res.json({ data: d });
});

tradevisorAgentRouter.get('/escalations', (_req, res) => {
  const pending = getPendingEscalations().map((d) => ({
    id: d.id,
    symbol: d.signal.symbol,
    action: d.signal.action,
    price: d.signal.price,
    reasoning: d.reasoning,
    confidence: d.confidence,
    createdAt: d.createdAt,
  }));
  res.json({ data: pending });
});

tradevisorAgentRouter.post('/escalations/:id/approve', (req, res) => {
  const d = resolveEscalation(req.params['id'] as string, 'approved');
  if (!d) {
    res.status(404).json({ error: 'escalation not found or already resolved' });
    return;
  }
  res.json({ data: { resolved: d } });
});

tradevisorAgentRouter.post('/escalations/:id/veto', (req, res) => {
  const d = resolveEscalation(req.params['id'] as string, 'vetoed');
  if (!d) {
    res.status(404).json({ error: 'escalation not found or already resolved' });
    return;
  }
  res.json({ data: { resolved: d } });
});
