/**
 * Solana Sniper Engine — State Management Module
 *
 * All in-memory state, persistence, constants, protected mints,
 * SOL balance/price caching, template CRUD, and helper functions
 * extracted from the monolithic solana-sniper.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getSolanaKeypair,
  getSolanaConnection,
  withRpcRetry,
} from '../solana-utils.js';
import type {
  SniperConfigFields,
  SniperConfig,
  SniperTemplate,
  TemplateStats,
  TemplateRuntimeState,
  SnipeExecution,
  ActivePosition,
  FailedSellEntry,
  PendingToken,
} from './types.js';

// ── Constants ──────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATE_ID = 'default';

export const DEFAULT_CONFIG_FIELDS: SniperConfigFields = {
  buyAmountSol: 0.0053,     // ~$0.50 per trade at ~$95/SOL — runs 24/7 without budget limit
  dailyBudgetSol: 999,      // No effective daily limit — bot runs 24/7 uninhibited
  slippageBps: 1500,         // 15% — needed for bonding curve tokens (pump.fun price moves fast)
  priorityFee: 200000,       // 200k micro-lamports — competitive on congested mainnet
  takeProfitPercent: 1000,   // Effectively disabled — tiered exits handle all profit-taking
  stopLossPercent: -20,      // -20% — tighter stop loss protects capital
  minLiquidityUsd: 5000,
  maxMarketCapUsd: 100000,   // $100K cap — avoid overpriced entries
  requireMintRevoked: true,  // NON-NEGOTIABLE safety — prevents rug pulls
  requireFreezeRevoked: true, // NON-NEGOTIABLE safety — prevents rug pulls
  maxOpenPositions: 10,      // User wants 10 for testing (easily changeable)
  autoBuyPumpFun: true,      // Enable auto-buy from pump.fun monitor
  autoBuyTrending: true,     // Enable auto-buy from trending scanner
  minMoonshotScore: 40,      // AI scoring enabled — skip tokens scoring below 40
  stalePriceTimeoutMs: 120_000,    // 2 min — exit dead meme coins fast before they bleed
  maxPositionAgeMs: 900_000,       // 15 min — meme coins moon or die quickly
  trailingStopActivatePercent: 25, // Activate trailing stop at +25%
  trailingStopPercent: -15,        // Trail 15% below high water mark — locks in profit
  buyCooldownMs: 30_000,           // 30s between buys
  minMarketCapUsd: 5_000,          // Skip tokens with near-zero liquidity
  maxCreatorDeploysPerHour: 3,     // Creator spam detection
  maxTrendingMarketCapUsd: 500_000,  // $500K cap for trending tokens (higher than PumpFun)
  minTrendingMomentumPercent: 50,    // Min 24h gain % for trending auto-buy
  paperMode: false,                  // Real mode by default
  // Phase 1: Momentum Confirmation Gate
  momentumWindowMs: 10_000,
  minUniqueBuyers: 5,
  minBuySellRatio: 1.5,
  minBuyVolumeSol: 0.5,
  // Phase 2: Instant Reject Filters
  minBondingCurveSol: 1.0,
  maxBondingCurveProgress: 0.8,
  enableSpamFilter: true,
  // Phase 3: Circuit Breakers
  consecutiveLossPauseThreshold: 3,
  consecutiveLossPauseMs: 300_000,
  maxDailyLossSol: 0.1,
  // Phase 4: RugCheck
  enableRugCheck: true,
  minRugCheckScore: 500,
  maxTopHolderPct: 30,
  rugCheckTimeoutMs: 2_000,
  // Phase 5: Tiered Exits
  enableTieredExits: true,
  exitTier1PctGain: 50,
  exitTier1SellPct: 30,
  exitTier2PctGain: 100,
  exitTier2SellPct: 30,
  exitTier3PctGain: 200,
  exitTier3SellPct: 30,
  exitTier4PctGain: 500,
  exitTier4SellPct: 100,
  // Phase 6: Jito
  enableJito: false,
  jitoTipLamports: 100_000,
  // Phase 7: AI Signal Generator
  useAiSignals: false,
  minSignalConfidence: 0,
  // Phase 8: Dynamic Risk & Position Sizing
  enableDynamicSizing: false,
  maxPositionPct: 0.10,
  // Phase 9: Anti-Rug Protection
  enableAntiRug: true,
  antiRugSellVelocityRatio: 5.0,       // Emergency sell if sells > 5x buys in window
  antiRugVelocityWindowMs: 10_000,     // 10s sliding window
  antiRugLiquidityDropPct: 15,         // Emergency sell if bonding curve SOL drops 15%+ in one trade
  antiRugMinPositionAgeMs: 5_000,      // Grace period — first 5s after buy is noisy
};

// ── State Maps ─────────────────────────────────────────────────────────

/** All registered sniper templates keyed by template ID */
export const sniperTemplates: Map<string, SniperTemplate> = new Map();

/** Runtime state per template (running, daily spend, etc.) */
export const templateRuntime: Map<string, TemplateRuntimeState> = new Map();

/** Positions per template: templateId -> (mint -> position) */
export const positionsMap: Map<string, Map<string, ActivePosition>> = new Map();

/**
 * Flat view of all active positions across all templates.
 * Exported for backwards compatibility with external consumers.
 */
export const activePositions: Map<string, ActivePosition> = new Map();

/** Global execution history across all templates */
export const executionHistory: SnipeExecution[] = [];
export const MAX_HISTORY = 500;

/** Global position-check interval handle */
export let positionCheckInterval: ReturnType<typeof setInterval> | null = null;

