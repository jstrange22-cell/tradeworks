/**
 * Intelligence Routes — APEX Agent Swarm API
 *
 * Unified intelligence layer across all markets.
 *
 * GET  /api/v1/intel/briefing          — Full swarm briefing (all markets)
 * GET  /api/v1/intel/scan              — Trigger on-demand swarm scan
 * GET  /api/v1/intel/learning          — Self-learning analysis of recent trades
 * POST /api/v1/intel/learning/apply    — Apply learning insights to template
 * GET  /api/v1/intel/swarm/status      — Swarm scan status
 * POST /api/v1/intel/swarm/start       — Start periodic scans
 * POST /api/v1/intel/swarm/stop        — Stop periodic scans
 */

import { Router, type Router as RouterType } from 'express';
import {
  runSwarmScan,
  getLastBriefing,
  startPeriodicScans,
  stopPeriodicScans,
} from '../services/ai/swarm-coordinator.js';
import {
  generateLearningReport,
  applyInsights,
  type TradeOutcome,
} from '../services/ai/self-learning.js';
import {
  executionHistory,
  sniperTemplates,
  persistTemplateConfigs,
} from '../routes/solana-sniper/state.js';

export const intelligenceRouter: RouterType = Router();

// Helper: convert execution history to TradeOutcome format
function executionsToOutcomes(): TradeOutcome[] {
  return executionHistory
    .filter(e => e.trigger && e.pnlSol !== undefined)
    .map(e => ({
      id: e.id,
      symbol: e.symbol ?? e.name ?? 'UNKNOWN',
      trigger: e.trigger ?? 'unknown',
      pnlSol: e.pnlSol ?? 0,
      pnlPercent: e.pnlPercent ?? 0,
      holdTimeMs: 0, // hold time tracked separately
      buyAmountSol: e.amountSol ?? 0.03,
      templateId: e.templateId ?? 'default',
      templateName: e.templateName ?? 'Default Sniper',
      timestamp: e.timestamp,
    }));
}

