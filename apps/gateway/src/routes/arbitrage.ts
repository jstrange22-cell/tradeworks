import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  scanArbitrage,
  getArbitrageConfig,
  updateArbitrageConfig,
} from '../services/arbitrage-scanner.js';

/**
 * Cross-Exchange Arbitrage endpoints.
 * GET  /api/v1/arbitrage/scan    — Scan for arbitrage opportunities
 * GET  /api/v1/arbitrage/config  — Get scanner configuration
 * PUT  /api/v1/arbitrage/config  — Update scanner configuration
 */

export const arbitrageRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ScanQuerySchema = z.object({
  instruments: z
    .string()
    .optional()
    .transform((val) =>
      val
        ? val.split(',').map((s) => s.trim().toUpperCase())
        : undefined,
    ),
});

const UpdateConfigSchema = z.object({
  minSpreadPercent: z.number().min(0).max(50).optional(),
  feePercent: z.number().min(0).max(10).optional(),
  slippagePercent: z.number().min(0).max(10).optional(),
  tradeSize: z.number().min(1).max(1_000_000).optional(),
  exchanges: z.array(z.string().min(1)).min(2).optional(),
});

// ---------------------------------------------------------------------------
// GET /scan — Run arbitrage scan
// ---------------------------------------------------------------------------

arbitrageRouter.get('/scan', async (req, res) => {
  try {
    const parsed = ScanQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.errors,
      });
      return;
    }

    const opportunities = await scanArbitrage(parsed.data.instruments);

    res.json({
      data: opportunities,
      total: opportunities.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Arbitrage scan failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /config — Get scanner configuration
// ---------------------------------------------------------------------------

arbitrageRouter.get('/config', (_req, res) => {
  try {
    const currentConfig = getArbitrageConfig();
    res.json({ data: currentConfig });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get arbitrage config' });
  }
});

// ---------------------------------------------------------------------------
// PUT /config — Update scanner configuration
// ---------------------------------------------------------------------------

arbitrageRouter.put('/config', (req, res) => {
  try {
    const parsed = UpdateConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid configuration',
        details: parsed.error.errors,
      });
      return;
    }

    const updated = updateArbitrageConfig(parsed.data);
    res.json({ data: updated, message: 'Arbitrage config updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update arbitrage config' });
  }
});
