/**
 * V2 Strategies router — per-strategy detail surface for the bandit-managed
 * v2 strategy lab (`pead`, `regime_trend`, `vol_rank_options`,
 * `sector_rotation`, `funding_basis`, `range_grid_stables`).
 *
 *   GET  /api/v1/v2-strategies                   → list all strategies + metadata
 *   GET  /api/v1/v2-strategies/:name             → one strategy + recent stats
 *   GET  /api/v1/v2-strategies/:name/equity-curve → 90d equity time series
 *   GET  /api/v1/v2-strategies/:name/decisions    → recent decisions filtered to strategy
 *   POST /api/v1/v2-strategies/:name/promote-to-live (admin) → flip paper → live
 *   POST /api/v1/v2-strategies/:name/pause        → pause strategy for N hours
 *   POST /api/v1/v2-strategies/:name/resume       → resume paused strategy
 *
 * State source of truth:
 *   - bandit-weights file       → live bandit weight per strategy
 *   - kill-switch state         → effective pause/resume flag
 *   - apps/gateway/data/v2-strategies.json → live/paper + sizingScalar overlay
 *   - memory DB (decisions + trade_outcomes) → stats + equity curve
 *
 * Distinct from `routes/strategies.ts` which is the legacy CRUD layer for
 * user-defined trading templates. The two coexist and never share state.
 */

import { Router, type Router as RouterType } from 'express';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { requireRole } from '../middleware/auth.js';
import { getCurrentWeights } from '../services/orchestrator/bandit-runner.js';
import {
  KNOWN_STRATEGIES,
  type StrategyName,
} from '../services/orchestrator/bandit-types.js';
import {
  getKillSwitchStatus,
  pauseStrategy,
  resumeStrategy,
} from '../services/orchestrator/kill-switches.js';
import { getRecentDecisions } from '../services/memory/decisions.js';
import { getPool } from '../services/memory/db.js';

export const v2StrategiesRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

type StrategyStatus = 'paper' | 'live' | 'paused';

interface StrategyOverlay {
  live: boolean;
  sizingScalar: number;
  status: StrategyStatus;
  promotedAt: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
}

interface StrategyMetaFile {
  schemaVersion: 1;
  updatedAt: string;
  strategies: Record<string, StrategyOverlay>;
}

interface StrategyStats30d {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  expectancy: number | null;
  totalPnlUsd: number;
  /** Annualized-like Sharpe proxy: mean(pnl) / stdev(pnl) * sqrt(252). */
  sharpe: number | null;
  /** Maximum drawdown in USD over the trailing 30d. */
  maxDdUsd: number;
  openPositions: number;
  lastDecisionTs: string | null;
}

// ── Constants & defaults ───────────────────────────────────────────────

const DEFAULT_STATUS: StrategyOverlay = {
  live: false,
  sizingScalar: 1.0,
  status: 'paper',
  promotedAt: null,
  pausedAt: null,
  pauseReason: null,
};

const PROMOTE_BODY = z.object({
  sizingScalar: z.number().min(0).max(1).default(0.25),
});

const PAUSE_BODY = z.object({
  hours: z.number().positive().max(24 * 30),
  reason: z.string().min(1).max(500),
});

// ── State file persistence ─────────────────────────────────────────────

function metaFilePath(): string {
  // src/routes/v2-strategies.ts → apps/gateway/data/v2-strategies.json
  const here = dirname(fileURLToPath(import.meta.url));
  const routes = here;
  const srcOrDist = dirname(routes);
  const gatewayRoot = dirname(srcOrDist);
  return resolve(gatewayRoot, 'data', 'v2-strategies.json');
}

function readMetaFile(): StrategyMetaFile {
  const path = metaFilePath();
  if (!existsSync(path)) {
    return seedMetaFile();
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StrategyMetaFile>;
    if (parsed.schemaVersion !== 1 || !parsed.strategies) {
      logger.warn('[v2-strategies] meta file schema mismatch — reseeding');
      return seedMetaFile();
    }
    // Ensure every known strategy has an entry, in case the canonical list grew.
    let dirty = false;
    for (const s of KNOWN_STRATEGIES) {
      if (!parsed.strategies[s]) {
        parsed.strategies[s] = { ...DEFAULT_STATUS };
        dirty = true;
      }
    }
    const file: StrategyMetaFile = {
      schemaVersion: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      strategies: parsed.strategies,
    };
    if (dirty) writeMetaFile(file);
    return file;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[v2-strategies] meta file unreadable — reseeding',
    );
    return seedMetaFile();
  }
}