// ── Pending Operations ─────────────────────────────────────────────────

/**
 * Tracks in-flight buy transactions as `templateId:mint` keys.
 * Added synchronously BEFORE async buy fires, removed in `finally`.
 * Prevents the race condition where multiple WebSocket events for the
 * same mint slip through `positions.has()` before any buy completes.
 */
export const pendingBuys: Set<string> = new Set();

/**
 * Tracks mints with in-flight sell transactions.
 * Map of mint → timestamp when added (for stale entry cleanup).
 * Prevents the sell storm where rapid trade events each trigger a sell.
 */
export const pendingSells: Map<string, number> = new Map();
export const PENDING_SELL_TIMEOUT_MS = 60_000; // 60 seconds max

/** Check if a mint has a pending sell. Auto-clears stale entries (>60s old). */
export function isPendingSell(mint: string): boolean {
  const addedAt = pendingSells.get(mint);
  if (addedAt === undefined) return false;

  if (Date.now() - addedAt > PENDING_SELL_TIMEOUT_MS) {
    console.warn(
      `[Sniper] Force-removing stale pendingSell for ${mint.slice(0, 8)}... (${Math.round((Date.now() - addedAt) / 1000)}s old)`,
    );
    pendingSells.delete(mint);
    return false;
  }
  return true;
}

/** Queue of failed sells to retry after a delay */
export const failedSellQueue: FailedSellEntry[] = [];
export const MAX_SELL_RETRIES = 3;
export const SELL_RETRY_DELAY_MS = 15_000; // 15 seconds between retries (was 30s)

/**
 * Permanently failed mints — exhausted all retries, don't re-attempt from checkPositions.
 * Cleared only when position is removed (auto-closed / manual sell).
 */
export const permanentlyFailedSells: Set<string> = new Set();

/**
 * Max total sell attempts on a position before auto-closing it as a write-off.
 * Prevents infinite sell loops for dead/rugged tokens.
 */
export const MAX_POSITION_SELL_ATTEMPTS = 10; // Auto-close after 10 failed attempts (~2.5 min)

// ── Cooldown State ─────────────────────────────────────────────────────

/** Timestamp of last successful buy (for cooldown enforcement) */
export let lastBuyTimestamp = 0;

/** Update the last buy timestamp */
export function setLastBuyTimestamp(ts: number): void {
  lastBuyTimestamp = ts;
}

/** Creator spam tracking: creator address → { count, firstSeen timestamp } */
export const recentCreators: Map<string, { count: number; firstSeen: number }> = new Map();

// ── Momentum Confirmation Gate (Phase 1) ──────────────────────────────

export const pendingTokens: Map<string, PendingToken> = new Map();
export const MAX_PENDING_TOKENS = 20;

// ── Protected Mints ─────────────────────────────────────────────────

/**
 * System-level protected mints: NEVER sell or close token accounts for these.
 * Includes stablecoins and wrapped SOL.
 */
export const SYSTEM_PROTECTED_MINTS = new Set([
  'So11111111111111111111111111111111111111112',  // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
]);

/** User-configured protected mints (persisted to disk). */
export const userProtectedMints: Set<string> = new Set();

export const PROTECTED_MINTS_FILE = path.join(process.cwd(), '.sniper-data', 'protected-mints.json');

/** Load user-protected mints from disk */
export function loadProtectedMints(): void {
  try {
    if (fs.existsSync(PROTECTED_MINTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PROTECTED_MINTS_FILE, 'utf-8')) as string[];
      for (const mint of raw) userProtectedMints.add(mint);
      console.log(`[Sniper] Loaded ${userProtectedMints.size} user-protected mints`);
    }
  } catch (err) {
    console.warn('[Sniper] Failed to load protected mints:', err instanceof Error ? err.message : err);
  }
}

/** Persist user-protected mints to disk */
export function persistProtectedMints(): void {
  try {
    fs.writeFileSync(PROTECTED_MINTS_FILE, JSON.stringify([...userProtectedMints], null, 2));
  } catch { /* fire-and-forget */ }
}

/** Check if a mint is protected (system OR user). */
export function isProtectedMint(mint: string): boolean {
  return SYSTEM_PROTECTED_MINTS.has(mint) || userProtectedMints.has(mint);
}

/** Add a mint to the user-protected list. */
export function addProtectedMint(mint: string): void {
  userProtectedMints.add(mint);
  persistProtectedMints();
}

/** Remove a mint from the user-protected list (cannot remove system-protected). */
export function removeProtectedMint(mint: string): boolean {
  if (SYSTEM_PROTECTED_MINTS.has(mint)) return false;
  const removed = userProtectedMints.delete(mint);
  if (removed) persistProtectedMints();
  return removed;
}

/** Get all protected mints (system + user). */
export function getAllProtectedMints(): { system: string[]; user: string[] } {
  return {
    system: [...SYSTEM_PROTECTED_MINTS],
    user: [...userProtectedMints],
  };
}

// Load protected mints on module init
loadProtectedMints();

// ── Cached SOL Balance (prevents RPC calls on every buy attempt) ────

/** Cached SOL balance in lamports. Updated every 30s and after sells. */
export let cachedSolBalanceLamports = 0;
export let cachedSolBalanceUpdatedAt = 0;
export const SOL_BALANCE_CACHE_TTL_MS = 30_000; // 30 seconds

/** Whether the pump.fun new-token feed is paused due to low balance */
export let pumpFeedPaused = false;
export let pumpFeedPausedAt = 0;

/** Set the pump feed paused state */
export function setPumpFeedPaused(paused: boolean): void {
  pumpFeedPaused = paused;
  if (paused) pumpFeedPausedAt = Date.now();
}

