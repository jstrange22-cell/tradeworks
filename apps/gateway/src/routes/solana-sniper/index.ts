/**
 * Solana Sniping Engine — Sprint 8.4 (Template System)
 *
 * Multi-template autonomous token sniping engine. Each template represents
 * an independent strategy with its own config, stats, positions, and budget.
 *
 * Template Routes:
 *   GET    /api/v1/solana/sniper/templates             — List all templates
 *   POST   /api/v1/solana/sniper/templates             — Create template
 *   PUT    /api/v1/solana/sniper/templates/:id         — Update template
 *   DELETE /api/v1/solana/sniper/templates/:id         — Delete template
 *   POST   /api/v1/solana/sniper/templates/:id/start   — Start template
 *   POST   /api/v1/solana/sniper/templates/:id/stop    — Stop template
 *
 * Legacy Routes (backwards-compatible, operate on default template):
 *   GET    /api/v1/solana/sniper/config       — Get default template config
 *   PUT    /api/v1/solana/sniper/config       — Update default template config
 *   POST   /api/v1/solana/sniper/start        — Start default template
 *   POST   /api/v1/solana/sniper/stop         — Stop default template
 *   GET    /api/v1/solana/sniper/status       — All templates status + positions
 *   POST   /api/v1/solana/sniper/execute      — Manual snipe (default template)
 *   GET    /api/v1/solana/sniper/history      — Execution history
 */

import { Router, type Router as RouterType } from 'express';
import {
  isSolanaConnected,
  getAllTokenAccounts,
  batchCloseTokenAccounts,
  batchBurnAndCloseTokenAccounts,
  type TokenAccountInfo,
} from '../solana-utils.js';

// ── State imports ────────────────────────────────────────────────────────
import {
  DEFAULT_TEMPLATE_ID,
  sniperTemplates,
  positionsMap,
  executionHistory,
  pendingTokens,
  activePositions,
  cachedSolPriceUsd,
  positionCheckInterval,
  getRuntime,
  getTemplatePositions,
  resetDailyBudgetIfNeeded,
  isAnyTemplateRunning,
  syncActivePositionsMap,
  templateToLegacyConfig,
  getAllActivePositions,
  ensurePositionCheckRunning,
  stopPositionCheckIfIdle,
  isProtectedMint,
  addProtectedMint,
  removeProtectedMint,
  getAllProtectedMints,
  refreshCachedSolBalance,
  pickConfigFields,
  validateConfigUpdates,
  applyConfigToTemplate,
  createTemplate,
  deleteTemplate,
  cachedSolBalanceLamports,
  persistTemplateConfigs,
} from './state.js';

// ── Execution imports ────────────────────────────────────────────────────
import {
  executeBuySnipe,
  reconcileWalletPositions,
} from './execution.js';

// ── Signal imports ────────────────────────────────────────────────────────
import { recentSignals } from './monitoring.js';

// ── Copy Trade imports ──────────────────────────────────────────────────
import {
  getWhaleRegistry,
  addWhale,
  removeWhale,
  getCopyTradeStatus,
  type TrackedWhale,
} from './copy-trade.js';

// ── AI Intelligence imports ──────────────────────────────────────────────
import { generateBriefing } from '../../services/ai/market-briefing.js';

// ── Re-exports for external consumers ────────────────────────────────────
export * from './types.js';
export { autoStartSniper, onNewTokenDetected, recentSignals } from './monitoring.js';
export { executeBuySnipe, executeSellSnipe, submitViaJito } from './execution.js';
export {
  isProtectedMint,
  addProtectedMint,
  removeProtectedMint,
  getAllProtectedMints,
  activePositions,
  getAllActivePositions,
} from './state.js';

// ── Constants ────────────────────────────────────────────────────────────

// P&L is tracked cumulatively in stats.totalPnlSol (persisted to template-stats.json)

// ── Router ───────────────────────────────────────────────────────────────

export const sniperRouter: RouterType = Router();

// ── Routes: Template Management ─────────────────────────────────────────

// GET /sniper/templates -- List all templates with stats
sniperRouter.get('/sniper/templates', (_req, res) => {
  const templates = [...sniperTemplates.values()].map(template => {
    const runtime = getRuntime(template.id);
    const positions = getTemplatePositions(template.id);
    resetDailyBudgetIfNeeded(runtime);

    // Use persisted stats.totalPnlSol — it accumulates correctly on every trade
    // and survives restarts via template-stats.json persistence
    const stats = template.stats;

    return {
      ...template,
      stats,
      running: runtime.running,
      startedAt: runtime.startedAt?.toISOString() ?? null,
      dailySpentSol: runtime.dailySpentSol,
      dailyRemainingSol: Math.max(0, template.dailyBudgetSol - runtime.dailySpentSol),
      openPositions: positions.size,
      paperBalanceSol: template.paperMode ? runtime.paperBalanceSol : undefined,
    };
  });

  res.json({
    data: templates,
    total: templates.length,
    defaultTemplateId: DEFAULT_TEMPLATE_ID,
  });
});

// POST /sniper/templates -- Create a new template
sniperRouter.post('/sniper/templates', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = body.name as string | undefined;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({
      error: { code: 'INVALID_NAME', message: 'Template name is required' },
    });
    return;
  }

  const configFields = pickConfigFields(body);
  const validationError = validateConfigUpdates(configFields);
  if (validationError) {
    res.status(400).json({
      error: { code: 'INVALID_CONFIG', message: validationError },
    });
    return;
  }

  const template = createTemplate(name.trim(), configFields);

  // Persist config so new template settings survive gateway restarts
  persistTemplateConfigs();

  res.status(201).json({
    data: template,
    message: `Template "${template.name}" created`,
  });
});