function seedMetaFile(): StrategyMetaFile {
  const strategies: Record<string, StrategyOverlay> = {};
  for (const s of KNOWN_STRATEGIES) {
    strategies[s] = { ...DEFAULT_STATUS };
  }
  const file: StrategyMetaFile = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    strategies,
  };
  writeMetaFile(file);
  return file;
}

function writeMetaFile(file: StrategyMetaFile): void {
  const path = metaFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf8');
  renameSync(tmpPath, path);
}

function updateOverlay(
  name: string,
  patch: Partial<StrategyOverlay>,
): StrategyOverlay {
  const file = readMetaFile();
  const existing = file.strategies[name] ?? { ...DEFAULT_STATUS };
  const next: StrategyOverlay = { ...existing, ...patch };
  file.strategies[name] = next;
  file.updatedAt = new Date().toISOString();
  writeMetaFile(file);
  return next;
}

// ── Stats helpers ──────────────────────────────────────────────────────

async function computeStats30d(name: string): Promise<StrategyStats30d> {
  const empty: StrategyStats30d = {
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    expectancy: null,
    totalPnlUsd: 0,
    sharpe: null,
    maxDdUsd: 0,
    openPositions: 0,
    lastDecisionTs: null,
  };

  const pool = getPool();
  if (!pool) return empty;

  try {
    // Closed-trade aggregates over the 30d window.
    const aggRes = await pool.query<{
      trades: string | number;
      wins: string | number;
      losses: string | number;
      pnl_sum: string | number | null;
      pnl_avg: string | number | null;
      pnl_std: string | number | null;
    }>(
      `
      SELECT
        COUNT(*)::bigint AS trades,
        COUNT(*) FILTER (WHERE o.realized_pnl_usd > 0)::bigint AS wins,
        COUNT(*) FILTER (WHERE o.realized_pnl_usd <= 0)::bigint AS losses,
        COALESCE(SUM(o.realized_pnl_usd), 0) AS pnl_sum,
        AVG(o.realized_pnl_usd) AS pnl_avg,
        STDDEV_SAMP(o.realized_pnl_usd) AS pnl_std
      FROM trade_outcomes o
      JOIN decisions d ON d.id = o.decision_id
      WHERE d.strategy = $1
        AND o.closed_at >= NOW() - INTERVAL '30 days'
      `,
      [name],
    );

    const row = aggRes.rows[0];
    const trades = numberish(row?.trades);
    const wins = numberish(row?.wins);
    const losses = numberish(row?.losses);
    const totalPnl = numberish(row?.pnl_sum);
    const pnlAvg = row?.pnl_avg == null ? null : numberish(row.pnl_avg);
    const pnlStd = row?.pnl_std == null ? null : numberish(row.pnl_std);

    const winRate = trades > 0 ? wins / trades : null;
    const expectancy = pnlAvg;
    const sharpe =
      pnlAvg != null && pnlStd != null && pnlStd > 0
        ? (pnlAvg / pnlStd) * Math.sqrt(252)
        : null;

    // Equity curve over 30d for max drawdown.
    const curveRes = await pool.query<{
      closed_at: Date;
      cum: string | number;
    }>(
      `
      SELECT
        o.closed_at,
        SUM(o.realized_pnl_usd) OVER (ORDER BY o.closed_at) AS cum
      FROM trade_outcomes o
      JOIN decisions d ON d.id = o.decision_id
      WHERE d.strategy = $1
        AND o.closed_at >= NOW() - INTERVAL '30 days'
      ORDER BY o.closed_at ASC
      `,
      [name],
    );

    let peak = 0;
    let maxDd = 0;
    for (const r of curveRes.rows) {
      const cum = numberish(r.cum);
      if (cum > peak) peak = cum;
      const dd = cum - peak;
      if (dd < maxDd) maxDd = dd;
    }

    // Open positions: decisions resolved=executed without a matching outcome.
    const openRes = await pool.query<{ open_count: string | number }>(
      `
      SELECT COUNT(*)::bigint AS open_count
      FROM decisions d
      LEFT JOIN trade_outcomes o ON o.decision_id = d.id
      WHERE d.strategy = $1
        AND d.resolution = 'executed'
        AND o.decision_id IS NULL
      `,
      [name],
    );
    const openPositions = numberish(openRes.rows[0]?.open_count);

    // Last decision timestamp (any verdict).
    const lastRes = await pool.query<{ last_ts: Date | null }>(
      `
      SELECT MAX(created_at) AS last_ts
      FROM decisions
      WHERE strategy = $1
      `,
      [name],
    );
    const lastTsRaw = lastRes.rows[0]?.last_ts;
    const lastDecisionTs = lastTsRaw ? new Date(lastTsRaw).toISOString() : null;

    return {
      trades,
      wins,
      losses,
      winRate,
      expectancy,
      totalPnlUsd: totalPnl,
      sharpe,
      maxDdUsd: maxDd,
      openPositions,
      lastDecisionTs,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, strategy: name },
      '[v2-strategies] computeStats30d failed — returning zeroes',
    );
    return empty;
  }
}