/** Refresh the cached SOL balance from the chain. */
export async function refreshCachedSolBalance(): Promise<number> {
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();
    cachedSolBalanceLamports = await withRpcRetry(
      () => connection.getBalance(keypair.publicKey),
      2,
    );
    cachedSolBalanceUpdatedAt = Date.now();
  } catch {
    // Keep existing cached value
  }
  return cachedSolBalanceLamports;
}

/** Get the cached SOL balance (refreshes if stale). */
export async function getCachedSolBalance(): Promise<number> {
  if (Date.now() - cachedSolBalanceUpdatedAt > SOL_BALANCE_CACHE_TTL_MS) {
    await refreshCachedSolBalance();
  }
  return cachedSolBalanceLamports;
}

// ── SOL Price Tracking (for bonding curve → USD conversion) ─────────

export let cachedSolPriceUsd = 130; // conservative default, updated every 60s

export async function refreshSolPrice(): Promise<void> {
  try {
    const res = await fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { data: Record<string, { price: string } | undefined> };
      const price = parseFloat(data.data['So11111111111111111111111111111111111111112']?.price ?? '0');
      if (price > 0) {
        cachedSolPriceUsd = price;
      }
    }
  } catch {
    // Keep using cached value
  }
}

// Refresh SOL price every 60 seconds
void refreshSolPrice();
setInterval(() => { void refreshSolPrice(); }, 60_000);

// ── Seed Default Template ──────────────────────────────────────────────

function makeEmptyStats(): { totalTrades: number; wins: number; losses: number; totalPnlSol: number; createdAt: string } {
  return { totalTrades: 0, wins: 0, losses: 0, totalPnlSol: 0, createdAt: new Date().toISOString() };
}

function seedTemplateEntry(id: string, template: SniperTemplate): void {
  sniperTemplates.set(id, template);
  templateRuntime.set(id, {
    running: false,
    startedAt: null,
    dailySpentSol: 0,
    dailyResetDate: new Date().toDateString(),
    paperBalanceSol: 0.5,
    consecutiveLosses: 0,
    dailyRealizedLossSol: 0,
    circuitBreakerPausedUntil: 0,
  });
  positionsMap.set(id, new Map());
}

export function seedDefaultTemplate(): void {
  if (!sniperTemplates.has(DEFAULT_TEMPLATE_ID)) {
    seedTemplateEntry(DEFAULT_TEMPLATE_ID, {
      id: DEFAULT_TEMPLATE_ID,
      name: 'Default Sniper',
      enabled: true,
      ...DEFAULT_CONFIG_FIELDS,
      stats: makeEmptyStats(),
    });
  }

  if (!sniperTemplates.has('moonshot-hunter')) {
    seedTemplateEntry('moonshot-hunter', {
      id: 'moonshot-hunter',
      name: 'Moonshot Hunter',
      enabled: false,
      ...DEFAULT_CONFIG_FIELDS,
      // Position sizing
      buyAmountSol: 0.1,
      maxOpenPositions: 5,
      // Hold longer — let moonshots develop
      maxPositionAgeMs: 3_600_000,
      stalePriceTimeoutMs: 600_000,
      // Wide stops — don't get shaken out on volatility
      trailingStopActivatePercent: 50,
      trailingStopPercent: -30,
      stopLossPercent: -25,
      // Early-stage tokens only
      maxMarketCapUsd: 150_000,
      maxBondingCurveProgress: 0.6,
      // Strong momentum required
      minBuySellRatio: 2.0,
      minMoonshotScore: 45,
      // Tiered exits — hold most until 10x
      exitTier1PctGain: 100,  exitTier1SellPct: 20,
      exitTier2PctGain: 300,  exitTier2SellPct: 20,
      exitTier3PctGain: 600,  exitTier3SellPct: 30,
      exitTier4PctGain: 1000, exitTier4SellPct: 100,
      // Risk controls
      consecutiveLossPauseThreshold: 3,
      maxDailyLossSol: 0.3,
      stats: makeEmptyStats(),
    });
  }

  if (!sniperTemplates.has('bag-builder')) {
    seedTemplateEntry('bag-builder', {
      id: 'bag-builder',
      name: 'Bag Builder',
      enabled: false,
      ...DEFAULT_CONFIG_FIELDS,
      // Moderate sizing — balanced risk/reward
      buyAmountSol: 0.075,
      maxOpenPositions: 6,
      // Hold long enough for 2-3x to develop
      maxPositionAgeMs: 7_200_000,    // 2 hours
      stalePriceTimeoutMs: 300_000,   // 5 min
      // Moderate stops — survive volatility but cut real losers fast
      trailingStopActivatePercent: 60,
      trailingStopPercent: -20,
      stopLossPercent: -15,           // Hard stop at -15%
      // Entry filters — balanced
      maxMarketCapUsd: 120_000,
      maxBondingCurveProgress: 0.5,
      minBuySellRatio: 1.8,
      minMoonshotScore: 40,
      // Tiered exits — 30% at 2x, 50% at 3x, keep 20% as moonshot bag forever
      // Tier 1: +100% (2x) → sell 30%  (70% remaining)
      // Tier 2: +200% (3x) → sell 71% of remaining → ~20% of original left as bag
      // Tier 3/4: disabled (bag rides to infinity or stop loss)
      exitTier1PctGain: 100, exitTier1SellPct: 30,
      exitTier2PctGain: 200, exitTier2SellPct: 71,
      exitTier3PctGain: 99999, exitTier3SellPct: 0,
      exitTier4PctGain: 99999, exitTier4SellPct: 0,
      // Conservative risk controls
      consecutiveLossPauseThreshold: 4,
      maxDailyLossSol: 0.25,
      stats: makeEmptyStats(),
    });
  }

  if (!sniperTemplates.has('quick-flip')) {
    seedTemplateEntry('quick-flip', {
      id: 'quick-flip',
      name: 'Quick Flip',
      enabled: false,
      ...DEFAULT_CONFIG_FIELDS,
      // Small size — many small trades
      buyAmountSol: 0.05,
      maxOpenPositions: 8,
      // Very short hold — in and out in minutes
      maxPositionAgeMs: 180_000,
      stalePriceTimeoutMs: 60_000,
      // Tight stops — exit fast on stale price
      trailingStopActivatePercent: 20,
      trailingStopPercent: -12,
      stopLossPercent: -15,
      // Buy very early on the bonding curve
      maxMarketCapUsd: 80_000,
      maxBondingCurveProgress: 0.4,
      minBuySellRatio: 1.5,
      minMoonshotScore: 35,
      // Tiered exits — take profits early and often
      exitTier1PctGain: 30,  exitTier1SellPct: 50,
      exitTier2PctGain: 60,  exitTier2SellPct: 30,
      exitTier3PctGain: 100, exitTier3SellPct: 20,
      exitTier4PctGain: 500, exitTier4SellPct: 100,
      // Aggressive circuit breaker
      consecutiveLossPauseThreshold: 3,
      maxDailyLossSol: 0.15,
      stats: makeEmptyStats(),
    });
  }
}