// PUT /sniper/templates/:id -- Update a template
sniperRouter.put('/sniper/templates/:id', (req, res) => {
  const { id } = req.params;
  const template = sniperTemplates.get(id);

  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const configFields = pickConfigFields(body);
  const validationError = validateConfigUpdates(configFields);
  if (validationError) {
    res.status(400).json({
      error: { code: 'INVALID_CONFIG', message: validationError },
    });
    return;
  }

  // Apply name update if provided
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    template.name = body.name.trim();
  }

  // Apply config field updates
  applyConfigToTemplate(template, configFields);

  // Allow resetting paper balance via API
  if (typeof body.paperBalanceSol === 'number' && body.paperBalanceSol > 0) {
    const runtime = getRuntime(id);
    runtime.paperBalanceSol = body.paperBalanceSol;
  }

  // Allow resetting daily spend via API
  if (body.resetDailySpend === true) {
    const runtime = getRuntime(id);
    runtime.dailySpentSol = 0;
  }

  // Allow resetting circuit breaker / consecutive losses / daily loss via API
  if (body.resetCircuitBreaker === true) {
    const runtime = getRuntime(id);
    runtime.consecutiveLosses = 0;
    runtime.circuitBreakerPausedUntil = 0;
    runtime.dailyRealizedLossSol = 0;
  }

  // Allow resetting stats via API
  if (body.resetStats === true) {
    template.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      createdAt: new Date().toISOString(),
    };
  }

  // Persist config so AI settings survive gateway restarts
  persistTemplateConfigs();

  res.json({
    data: template,
    message: `Template "${template.name}" updated`,
  });
});

// DELETE /sniper/templates/:id -- Delete a template
sniperRouter.delete('/sniper/templates/:id', (req, res) => {
  const { id } = req.params;

  if (id === DEFAULT_TEMPLATE_ID) {
    res.status(400).json({
      error: { code: 'CANNOT_DELETE_DEFAULT', message: 'Cannot delete the default template' },
    });
    return;
  }

  const template = sniperTemplates.get(id);
  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const runtime = getRuntime(id);
  if (runtime.running) {
    res.status(409).json({
      error: { code: 'TEMPLATE_RUNNING', message: 'Stop the template before deleting it' },
    });
    return;
  }

  const positions = getTemplatePositions(id);
  if (positions.size > 0) {
    res.status(409).json({
      error: {
        code: 'HAS_OPEN_POSITIONS',
        message: `Template has ${positions.size} open position(s). Close them before deleting.`,
      },
    });
    return;
  }

  deleteTemplate(id);

  res.json({ message: `Template "${template.name}" deleted` });
});

// POST /sniper/templates/:id/start -- Start a specific template
sniperRouter.post('/sniper/templates/:id/start', (req, res) => {
  const { id } = req.params;

  if (!isSolanaConnected()) {
    res.status(400).json({
      error: { code: 'NO_WALLET', message: 'No Solana wallet configured' },
    });
    return;
  }

  const template = sniperTemplates.get(id);
  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const runtime = getRuntime(id);
  runtime.running = true;
  runtime.startedAt = new Date();
  template.enabled = true;

  // Persist enabled state so it survives restarts
  persistTemplateConfigs();
  ensurePositionCheckRunning();

  res.json({
    message: `Template "${template.name}" started`,
    status: 'running',
    template,
  });
});

// POST /sniper/templates/:id/stop -- Stop a specific template
sniperRouter.post('/sniper/templates/:id/stop', (req, res) => {
  const { id } = req.params;
  const template = sniperTemplates.get(id);

  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const runtime = getRuntime(id);
  runtime.running = false;
  template.enabled = false;

  // Persist so this survives restarts — user said stop, it stays stopped
  persistTemplateConfigs();

  stopPositionCheckIfIdle();

  const positions = getTemplatePositions(id);

  res.json({
    message: `Template "${template.name}" stopped — will stay stopped across restarts`,
    status: 'stopped',
    openPositions: positions.size,
  });
});

// ── Routes: Legacy (backwards-compatible) ───────────────────────────────

// GET /sniper/config -- returns default template as legacy SniperConfig
sniperRouter.get('/sniper/config', (_req, res) => {
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  res.json({ data: templateToLegacyConfig(defaultTemplate) });
});

// PUT /sniper/config -- updates default template
sniperRouter.put('/sniper/config', (req, res) => {
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const configFields = pickConfigFields(body);
  const validationError = validateConfigUpdates(configFields);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  // Apply config field updates
  applyConfigToTemplate(defaultTemplate, configFields);

  // Handle legacy 'enabled' field
  if (typeof body.enabled === 'boolean') {
    defaultTemplate.enabled = body.enabled;
  }

  // Persist config so AI settings survive gateway restarts
  persistTemplateConfigs();

  res.json({
    data: templateToLegacyConfig(defaultTemplate),
    message: 'Sniper configuration updated',
  });
});

// POST /sniper/start -- starts default template
sniperRouter.post('/sniper/start', (_req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({ error: 'No Solana wallet configured' });
    return;
  }

  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  const runtime = getRuntime(DEFAULT_TEMPLATE_ID);
  runtime.running = true;
  runtime.startedAt = new Date();
  defaultTemplate.enabled = true;

  ensurePositionCheckRunning();

  res.json({
    message: 'Sniper engine started',
    status: 'running',
    config: templateToLegacyConfig(defaultTemplate),
  });
});

