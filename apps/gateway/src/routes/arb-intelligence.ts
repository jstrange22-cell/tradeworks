/**
 * Arb Intelligence API Routes
 *
 * GET  /api/v1/arb-intel/status         — Engine status + config
 * GET  /api/v1/arb-intel/scan           — Force scan (returns opps + decisions)
 * GET  /api/v1/arb-intel/portfolio      — Paper arb portfolio
 * GET  /api/v1/arb-intel/learner        — Learning report (stats by arb type)
 * POST /api/v1/arb-intel/start          — Start arb engine
 * POST /api/v1/arb-intel/stop           — Stop arb engine
 */

import { Router, type Router as RouterType } from 'express';
import {
  startArbEngine,
  stopArbEngine,
  forceScan,
  getArbPortfolio,
  getArbStatus,
  getLearnerReport,
} from '../services/arb-intelligence/orchestrator.js';
import {
  getArbAgentStatus,
  getArbAgentReasoning,
  setArbAgentOverride,
  clearArbAgentOverride,
  getArbAgentOutcomes,
  startArbAgent,
  stopArbAgent,
} from '../services/ai/arb-agent.js';

export const arbIntelRouter: RouterType = Router();

// GET /status — Engine status
arbIntelRouter.get('/status', (_req, res) => {
  res.json({ data: getArbStatus() });
});

// GET /scan — Force a scan cycle
arbIntelRouter.get('/scan', async (_req, res) => {
  try {
    const result = await forceScan();
    res.json({
      data: {
        opportunities: result.opportunities.length,
        decisions: result.decisions.map(d => ({
          action: d.action,
          arbType: d.opportunity.arbType,
          ticker: d.opportunity.ticker_a,
          confidence: d.confidence,
          reasoning: d.reasoning,
          warnings: d.warnings,
          elapsedMs: d.elapsedMs,
        })),
        rawOpportunities: result.opportunities.slice(0, 20),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Scan failed' });
  }
});

// GET /portfolio — Paper arb portfolio
arbIntelRouter.get('/portfolio', (_req, res) => {
  res.json({ data: getArbPortfolio() });
});

// GET /learner — Learning report
arbIntelRouter.get('/learner', (_req, res) => {
  res.json({ data: getLearnerReport() });
});

// POST /start — Start engine
arbIntelRouter.post('/start', (_req, res) => {
  startArbEngine();
  res.json({ message: 'Arb intelligence engine started', data: getArbStatus() });
});

// POST /stop — Stop engine
arbIntelRouter.post('/stop', (_req, res) => {
  stopArbEngine();
  res.json({ message: 'Arb intelligence engine stopped', data: getArbStatus() });
});

// ── Arb Agent (APEX/OpenClaw Reasoning Layer) ────────────────────────────

// GET /agent/status — Current agent state, thesis, confidence, recent actions
arbIntelRouter.get('/agent/status', (_req, res) => {
  res.json({ data: getArbAgentStatus() });
});

// GET /agent/reasoning — Last N reasoning chains with outcomes
arbIntelRouter.get('/agent/reasoning', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
  res.json({ data: getArbAgentReasoning(limit) });
});

// GET /agent/outcomes — Historical action outcomes for learning analysis
arbIntelRouter.get('/agent/outcomes', (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 500);
  res.json({ data: getArbAgentOutcomes(limit) });
});

// POST /agent/override — Manual override of agent thesis/actions
arbIntelRouter.post('/agent/override', (req, res) => {
  const { thesis, confidence, durationMinutes } = req.body ?? {};
  if (!thesis || typeof thesis !== 'string') {
    res.status(400).json({ error: 'thesis (string) is required' });
    return;
  }
  setArbAgentOverride(thesis, confidence ?? 50, durationMinutes ?? 30);
  res.json({ message: 'Thesis override set', data: { thesis, confidence: confidence ?? 50, durationMinutes: durationMinutes ?? 30 } });
});

// DELETE /agent/override — Clear manual override
arbIntelRouter.delete('/agent/override', (_req, res) => {
  clearArbAgentOverride();
  res.json({ message: 'Thesis override cleared' });
});

// POST /agent/start — Start the reasoning agent
arbIntelRouter.post('/agent/start', (_req, res) => {
  startArbAgent();
  res.json({ message: 'Arb reasoning agent started', data: getArbAgentStatus() });
});

// POST /agent/stop — Stop the reasoning agent
arbIntelRouter.post('/agent/stop', (_req, res) => {
  stopArbAgent();
  res.json({ message: 'Arb reasoning agent stopped' });
});