seedDefaultTemplate();

// ── Persistence Layer ─────────────────────────────────────────────────

export const DATA_DIR = path.join(process.cwd(), '.sniper-data');

export function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* ignore */ }
}

ensureDataDir();

/** Serialize Map<string, Map<string, ActivePosition>> to JSON-safe object */
export function serializePositions(): Record<string, Record<string, ActivePosition>> {
  const result: Record<string, Record<string, ActivePosition>> = {};
  for (const [templateId, positions] of positionsMap) {
    const inner: Record<string, ActivePosition> = {};
    for (const [mint, pos] of positions) {
      inner[mint] = pos;
    }
    result[templateId] = inner;
  }
  return result;
}

export function persistPositions(): void {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'positions.json'),
      JSON.stringify(serializePositions(), null, 2),
    );
  } catch { /* fire-and-forget */ }
}

export function persistExecutions(): void {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'executions.json'),
      JSON.stringify(executionHistory.slice(0, MAX_HISTORY), null, 2),
    );
  } catch { /* fire-and-forget */ }
}

export function persistDailySpend(): void {
  try {
    const spend: Record<string, { date: string; spentSol: number }> = {};
    for (const [templateId, runtime] of templateRuntime) {
      spend[templateId] = { date: runtime.dailyResetDate, spentSol: runtime.dailySpentSol };
    }
    fs.writeFileSync(
      path.join(DATA_DIR, 'daily-spend.json'),
      JSON.stringify(spend, null, 2),
    );
  } catch { /* fire-and-forget */ }
}

export function persistTemplateStats(): void {
  try {
    const stats: Record<string, TemplateStats> = {};
    for (const [id, template] of sniperTemplates) {
      stats[id] = template.stats;
    }
    fs.writeFileSync(
      path.join(DATA_DIR, 'template-stats.json'),
      JSON.stringify(stats, null, 2),
    );
  } catch { /* fire-and-forget */ }
}

export function persistTemplateConfigs(): void {
  try {
    const configs: Record<string, Partial<SniperConfigFields>> = {};
    for (const [id, template] of sniperTemplates) {
      const { stats: _stats, id: _id, name: _name, enabled: _enabled, ...configFields } = template;
      configs[id] = configFields as Partial<SniperConfigFields>;
    }
    fs.writeFileSync(
      path.join(DATA_DIR, 'template-configs.json'),
      JSON.stringify(configs, null, 2),
    );
  } catch { /* fire-and-forget */ }
}

