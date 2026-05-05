/**
 * Kill-switch HTTP API.
 *
 * GET  /status              — full status snapshot
 * POST /master-kill         — admin-only; flatten all + block new entries
 * POST /master-deactivate   — admin-only; clear master kill
 * POST /strategy-pause      — pause one strategy for N hours
 * POST /strategy-resume     — resume one strategy
 * POST /portfolio-pause     — pause all new entries
 * POST /portfolio-resume    — resume new entries
 *
 * All status / pause / resume endpoints return the FULL `KillSwitchStatus`
 * after the change so dashboards stay consistent with one round-trip.
 */

import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import {
  activateMasterKill,
  deactivateMaster,
  getKillSwitchStatus,
  pausePortfolio,
  pauseStrategy,
  resumePortfolio,
  resumeStrategy,
} from '../services/orchestrator/kill-switches.js';

export const killSwitchesRouter: IRouter = Router();

// ── GET /status ────────────────────────────────────────────────────────

killSwitchesRouter.get('/status', async (_req, res) => {
  try {
    const status = await getKillSwitchStatus();
    res.json({ data: status });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] /status failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'status failed' });
  }
});

// ── POST /master-kill (admin only) ─────────────────────────────────────

const MasterKillBody = z.object({
  reason: z.string().min(1).max(500),
});

killSwitchesRouter.post('/master-kill', requireRole('admin'), async (req, res) => {
  const parsed = MasterKillBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'reason required', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await activateMasterKill(parsed.data.reason);
    const status = await getKillSwitchStatus();
    res.json({ data: status, message: 'Master kill activated — all positions flattened' });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] master-kill failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'master-kill failed' });
  }
});

// ── POST /master-deactivate (admin only) ───────────────────────────────

killSwitchesRouter.post('/master-deactivate', requireRole('admin'), async (_req, res) => {
  try {
    await deactivateMaster();
    const status = await getKillSwitchStatus();
    res.json({ data: status, message: 'Master kill deactivated' });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] master-deactivate failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'master-deactivate failed' });
  }
});

// ── POST /strategy-pause ───────────────────────────────────────────────

const StrategyPauseBody = z.object({
  strategy: z.string().min(1).max(120),
  hours: z.number().positive().max(24 * 30), // cap at 30 days
  reason: z.string().min(1).max(500),
});

killSwitchesRouter.post('/strategy-pause', async (req, res) => {
  const parsed = StrategyPauseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await pauseStrategy(parsed.data.strategy, parsed.data.hours, parsed.data.reason);
    const status = await getKillSwitchStatus();
    res.json({ data: status, message: `Strategy "${parsed.data.strategy}" paused for ${parsed.data.hours}h` });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] strategy-pause failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'strategy-pause failed' });
  }
});

// ── POST /strategy-resume ──────────────────────────────────────────────

const StrategyResumeBody = z.object({
  strategy: z.string().min(1).max(120),
});

killSwitchesRouter.post('/strategy-resume', async (req, res) => {
  const parsed = StrategyResumeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await resumeStrategy(parsed.data.strategy);
    const status = await getKillSwitchStatus();
    res.json({ data: status, message: `Strategy "${parsed.data.strategy}" resumed` });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] strategy-resume failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'strategy-resume failed' });
  }
});

// ── POST /portfolio-pause ──────────────────────────────────────────────

const PortfolioPauseBody = z.object({
  reason: z.string().min(1).max(500),
});

killSwitchesRouter.post('/portfolio-pause', async (req, res) => {
  const parsed = PortfolioPauseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'reason required', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    await pausePortfolio(parsed.data.reason);
    const status = await getKillSwitchStatus();
    res.json({ data: status, message: 'Portfolio paused — no new entries' });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] portfolio-pause failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'portfolio-pause failed' });
  }
});

// ── POST /portfolio-resume ─────────────────────────────────────────────

killSwitchesRouter.post('/portfolio-resume', async (_req, res) => {
  try {
    await resumePortfolio();
    const status = await getKillSwitchStatus();
    res.json({ data: status, message: 'Portfolio resumed' });
  } catch (err) {
    logger.error({ err }, '[KillSwitch] portfolio-resume failed');
    res.status(500).json({ error: err instanceof Error ? err.message : 'portfolio-resume failed' });
  }
});
