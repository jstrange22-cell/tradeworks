import { Router, type Router as RouterType } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllExchangeBalances } from './balances.js';

/**
 * Asset Protection System.
 *
 * Prevents the trading engine from touching the user's existing holdings.
 * All assets are LOCKED by default after a snapshot. The engine can only
 * trade with an explicit budget and can only sell what it bought.
 *
 * GET    /api/v1/settings/asset-protection          — Read current config
 * PUT    /api/v1/settings/asset-protection          — Update config
 * POST   /api/v1/settings/asset-protection/snapshot  — Snapshot current holdings
 */

export const assetProtectionRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

export interface ProtectedAsset {
  symbol: string;
  locked: boolean;
  snapshotQuantity: number;  // Quantity user owned at snapshot time
  snapshotValueUsd: number;
}

export interface EnginePosition {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  priceUsd: number;
  timestamp: string;
}

export interface AssetProtectionConfig {
  engineTradingEnabled: boolean;
  tradingBudgetUsd: number;
  budgetUsedUsd: number;
  protectedAssets: Record<string, ProtectedAsset>;
  enginePositions: EnginePosition[];
  snapshotTakenAt: string | null;
}

// ── File persistence ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '..', '..', 'data', 'asset-protection.json');

function loadConfig(): AssetProtectionConfig {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw) as AssetProtectionConfig;
    }
  } catch (err) {
    console.error('[AssetProtection] Failed to load config:', err);
  }
  return {
    engineTradingEnabled: false,
    tradingBudgetUsd: 0,
    budgetUsedUsd: 0,
    protectedAssets: {},
    enginePositions: [],
    snapshotTakenAt: null,
  };
}

function saveConfig(config: AssetProtectionConfig): void {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AssetProtection] Failed to save config:', err);
  }
}

// Keep in memory for fast access by engine guards
let config = loadConfig();

// ── Guard functions (used by engine.ts) ────────────────────────────────

/** Is the master switch ON? */
export function isEngineTradingEnabled(): boolean {
  return config.engineTradingEnabled;
}

/** Is a specific asset locked (protected from engine sells)? */
export function isAssetProtected(symbol: string): boolean {
  const asset = config.protectedAssets[symbol];
  if (!asset) return false;  // Unknown asset — not protected
  return asset.locked;
}

/** How much of a symbol did the engine buy (net)? */
export function getEngineOwnedQuantity(symbol: string): number {
  let net = 0;
  for (const pos of config.enginePositions) {
    if (pos.symbol !== symbol) continue;
    if (pos.side === 'buy') net += pos.quantity;
    else net -= pos.quantity;
  }
  return Math.max(net, 0);
}

/** How much budget is left? */
export function getRemainingBudget(): number {
  return Math.max(config.tradingBudgetUsd - config.budgetUsedUsd, 0);
}

/** Record an engine trade (called after successful execution). */
export function recordEnginePosition(
  symbol: string,
  side: 'buy' | 'sell',
  quantity: number,
  priceUsd: number,
): void {
  config.enginePositions.push({
    symbol,
    side,
    quantity,
    priceUsd,
    timestamp: new Date().toISOString(),
  });

  // Consume budget on buys
  if (side === 'buy') {
    config.budgetUsedUsd += quantity * priceUsd;
  }

  saveConfig(config);
}

/** Get full config (for API response). */
export function getProtectionConfig(): AssetProtectionConfig {
  return { ...config };
}

// ── API Routes ─────────────────────────────────────────────────────────

// GET — read current protection config
assetProtectionRouter.get('/', (_req, res) => {
  res.json({ data: getProtectionConfig() });
});

// PUT — update protection config
assetProtectionRouter.put('/', (req, res) => {
  const body = req.body as Partial<AssetProtectionConfig>;

  if (typeof body.engineTradingEnabled === 'boolean') {
    config.engineTradingEnabled = body.engineTradingEnabled;
  }
  if (typeof body.tradingBudgetUsd === 'number' && body.tradingBudgetUsd >= 0) {
    config.tradingBudgetUsd = body.tradingBudgetUsd;
  }
  if (body.protectedAssets && typeof body.protectedAssets === 'object') {
    // Merge per-asset lock changes
    for (const [symbol, update] of Object.entries(body.protectedAssets)) {
      if (config.protectedAssets[symbol]) {
        config.protectedAssets[symbol] = {
          ...config.protectedAssets[symbol],
          ...update,
        };
      }
    }
  }

  saveConfig(config);
  res.json({ data: getProtectionConfig(), message: 'Asset protection updated' });
});

// POST /snapshot — snapshot current exchange holdings
assetProtectionRouter.post('/snapshot', async (_req, res) => {
  try {
    const live = await fetchAllExchangeBalances();
    const protectedAssets: Record<string, ProtectedAsset> = {};

    for (const exchange of live.exchanges) {
      if (!exchange.connected) continue;
      for (const asset of exchange.assets) {
        if (asset.total <= 0) continue;
        // If already tracked, keep existing lock state; otherwise default to locked
        const existing = config.protectedAssets[asset.symbol];
        protectedAssets[asset.symbol] = {
          symbol: asset.symbol,
          locked: existing?.locked ?? true, // Default: LOCKED
          snapshotQuantity: asset.total,
          snapshotValueUsd: asset.valueUsd,
        };
      }
    }

    config.protectedAssets = protectedAssets;
    config.snapshotTakenAt = new Date().toISOString();
    saveConfig(config);

    const assetCount = Object.keys(protectedAssets).length;
    const totalValue = Object.values(protectedAssets).reduce((s, a) => s + a.snapshotValueUsd, 0);

    res.json({
      data: getProtectionConfig(),
      message: `Snapshot taken: ${assetCount} asset(s) protected, $${totalValue.toFixed(2)} total value`,
    });
  } catch (error) {
    console.error('[AssetProtection] Snapshot failed:', error);
    res.status(500).json({
      error: 'Failed to take snapshot',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