// POST /sniper/stop -- stops default template
sniperRouter.post('/sniper/stop', (_req, res) => {
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  const runtime = getRuntime(DEFAULT_TEMPLATE_ID);
  runtime.running = false;
  defaultTemplate.enabled = false;

  stopPositionCheckIfIdle();

  const positions = getTemplatePositions(DEFAULT_TEMPLATE_ID);

  res.json({
    message: 'Sniper engine stopped',
    status: 'stopped',
    openPositions: positions.size,
  });
});

// GET /sniper/status -- returns status for all templates + combined positions
sniperRouter.get('/sniper/status', (_req, res) => {
  const defaultRuntime = getRuntime(DEFAULT_TEMPLATE_ID);
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  resetDailyBudgetIfNeeded(defaultRuntime);

  // Per-template status
  const templates = [...sniperTemplates.values()].map(template => {
    const runtime = getRuntime(template.id);
    const positions = getTemplatePositions(template.id);
    resetDailyBudgetIfNeeded(runtime);

    return {
      id: template.id,
      name: template.name,
      enabled: template.enabled,
      running: runtime.running,
      startedAt: runtime.startedAt?.toISOString() ?? null,
      dailySpentSol: runtime.dailySpentSol,
      dailyBudgetSol: template.dailyBudgetSol,
      dailyRemainingSol: Math.max(0, template.dailyBudgetSol - runtime.dailySpentSol),
      openPositions: positions.size,
      stats: template.stats,
      paperMode: template.paperMode,
      paperBalanceSol: template.paperMode ? runtime.paperBalanceSol : undefined,
      pendingTokens: pendingTokens.size,
      circuitBreakerPausedUntil: runtime.circuitBreakerPausedUntil,
      consecutiveLosses: runtime.consecutiveLosses,
      dailyRealizedLossSol: runtime.dailyRealizedLossSol,
    };
  });

  const allPositions = getAllActivePositions();
  const openPositionsWithUsd = allPositions.map((pos) => {
    const costSol = pos.buyCostSol ?? (defaultTemplate?.buyAmountSol ?? 0.005);
    const hasBuyPrice = pos.buyPrice > 0;
    // Calculate value with sanity cap — DexScreener sometimes returns wrong token prices
    const rawValueUsd = pos.currentPrice * pos.amountTokens;
    const costUsd = costSol * cachedSolPriceUsd;
    const maxReasonableValue = costUsd * 100; // Cap at 100x buy cost — no memecoin realistically does more in minutes
    const valueUsd = (maxReasonableValue > 0 && rawValueUsd > maxReasonableValue) ? maxReasonableValue : rawValueUsd;

    const rawPnlUsd = hasBuyPrice ? pos.amountTokens * (pos.currentPrice - pos.buyPrice) : 0;
    const maxReasonablePnl = costUsd * 99; // Max 99x gain
    const unrealizedPnlUsd = (maxReasonablePnl > 0 && rawPnlUsd > maxReasonablePnl) ? maxReasonablePnl : rawPnlUsd;

    return {
      ...pos,
      buyCostSol: costSol,
      costUsd,
      valueUsd,
      pnlPercent: hasBuyPrice ? pos.pnlPercent : 0,
      unrealizedPnlUsd,
    };
  });

  const totalInvestedSol = openPositionsWithUsd.reduce((sum, p) => sum + p.buyCostSol, 0);
  const totalInvestedUsd = totalInvestedSol * cachedSolPriceUsd;

  // Aggregate stats across all templates for top-level analytics
  // CRITICAL: For paper templates, derive P&L from paper balance (ground truth)
  // instead of the stats accumulator which drifts over thousands of trades.
  const aggStats = { totalTrades: 0, wins: 0, losses: 0, totalPnlSol: 0 };
  for (const [_id, tpl] of sniperTemplates) {
    aggStats.totalTrades += tpl.stats.totalTrades;
    aggStats.wins += tpl.stats.wins;
    aggStats.losses += tpl.stats.losses;

    // Use persisted cumulative P&L — survives restarts
    aggStats.totalPnlSol += tpl.stats.totalPnlSol;
  }
  const winRate = aggStats.totalTrades > 0
    ? Math.round((aggStats.wins / aggStats.totalTrades) * 100)
    : 0;

  res.json({
    // Runtime
    running: defaultRuntime.running,
    startedAt: defaultRuntime.startedAt?.toISOString() ?? null,
    dailySpentSol: defaultRuntime.dailySpentSol,
    dailyBudgetSol: defaultTemplate?.dailyBudgetSol ?? 0,
    dailyRemainingSol: Math.max(
      0,
      (defaultTemplate?.dailyBudgetSol ?? 0) - defaultRuntime.dailySpentSol,
    ),
    consecutiveLosses: defaultRuntime.consecutiveLosses,
    circuitBreakerPaused: defaultRuntime.circuitBreakerPausedUntil > Date.now(),
    circuitBreakerResumesAt: defaultRuntime.circuitBreakerPausedUntil > Date.now()
      ? new Date(defaultRuntime.circuitBreakerPausedUntil).toISOString()
      : null,
    walletSolBalance: cachedSolBalanceLamports / 1e9,
    solPriceUsd: cachedSolPriceUsd,
    // Positions
    openPositions: openPositionsWithUsd,
    totalInvestedSol,
    totalInvestedUsd,
    // Aggregated analytics
    totalExecutions: executionHistory.length,
    stats: {
      totalTrades: aggStats.totalTrades,
      wins: aggStats.wins,
      losses: aggStats.losses,
      totalPnlSol: aggStats.totalPnlSol,
      totalPnlUsd: aggStats.totalPnlSol * cachedSolPriceUsd,
      winRate,
      dailyRealizedLossSol: defaultRuntime.dailyRealizedLossSol,
    },
    recentExecutions: executionHistory.slice(0, 50),
    // Template detail
    templates,
    anyRunning: isAnyTemplateRunning(),
  });
});