/** Load all persisted state on startup (before wallet sync) */
export function loadPersistedState(): void {
  try {
    // 1. Load positions
    const posPath = path.join(DATA_DIR, 'positions.json');
    if (fs.existsSync(posPath)) {
      const raw = JSON.parse(fs.readFileSync(posPath, 'utf-8')) as Record<string, Record<string, ActivePosition>>;
      let loaded = 0;
      for (const [templateId, inner] of Object.entries(raw)) {
        const positions = getTemplatePositions(templateId);
        for (const [mint, pos] of Object.entries(inner)) {
          if (!positions.has(mint)) {
            // Ensure new fields have defaults
            pos.lastPriceChangeAt = pos.lastPriceChangeAt ?? new Date().toISOString();
            pos.highWaterMarkPrice = pos.highWaterMarkPrice ?? pos.currentPrice;
            const tpl = sniperTemplates.get(templateId);
            pos.buyCostSol = pos.buyCostSol ?? (tpl?.buyAmountSol ?? DEFAULT_CONFIG_FIELDS.buyAmountSol);
            positions.set(mint, pos);
            loaded++;
          }
        }
      }
      syncActivePositionsMap();
      if (loaded > 0) console.log(`[Persistence] Loaded ${loaded} positions from disk`);
    }

    // 2. Load executions
    const execPath = path.join(DATA_DIR, 'executions.json');
    if (fs.existsSync(execPath)) {
      const rawExecs = JSON.parse(fs.readFileSync(execPath, 'utf-8')) as SnipeExecution[];
      if (Array.isArray(rawExecs)) {
        executionHistory.push(...rawExecs.slice(0, MAX_HISTORY));
        console.log(`[Persistence] Loaded ${Math.min(rawExecs.length, MAX_HISTORY)} executions from disk`);
      }
    }

    // 3. Load daily spend
    const spendPath = path.join(DATA_DIR, 'daily-spend.json');
    if (fs.existsSync(spendPath)) {
      const rawSpend = JSON.parse(fs.readFileSync(spendPath, 'utf-8')) as Record<string, { date: string; spentSol: number }>;
      for (const [templateId, spend] of Object.entries(rawSpend)) {
        const runtime = getRuntime(templateId);
        // Only restore if same day — otherwise it'll be reset by resetDailyBudgetIfNeeded
        if (spend.date === new Date().toDateString()) {
          runtime.dailySpentSol = spend.spentSol;
          runtime.dailyResetDate = spend.date;
        }
      }
      console.log('[Persistence] Loaded daily spend from disk');
    }

    // 4. Load template stats
    const statsPath = path.join(DATA_DIR, 'template-stats.json');
    if (fs.existsSync(statsPath)) {
      const rawStats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as Record<string, TemplateStats>;
      for (const [id, stats] of Object.entries(rawStats)) {
        const template = sniperTemplates.get(id);
        if (template) {
          template.stats = { ...template.stats, ...stats };
        }
      }
      console.log('[Persistence] Loaded template stats from disk');
    }

    // 5. Load template configs (AI settings, dynamic sizing, etc.)
    const configsPath = path.join(DATA_DIR, 'template-configs.json');
    if (fs.existsSync(configsPath)) {
      const rawConfigs = JSON.parse(fs.readFileSync(configsPath, 'utf-8')) as Record<string, Partial<SniperConfigFields>>;
      for (const [id, fields] of Object.entries(rawConfigs)) {
        const template = sniperTemplates.get(id);
        if (template) {
          Object.assign(template, fields);
        }
      }
      console.log('[Persistence] Loaded template configs from disk');
    }
  } catch (err) {
    console.error('[Persistence] Failed to load state:', err instanceof Error ? err.message : err);
  }
}

// Load persisted state on module init
loadPersistedState();

// ── Helpers ────────────────────────────────────────────────────────────

export function generateTemplateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `tpl_${timestamp}_${random}`;
}

export function getTemplatePositions(templateId: string): Map<string, ActivePosition> {
  let positions = positionsMap.get(templateId);
  if (!positions) {
    positions = new Map();
    positionsMap.set(templateId, positions);
  }
  return positions;
}

export function getRuntime(templateId: string): TemplateRuntimeState {
  let runtime = templateRuntime.get(templateId);
  if (!runtime) {
    runtime = {
      running: false,
      startedAt: null,
      dailySpentSol: 0,
      dailyResetDate: new Date().toDateString(),
      paperBalanceSol: 0.5, // Default 0.5 SOL virtual balance
      consecutiveLosses: 0,
      dailyRealizedLossSol: 0,
      circuitBreakerPausedUntil: 0,
    };
    templateRuntime.set(templateId, runtime);
  }
  return runtime;
}

export function resetDailyBudgetIfNeeded(runtime: TemplateRuntimeState): void {
  const today = new Date().toDateString();
  if (today !== runtime.dailyResetDate) {
    runtime.dailySpentSol = 0;
    runtime.dailyResetDate = today;
  }
}

/** Check if any template is currently running (used for the global interval) */
export function isAnyTemplateRunning(): boolean {
  for (const runtime of templateRuntime.values()) {
    if (runtime.running) return true;
  }
  return false;
}

/** Sync the flat activePositions map from all template positions */
export function syncActivePositionsMap(): void {
  activePositions.clear();
  for (const positions of positionsMap.values()) {
    for (const [mint, position] of positions) {
      activePositions.set(mint, position);
    }
  }
}

