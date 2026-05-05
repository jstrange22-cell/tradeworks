/**
 * Solana Agent + Bot HTTP API.
 *
 *   GET  /status                           Mode + decision stats + last cycle
 *   GET  /decisions?limit=N                Recent decisions (compact)
 *   GET  /decisions/:id                    Full decision with context
 *   GET  /escalations                      Pending escalations
 *   POST /escalations/:id/approve|veto     Resolve an escalation
 *   GET  /ledger                           Paper ledger state
 *   POST /scan-now                         Trigger a scanner cycle on demand
 */
import { Router, type Router as RouterType } from 'express';
import {
  getSolanaAgentMode,
  getRecentDecisions,
  getDecisionById,
  getPendingEscalations,
  resolveEscalation,
  getDecisionStats,
} from '../services/ai/solana-agent/index.js';
import { runScannerCycle, getLastCycleResult } from '../services/solana-bot/orchestrator.js';
import { getLedgerState, LEDGER_HARD_CAPS } from '../services/solana-bot/paper-ledger.js';

export const solanaAgentRouter: RouterType = Router();

solanaAgentRouter.get('/status', (_req, res) => {
  res.json({
    data: {
      agentMode: getSolanaAgentMode(),
      botEnabled: process.env['ENABLE_SOLANA_BOT'] === 'true',
      stats: getDecisionStats(),
      hardCaps: LEDGER_HARD_CAPS,
      lastCycle: getLastCycleResult(),
    },
  });
});

solanaAgentRouter.get('/decisions', (req, res) => {
  const limit = Math.min(500, parseInt((req.query['limit'] as string) ?? '50', 10) || 50);
  const compact = getRecentDecisions(limit).map((d) => ({
    id: d.id,
    symbol: d.candidate.symbol,
    mint: d.candidate.mint,
    verdict: d.verdict,
    confidence: d.confidence,
    reasoning: d.reasoning,
    sizeUsd: d.sizeUsd,
    aiScore: d.context.aiScore.score,
    modelUsed: d.modelUsed,
    latencyMs: d.reasoningLatencyMs,
    createdAt: d.createdAt,
    resolution: d.resolution,
  }));
  res.json({ data: compact });
});

solanaAgentRouter.get('/decisions/:id', (req, res) => {
  const d = getDecisionById(req.params['id'] as string);
  if (!d) {
    res.status(404).json({ error: 'decision not found' });
    return;
  }
  res.json({ data: d });
});

solanaAgentRouter.get('/escalations', (_req, res) => {
  const pending = getPendingEscalations().map((d) => ({
    id: d.id,
    symbol: d.candidate.symbol,
    mint: d.candidate.mint,
    priceUsd: d.candidate.priceUsd,
    reasoning: d.reasoning,
    confidence: d.confidence,
    createdAt: d.createdAt,
  }));
  res.json({ data: pending });
});

solanaAgentRouter.post('/escalations/:id/approve', (req, res) => {
  const d = resolveEscalation(req.params['id'] as string, 'approved');
  if (!d) {
    res.status(404).json({ error: 'escalation not found or already resolved' });
    return;
  }
  res.json({ data: { resolved: d } });
});

solanaAgentRouter.post('/escalations/:id/veto', (req, res) => {
  const d = resolveEscalation(req.params['id'] as string, 'vetoed');
  if (!d) {
    res.status(404).json({ error: 'escalation not found or already resolved' });
    return;
  }
  res.json({ data: { resolved: d } });
});

solanaAgentRouter.get('/ledger', (_req, res) => {
  res.json({ data: getLedgerState() });
});

solanaAgentRouter.post('/scan-now', async (_req, res) => {
  try {
    const result = await runScannerCycle();
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'cycle failed' });
  }
});