// POST /sniper/execute -- Manual single snipe (supports optional templateId)
sniperRouter.post('/sniper/execute', async (req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({ error: 'No Solana wallet configured' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const mint = body.mint as string | undefined;
  const symbol = body.symbol as string | undefined;
  const name = body.name as string | undefined;
  const templateId = (body.templateId as string | undefined) ?? DEFAULT_TEMPLATE_ID;

  if (!mint) {
    res.status(400).json({ error: 'Missing required field: mint' });
    return;
  }

  if (!sniperTemplates.has(templateId)) {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  try {
    const execution = await executeBuySnipe({
      mint,
      symbol: symbol ?? 'UNKNOWN',
      name: name ?? 'Unknown Token',
      trigger: 'manual',
      templateId,
    });

    res.json({
      data: execution,
      message: execution.status === 'success'
        ? 'Snipe executed successfully'
        : 'Snipe failed',
    });
  } catch (err) {
    res.status(500).json({
      error: 'Snipe execution failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /sniper/history -- supports optional templateId filter
sniperRouter.get('/sniper/history', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10);
  const templateId = req.query.templateId as string | undefined;

  let filtered = executionHistory;
  if (templateId) {
    filtered = executionHistory.filter(
      execution => execution.templateId === templateId,
    );
  }

  res.json({
    data: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
  });
});

// ── Holdings P&L ──────────────────────────────────────────────────────

interface HoldingPnL {
  mint: string;
  symbol: string;
  name: string;
  totalBuySol: number;
  totalSellSol: number;
  totalBuyCount: number;
  totalSellCount: number;
  currentAmountTokens: number;
  currentPriceUsd: number;
  currentValueUsd: number;
  realizedPnlSol: number;
  unrealizedPnlPercent: number;
  avgBuyPrice: number;
  lastAction: string;
  lastActionAt: string;
  isOpen: boolean;
  templateName: string | null;
}

/** GET /sniper/holdings — Aggregated P&L per token from execution history + open positions */
sniperRouter.get('/sniper/holdings', (_req, res) => {
  const holdingsMap = new Map<string, HoldingPnL>();

  // Build from execution history (successful buys and sells only)
  for (const execution of executionHistory) {
    if (execution.status !== 'success') continue;

    let holding = holdingsMap.get(execution.mint);
    if (!holding) {
      holding = {
        mint: execution.mint,
        symbol: execution.symbol,
        name: execution.name,
        totalBuySol: 0,
        totalSellSol: 0,
        totalBuyCount: 0,
        totalSellCount: 0,
        currentAmountTokens: 0,
        currentPriceUsd: 0,
        currentValueUsd: 0,
        realizedPnlSol: 0,
        unrealizedPnlPercent: 0,
        avgBuyPrice: 0,
        lastAction: execution.action,
        lastActionAt: execution.timestamp,
        isOpen: false,
        templateName: execution.templateName,
      };
      holdingsMap.set(execution.mint, holding);
    }

    if (execution.action === 'buy') {
      holding.totalBuySol += execution.amountSol;
      holding.totalBuyCount++;
    } else if (execution.action === 'sell') {
      holding.totalSellSol += execution.amountSol;
      holding.totalSellCount++;
    }

    holding.lastAction = execution.action;
    holding.lastActionAt = execution.timestamp;
    holding.templateName = execution.templateName;
  }

  // Merge open positions for current values + unrealized P&L
  for (const position of getAllActivePositions()) {
    let holding = holdingsMap.get(position.mint);
    if (!holding) {
      holding = {
        mint: position.mint,
        symbol: position.symbol,
        name: position.name,
        totalBuySol: 0,
        totalSellSol: 0,
        totalBuyCount: 1,
        totalSellCount: 0,
        currentAmountTokens: position.amountTokens,
        currentPriceUsd: position.currentPrice,
        currentValueUsd: 0,
        realizedPnlSol: 0,
        unrealizedPnlPercent: position.pnlPercent,
        avgBuyPrice: position.buyPrice,
        lastAction: 'buy',
        lastActionAt: position.boughtAt,
        isOpen: true,
        templateName: position.templateName,
      };
      holdingsMap.set(position.mint, holding);
    } else {
      holding.currentAmountTokens = position.amountTokens;
      holding.currentPriceUsd = position.currentPrice;
      holding.avgBuyPrice = position.buyPrice;
      holding.unrealizedPnlPercent = position.pnlPercent;
      holding.isOpen = true;
    }
  }

  // Calculate realized P&L and current value for all holdings
  for (const holding of holdingsMap.values()) {
    holding.realizedPnlSol = holding.totalSellSol - holding.totalBuySol;
    if (holding.isOpen && holding.currentPriceUsd > 0 && holding.avgBuyPrice > 0) {
      holding.currentValueUsd = holding.currentAmountTokens * holding.currentPriceUsd;
    }
  }

  const holdings = [...holdingsMap.values()].sort(
    (a, b) => new Date(b.lastActionAt).getTime() - new Date(a.lastActionAt).getTime(),
  );

  const totalRealizedPnl = holdings.reduce((sum, h) => sum + h.realizedPnlSol, 0);
  const totalInvested = holdings.reduce((sum, h) => sum + h.totalBuySol, 0);
  const totalReturned = holdings.reduce((sum, h) => sum + h.totalSellSol, 0);
  const openCount = holdings.filter(h => h.isOpen).length;

  res.json({
    data: holdings,
    summary: {
      totalHoldings: holdings.length,
      openPositions: openCount,
      closedPositions: holdings.length - openCount,
      totalInvestedSol: totalInvested,
      totalReturnedSol: totalReturned,
      realizedPnlSol: totalRealizedPnl,
    },
  });
});

// GET /sniper/pnl — Aggregated P&L summary across all templates
sniperRouter.get('/sniper/pnl', (_req, res) => {
  const templateStats = [...sniperTemplates.values()].map(template => {
    const runtime = getRuntime(template.id);
    resetDailyBudgetIfNeeded(runtime);
    const positions = getTemplatePositions(template.id);

    return {
      templateId: template.id,
      templateName: template.name,
      totalTrades: template.stats.totalTrades,
      wins: template.stats.wins,
      losses: template.stats.losses,
      totalPnlSol: template.stats.totalPnlSol,
      winRate: template.stats.totalTrades > 0
        ? (template.stats.wins / template.stats.totalTrades) * 100
        : 0,
      openPositions: positions.size,
      dailySpentSol: runtime.dailySpentSol,
      dailyBudgetSol: template.dailyBudgetSol,
      running: runtime.running,
      paperMode: template.paperMode,
      paperBalanceSol: template.paperMode ? runtime.paperBalanceSol : undefined,
    };
  });

  const totals = templateStats.reduce(
    (acc, s) => ({
      totalTrades: acc.totalTrades + s.totalTrades,
      wins: acc.wins + s.wins,
      losses: acc.losses + s.losses,
      totalPnlSol: acc.totalPnlSol + s.totalPnlSol,
      openPositions: acc.openPositions + s.openPositions,
    }),
    { totalTrades: 0, wins: 0, losses: 0, totalPnlSol: 0, openPositions: 0 },
  );

  const winRate = totals.totalTrades > 0
    ? (totals.wins / totals.totalTrades) * 100
    : 0;

  // Gather unrealized P&L from active positions
  syncActivePositionsMap();
  const unrealizedPnl = [...activePositions.values()].reduce(
    (sum, p) => {
      if (p.buyPrice <= 0) return sum;
      const positionValueSol = p.amountTokens * p.currentPrice;
      const costSol = p.amountTokens * p.buyPrice;
      return sum + (positionValueSol - costSol);
    },
    0,
  );

  res.json({
    summary: {
      totalPnlSol: totals.totalPnlSol,
      unrealizedPnl,
      totalTrades: totals.totalTrades,
      wins: totals.wins,
      losses: totals.losses,
      winRate,
      openPositions: totals.openPositions,
    },
    templates: templateStats,
    recentExecutions: executionHistory.slice(0, 20),
  });
});

// ── Clean Wallet (close empty token accounts, recover rent) ─────────

/**
 * POST /sniper/clean-wallet
 *
 * Scans ALL SPL token accounts in the bot wallet:
 *   1. Skips protected mints (system + user configured)
 *   2. For 0-balance accounts: closes them to recover rent (~0.002 SOL each)
 *   3. For non-zero balance accounts: attempts sell first, then closes
 *
 * Returns summary of accounts closed, rent recovered, etc.
 */
sniperRouter.post('/sniper/clean-wallet', async (_req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({
      error: 'No Solana wallet configured',
      message: 'Add a Solana bot wallet in Settings → API Keys',
    });
    return;
  }

  try {
    console.log('[Sniper] 🧹 Starting wallet cleanup...');

    const allAccounts = await getAllTokenAccounts();
    console.log(`[Sniper] Found ${allAccounts.length} total token accounts`);

    const emptyToClose: TokenAccountInfo[] = [];
    const nonEmptyToBurn: TokenAccountInfo[] = [];
    let skippedProtected = 0;

    for (const account of allAccounts) {
      // Skip protected mints
      if (isProtectedMint(account.mint)) {
        skippedProtected++;
        continue;
      }

      if (account.balance === 0) {
        emptyToClose.push(account);
      } else {
        nonEmptyToBurn.push(account);
      }
    }

    console.log(
      `[Sniper] Cleanup plan: ${emptyToClose.length} empty → close, ${nonEmptyToBurn.length} non-empty → burn+close, ${skippedProtected} protected skipped`,
    );

    // Phase 1: Close empty accounts (just need close instruction)
    let accountsClosed = 0;
    let totalRentRecoveredLamports = 0;
    const closeSignatures: string[] = [];

    if (emptyToClose.length > 0) {
      console.log(`[Sniper] Phase 1: Closing ${emptyToClose.length} empty accounts...`);
      const batchResult = await batchCloseTokenAccounts(emptyToClose);
      accountsClosed += batchResult.closed;
      totalRentRecoveredLamports += batchResult.totalRentRecoveredLamports;
      closeSignatures.push(...batchResult.signatures);
    }

    // Phase 2: Burn tokens and close non-empty accounts (dead/unsellable tokens)
    let tokensBurned = 0;
    let burnFailed = 0;

    if (nonEmptyToBurn.length > 0) {
      console.log(`[Sniper] Phase 2: Burning+closing ${nonEmptyToBurn.length} non-empty accounts...`);
      const burnResult = await batchBurnAndCloseTokenAccounts(nonEmptyToBurn);
      accountsClosed += burnResult.closed;
      totalRentRecoveredLamports += burnResult.totalRentRecoveredLamports;
      tokensBurned = burnResult.closed;
      burnFailed = burnResult.failed;
      closeSignatures.push(...burnResult.signatures);
    }

    const rentRecoveredSol = totalRentRecoveredLamports / 1e9;
    console.log(
      `[Sniper] 🧹 Wallet cleanup complete: ${accountsClosed} accounts closed, ` +
      `${rentRecoveredSol.toFixed(4)} SOL recovered, ${tokensBurned} tokens burned, ` +
      `${burnFailed} burn failures, ${skippedProtected} protected`,
    );

    // Refresh cached balance after cleanup
    void refreshCachedSolBalance();

    res.json({
      data: {
        accountsClosed,
        rentRecoveredSol,
        tokensBurned,
        burnFailed,
        skippedProtected,
        totalAccountsScanned: allAccounts.length,
        signatures: closeSignatures.slice(0, 30),
      },
      message: `Cleaned ${accountsClosed} token accounts, recovered ~${rentRecoveredSol.toFixed(4)} SOL`,
    });
  } catch (err) {
    console.error('[Sniper] Wallet cleanup failed:', err);
    res.status(500).json({
      error: 'Wallet cleanup failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /sniper/reconcile-wallet — Sell untracked tokens and close empty accounts
sniperRouter.post('/sniper/reconcile-wallet', async (_req, res) => {
  try {
    const result = await reconcileWalletPositions();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Reconciliation failed' });
  }
});

// POST /sniper/force-sell/:mint — Force sell a token by mint address (sells untracked tokens)
sniperRouter.post('/sniper/force-sell/:mint', async (req, res) => {
  try {
    const { mint } = req.params;
    const { executeSellSnipe } = await import('./execution.js');
    const { fetchTokenBalance } = await import('./execution.js');

    // Check if there's a real balance
    const balance = await fetchTokenBalance(mint);
    if (balance <= 0) {
      res.json({ message: `No tokens found for ${mint.slice(0, 12)}...`, balance: 0 });
      return;
    }

    // Create a temporary position so executeSellSnipe can find it
    const templateId = DEFAULT_TEMPLATE_ID;
    const positions = getTemplatePositions(templateId);
    if (!positions.has(mint)) {
      positions.set(mint, {
        mint,
        symbol: req.body?.symbol ?? mint.slice(0, 8),
        name: req.body?.name ?? 'Force Sell',
        buyPrice: 0,
        currentPrice: 0,
        amountTokens: balance,
        pnlPercent: 0,
        buySignature: 'force-sell',
        boughtAt: new Date().toISOString(),
        templateId,
        templateName: 'Default Sniper',
        priceFetchFailCount: 0,
        lastPriceChangeAt: new Date().toISOString(),
        highWaterMarkPrice: 0,
        buyCostSol: 0.03,
      });
      syncActivePositionsMap();
    }

    const result = await executeSellSnipe(mint, 'manual', templateId, true);
    res.json({
      message: result?.status === 'success'
        ? `Sold ${mint.slice(0, 12)}... — ${result.amountSol?.toFixed(6)} SOL received`
        : `Sell attempted — ${result?.status ?? 'unknown'}`,
      execution: result ? { status: result.status, amountSol: result.amountSol, signature: result.signature } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Force sell failed' });
  }
});

// POST /sniper/clear-paper-positions — Remove all paper positions (for switching to live mode)
sniperRouter.post('/sniper/clear-paper-positions', (_req, res) => {
  let cleared = 0;
  for (const [, positions] of positionsMap) {
    for (const [mint, position] of positions) {
      if (position.paperMode) {
        positions.delete(mint);
        cleared++;
      }
    }
  }
  res.json({ message: `Cleared ${cleared} paper position(s)`, cleared });
});

// ── Copy Trade API ──────────────────────────────────────────────────

// GET /sniper/copy-trade/status — Copy trade monitor status
sniperRouter.get('/sniper/copy-trade/status', (_req, res) => {
  const status = getCopyTradeStatus();
  res.json({ data: status });
});

// GET /sniper/copy-trade/whales — List tracked whale wallets
sniperRouter.get('/sniper/copy-trade/whales', (_req, res) => {
  const registry = getWhaleRegistry();
  res.json({ data: [...registry.values()], count: registry.size });
});

// POST /sniper/copy-trade/whales — Add a whale to the registry
sniperRouter.post('/sniper/copy-trade/whales', (req, res) => {
  const { address, label, winRate, avgRoiPercent, totalTrades90d, portfolioValueUsd, source } = req.body as Partial<TrackedWhale>;
  if (!address || address.length < 32) {
    res.status(400).json({ error: 'Valid Solana address required' });
    return;
  }
  const whale: TrackedWhale = {
    address,
    label: label ?? address.slice(0, 8),
    winRate: winRate ?? 0,
    avgRoiPercent: avgRoiPercent ?? 0,
    totalTrades90d: totalTrades90d ?? 0,
    portfolioValueUsd: portfolioValueUsd ?? 0,
    addedAt: new Date().toISOString(),
    source: (source as TrackedWhale['source']) ?? 'manual',
  };
  addWhale(whale);
  res.json({ message: `Whale ${whale.label} added`, data: whale });
});

// DELETE /sniper/copy-trade/whales/:address — Remove a whale
sniperRouter.delete('/sniper/copy-trade/whales/:address', (req, res) => {
  const removed = removeWhale(req.params.address);
  if (!removed) {
    res.status(404).json({ error: 'Whale not found in registry' });
    return;
  }
  res.json({ message: 'Whale removed' });
});

// ── Protected Mints API ─────────────────────────────────────────────

// GET /sniper/protected — List all protected mints
sniperRouter.get('/sniper/protected', (_req, res) => {
  res.json({ data: getAllProtectedMints() });
});

// POST /sniper/protect/:mint — Add mint to protected list
sniperRouter.post('/sniper/protect/:mint', (req, res) => {
  const { mint } = req.params;
  if (!mint || mint.length < 32) {
    res.status(400).json({ error: 'Invalid mint address' });
    return;
  }
  addProtectedMint(mint);
  console.log(`[Sniper] 🛡️ Protected mint added: ${mint.slice(0, 12)}...`);
  res.json({ message: `Mint ${mint.slice(0, 12)}... added to protected list`, data: getAllProtectedMints() });
});

// DELETE /sniper/protect/:mint — Remove mint from protected list
sniperRouter.delete('/sniper/protect/:mint', (req, res) => {
  const { mint } = req.params;
  if (!mint || mint.length < 32) {
    res.status(400).json({ error: 'Invalid mint address' });
    return;
  }
  const removed = removeProtectedMint(mint);
  if (!removed) {
    res.status(400).json({ error: 'Cannot remove system-protected mint or mint not found' });
    return;
  }
  console.log(`[Sniper] 🛡️ Protected mint removed: ${mint.slice(0, 12)}...`);
  res.json({ message: `Mint ${mint.slice(0, 12)}... removed from protected list`, data: getAllProtectedMints() });
});

// ── Performance Analytics Routes ──────────────────────────────────────

import { computePerformanceMetrics } from '../../services/analytics/performance-tracker.js';

// GET /sniper/analytics — full performance metrics
sniperRouter.get('/sniper/analytics', (req, res) => {
  const period = (req.query.period as string | undefined) ?? 'all';
  const templateId = req.query.templateId as string | undefined;

  if (!['all', '24h', '7d', '30d'].includes(period)) {
    res.status(400).json({
      error: { code: 'INVALID_PERIOD', message: 'period must be all, 24h, 7d, or 30d' },
    });
    return;
  }

  const metrics = computePerformanceMetrics({
    executions: executionHistory,
    period: period as 'all' | '24h' | '7d' | '30d',
    templateId,
  });

  res.json({ data: metrics });
});

// GET /sniper/analytics/daily — daily P&L chart data
sniperRouter.get('/sniper/analytics/daily', (req, res) => {
  const period = (req.query.period as string | undefined) ?? 'all';
  const templateId = req.query.templateId as string | undefined;

  if (!['all', '24h', '7d', '30d'].includes(period)) {
    res.status(400).json({
      error: { code: 'INVALID_PERIOD', message: 'period must be all, 24h, 7d, or 30d' },
    });
    return;
  }

  const metrics = computePerformanceMetrics({
    executions: executionHistory,
    period: period as 'all' | '24h' | '7d' | '30d',
    templateId,
  });

  res.json({
    data: metrics.dailyPnl,
    summary: {
      totalTrades: metrics.totalTrades,
      totalPnlSol: metrics.totalPnlSol,
      winRate: metrics.winRate,
      days: metrics.dailyPnl.length,
    },
  });
});

// ── Risk & Position Sizing Routes ─────────────────────────────────────

import { calculatePortfolioHeat } from '../../services/risk/portfolio-heat.js';
import { calculatePositionSize } from '../../services/risk/kelly-criterion.js';

// GET /sniper/risk/portfolio — current portfolio heat + sizing info
sniperRouter.get('/sniper/risk/portfolio', (_req, res) => {
  const walletSol = cachedSolBalanceLamports / 1e9;
  const allPositions = getAllActivePositions();

  const positionSnapshots = allPositions.map((pos) => {
    const buyCost = pos.buyCostSol ?? 0.005;
    return {
      buyCostSol: buyCost,
      pnlPercent: pos.pnlPercent,
      currentValueSol: buyCost * (1 + pos.pnlPercent / 100),
    };
  });

  const heat = calculatePortfolioHeat({
    walletBalanceSol: walletSol,
    positions: positionSnapshots,
  });

  // Calculate example sizing for each quality tier
  const templateId = _req.query.templateId as string | undefined;
  const template = sniperTemplates.get(templateId ?? DEFAULT_TEMPLATE_ID);

  let exampleSizing: Record<string, unknown> | undefined;
  if (template) {
    const winRate = template.stats.totalTrades > 0
      ? template.stats.wins / template.stats.totalTrades
      : 0;
    const avgWinLoss = template.stats.totalTrades > 2 ? 1.5 : 1.5;

    const tiers = ['PRIME', 'STANDARD', 'SPECULATIVE'] as const;
    const sizing: Record<string, unknown> = {};
    for (const quality of tiers) {
      const confidenceMap = { PRIME: 80, STANDARD: 60, SPECULATIVE: 40 } as const;
      const result = calculatePositionSize({
        walletBalanceSol: walletSol,
        signalConfidence: confidenceMap[quality],
        signalQuality: quality,
        historicalWinRate: winRate,
        avgWinLossRatio: avgWinLoss,
        portfolioHeat: heat.score,
        maxPositionPct: template.maxPositionPct,
        baseBuyAmountSol: template.buyAmountSol,
      });
      sizing[quality] = {
        recommendedSol: result.recommendedSol,
        kellyPct: Math.round(result.kellyFraction * 10000) / 100,
        adjustedPct: Math.round(result.adjustedFraction * 10000) / 100,
        reasoning: result.reasoning,
      };
    }
    exampleSizing = sizing;
  }

  res.json({
    data: {
      walletBalanceSol: walletSol,
      heat,
      openPositionCount: allPositions.length,
      dynamicSizingEnabled: template?.enableDynamicSizing ?? false,
      maxPositionPct: template?.maxPositionPct ?? 0.10,
      baseBuyAmountSol: template?.buyAmountSol ?? 0.005,
      exampleSizing,
    },
  });
});

// ── Strategy Preset Routes ──────────────────────────────────────────────

import { getAllPresets, getPreset } from '../../services/ai/strategy-templates.js';

// GET /sniper/presets — list all strategy presets
sniperRouter.get('/sniper/presets', (_req, res) => {
  const presets = getAllPresets();
  res.json({
    data: presets,
    total: presets.length,
  });
});

// POST /sniper/presets/:name/apply — create a new template from a preset
sniperRouter.post('/sniper/presets/:name/apply', (req, res) => {
  const { name } = req.params;
  const preset = getPreset(name);

  if (!preset) {
    const available = getAllPresets().map((p) => p.name);
    res.status(404).json({
      error: {
        code: 'PRESET_NOT_FOUND',
        message: `Preset "${name}" not found`,
        availablePresets: available,
      },
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const customName = typeof body.name === 'string' && body.name.trim().length > 0
    ? body.name.trim()
    : preset.name;

  // Merge preset config with any user overrides from the request body
  const userOverrides = pickConfigFields(body);
  const mergedConfig = { ...preset.config, ...userOverrides };

  const validationError = validateConfigUpdates(mergedConfig);
  if (validationError) {
    res.status(400).json({
      error: { code: 'INVALID_CONFIG', message: validationError },
    });
    return;
  }

  const template = createTemplate(customName, mergedConfig);

  res.status(201).json({
    data: template,
    preset: {
      name: preset.name,
      category: preset.category,
      riskLevel: preset.riskLevel,
      expectedWinRate: preset.expectedWinRate,
      bestFor: preset.bestFor,
    },
    message: `Template "${template.name}" created from preset "${preset.name}"`,
  });
});

// ── AI Signal Routes ────────────────────────────────────────────────────

import { generateSignal } from '../../services/ai/signal-generator.js';

// GET /sniper/signals/latest — last 50 signals generated
sniperRouter.get('/sniper/signals/latest', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const qualityFilter = req.query.quality as string | undefined;

  let signals = recentSignals;
  if (qualityFilter) {
    const upper = qualityFilter.toUpperCase();
    signals = signals.filter((s) => s.quality === upper);
  }

  res.json({
    data: signals.slice(0, limit),
    total: signals.length,
    limit,
  });
});

// GET /sniper/signals/:mint — generate a fresh signal on-demand for a specific token
sniperRouter.get('/sniper/signals/:mint', async (req, res) => {
  const { mint } = req.params;

  if (!mint || mint.length < 32) {
    res.status(400).json({ error: 'Invalid mint address' });
    return;
  }

  // Check if we have a recent signal for this mint (< 2 min old)
  const existing = recentSignals.find((s) => s.mint === mint);
  if (existing) {
    const ageMs = Date.now() - new Date(existing.timestamp).getTime();
    if (ageMs < 120_000) {
      res.json({ data: existing, cached: true, ageMs });
      return;
    }
  }

  try {
    // Fetch current price from DexScreener for the on-demand signal
    let currentPrice = 0;
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (dexRes.ok) {
        const dexData = (await dexRes.json()) as { pairs?: Array<{ chainId: string; priceUsd?: string }> };
        const solanaPair = dexData.pairs?.find((p) => p.chainId === 'solana');
        if (solanaPair?.priceUsd) {
          currentPrice = parseFloat(solanaPair.priceUsd);
        }
      }
    } catch { /* price fetch failed, use 0 */ }

    const signal = await generateSignal({
      mint,
      symbol: 'LOOKUP',
      name: 'On-demand lookup',
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
    });

    // Store the on-demand signal too
    recentSignals.unshift(signal);
    if (recentSignals.length > 200) {
      recentSignals.length = 200;
    }

    res.json({ data: signal, cached: false });
  } catch (err) {
    res.status(500).json({
      error: 'Signal generation failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── AI Intelligence: Market Briefing ─────────────────────────────────────

// GET /sniper/briefing — latest market briefing
sniperRouter.get('/sniper/briefing', (_req, res) => {
  try {
    const briefing = generateBriefing();
    res.json({ data: briefing });
  } catch (err) {
    res.status(500).json({
      error: 'Briefing generation failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── Cleanup ─────────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
process.on('SIGTERM', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