/** Extract SniperConfig (legacy shape) from a template */
export function templateToLegacyConfig(template: SniperTemplate): SniperConfig {
  return {
    enabled: template.enabled,
    buyAmountSol: template.buyAmountSol,
    dailyBudgetSol: template.dailyBudgetSol,
    slippageBps: template.slippageBps,
    priorityFee: template.priorityFee,
    takeProfitPercent: template.takeProfitPercent,
    stopLossPercent: template.stopLossPercent,
    minLiquidityUsd: template.minLiquidityUsd,
    maxMarketCapUsd: template.maxMarketCapUsd,
    requireMintRevoked: template.requireMintRevoked,
    requireFreezeRevoked: template.requireFreezeRevoked,
    maxOpenPositions: template.maxOpenPositions,
    autoBuyPumpFun: template.autoBuyPumpFun,
    autoBuyTrending: template.autoBuyTrending,
    minMoonshotScore: template.minMoonshotScore,
    stalePriceTimeoutMs: template.stalePriceTimeoutMs,
    maxPositionAgeMs: template.maxPositionAgeMs,
    trailingStopActivatePercent: template.trailingStopActivatePercent,
    trailingStopPercent: template.trailingStopPercent,
    buyCooldownMs: template.buyCooldownMs,
    minMarketCapUsd: template.minMarketCapUsd,
    maxCreatorDeploysPerHour: template.maxCreatorDeploysPerHour,
    maxTrendingMarketCapUsd: template.maxTrendingMarketCapUsd,
    minTrendingMomentumPercent: template.minTrendingMomentumPercent,
    paperMode: template.paperMode,
    momentumWindowMs: template.momentumWindowMs,
    minUniqueBuyers: template.minUniqueBuyers,
    minBuySellRatio: template.minBuySellRatio,
    minBuyVolumeSol: template.minBuyVolumeSol,
    minBondingCurveSol: template.minBondingCurveSol,
    maxBondingCurveProgress: template.maxBondingCurveProgress,
    enableSpamFilter: template.enableSpamFilter,
    consecutiveLossPauseThreshold: template.consecutiveLossPauseThreshold,
    consecutiveLossPauseMs: template.consecutiveLossPauseMs,
    maxDailyLossSol: template.maxDailyLossSol,
    enableRugCheck: template.enableRugCheck,
    minRugCheckScore: template.minRugCheckScore,
    maxTopHolderPct: template.maxTopHolderPct,
    rugCheckTimeoutMs: template.rugCheckTimeoutMs,
    enableTieredExits: template.enableTieredExits,
    exitTier1PctGain: template.exitTier1PctGain,
    exitTier1SellPct: template.exitTier1SellPct,
    exitTier2PctGain: template.exitTier2PctGain,
    exitTier2SellPct: template.exitTier2SellPct,
    exitTier3PctGain: template.exitTier3PctGain,
    exitTier3SellPct: template.exitTier3SellPct,
    exitTier4PctGain: template.exitTier4PctGain,
    exitTier4SellPct: template.exitTier4SellPct,
    enableJito: template.enableJito,
    jitoTipLamports: template.jitoTipLamports,
    useAiSignals: template.useAiSignals,
    minSignalConfidence: template.minSignalConfidence,
    enableDynamicSizing: template.enableDynamicSizing,
    maxPositionPct: template.maxPositionPct,
    enableAntiRug: template.enableAntiRug,
    antiRugSellVelocityRatio: template.antiRugSellVelocityRatio,
    antiRugVelocityWindowMs: template.antiRugVelocityWindowMs,
    antiRugLiquidityDropPct: template.antiRugLiquidityDropPct,
    antiRugMinPositionAgeMs: template.antiRugMinPositionAgeMs,
  };
}

/** Collect all active positions across all templates into a flat array */
export function getAllActivePositions(): ActivePosition[] {
  const all: ActivePosition[] = [];
  for (const positions of positionsMap.values()) {
    for (const position of positions.values()) {
      all.push(position);
    }
  }
  return all;
}

/** Trending auto-snipe poll interval handle */
export let trendingPollInterval: ReturnType<typeof setInterval> | null = null;

/** Update the trending poll interval handle */
export function setTrendingPollInterval(interval: ReturnType<typeof setInterval> | null): void {
  trendingPollInterval = interval;
}

/**
 * Late-bound reference to the checkPositions function (lives in the main module).
 * Must be set via `setCheckPositionsFn()` before starting any template.
 */
let _checkPositionsFn: (() => Promise<void>) | null = null;

/** Register the checkPositions callback from the main module */
export function setCheckPositionsFn(fn: () => Promise<void>): void {
  _checkPositionsFn = fn;
}

/** Start the global position-check interval if not already running */
export function ensurePositionCheckRunning(): void {
  if (positionCheckInterval) return;
  positionCheckInterval = setInterval(() => {
    if (_checkPositionsFn) {
      _checkPositionsFn().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Sniper] Position check error:', message);
      });
    }
  }, 20_000); // 20s interval (was 10s — reduces RPC pressure)
}

/** Stop the global position-check interval if no templates are running */
export function stopPositionCheckIfIdle(): void {
  if (!isAnyTemplateRunning()) {
    if (positionCheckInterval) {
      clearInterval(positionCheckInterval);
      positionCheckInterval = null;
    }
    if (trendingPollInterval) {
      clearInterval(trendingPollInterval);
      trendingPollInterval = null;
    }
  }
}

// ── Validation Helpers ────────────────────────────────────────────────

export const SNIPER_CONFIG_KEYS: ReadonlyArray<keyof SniperConfigFields> = [
  'buyAmountSol', 'dailyBudgetSol', 'slippageBps', 'priorityFee',
  'takeProfitPercent', 'stopLossPercent', 'minLiquidityUsd', 'maxMarketCapUsd',
  'requireMintRevoked', 'requireFreezeRevoked', 'maxOpenPositions',
  'autoBuyPumpFun', 'autoBuyTrending', 'minMoonshotScore', 'paperMode',
  'stalePriceTimeoutMs', 'maxPositionAgeMs', 'trailingStopActivatePercent',
  'trailingStopPercent', 'buyCooldownMs', 'minMarketCapUsd',
  'maxCreatorDeploysPerHour', 'maxTrendingMarketCapUsd', 'minTrendingMomentumPercent',
  // Phase 1: Momentum Confirmation Gate
  'momentumWindowMs', 'minUniqueBuyers', 'minBuySellRatio', 'minBuyVolumeSol',
  // Phase 2: Instant Reject Filters
  'minBondingCurveSol', 'maxBondingCurveProgress', 'enableSpamFilter',
  // Phase 3: Circuit Breakers
  'consecutiveLossPauseThreshold', 'consecutiveLossPauseMs', 'maxDailyLossSol',
  // Phase 4: RugCheck
  'enableRugCheck', 'minRugCheckScore', 'maxTopHolderPct', 'rugCheckTimeoutMs',
  // Phase 5: Tiered Exits
  'enableTieredExits', 'exitTier1PctGain', 'exitTier1SellPct',
  'exitTier2PctGain', 'exitTier2SellPct', 'exitTier3PctGain', 'exitTier3SellPct',
  'exitTier4PctGain', 'exitTier4SellPct',
  // Phase 6: Jito
  'enableJito', 'jitoTipLamports',
  // Phase 7: AI Signal Generator
  'useAiSignals', 'minSignalConfidence',
  // Phase 8: Dynamic Risk & Position Sizing
  'enableDynamicSizing', 'maxPositionPct',
  // Phase 9: Anti-Rug Protection
  'enableAntiRug', 'antiRugSellVelocityRatio', 'antiRugVelocityWindowMs',
  'antiRugLiquidityDropPct', 'antiRugMinPositionAgeMs',
] as const;