function numberish(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

async function buildStrategyDescriptor(
  name: string,
): Promise<{
  name: string;
  overlay: StrategyOverlay;
  effectiveStatus: StrategyStatus;
  banditWeight: number;
  stats: StrategyStats30d;
}> {
  const meta = readMetaFile();
  const overlay = meta.strategies[name] ?? { ...DEFAULT_STATUS };

  const weights = getCurrentWeights();
  const banditWeight =
    weights?.strategies[name]?.weight ?? 1 / KNOWN_STRATEGIES.length;

  // Effective status: if kill-switch has paused this strategy it overrides
  // whatever's stored in the overlay file.
  const ks = await getKillSwitchStatus();
  const ksPaused = ks.strategies?.[name]?.active === true;
  const effectiveStatus: StrategyStatus = ksPaused ? 'paused' : overlay.status;

  const stats = await computeStats30d(name);

  return {
    name,
    overlay,
    effectiveStatus,
    banditWeight,
    stats,
  };
}

function isKnownStrategy(name: string): name is StrategyName {
  return (KNOWN_STRATEGIES as readonly string[]).includes(name);
}

// ── Routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/v2-strategies
 * Returns the list of all known v2 strategies with metadata + 30d stats.
 */
v2StrategiesRouter.get('/', async (_req, res) => {
  try {
    const list = await Promise.all(
      KNOWN_STRATEGIES.map((s) => buildStrategyDescriptor(s)),
    );
    res.json({ data: list });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[v2-strategies] list failed',
    );
    res.status(500).json({ error: 'Failed to list strategies' });
  }
});

/**
 * GET /api/v1/v2-strategies/:name
 * Returns a single strategy descriptor + recent stats.
 */
v2StrategiesRouter.get('/:name', async (req, res) => {
  const { name } = req.params;
  if (!name || !isKnownStrategy(name)) {
    res.status(404).json({ error: `Unknown strategy "${name}"` });
    return;
  }

  try {
    const descriptor = await buildStrategyDescriptor(name);
    res.json({ data: descriptor });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, name },
      '[v2-strategies] get failed',
    );
    res.status(500).json({ error: 'Failed to fetch strategy' });
  }
});

/**
 * GET /api/v1/v2-strategies/:name/equity-curve
 * Returns the realized-PnL cumulative time series over the trailing 90d.
 */
v2StrategiesRouter.get('/:name/equity-curve', async (req, res) => {
  const { name } = req.params;
  if (!name || !isKnownStrategy(name)) {
    res.status(404).json({ error: `Unknown strategy "${name}"` });
    return;
  }

  const pool = getPool();
  if (!pool) {
    res.json({ data: { points: [], note: 'memory DB unavailable' } });
    return;
  }

  try {
    const result = await pool.query<{
      closed_at: Date;
      pnl: string | number;
    }>(
      `
      SELECT o.closed_at, o.realized_pnl_usd AS pnl
      FROM trade_outcomes o
      JOIN decisions d ON d.id = o.decision_id
      WHERE d.strategy = $1
        AND o.closed_at >= NOW() - INTERVAL '90 days'
      ORDER BY o.closed_at ASC
      `,
      [name],
    );

    let cum = 0;
    const points = result.rows.map((r) => {
      cum += numberish(r.pnl);
      return {
        ts: new Date(r.closed_at).toISOString(),
        equity: Number(cum.toFixed(2)),
      };
    });

    res.json({ data: { points } });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, name },
      '[v2-strategies] equity-curve failed',
    );
    res.status(500).json({ error: 'Failed to fetch equity curve' });
  }
});

/**
 * GET /api/v1/v2-strategies/:name/decisions?limit=50
 * Returns recent decisions for this strategy with closed-trade P&L joined in.
 */
