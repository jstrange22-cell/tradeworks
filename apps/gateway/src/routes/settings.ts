import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  getGuardrails,
  upsertGuardrail,
  getAllSettings,
  setSetting,
  type NewGuardrail,
} from '@tradeworks/db';

/**
 * Settings routes.
 * GET    /api/v1/settings              - Get all settings (combined)
 * PUT    /api/v1/settings              - Partial merge update
 * GET    /api/v1/settings/risk-limits  - Get risk guardrails
 * PUT    /api/v1/settings/risk-limits  - Upsert risk guardrails
 */

export const settingsRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RiskLimitsSchema = z.object({
  maxRiskPerTrade: z.number().min(0.1).max(5).optional(),
  dailyLossCap: z.number().min(1).max(10).optional(),
  weeklyLossCap: z.number().min(2).max(20).optional(),
  maxPortfolioHeat: z.number().min(1).max(15).optional(),
  minRiskReward: z.number().min(1).max(10).optional(),
  maxCorrelation: z.number().min(10).max(100).optional(),
});

const GeneralSettingsSchema = z.object({
  paperTrading: z.boolean().optional(),
  cycleIntervalSeconds: z.number().int().min(60).max(3600).optional(),
  notifications: z.object({
    onTrade: z.boolean().optional(),
    onCircuitBreaker: z.boolean().optional(),
    onError: z.boolean().optional(),
    onDailyReport: z.boolean().optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Helpers — map guardrail type enum values to risk limit field names
// ---------------------------------------------------------------------------

const GUARDRAIL_FIELD_MAP: Record<string, NewGuardrail['guardrailType']> = {
  maxRiskPerTrade: 'max_position_size',
  dailyLossCap: 'max_daily_loss',
  weeklyLossCap: 'max_drawdown',
  maxPortfolioHeat: 'max_portfolio_heat',
  maxCorrelation: 'max_correlation',
  minRiskReward: 'circuit_breaker', // closest match — stores in value JSON
};

// ---------------------------------------------------------------------------
// GET /api/v1/settings — combined settings
// ---------------------------------------------------------------------------

settingsRouter.get('/', async (_req, res) => {
  try {
    let guardrailsList: Awaited<ReturnType<typeof getGuardrails>> = [];
    let settingsList: Awaited<ReturnType<typeof getAllSettings>> = [];

    try {
      guardrailsList = await getGuardrails();
    } catch (e) {
      console.warn('[Settings] DB error fetching guardrails:', e);
    }

    try {
      settingsList = await getAllSettings();
    } catch (e) {
      console.warn('[Settings] DB error fetching settings:', e);
    }

    // Convert settings list to key-value object
    const settings: Record<string, unknown> = {};
    for (const s of settingsList) {
      settings[s.key] = s.value;
    }

    // Extract risk limits from guardrails
    const riskLimits: Record<string, unknown> = {};
    for (const g of guardrailsList) {
      riskLimits[g.guardrailType] = {
        value: g.value,
        enabled: g.enabled,
      };
    }

    res.json({
      data: {
        ...settings,
        riskLimits,
      },
    });
  } catch (error) {
    console.error('[Settings] Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/v1/settings — partial merge update for general settings
// ---------------------------------------------------------------------------

settingsRouter.put('/', async (req, res) => {
  try {
    const body = GeneralSettingsSchema.parse(req.body);

    const results: Record<string, unknown> = {};

    if (body.paperTrading !== undefined) {
      try {
        await setSetting('paperTrading', { enabled: body.paperTrading });
        results.paperTrading = body.paperTrading;
      } catch (e) {
        console.warn('[Settings] DB error saving paperTrading:', e);
        results.paperTrading = body.paperTrading;
      }
    }

    if (body.cycleIntervalSeconds !== undefined) {
      try {
        await setSetting('cycleInterval', { seconds: body.cycleIntervalSeconds });
        results.cycleIntervalSeconds = body.cycleIntervalSeconds;
      } catch (e) {
        console.warn('[Settings] DB error saving cycleInterval:', e);
        results.cycleIntervalSeconds = body.cycleIntervalSeconds;
      }
    }

    if (body.notifications !== undefined) {
      try {
        await setSetting('notifications', body.notifications as Record<string, unknown>);
        results.notifications = body.notifications;
      } catch (e) {
        console.warn('[Settings] DB error saving notifications:', e);
        results.notifications = body.notifications;
      }
    }

    res.json({
      data: results,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid settings data',
        details: error.errors,
      });
      return;
    }
    console.error('[Settings] Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/settings/risk-limits — get all risk guardrails
// ---------------------------------------------------------------------------

settingsRouter.get('/risk-limits', async (_req, res) => {
  try {
    let guardrailsList: Awaited<ReturnType<typeof getGuardrails>> = [];
    try {
      guardrailsList = await getGuardrails();
    } catch (e) {
      console.warn('[Settings] DB error fetching guardrails:', e);
    }

    // Build a user-friendly response
    const riskLimits: Record<string, unknown> = {
      maxRiskPerTrade: 1.0,
      dailyLossCap: 3.0,
      weeklyLossCap: 7.0,
      maxPortfolioHeat: 6.0,
      minRiskReward: 3.0,
      maxCorrelation: 40,
    };

    // Override with DB values
    for (const g of guardrailsList) {
      const val = g.value as Record<string, unknown>;
      for (const [field, dbType] of Object.entries(GUARDRAIL_FIELD_MAP)) {
        if (g.guardrailType === dbType && val[field] != null) {
          riskLimits[field] = val[field];
        }
      }
      // Also check for a generic "limit" key
      if (val.limit != null) {
        for (const [field, dbType] of Object.entries(GUARDRAIL_FIELD_MAP)) {
          if (g.guardrailType === dbType) {
            riskLimits[field] = val.limit;
          }
        }
      }
    }

    res.json({ data: riskLimits });
  } catch (error) {
    console.error('[Settings] Error fetching risk limits:', error);
    res.status(500).json({ error: 'Failed to fetch risk limits' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/v1/settings/risk-limits — upsert risk guardrails
// ---------------------------------------------------------------------------

settingsRouter.put('/risk-limits', async (req, res) => {
  try {
    const body = RiskLimitsSchema.parse(req.body);

    const saved: Record<string, unknown> = {};

    for (const [field, value] of Object.entries(body)) {
      if (value == null) continue;
      const guardrailType = GUARDRAIL_FIELD_MAP[field];
      if (!guardrailType) continue;

      try {
        await upsertGuardrail(guardrailType, { [field]: value, limit: value }, true);
        saved[field] = value;
      } catch (e) {
        console.warn(`[Settings] DB error saving guardrail ${guardrailType}:`, e);
        saved[field] = value;
      }
    }

    res.json({
      data: saved,
      message: 'Risk limits updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid risk limits',
        details: error.errors,
      });
      return;
    }
    console.error('[Settings] Error updating risk limits:', error);
    res.status(500).json({ error: 'Failed to update risk limits' });
  }
});