export function validateConfigUpdates(
  updates: Partial<SniperConfigFields>,
): string | null {
  if (updates.buyAmountSol !== undefined
    && (updates.buyAmountSol <= 0 || updates.buyAmountSol > 10)) {
    return 'buyAmountSol must be between 0 and 10 SOL';
  }
  if (updates.dailyBudgetSol !== undefined
    && (updates.dailyBudgetSol <= 0 || updates.dailyBudgetSol > 9999)) {
    return 'dailyBudgetSol must be between 0 and 9999 SOL';
  }
  if (updates.slippageBps !== undefined
    && (updates.slippageBps < 0 || updates.slippageBps > 5000)) {
    return 'slippageBps must be between 0 and 5000';
  }
  if (updates.maxOpenPositions !== undefined
    && (updates.maxOpenPositions < 1 || updates.maxOpenPositions > 100)) {
    return 'maxOpenPositions must be between 1 and 100';
  }
  if (updates.minMoonshotScore !== undefined
    && (updates.minMoonshotScore < 0 || updates.minMoonshotScore > 100)) {
    return 'minMoonshotScore must be between 0 and 100';
  }
  if (updates.minSignalConfidence !== undefined
    && (updates.minSignalConfidence < 0 || updates.minSignalConfidence > 100)) {
    return 'minSignalConfidence must be between 0 and 100';
  }
  if (updates.maxPositionPct !== undefined
    && (updates.maxPositionPct <= 0 || updates.maxPositionPct > 1)) {
    return 'maxPositionPct must be between 0 and 1 (e.g. 0.10 = 10%)';
  }
  return null;
}

export function pickConfigFields(
  body: Record<string, unknown>,
): Partial<SniperConfigFields> {
  const result: Partial<SniperConfigFields> = {};
  for (const key of SNIPER_CONFIG_KEYS) {
    if (key in body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic key assignment from validated keys
      (result as Record<keyof SniperConfigFields, unknown>)[key] = body[key];
    }
  }
  return result;
}