v2StrategiesRouter.get('/:name/decisions', async (req, res) => {
  const { name } = req.params;
  if (!name || !isKnownStrategy(name)) {
    res.status(404).json({ error: `Unknown strategy "${name}"` });
    return;
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 500);

  try {
    const decisions = await getRecentDecisions(limit, { strategy: name });
    if (decisions.length === 0) {
      res.json({ data: [] });
      return;
    }

    const pool = getPool();
    let pnlByDecision = new Map<string, number>();

    if (pool) {
      const ids = decisions.map((d) => d.id);
      const pnlRes = await pool.query<{
        decision_id: string;
        realized_pnl_usd: string | number;
      }>(
        `SELECT decision_id, realized_pnl_usd
           FROM trade_outcomes
           WHERE decision_id = ANY($1::uuid[])`,
        [ids],
      );
      pnlByDecision = new Map(
        pnlRes.rows.map((r) => [r.decision_id, numberish(r.realized_pnl_usd)]),
      );
    }

    const rows = decisions.map((d) => {
      const sig = d.signal as { symbol?: string; ticker?: string } | null;
      const symbol = sig?.symbol ?? sig?.ticker ?? null;
      const pnl = pnlByDecision.get(d.id);
      return {
        id: d.id,
        ts: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
        symbol,
        verdict: d.verdict,
        confidence: d.confidence,
        resolution: d.resolution,
        pnlUsd: pnl ?? null,
      };
    });

    res.json({ data: rows });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, name },
      '[v2-strategies] decisions failed',
    );
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

/**
 * POST /api/v1/v2-strategies/:name/promote-to-live (admin only)
 * Flip a strategy from paper to live with a manual sizing scalar override.
 */
v2StrategiesRouter.post(
  '/:name/promote-to-live',
  requireRole('admin'),
  (req, res) => {
    const name = String(req.params.name ?? '');
    if (!name || !isKnownStrategy(name)) {
      res.status(404).json({ error: `Unknown strategy "${name}"` });
      return;
    }

    const parsed = PROMOTE_BODY.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid promote payload',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const overlay = updateOverlay(name, {
        live: true,
        sizingScalar: parsed.data.sizingScalar,
        status: 'live',
        promotedAt: new Date().toISOString(),
        pausedAt: null,
        pauseReason: null,
      });
      logger.warn(
        { strategy: name, sizingScalar: parsed.data.sizingScalar },
        `[v2-strategies] PROMOTED "${name}" → LIVE @ scalar=${parsed.data.sizingScalar}`,
      );
      res.json({
        data: { name, overlay },
        message: `Strategy "${name}" promoted to LIVE (scalar=${parsed.data.sizingScalar})`,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err, name },
        '[v2-strategies] promote failed',
      );
      res.status(500).json({ error: 'Promote failed' });
    }
  },
);

/**
 * POST /api/v1/v2-strategies/:name/pause
 * Pause a strategy via the kill-switch module + record overlay metadata.
 */
v2StrategiesRouter.post('/:name/pause', async (req, res) => {
  const { name } = req.params;
  if (!name || !isKnownStrategy(name)) {
    res.status(404).json({ error: `Unknown strategy "${name}"` });
    return;
  }

  const parsed = PAUSE_BODY.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid pause payload',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    await pauseStrategy(name, parsed.data.hours, parsed.data.reason);
    const overlay = updateOverlay(name, {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      pauseReason: parsed.data.reason,
    });
    res.json({
      data: { name, overlay },
      message: `Strategy "${name}" paused for ${parsed.data.hours}h`,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, name },
      '[v2-strategies] pause failed',
    );
    res.status(500).json({ error: 'Pause failed' });
  }
});

/**
 * POST /api/v1/v2-strategies/:name/resume
 * Resume a paused strategy. Restores prior status (paper unless live=true).
 */
v2StrategiesRouter.post('/:name/resume', async (req, res) => {
  const { name } = req.params;
  if (!name || !isKnownStrategy(name)) {
    res.status(404).json({ error: `Unknown strategy "${name}"` });
    return;
  }

  try {
    await resumeStrategy(name);
    const meta = readMetaFile();
    const existing = meta.strategies[name] ?? { ...DEFAULT_STATUS };
    const overlay = updateOverlay(name, {
      status: existing.live ? 'live' : 'paper',
      pausedAt: null,
      pauseReason: null,
    });
    res.json({
      data: { name, overlay },
      message: `Strategy "${name}" resumed`,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err, name },
      '[v2-strategies] resume failed',
    );
    res.status(500).json({ error: 'Resume failed' });
  }
});