// GET /briefing — Latest swarm briefing
intelligenceRouter.get('/briefing', async (_req, res) => {
  try {
    const briefing = getLastBriefing();
    if (briefing) {
      res.json({ data: briefing });
      return;
    }
    // No cached briefing — run one now
    const fresh = await runSwarmScan(executionsToOutcomes());
    res.json({ data: fresh });
  } catch (err) {
    res.status(500).json({
      error: 'Briefing failed',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// GET /scan — Force a fresh swarm scan
intelligenceRouter.get('/scan', async (_req, res) => {
  try {
    const briefing = await runSwarmScan(executionsToOutcomes());
    res.json({ data: briefing });
  } catch (err) {
    res.status(500).json({
      error: 'Scan failed',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// GET /learning — Self-learning analysis of trades
intelligenceRouter.get('/learning', (_req, res) => {
  try {
    const outcomes = executionsToOutcomes();
    const report = generateLearningReport(outcomes);
    res.json({ data: report });
  } catch (err) {
    res.status(500).json({
      error: 'Learning analysis failed',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// POST /learning/apply — Apply learning insights to a template
intelligenceRouter.post('/learning/apply', (req, res) => {
  try {
    const { templateId, threshold } = req.body as { templateId?: string; threshold?: number };
    const tplId = templateId ?? 'default';
    const template = sniperTemplates.get(tplId);

    if (!template) {
      res.status(404).json({ error: `Template not found: ${tplId}` });
      return;
    }

    const outcomes = executionsToOutcomes().filter(o => o.templateId === tplId);
    const report = generateLearningReport(outcomes);

    // Build a mutable config record from template
    const config: Record<string, number> = {
      noPumpExitMs: template.noPumpExitMs,
      stalePriceTimeoutMs: template.stalePriceTimeoutMs,
      minUniqueBuyers: template.minUniqueBuyers,
      minBuySellRatio: template.minBuySellRatio,
      takeProfitPercent: template.takeProfitPercent,
      stopLossPercent: template.stopLossPercent,
    };

    const adjustments = applyInsights(report.insights, config, threshold ?? 70);

    // Apply adjustments back to template
    for (const adj of adjustments) {
      if (adj.parameter in template) {
        (template as unknown as Record<string, number>)[adj.parameter] = adj.newValue;
      }
    }

    if (adjustments.length > 0) {
      persistTemplateConfigs();
    }

    res.json({
      data: {
        templateId: tplId,
        adjustments,
        report,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to apply insights',
      message: err instanceof Error ? err.message : 'Unknown',
    });
  }
});

// GET /swarm/status — Periodic scan status
intelligenceRouter.get('/swarm/status', (_req, res) => {
  const briefing = getLastBriefing();
  res.json({
    data: {
      hasLastBriefing: Boolean(briefing),
      lastScanAt: briefing?.generatedAt ?? null,
      lastScanDurationMs: briefing?.durationMs ?? null,
      regime: briefing?.regime?.regime ?? null,
      totalOpportunities: briefing?.totalOpportunities ?? 0,
      actionItems: briefing?.actionItems?.length ?? 0,
    },
  });
});

// POST /swarm/start — Start periodic scans
intelligenceRouter.post('/swarm/start', (req, res) => {
  const intervalMs = parseInt(req.body?.intervalMs ?? '900000', 10);
  startPeriodicScans(intervalMs);
  res.json({ message: `Swarm scans started (every ${intervalMs / 60_000} min)` });
});

// POST /swarm/stop — Stop periodic scans
intelligenceRouter.post('/swarm/stop', (_req, res) => {
  stopPeriodicScans();
  res.json({ message: 'Swarm scans stopped' });
});

// ── APEX Bridge Status ──────────────────────────────────────────────────

import { getApexBridgeStatus } from '../services/ai/apex-bridge.js';
import { getTradevisorStatus, getWatchlist } from '../services/ai/tradevisor-watchlist.js';
import { getTradevisorStats } from '../services/ai/tradevisor-engine.js';

// GET /bridge/status — APEX intelligence bridge status
intelligenceRouter.get('/bridge/status', (_req, res) => {
  res.json({ data: getApexBridgeStatus() });
});

// GET /tradevisor/status — Tradevisor watchlist + scan status
intelligenceRouter.get('/tradevisor/status', (_req, res) => {
  const status = getTradevisorStatus();
  const stats = getTradevisorStats();
  const watchlist = getWatchlist();

  res.json({
    data: {
      ...status,
      stats,
      watchlistDetails: watchlist.map(w => ({
        ticker: w.ticker,
        chain: w.chain,
        source: w.source,
        addedAt: w.addedAt,
        expiresAt: w.expiresAt,
        analysisCount: w.analysisCount,
        lastAction: w.lastAnalysis?.action ?? 'pending',
        lastGrade: w.lastAnalysis?.grade ?? 'pending',
        lastScore: w.lastAnalysis?.confluenceScore ?? 0,
        lastConfidence: w.lastAnalysis?.confidence ?? 0,
        currentPrice: w.lastAnalysis?.currentPrice ?? 0,
        indicators: w.lastAnalysis?.indicators ?? null,
        analyzedAt: w.lastAnalysis?.analyzedAt ?? null,
      })),
    },
  });
});

// ── Twitter/X Social Intelligence ───────────────────────────────────────

import {
  getTwitterSignals,
  getTwitterSentiment,
  getTwitterScraperStatus,
} from '../services/sentiment/twitter-scraper.js';

// GET /twitter/status — Twitter scraper status
intelligenceRouter.get('/twitter/status', (_req, res) => {
  res.json({ data: getTwitterScraperStatus() });
});

// GET /twitter/signals — Recent tweet signals
intelligenceRouter.get('/twitter/signals', (req, res) => {
  const category = req.query.category as string | undefined;
  const limit = parseInt(req.query.limit as string ?? '50', 10);
  res.json({ data: getTwitterSignals(category, limit) });
});

// GET /twitter/sentiment — Twitter sentiment by category
intelligenceRouter.get('/twitter/sentiment', (_req, res) => {
  res.json({ data: getTwitterSentiment() });
});