/** Type-safe application of partial config fields onto a SniperTemplate */
export function applyConfigToTemplate(
  template: SniperTemplate,
  fields: Partial<SniperConfigFields>,
): void {
  if (fields.buyAmountSol !== undefined) template.buyAmountSol = fields.buyAmountSol;
  if (fields.dailyBudgetSol !== undefined) template.dailyBudgetSol = fields.dailyBudgetSol;
  if (fields.slippageBps !== undefined) template.slippageBps = fields.slippageBps;
  if (fields.priorityFee !== undefined) template.priorityFee = fields.priorityFee;
  if (fields.takeProfitPercent !== undefined) template.takeProfitPercent = fields.takeProfitPercent;
  if (fields.stopLossPercent !== undefined) template.stopLossPercent = fields.stopLossPercent;
  if (fields.minLiquidityUsd !== undefined) template.minLiquidityUsd = fields.minLiquidityUsd;
  if (fields.maxMarketCapUsd !== undefined) template.maxMarketCapUsd = fields.maxMarketCapUsd;
  if (fields.requireMintRevoked !== undefined) template.requireMintRevoked = fields.requireMintRevoked;
  if (fields.requireFreezeRevoked !== undefined) template.requireFreezeRevoked = fields.requireFreezeRevoked;
  if (fields.maxOpenPositions !== undefined) template.maxOpenPositions = fields.maxOpenPositions;
  if (fields.autoBuyPumpFun !== undefined) template.autoBuyPumpFun = fields.autoBuyPumpFun;
  if (fields.autoBuyTrending !== undefined) template.autoBuyTrending = fields.autoBuyTrending;
  if (fields.minMoonshotScore !== undefined) template.minMoonshotScore = fields.minMoonshotScore;
  if (fields.paperMode !== undefined) template.paperMode = fields.paperMode;
  if (fields.stalePriceTimeoutMs !== undefined) template.stalePriceTimeoutMs = fields.stalePriceTimeoutMs;
  if (fields.maxPositionAgeMs !== undefined) template.maxPositionAgeMs = fields.maxPositionAgeMs;
  if (fields.trailingStopActivatePercent !== undefined) template.trailingStopActivatePercent = fields.trailingStopActivatePercent;
  if (fields.trailingStopPercent !== undefined) template.trailingStopPercent = fields.trailingStopPercent;
  if (fields.buyCooldownMs !== undefined) template.buyCooldownMs = fields.buyCooldownMs;
  if (fields.minMarketCapUsd !== undefined) template.minMarketCapUsd = fields.minMarketCapUsd;
  if (fields.maxCreatorDeploysPerHour !== undefined) template.maxCreatorDeploysPerHour = fields.maxCreatorDeploysPerHour;
  if (fields.maxTrendingMarketCapUsd !== undefined) template.maxTrendingMarketCapUsd = fields.maxTrendingMarketCapUsd;
  if (fields.minTrendingMomentumPercent !== undefined) template.minTrendingMomentumPercent = fields.minTrendingMomentumPercent;
  // Phase 1: Momentum Confirmation Gate
  if (fields.momentumWindowMs !== undefined) template.momentumWindowMs = fields.momentumWindowMs;
  if (fields.minUniqueBuyers !== undefined) template.minUniqueBuyers = fields.minUniqueBuyers;
  if (fields.minBuySellRatio !== undefined) template.minBuySellRatio = fields.minBuySellRatio;
  if (fields.minBuyVolumeSol !== undefined) template.minBuyVolumeSol = fields.minBuyVolumeSol;
  // Phase 2: Instant Reject Filters
  if (fields.minBondingCurveSol !== undefined) template.minBondingCurveSol = fields.minBondingCurveSol;
  if (fields.maxBondingCurveProgress !== undefined) template.maxBondingCurveProgress = fields.maxBondingCurveProgress;
  if (fields.enableSpamFilter !== undefined) template.enableSpamFilter = fields.enableSpamFilter;
  // Phase 3: Circuit Breakers
  if (fields.consecutiveLossPauseThreshold !== undefined) template.consecutiveLossPauseThreshold = fields.consecutiveLossPauseThreshold;
  if (fields.consecutiveLossPauseMs !== undefined) template.consecutiveLossPauseMs = fields.consecutiveLossPauseMs;
  if (fields.maxDailyLossSol !== undefined) template.maxDailyLossSol = fields.maxDailyLossSol;
  // Phase 4: RugCheck
  if (fields.enableRugCheck !== undefined) template.enableRugCheck = fields.enableRugCheck;
  if (fields.minRugCheckScore !== undefined) template.minRugCheckScore = fields.minRugCheckScore;
  if (fields.maxTopHolderPct !== undefined) template.maxTopHolderPct = fields.maxTopHolderPct;
  if (fields.rugCheckTimeoutMs !== undefined) template.rugCheckTimeoutMs = fields.rugCheckTimeoutMs;
  // Phase 5: Tiered Exits
  if (fields.enableTieredExits !== undefined) template.enableTieredExits = fields.enableTieredExits;
  if (fields.exitTier1PctGain !== undefined) template.exitTier1PctGain = fields.exitTier1PctGain;
  if (fields.exitTier1SellPct !== undefined) template.exitTier1SellPct = fields.exitTier1SellPct;
  if (fields.exitTier2PctGain !== undefined) template.exitTier2PctGain = fields.exitTier2PctGain;
  if (fields.exitTier2SellPct !== undefined) template.exitTier2SellPct = fields.exitTier2SellPct;
  if (fields.exitTier3PctGain !== undefined) template.exitTier3PctGain = fields.exitTier3PctGain;
  if (fields.exitTier3SellPct !== undefined) template.exitTier3SellPct = fields.exitTier3SellPct;
  if (fields.exitTier4PctGain !== undefined) template.exitTier4PctGain = fields.exitTier4PctGain;
  if (fields.exitTier4SellPct !== undefined) template.exitTier4SellPct = fields.exitTier4SellPct;
  // Phase 6: Jito
  if (fields.enableJito !== undefined) template.enableJito = fields.enableJito;
  if (fields.jitoTipLamports !== undefined) template.jitoTipLamports = fields.jitoTipLamports;
  // Phase 7: AI Signal Generator
  if (fields.useAiSignals !== undefined) template.useAiSignals = fields.useAiSignals;
  if (fields.minSignalConfidence !== undefined) template.minSignalConfidence = fields.minSignalConfidence;
  // Phase 8: Dynamic Risk & Position Sizing
  if (fields.enableDynamicSizing !== undefined) template.enableDynamicSizing = fields.enableDynamicSizing;
  if (fields.maxPositionPct !== undefined) template.maxPositionPct = fields.maxPositionPct;
  // Phase 9: Anti-Rug Protection
  if (fields.enableAntiRug !== undefined) template.enableAntiRug = fields.enableAntiRug;
  if (fields.antiRugSellVelocityRatio !== undefined) template.antiRugSellVelocityRatio = fields.antiRugSellVelocityRatio;
  if (fields.antiRugVelocityWindowMs !== undefined) template.antiRugVelocityWindowMs = fields.antiRugVelocityWindowMs;
  if (fields.antiRugLiquidityDropPct !== undefined) template.antiRugLiquidityDropPct = fields.antiRugLiquidityDropPct;
  if (fields.antiRugMinPositionAgeMs !== undefined) template.antiRugMinPositionAgeMs = fields.antiRugMinPositionAgeMs;
}

// ── Template CRUD ──────────────────────────────────────────────────────

export function createTemplate(
  name: string,
  configOverrides: Partial<SniperConfigFields>,
): SniperTemplate {
  const id = generateTemplateId();
  const template: SniperTemplate = {
    id,
    name,
    enabled: false,
    ...DEFAULT_CONFIG_FIELDS,
    ...configOverrides,
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      createdAt: new Date().toISOString(),
    },
  };

  sniperTemplates.set(id, template);
  templateRuntime.set(id, {
    running: false,
    startedAt: null,
    dailySpentSol: 0,
    dailyResetDate: new Date().toDateString(),
    paperBalanceSol: 0.5,
    consecutiveLosses: 0,
    dailyRealizedLossSol: 0,
    circuitBreakerPausedUntil: 0,
  });
  positionsMap.set(id, new Map());

  return template;
}

export function deleteTemplate(id: string): boolean {
  if (id === DEFAULT_TEMPLATE_ID) return false;

  sniperTemplates.delete(id);
  templateRuntime.delete(id);
  positionsMap.delete(id);
  syncActivePositionsMap();
  return true;
}
