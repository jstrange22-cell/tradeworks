import { Router, type Router as RouterType } from 'express';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import type { ParsedAccountData } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { broadcast } from '../websocket/server.js';
import {
  isSolanaConnected,
  getSolanaKeypair,
  getSolanaConnection,
  getSecondaryConnection,
  getSolanaRpcUrl,
  withRpcRetry,
  hasEnoughSolForSwap,
  getAllTokenAccounts,
  batchCloseTokenAccounts,
  batchBurnAndCloseTokenAccounts,
  closeTokenAccount,
  type TokenAccountInfo,
} from './solana-utils.js';
import { getMoonshotScore } from './solana-moonshot.js';
import { fetchTrendingTokens } from './solana-scanner.js';
import {
  subscribeTokenTrades,
  unsubscribeTokenTrades,
  onTradeEvent,
  type PumpPortalTradeEvent,
} from './solana-pumpfun.js';

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

export const sniperRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface SniperConfigFields {
  /** SOL amount per snipe (e.g. 0.05 = 0.05 SOL) */
  buyAmountSol: number;
  /** Max SOL to spend per day */
  dailyBudgetSol: number;
  /** Slippage tolerance in basis points */
  slippageBps: number;
  /** Priority fee in micro-lamports per CU */
  priorityFee: number;
  /** Auto-sell: take profit % (e.g. 100 = 2x) */
  takeProfitPercent: number;
  /** Auto-sell: stop loss % (e.g. -50 = sell at 50% loss) */
  stopLossPercent: number;
  /** Min liquidity USD to snipe */
  minLiquidityUsd: number;
  /** Max market cap USD to snipe (avoid already-pumped tokens) */
  maxMarketCapUsd: number;
  /** Only snipe tokens with mint authority revoked */
  requireMintRevoked: boolean;
  /** Only snipe tokens with freeze authority revoked */
  requireFreezeRevoked: boolean;
  /** Max concurrent open positions */
  maxOpenPositions: number;
  /** Auto-buy on pump.fun detection */
  autoBuyPumpFun: boolean;
  /** Auto-buy on trending detection (Dexscreener) */
  autoBuyTrending: boolean;
  /** Min moonshot AI score to buy (0 = disabled, 1-100 = threshold) */
  minMoonshotScore: number;
  /** Sell if price hasn't moved >1% in this many ms (default: 300000 = 5 min) */
  stalePriceTimeoutMs: number;
  /** Force sell after this many ms regardless (default: 1800000 = 30 min) */
  maxPositionAgeMs: number;
  /** Activate trailing stop when P&L reaches this % (default: 30) */
  trailingStopActivatePercent: number;
  /** Trail this % below high water mark (default: -15) */
  trailingStopPercent: number;
  /** Minimum ms between buys (default: 30000 = 30s) */
  buyCooldownMs: number;
  /** Skip tokens below this market cap (default: 5000) */
  minMarketCapUsd: number;
  /** Max tokens one creator can deploy per hour before blocking (default: 3) */
  maxCreatorDeploysPerHour: number;
  /** Max market cap for trending token auto-buys (default: 500000 — higher than PumpFun cap) */
  maxTrendingMarketCapUsd: number;
  /** Minimum 24h price change % for trending auto-buy (default: 50) */
  minTrendingMomentumPercent: number;
  /** Run in paper/simulation mode — no real transactions (default: false) */
  paperMode: boolean;
  // ── Phase 1: Momentum Confirmation Gate ──
  /** Observation window in ms before buying (default: 10000 = 10s) */
  momentumWindowMs: number;
  /** Minimum unique buyer wallets during observation (default: 5) */
  minUniqueBuyers: number;
  /** Minimum buy/sell volume ratio (default: 1.5) */
  minBuySellRatio: number;
  /** Minimum total buy volume in SOL during observation (default: 0.5) */
  minBuyVolumeSol: number;
  // ── Phase 2: Instant Reject Filters ──
  /** Minimum SOL in bonding curve to consider (default: 1.0) */
  minBondingCurveSol: number;
  /** Max bonding curve progress 0-1 before rejecting (default: 0.8) */
  maxBondingCurveProgress: number;
  /** Enable spam name filter (default: true) */
  enableSpamFilter: boolean;
  // ── Phase 3: Circuit Breakers ──
  /** Consecutive losses before pausing buys (default: 5) */
  consecutiveLossPauseThreshold: number;
  /** Pause duration in ms after consecutive losses (default: 300000 = 5min) */
  consecutiveLossPauseMs: number;
  /** Max realized loss in SOL per day before stopping (default: 0.1) */
  maxDailyLossSol: number;
  // ── Phase 4: RugCheck ──
  /** Enable RugCheck API validation (default: true) */
  enableRugCheck: boolean;
  /** Minimum RugCheck score 0-1000 (default: 500) */
  minRugCheckScore: number;
  /** Max top holder percentage (default: 30) */
  maxTopHolderPct: number;
  /** RugCheck API timeout in ms (default: 2000) */
  rugCheckTimeoutMs: number;
  // ── Phase 5: Tiered Exits ──
  /** Enable partial sells at profit milestones (default: true) */
  enableTieredExits: boolean;
  /** Profit tiers: array of { pctGain, sellPct } */
  exitTier1PctGain: number;   // default: 50 (1.5x)
  exitTier1SellPct: number;   // default: 30
  exitTier2PctGain: number;   // default: 100 (2x)
  exitTier2SellPct: number;   // default: 30
  exitTier3PctGain: number;   // default: 200 (3x)
  exitTier3SellPct: number;   // default: 30
  exitTier4PctGain: number;   // default: 500 (5x+)
  exitTier4SellPct: number;   // default: 100 (sell remaining moonbag)
  // ── Phase 6: Jito Bundles ──
  /** Enable Jito bundle execution for MEV protection (default: false) */
  enableJito: boolean;
  /** Jito tip in lamports (default: 100000 = 0.0001 SOL) */
  jitoTipLamports: number;
}

/** Backwards-compatible config shape (config fields + enabled flag) */
interface SniperConfig extends SniperConfigFields {
  enabled: boolean;
}

interface TemplateStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  createdAt: string;
}

interface SniperTemplate extends SniperConfigFields {
  id: string;
  name: string;
  enabled: boolean;
  stats: TemplateStats;
}

interface TemplateRuntimeState {
  running: boolean;
  startedAt: Date | null;
  dailySpentSol: number;
  dailyResetDate: string;
  /** Virtual SOL balance for paper mode */
  paperBalanceSol: number;
  /** Consecutive losses counter for circuit breaker */
  consecutiveLosses: number;
  /** Realized loss in SOL today for daily loss limit */
  dailyRealizedLossSol: number;
  /** Timestamp when circuit breaker pause started (0 = not paused) */
  circuitBreakerPausedUntil: number;
}

interface SnipeExecution {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  amountSol: number;
  amountTokens: number | null;
  priceUsd: number | null;
  signature: string | null;
  status: 'pending' | 'success' | 'failed';
  error: string | null;
  trigger: 'manual' | 'pumpfun' | 'trending' | 'take_profit' | 'stop_loss' | 'stale_price' | 'max_age' | 'trailing_stop';
  templateId: string;
  templateName: string;
  timestamp: string;
  /** Whether this execution was simulated (paper mode) */
  paperMode?: boolean;
}

interface ActivePosition {
  mint: string;
  symbol: string;
  name: string;
  buyPrice: number;
  currentPrice: number;
  amountTokens: number;
  pnlPercent: number;
  buySignature: string;
  boughtAt: string;
  templateId: string;
  templateName: string;
  /** Consecutive price-fetch failures (for degraded monitoring warnings) */
  priceFetchFailCount: number;
  /** ISO timestamp of last meaningful price movement (>1% change) */
  lastPriceChangeAt: string;
  /** Highest price seen since buy (for trailing stop-loss) */
  highWaterMarkPrice: number;
  /** SOL cost to acquire this position */
  buyCostSol?: number;
  /** Total sell attempts that have failed (for write-off threshold) */
  sellFailCount?: number;
  /** Whether this is a paper/simulated position */
  paperMode?: boolean;
  /** Remaining position as fraction 0-1 (1.0 = full position) */
  remainingPct?: number;
  /** Which exit tiers have been triggered (tier numbers) */
  tiersSold?: number[];
  /** Token description from pump.fun or metadata */
  description?: string;
}

// ── State ──────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE_ID = 'default';

const DEFAULT_CONFIG_FIELDS: SniperConfigFields = {
  buyAmountSol: 0.005,      // Conservative — wallet has limited SOL
  dailyBudgetSol: 0.5,
  slippageBps: 1500,         // 15% — needed for bonding curve tokens (pump.fun price moves fast)
  priorityFee: 200000,       // 200k micro-lamports — competitive on congested mainnet
  takeProfitPercent: 50,     // 1.5x — more realistic for meme coins (was 100/2x)
  stopLossPercent: -20,      // -20% — tighter stop loss protects capital
  minLiquidityUsd: 5000,
  maxMarketCapUsd: 100000,   // $100K cap — avoid overpriced entries
  requireMintRevoked: true,  // NON-NEGOTIABLE safety — prevents rug pulls
  requireFreezeRevoked: true, // NON-NEGOTIABLE safety — prevents rug pulls
  maxOpenPositions: 10,      // User wants 10 for testing (easily changeable)
  autoBuyPumpFun: true,      // Enable auto-buy from pump.fun monitor
  autoBuyTrending: true,     // Enable auto-buy from trending scanner
  minMoonshotScore: 40,      // AI scoring enabled — skip tokens scoring below 40
  stalePriceTimeoutMs: 300_000,    // 5 min — sell if no price movement
  maxPositionAgeMs: 1_800_000,     // 30 min — force sell regardless
  trailingStopActivatePercent: 30, // Activate trailing stop at +30%
  trailingStopPercent: -15,        // Trail 15% below high water mark
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
  consecutiveLossPauseThreshold: 5,
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
};

/** All registered sniper templates keyed by template ID */
const sniperTemplates: Map<string, SniperTemplate> = new Map();

/** Runtime state per template (running, daily spend, etc.) */
const templateRuntime: Map<string, TemplateRuntimeState> = new Map();

/** Positions per template: templateId -> (mint -> position) */
const positionsMap: Map<string, Map<string, ActivePosition>> = new Map();

/**
 * Flat view of all active positions across all templates.
 * Exported for backwards compatibility with external consumers.
 */
export const activePositions: Map<string, ActivePosition> = new Map();

/** Global execution history across all templates */
const executionHistory: SnipeExecution[] = [];
const MAX_HISTORY = 500;

/** Global position-check interval handle */
let positionCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Tracks in-flight buy transactions as `templateId:mint` keys.
 * Added synchronously BEFORE async buy fires, removed in `finally`.
 * Prevents the race condition where multiple WebSocket events for the
 * same mint slip through `positions.has()` before any buy completes.
 */
const pendingBuys: Set<string> = new Set();

/**
 * Tracks mints with in-flight sell transactions.
 * Map of mint → timestamp when added (for stale entry cleanup).
 * Prevents the sell storm where rapid trade events each trigger a sell.
 */
const pendingSells: Map<string, number> = new Map();
const PENDING_SELL_TIMEOUT_MS = 60_000; // 60 seconds max

/** Check if a mint has a pending sell. Auto-clears stale entries (>60s old). */
function isPendingSell(mint: string): boolean {
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
interface FailedSellEntry {
  mint: string;
  trigger: SnipeExecution['trigger'];
  templateId: string;
  failedAt: number;
  retryCount: number;
}

const failedSellQueue: FailedSellEntry[] = [];
const MAX_SELL_RETRIES = 3;
const SELL_RETRY_DELAY_MS = 30_000; // 30 seconds between retries

/**
 * Permanently failed mints — exhausted all retries, don't re-attempt from checkPositions.
 * Cleared only when position is removed (auto-closed / manual sell).
 */
const permanentlyFailedSells: Set<string> = new Set();

/**
 * Max total sell attempts on a position before auto-closing it as a write-off.
 * Prevents infinite sell loops for dead/rugged tokens.
 */
const MAX_POSITION_SELL_ATTEMPTS = 50;

/** Timestamp of last successful buy (for cooldown enforcement) */
let lastBuyTimestamp = 0;

/** Creator spam tracking: creator address → { count, firstSeen timestamp } */
const recentCreators: Map<string, { count: number; firstSeen: number }> = new Map();

// ── Momentum Confirmation Gate (Phase 1) ──────────────────────────────

interface PendingToken {
  mint: string;
  name: string;
  symbol: string;
  creatorAddress: string;
  detectedAt: number;
  trades: Array<{ txType: 'buy' | 'sell'; traderPublicKey: string; solAmount: number; timestamp: number }>;
  uniqueBuyers: Set<string>;
  uniqueSellers: Set<string>;
  totalBuySol: number;
  totalSellSol: number;
  templateId: string;
  source: 'pumpfun' | 'trending';
  usdMarketCap: number;
  /** RugCheck result (null = pending/disabled) */
  rugCheckResult: { score: number; topHolderPct: number; bundleDetected: boolean } | null;
  rugCheckDone: boolean;
}

const pendingTokens: Map<string, PendingToken> = new Map();
const MAX_PENDING_TOKENS = 20;

/** Fetch RugCheck report for a token (Phase 4) */
async function fetchRugCheck(mint: string, timeoutMs: number): Promise<{ score: number; topHolderPct: number; bundleDetected: boolean } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;

    const score = typeof data.score === 'number' ? data.score : 0;

    // Check for bundle risk
    const risks = Array.isArray(data.risks) ? data.risks as Array<Record<string, unknown>> : [];
    const bundleDetected = risks.some(r => typeof r.name === 'string' && r.name.toLowerCase().includes('bundle'));

    // Top holder percentage
    let topHolderPct = 0;
    const topHolders = Array.isArray(data.topHolders) ? data.topHolders as Array<Record<string, unknown>> : [];
    if (topHolders.length > 0) {
      topHolderPct = typeof topHolders[0].pct === 'number' ? topHolders[0].pct : 0;
    }

    return { score, topHolderPct, bundleDetected };
  } catch {
    return null; // Don't block on API failures
  }
}

/** Check if token name matches spam patterns (Phase 2) */
function isSpamTokenName(name: string, symbol: string): boolean {
  // Too short or too long
  if (name.length < 2 || name.length > 30) return true;
  if (symbol.length < 2 || symbol.length > 10) return true;

  // Known spam patterns
  const spamPatterns = /^(TEST|TESTING|SCAM|RUG|FAKE|AIRDROP|FREE|GIVEAWAY)/i;
  if (spamPatterns.test(name) || spamPatterns.test(symbol)) return true;

  // Excessive emoji (more than 3)
  const emojiCount = (name.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) ?? []).length;
  if (emojiCount > 3) return true;

  // All uppercase gibberish (10+ chars, no spaces, no lowercase)
  if (name.length >= 10 && /^[A-Z0-9]+$/.test(name) && !/\s/.test(name)) return true;

  return false;
}

/** Evaluate a pending token after observation window (Phase 1) */
function evaluatePendingToken(pending: PendingToken): void {
  const template = sniperTemplates.get(pending.templateId);
  if (!template) {
    pendingTokens.delete(pending.mint);
    return;
  }

  const elapsed = Date.now() - pending.detectedAt;

  // Not enough time elapsed yet
  if (elapsed < template.momentumWindowMs) return;

  const uniqueBuyers = pending.uniqueBuyers.size;
  const buySellRatio = pending.totalSellSol > 0 ? pending.totalBuySol / pending.totalSellSol : (pending.totalBuySol > 0 ? Infinity : 0);

  // Check RugCheck result (Phase 4)
  if (template.enableRugCheck && pending.rugCheckDone && pending.rugCheckResult) {
    const rc = pending.rugCheckResult;
    if (rc.score < template.minRugCheckScore) {
      console.log(`[Sniper][${template.name}] REJECTED ${pending.symbol} — RugCheck score ${rc.score} < ${template.minRugCheckScore}`);
      pendingTokens.delete(pending.mint);
      unsubscribeTokenTrades([pending.mint]);
      return;
    }
    if (rc.bundleDetected) {
      console.log(`[Sniper][${template.name}] REJECTED ${pending.symbol} — Bundle detected by RugCheck`);
      pendingTokens.delete(pending.mint);
      unsubscribeTokenTrades([pending.mint]);
      return;
    }
    if (rc.topHolderPct > template.maxTopHolderPct) {
      console.log(`[Sniper][${template.name}] REJECTED ${pending.symbol} — Top holder ${rc.topHolderPct.toFixed(1)}% > ${template.maxTopHolderPct}%`);
      pendingTokens.delete(pending.mint);
      unsubscribeTokenTrades([pending.mint]);
      return;
    }
  }

  // If RugCheck is enabled but not done yet, and we haven't timed out, wait
  if (template.enableRugCheck && !pending.rugCheckDone && elapsed < template.momentumWindowMs * 2) {
    return;
  }

  // Check momentum thresholds
  if (uniqueBuyers < template.minUniqueBuyers) {
    console.log(`[Sniper][${template.name}] REJECTED ${pending.symbol} — ${uniqueBuyers} unique buyers < ${template.minUniqueBuyers} required`);
    pendingTokens.delete(pending.mint);
    unsubscribeTokenTrades([pending.mint]);
    return;
  }

  if (buySellRatio < template.minBuySellRatio) {
    console.log(`[Sniper][${template.name}] REJECTED ${pending.symbol} — buy/sell ratio ${buySellRatio.toFixed(2)} < ${template.minBuySellRatio} required`);
    pendingTokens.delete(pending.mint);
    unsubscribeTokenTrades([pending.mint]);
    return;
  }

  if (pending.totalBuySol < template.minBuyVolumeSol) {
    console.log(`[Sniper][${template.name}] REJECTED ${pending.symbol} — buy volume ${pending.totalBuySol.toFixed(4)} SOL < ${template.minBuyVolumeSol} required`);
    pendingTokens.delete(pending.mint);
    unsubscribeTokenTrades([pending.mint]);
    return;
  }

  // PASSED all checks — execute buy
  console.log(
    `[Sniper][${template.name}] MOMENTUM CONFIRMED ${pending.symbol}: ${uniqueBuyers} buyers, ${buySellRatio.toFixed(1)}x ratio, ${pending.totalBuySol.toFixed(4)} SOL volume (${(elapsed / 1000).toFixed(1)}s window)`,
  );

  pendingTokens.delete(pending.mint);
  // Don't unsubscribe — executeBuySnipe will re-subscribe for position tracking

  const pendingKey = pending.templateId + ':' + pending.mint;
  pendingBuys.add(pendingKey);

  void (async () => {
    try {
      await executeBuySnipe({
        mint: pending.mint,
        symbol: pending.symbol,
        name: pending.name,
        trigger: pending.source === 'pumpfun' ? 'pumpfun' : 'trending',
        priceUsd: pending.usdMarketCap > 0 ? pending.usdMarketCap / 1e9 : undefined,
        templateId: pending.templateId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Sniper][${template.name}] Momentum buy error for ${pending.symbol}:`, message);
    } finally {
      pendingBuys.delete(pendingKey);
    }
  })();
}

/** Handle trade events for tokens in the momentum observation window */
function handlePendingTokenTradeEvent(event: PumpPortalTradeEvent): void {
  const pending = pendingTokens.get(event.mint);
  if (!pending) return;

  pending.trades.push({
    txType: event.txType,
    traderPublicKey: event.traderPublicKey,
    solAmount: event.solAmount,
    timestamp: Date.now(),
  });

  if (event.txType === 'buy') {
    pending.uniqueBuyers.add(event.traderPublicKey);
    pending.totalBuySol += event.solAmount;
  } else {
    pending.uniqueSellers.add(event.traderPublicKey);
    pending.totalSellSol += event.solAmount;
  }

  // Re-evaluate after each trade
  evaluatePendingToken(pending);
}

// ── Protected Mints ─────────────────────────────────────────────────

/**
 * System-level protected mints: NEVER sell or close token accounts for these.
 * Includes stablecoins and wrapped SOL.
 */
const SYSTEM_PROTECTED_MINTS = new Set([
  'So11111111111111111111111111111111111111112',  // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
]);

/** User-configured protected mints (persisted to disk). */
const userProtectedMints: Set<string> = new Set();

const PROTECTED_MINTS_FILE = path.join(process.cwd(), '.sniper-data', 'protected-mints.json');

/** Load user-protected mints from disk */
function loadProtectedMints(): void {
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
function persistProtectedMints(): void {
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
let cachedSolBalanceLamports = 0;
let cachedSolBalanceUpdatedAt = 0;
const SOL_BALANCE_CACHE_TTL_MS = 30_000; // 30 seconds

/** Whether the pump.fun new-token feed is paused due to low balance */
let pumpFeedPaused = false;
let pumpFeedPausedAt = 0;

/** Refresh the cached SOL balance from the chain. */
async function refreshCachedSolBalance(): Promise<number> {
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
async function getCachedSolBalance(): Promise<number> {
  if (Date.now() - cachedSolBalanceUpdatedAt > SOL_BALANCE_CACHE_TTL_MS) {
    await refreshCachedSolBalance();
  }
  return cachedSolBalanceLamports;
}

// ── Seed default template ──────────────────────────────────────────────

function seedDefaultTemplate(): void {
  if (sniperTemplates.has(DEFAULT_TEMPLATE_ID)) return;

  const defaultTemplate: SniperTemplate = {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Default Sniper',
    enabled: true,
    ...DEFAULT_CONFIG_FIELDS,
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      createdAt: new Date().toISOString(),
    },
  };

  sniperTemplates.set(DEFAULT_TEMPLATE_ID, defaultTemplate);
  templateRuntime.set(DEFAULT_TEMPLATE_ID, {
    running: false,
    startedAt: null,
    dailySpentSol: 0,
    dailyResetDate: new Date().toDateString(),
    paperBalanceSol: 0.5,
    consecutiveLosses: 0,
    dailyRealizedLossSol: 0,
    circuitBreakerPausedUntil: 0,
  });
  positionsMap.set(DEFAULT_TEMPLATE_ID, new Map());
}

seedDefaultTemplate();

// ── Persistence Layer ─────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), '.sniper-data');

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* ignore */ }
}

ensureDataDir();

/** Serialize Map<string, Map<string, ActivePosition>> to JSON-safe object */
function serializePositions(): Record<string, Record<string, ActivePosition>> {
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

function persistPositions(): void {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'positions.json'),
      JSON.stringify(serializePositions(), null, 2),
    );
  } catch { /* fire-and-forget */ }
}

function persistExecutions(): void {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'executions.json'),
      JSON.stringify(executionHistory.slice(0, MAX_HISTORY), null, 2),
    );
  } catch { /* fire-and-forget */ }
}

function persistDailySpend(): void {
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

function persistTemplateStats(): void {
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

/** Load all persisted state on startup (before wallet sync) */
function loadPersistedState(): void {
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
  } catch (err) {
    console.error('[Persistence] Failed to load state:', err instanceof Error ? err.message : err);
  }
}

// Load persisted state on module init
loadPersistedState();

// ── UNKNOWN Token Name Resolution ───────────────────────────────────

/**
 * Resolve UNKNOWN symbol/name for positions loaded from persistence.
 * Tries: Helius DAS batch → DexScreener → PumpFun API.
 * Called on startup and periodically every 5 minutes.
 */
async function resolveUnknownPositions(): Promise<void> {
  const unknownMints: string[] = [];
  for (const positions of positionsMap.values()) {
    for (const [mint, pos] of positions) {
      if (pos.symbol === 'UNKNOWN' || pos.name === 'Unknown Token') {
        unknownMints.push(mint);
      }
    }
  }

  if (unknownMints.length === 0) return;
  console.log(`[Sniper] Resolving ${unknownMints.length} UNKNOWN positions...`);

  let resolved = 0;
  const remaining: string[] = [];

  // Phase 1: Helius DAS batch
  try {
    const heliusData = await fetchHeliusBatchPrices(unknownMints);
    for (const mint of unknownMints) {
      const enriched = heliusData[mint];
      if (enriched?.symbol || enriched?.name) {
        applyResolvedMetadata(mint, enriched.symbol, enriched.name);
        resolved++;
      } else {
        remaining.push(mint);
      }
    }
  } catch {
    remaining.push(...unknownMints);
  }

  // Phase 2: DexScreener (no price guard)
  const stillUnresolved: string[] = [];
  for (const mint of remaining) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = (await res.json()) as DexscreenerTokenResponse;
        const pair = (data.pairs ?? []).find(
          (p: DexscreenerPair) => p.chainId === 'solana',
        );
        const baseToken = pair as unknown as { baseToken?: { symbol?: string; name?: string } } | undefined;
        if (baseToken?.baseToken?.symbol) {
          applyResolvedMetadata(mint, baseToken.baseToken.symbol, baseToken.baseToken.name);
          resolved++;
          continue;
        }
      }
    } catch { /* continue to next */ }
    stillUnresolved.push(mint);
  }

  // Phase 3: PumpFun API as last resort
  for (const mint of stillUnresolved) {
    try {
      const res = await fetch(
        `https://frontend-api-v2.pump.fun/coins/${mint}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (data.symbol) {
          applyResolvedMetadata(mint, data.symbol as string, data.name as string | undefined);
          resolved++;
        }
      }
    } catch { /* give up on this mint */ }
  }

  if (resolved > 0) {
    persistPositions();
    console.log(`[Sniper] Resolved ${resolved}/${unknownMints.length} UNKNOWN positions`);
  }
}

/** Apply resolved symbol/name to all matching positions across templates */
function applyResolvedMetadata(
  mint: string,
  symbol: string | undefined,
  name: string | undefined,
): void {
  for (const positions of positionsMap.values()) {
    const pos = positions.get(mint);
    if (pos) {
      if (symbol && pos.symbol === 'UNKNOWN') pos.symbol = symbol;
      if (name && pos.name === 'Unknown Token') pos.name = name;
    }
  }
}

// ── SOL Price Tracking (for bonding curve → USD conversion) ─────────

let cachedSolPriceUsd = 130; // conservative default, updated every 60s

async function refreshSolPrice(): Promise<void> {
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

// ── Real-Time Trade Event Handler ────────────────────────────────────

/**
 * Called on every trade event from PumpPortal WebSocket for tokens we hold.
 * Updates position prices in real-time and triggers TP/SL immediately.
 * This is the PRIMARY price source for bonding curve tokens (replaces polling).
 */
function handlePositionTradeEvent(event: PumpPortalTradeEvent): void {
  // Derive USD price from bonding curve market cap
  // pump.fun tokens have 1 billion (1e9) total supply
  const priceUsd = (event.marketCapSol * cachedSolPriceUsd) / 1e9;
  if (priceUsd <= 0) return;

  // Find the position for this mint across all templates
  for (const [templateId, positions] of positionsMap) {
    const position = positions.get(event.mint);
    if (!position) continue;

    const template = sniperTemplates.get(templateId);
    if (!template) continue;

    const prevPrice = position.currentPrice;

    // Update price
    position.currentPrice = priceUsd;
    position.priceFetchFailCount = 0;

    // Track price movement for stale detection (>1% change = meaningful)
    if (prevPrice > 0 && Math.abs((priceUsd - prevPrice) / prevPrice) > 0.01) {
      position.lastPriceChangeAt = new Date().toISOString();
    }

    // Update high water mark (for trailing stop)
    if (priceUsd > (position.highWaterMarkPrice ?? 0)) {
      position.highWaterMarkPrice = priceUsd;
    }

    // Lazy buyPrice initialization
    if (position.buyPrice === 0) {
      position.buyPrice = priceUsd;
      position.highWaterMarkPrice = priceUsd;
      console.log(`[Sniper] Trade event set buyPrice for ${position.symbol}: $${priceUsd.toFixed(10)}`);
    }

    position.pnlPercent = ((priceUsd - position.buyPrice) / position.buyPrice) * 100;

    // Broadcast live P&L to dashboard
    broadcast('solana:sniper', {
      event: 'position:pnl_update',
      templateId,
      templateName: template.name,
      mint: event.mint,
      symbol: position.symbol,
      name: position.name,
      buyPrice: position.buyPrice,
      currentPrice: priceUsd,
      amountTokens: position.amountTokens,
      pnlPercent: position.pnlPercent,
      unrealizedPnlUsd: position.amountTokens * (priceUsd - position.buyPrice),
      boughtAt: position.boughtAt,
    });

    // Skip protected mints — NEVER auto-sell
    if (isProtectedMint(event.mint)) return;

    // Skip TP/SL if a sell is already in-flight for this mint
    if (isPendingSell(event.mint)) return;

    // ── Tiered Exits (Phase 5) ──
    if (template.enableTieredExits && position.pnlPercent > 0) {
      const tiersSold = position.tiersSold ?? [];
      const tiers = [
        { num: 1, pctGain: template.exitTier1PctGain, sellPct: template.exitTier1SellPct },
        { num: 2, pctGain: template.exitTier2PctGain, sellPct: template.exitTier2SellPct },
        { num: 3, pctGain: template.exitTier3PctGain, sellPct: template.exitTier3SellPct },
        { num: 4, pctGain: template.exitTier4PctGain, sellPct: template.exitTier4SellPct },
      ];

      for (const tier of tiers) {
        if (tiersSold.includes(tier.num)) continue;
        if (position.pnlPercent >= tier.pctGain) {
          const remaining = position.remainingPct ?? 1.0;
          const sellFraction = tier.sellPct / 100;
          const actualSellPct = Math.min(sellFraction, remaining);

          if (actualSellPct <= 0) continue;

          console.log(
            `[Sniper][${template.name}] TIER ${tier.num} EXIT ${position.symbol}: +${position.pnlPercent.toFixed(1)}% — selling ${(actualSellPct * 100).toFixed(0)}% of position`,
          );

          // Mark tier as sold BEFORE executing (prevent duplicate triggers)
          position.tiersSold = [...tiersSold, tier.num];
          position.remainingPct = remaining - actualSellPct;

          pendingSells.set(event.mint, Date.now());
          void executeSellSnipe(event.mint, 'take_profit', templateId, false, actualSellPct)
            .finally(() => { pendingSells.delete(event.mint); });
          return; // Only one tier per trade event
        }
      }
    }

    // Check take-profit (real-time — no 10s delay!)
    if (template.takeProfitPercent > 0 && position.pnlPercent >= template.takeProfitPercent) {
      console.log(
        `[Sniper][${template.name}] TAKE PROFIT (trade event) ${position.symbol}: +${position.pnlPercent.toFixed(1)}%`,
      );
      pendingSells.set(event.mint, Date.now());
      void executeSellSnipe(event.mint, 'take_profit', templateId)
        .finally(() => { pendingSells.delete(event.mint); });
      return;
    }

    // Trailing stop-loss: activate at +trailingStopActivatePercent%, trail below high water mark
    if (
      template.trailingStopActivatePercent > 0 &&
      position.pnlPercent >= template.trailingStopActivatePercent &&
      (position.highWaterMarkPrice ?? 0) > 0
    ) {
      const trailingStopPrice = position.highWaterMarkPrice * (1 + template.trailingStopPercent / 100);
      if (priceUsd <= trailingStopPrice) {
        const dropFromHigh = ((priceUsd - position.highWaterMarkPrice) / position.highWaterMarkPrice) * 100;
        console.log(
          `[Sniper][${template.name}] 📉 TRAILING STOP (trade event) ${position.symbol}: ${dropFromHigh.toFixed(1)}% from high, P&L: +${position.pnlPercent.toFixed(1)}%`,
        );
        pendingSells.set(event.mint, Date.now());
        void executeSellSnipe(event.mint, 'trailing_stop', templateId)
          .finally(() => { pendingSells.delete(event.mint); });
        return;
      }
    }

    // Check stop-loss (real-time — triggers INSTANTLY on price drop)
    if (template.stopLossPercent < 0 && position.pnlPercent <= template.stopLossPercent) {
      console.log(
        `[Sniper][${template.name}] 🛑 STOP LOSS (trade event) ${position.symbol}: ${position.pnlPercent.toFixed(1)}%`,
      );
      pendingSells.set(event.mint, Date.now());
      void executeSellSnipe(event.mint, 'stop_loss', templateId)
        .finally(() => { pendingSells.delete(event.mint); });
      return;
    }
  }
}

/**
 * Auto-start the default sniper template on gateway boot.
 * Called from index.ts after PumpFun monitor is initialised so
 * onNewTokenDetected() actually processes incoming tokens.
 */
export function autoStartSniper(): void {
  const template = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!template) return;

  template.enabled = true;
  const runtime = getRuntime(DEFAULT_TEMPLATE_ID);
  runtime.running = true;
  runtime.startedAt = new Date();

  // Register the real-time trade event handler (must be after pumpfun module is initialized)
  onTradeEvent(handlePositionTradeEvent);
  onTradeEvent(handlePendingTokenTradeEvent);

  // Cleanup stale pending tokens every 30s
  setInterval(() => {
    const now = Date.now();
    for (const [mint, pending] of pendingTokens) {
      const tpl = sniperTemplates.get(pending.templateId);
      const maxWait = (tpl?.momentumWindowMs ?? 10_000) * 2;
      if (now - pending.detectedAt > maxWait) {
        console.log(`[Sniper] Pending token ${pending.symbol} timed out after ${((now - pending.detectedAt) / 1000).toFixed(0)}s — removing`);
        pendingTokens.delete(mint);
        unsubscribeTokenTrades([mint]);
      }
    }
  }, 30_000);

  // Start position-check interval if not already running
  ensurePositionCheckRunning();

  console.log('[Sniper] Default template auto-started — ready to snipe (real-time trade pricing enabled)');

  // Sync wallet tokens into positions on startup (recovers positions lost on restart)
  void syncWalletPositions();

  // Resolve UNKNOWN names from persisted positions (non-blocking)
  setTimeout(() => { void resolveUnknownPositions(); }, 10_000);

  // Re-resolve UNKNOWN positions every 5 minutes
  setInterval(() => { void resolveUnknownPositions(); }, 5 * 60_000);

  // Start trending auto-snipe polling (every 60 seconds)
  if (!trendingPollInterval) {
    trendingPollInterval = setInterval(() => {
      void pollTrendingForSnipe();
    }, 60_000);
    // First poll after 30s delay (let other services initialize)
    setTimeout(() => { void pollTrendingForSnipe(); }, 30_000);
    console.log('[Sniper] Trending auto-snipe loop started (60s interval)');
  }

  // Cache SOL balance on startup (non-blocking) and refresh every 30s
  void refreshCachedSolBalance().then(balance => {
    console.log(`[Sniper] Cached SOL balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  });
  setInterval(() => { void refreshCachedSolBalance(); }, SOL_BALANCE_CACHE_TTL_MS);
}

/**
 * Read all SPL token holdings from the Solana wallet and populate
 * positions that are missing from in-memory tracking.
 * This runs on startup to recover positions lost on gateway restart.
 */
async function syncWalletPositions(): Promise<void> {
  if (!isSolanaConnected()) return;

  try {
    const connection = getSolanaConnection();
    const keypair = getSolanaKeypair();
    if (!keypair) return;

    // Use withRpcRetry to handle 429 rate limits (same as fetchTokenBalance)
    const tokenAccounts = await withRpcRetry(
      () => connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        { programId: TOKEN_PROGRAM_ID },
      ),
      3,
    );

    const positions = getTemplatePositions(DEFAULT_TEMPLATE_ID);

    // Skip well-known tokens (SOL, USDC, USDT, etc.)
    const knownMints = new Set([
      'So11111111111111111111111111111111111111112',  // Wrapped SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  // USDT
    ]);

    // Phase 1: Collect all new mints from wallet
    const newMints: Array<{ mint: string; uiAmount: number }> = [];

    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed?.info as Record<string, unknown> | undefined;
      if (!parsed) continue;

      const mint = parsed.mint as string;
      const tokenAmount = parsed.tokenAmount as { uiAmount: number; decimals: number } | undefined;
      if (!tokenAmount || tokenAmount.uiAmount <= 0) continue;
      if (positions.has(mint)) continue;
      if (knownMints.has(mint)) continue;

      newMints.push({ mint, uiAmount: tokenAmount.uiAmount });
    }

    if (newMints.length === 0) {
      console.log(`[Wallet Sync] All wallet tokens already tracked (${positions.size} positions)`);

      // Still subscribe all positions to trade events
      const allTrackedMints = [...positions.keys()];
      if (allTrackedMints.length > 0) {
        subscribeTokenTrades(allTrackedMints);
      }
      return;
    }

    console.log(`[Wallet Sync] Found ${newMints.length} untracked tokens in wallet, enriching via Helius DAS...`);

    // Phase 2: Batch-enrich with Helius DAS (up to 50 per call — no DexScreener)
    const mintAddresses = newMints.map(m => m.mint);
    const heliusData = await fetchHeliusBatchPrices(mintAddresses);
    const heliusHits = Object.values(heliusData).filter(v => v.symbol || v.name || v.price > 0).length;
    console.log(`[Wallet Sync] Helius enriched ${heliusHits}/${mintAddresses.length} tokens`);

    // Phase 3: Create position entries for ALL tokens (enriched or not)
    let synced = 0;
    for (const { mint, uiAmount } of newMints) {
      const enriched = heliusData[mint];

      const syncTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
      const newPosition: ActivePosition = {
        mint,
        symbol: enriched?.symbol ?? 'UNKNOWN',
        name: enriched?.name ?? 'Unknown Token',
        buyPrice: enriched?.price ?? 0,
        currentPrice: enriched?.price ?? 0,
        amountTokens: uiAmount,
        pnlPercent: 0,
        buySignature: 'wallet-sync',
        boughtAt: new Date().toISOString(),
        templateId: DEFAULT_TEMPLATE_ID,
        templateName: 'Default Sniper',
        priceFetchFailCount: 0,
        lastPriceChangeAt: new Date().toISOString(),
        highWaterMarkPrice: enriched?.price ?? 0,
        buyCostSol: syncTemplate?.buyAmountSol ?? DEFAULT_CONFIG_FIELDS.buyAmountSol,
      };

      positions.set(mint, newPosition);
      synced++;
    }

    syncActivePositionsMap();

    // Subscribe to real-time trade events for ALL tracked positions
    const allTrackedMints = [...positions.keys()];
    if (allTrackedMints.length > 0) {
      subscribeTokenTrades(allTrackedMints);
      console.log(`[Wallet Sync] Subscribed ${allTrackedMints.length} mints to trade events`);
    }

    console.log(`[Wallet Sync] Recovered ${synced}/${newMints.length} positions, ${positions.size} total tracked`);

    // Persist recovered positions
    persistPositions();
  } catch (err) {
    console.error('[Wallet Sync] Failed:', err instanceof Error ? err.message : err);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function generateTemplateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `tpl_${timestamp}_${random}`;
}

function getTemplatePositions(templateId: string): Map<string, ActivePosition> {
  let positions = positionsMap.get(templateId);
  if (!positions) {
    positions = new Map();
    positionsMap.set(templateId, positions);
  }
  return positions;
}

function getRuntime(templateId: string): TemplateRuntimeState {
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

function resetDailyBudgetIfNeeded(runtime: TemplateRuntimeState): void {
  const today = new Date().toDateString();
  if (today !== runtime.dailyResetDate) {
    runtime.dailySpentSol = 0;
    runtime.dailyResetDate = today;
  }
}

/** Check if any template is currently running (used for the global interval) */
function isAnyTemplateRunning(): boolean {
  for (const runtime of templateRuntime.values()) {
    if (runtime.running) return true;
  }
  return false;
}

/** Sync the flat activePositions map from all template positions */
function syncActivePositionsMap(): void {
  activePositions.clear();
  for (const positions of positionsMap.values()) {
    for (const [mint, position] of positions) {
      activePositions.set(mint, position);
    }
  }
}

/** Extract SniperConfig (legacy shape) from a template */
function templateToLegacyConfig(template: SniperTemplate): SniperConfig {
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
  };
}

/** Collect all active positions across all templates into a flat array */
function getAllActivePositions(): ActivePosition[] {
  const all: ActivePosition[] = [];
  for (const positions of positionsMap.values()) {
    for (const position of positions.values()) {
      all.push(position);
    }
  }
  return all;
}

/** Trending auto-snipe poll interval handle */
let trendingPollInterval: ReturnType<typeof setInterval> | null = null;

/** Start the global position-check interval if not already running */
function ensurePositionCheckRunning(): void {
  if (positionCheckInterval) return;
  positionCheckInterval = setInterval(() => {
    checkPositions().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Sniper] Position check error:', message);
    });
  }, 20_000); // 20s interval (was 10s — reduces RPC pressure)
}

/** Stop the global position-check interval if no templates are running */
function stopPositionCheckIfIdle(): void {
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

// ── Validation helpers ────────────────────────────────────────────────

const SNIPER_CONFIG_KEYS: ReadonlyArray<keyof SniperConfigFields> = [
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
] as const;

function validateConfigUpdates(
  updates: Partial<SniperConfigFields>,
): string | null {
  if (updates.buyAmountSol !== undefined
    && (updates.buyAmountSol <= 0 || updates.buyAmountSol > 10)) {
    return 'buyAmountSol must be between 0 and 10 SOL';
  }
  if (updates.dailyBudgetSol !== undefined
    && (updates.dailyBudgetSol <= 0 || updates.dailyBudgetSol > 100)) {
    return 'dailyBudgetSol must be between 0 and 100 SOL';
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
  return null;
}

function pickConfigFields(
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
function applyConfigToTemplate(
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
}

// ── Raydium swap helper (replaced dead Jupiter API) ──────────────────

const RAYDIUM_QUOTE_URL = 'https://transaction-v1.raydium.io/compute/swap-base-in';
const RAYDIUM_SWAP_URL = 'https://transaction-v1.raydium.io/transaction/swap-base-in';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

interface SwapResult {
  signature: string;
  success: boolean;
  outAmount: string | null;
}

interface RaydiumQuoteResponse {
  success: boolean;
  data?: {
    outputAmount: string;
    [key: string]: unknown;
  };
  msg?: string;
  [key: string]: unknown;
}

interface RaydiumSwapResponse {
  success: boolean;
  data?: {
    transaction: string[];
  };
  msg?: string;
}

async function executeSwap(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps: number;
  priorityFee: number;
}): Promise<SwapResult> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  // Pre-flight balance check (only for SOL input swaps)
  if (params.inputMint === SOL_MINT) {
    const check = await hasEnoughSolForSwap(parseInt(params.amountLamports, 10));
    if (!check.sufficient) {
      throw new Error(
        `Insufficient SOL: have ${(check.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
        `need ${(check.requiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (including fees)`,
      );
    }
  }

  // Raydium Quote
  const quoteParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amountLamports,
    slippageBps: String(params.slippageBps),
    txVersion: 'V0',
  });

  console.log(`[Sniper] Raydium quote: ${params.inputMint.slice(0, 8)}... -> ${params.outputMint.slice(0, 8)}... amount=${params.amountLamports}`);
  const quoteRes = await fetch(`${RAYDIUM_QUOTE_URL}?${quoteParams}`);
  if (!quoteRes.ok) {
    const errorBody = await quoteRes.text();
    console.error(`[Sniper] Raydium quote error (${quoteRes.status}):`, errorBody);
    throw new Error(`Raydium quote failed (${quoteRes.status}): ${errorBody.slice(0, 200)}`);
  }
  const quoteResponse = (await quoteRes.json()) as RaydiumQuoteResponse;
  if (!quoteResponse.success || !quoteResponse.data) {
    throw new Error(`Raydium quote failed: ${quoteResponse.msg ?? 'no data'}`);
  }

  const outputAmount = quoteResponse.data.outputAmount;
  console.log(`[Sniper] Raydium quote OK: output=${outputAmount}`);

  // Raydium Swap Transaction
  const swapRes = await fetch(RAYDIUM_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      computeUnitPriceMicroLamports: String(Math.max(params.priorityFee, 100000)),
      swapResponse: quoteResponse,
      txVersion: 'V0',
      wallet: keypair.publicKey.toBase58(),
      wrapSol: params.inputMint === SOL_MINT,
      unwrapSol: params.outputMint === SOL_MINT,
    }),
  });

  if (!swapRes.ok) {
    const errorBody = await swapRes.text();
    console.error(`[Sniper] Raydium swap build error (${swapRes.status}):`, errorBody);
    throw new Error(`Raydium swap build failed (${swapRes.status}): ${errorBody.slice(0, 200)}`);
  }
  const swapData = (await swapRes.json()) as RaydiumSwapResponse;
  if (!swapData.success || !swapData.data?.transaction?.length) {
    throw new Error(`Raydium swap build failed: ${swapData.msg ?? 'no transaction data'}`);
  }

  // Raydium may return multiple transactions; use the first (main swap)
  const txBase64 = swapData.data.transaction[0];
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(txBase64, 'base64'),
  );

  const { blockhash, lastValidBlockHeight } = await withRpcRetry(
    () => connection.getLatestBlockhash('confirmed'),
  );

  transaction.sign([keypair]);

  const signature = await withRpcRetry(
    () => connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    }),
    2,
  );

  console.log(`[Sniper] Raydium tx sent: ${signature}`);

  // Confirm with timeout fallback
  let success = false;
  try {
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    success = !confirmation.value.err;
    if (confirmation.value.err) {
      console.error(`[Sniper] Raydium tx failed on-chain:`, confirmation.value.err);
    }
  } catch {
    console.warn(`[Sniper] Raydium confirmation timed out for ${signature}, checking status...`);
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      if (status.value?.confirmationStatus === 'confirmed' ||
          status.value?.confirmationStatus === 'finalized') {
        success = !status.value.err;
        console.log(`[Sniper] Raydium fallback status: ${success ? 'SUCCESS' : 'FAILED on-chain'}`);
      }
    } catch {
      console.error(`[Sniper] Raydium fallback status check failed for ${signature}`);
    }
  }

  return {
    signature,
    success,
    outAmount: outputAmount ?? null,
  };
}

// ── PumpPortal Local API (bonding curve + graduated tokens) ───────────

const PUMPPORTAL_TRADE_URL = 'https://pumpportal.fun/api/trade-local';

/**
 * Execute a swap via PumpPortal's Local Transaction API.
 * Returns a serialized VersionedTransaction that we sign and send ourselves.
 *
 * Works for: bonding curve (pump), PumpSwap (pump-amm), Raydium, auto-detect.
 * Fee: 0.5% per trade (deducted on-chain by PumpPortal).
 *
 * @see https://pumpportal.fun/local-trading-api/trading-api/
 */
async function executePumpPortalSwap(params: {
  action: 'buy' | 'sell';
  mint: string;
  amount: number;
  denominatedInSol: boolean;
  slippageBps: number;
  priorityFeeLamports: number;
}): Promise<SwapResult> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  // Pre-flight balance check for buys
  if (params.action === 'buy' && params.denominatedInSol) {
    const amountLamports = Math.floor(params.amount * LAMPORTS_PER_SOL);
    const check = await hasEnoughSolForSwap(amountLamports);
    if (!check.sufficient) {
      throw new Error(
        `Insufficient SOL: have ${(check.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
        `need ${(check.requiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (including fees)`,
      );
    }
  }

  // PumpPortal slippage is a percentage (25 = 25%), not bps
  const slippagePercent = Math.max(params.slippageBps / 100, 1);
  // Convert priority fee from lamports to SOL
  const priorityFeeSol = params.priorityFeeLamports / LAMPORTS_PER_SOL;

  const body = {
    publicKey: keypair.publicKey.toBase58(),
    action: params.action,
    mint: params.mint,
    amount: params.amount,
    denominatedInSol: String(params.denominatedInSol),
    slippage: slippagePercent,
    priorityFee: priorityFeeSol,
    pool: 'auto',
  };

  console.log(`[Sniper] PumpPortal ${params.action}:`, {
    mint: params.mint,
    amount: params.amount,
    slippage: `${slippagePercent}%`,
    priorityFee: `${priorityFeeSol} SOL`,
    pool: 'auto',
  });

  const response = await fetch(PUMPPORTAL_TRADE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status !== 200) {
    const errorText = await response.text();
    console.error(`[Sniper] PumpPortal error (${response.status}):`, errorText);
    throw new Error(`PumpPortal ${params.action} failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  // Response is raw bytes of a serialized VersionedTransaction
  const txBuffer = Buffer.from(await response.arrayBuffer());
  const transaction = VersionedTransaction.deserialize(txBuffer);

  // Fetch blockhash BEFORE sending (Sprint 14 critical fix)
  const { blockhash, lastValidBlockHeight } = await withRpcRetry(
    () => connection.getLatestBlockhash('confirmed'),
  );

  transaction.sign([keypair]);

  const signature = await withRpcRetry(
    () => connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    }),
    2,
  );

  console.log(`[Sniper] PumpPortal tx sent: ${signature}`);

  // Confirm with timeout fallback
  let success = false;
  try {
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    success = !confirmation.value.err;
    if (confirmation.value.err) {
      console.error(`[Sniper] PumpPortal tx failed on-chain:`, confirmation.value.err);
    }
  } catch {
    console.warn(`[Sniper] PumpPortal confirmation timed out for ${signature}, checking status...`);
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      if (status.value?.confirmationStatus === 'confirmed' ||
          status.value?.confirmationStatus === 'finalized') {
        success = !status.value.err;
        console.log(`[Sniper] PumpPortal fallback status: ${success ? 'SUCCESS' : 'FAILED on-chain'}`);
      }
    } catch {
      console.error(`[Sniper] PumpPortal fallback status check failed for ${signature}`);
    }
  }

  return {
    signature,
    success,
    outAmount: null, // PumpPortal Local API doesn't return output amount
  };
}

// ── Snipe execution ────────────────────────────────────────────────────

/**
 * Execute a buy snipe using a specific template's configuration.
 * Falls back to the default template if no templateId is provided.
 *
 * Strategy: PumpPortal first (works for bonding curve + graduated),
 * then Jupiter V6 fallback (works for graduated DEX tokens).
 *
 * Exported for use by solana-pumpfun.ts and solana-whales.ts.
 */

// ── Phase 6: Jito Bundle Execution ──────────────────────────────────────

const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

// TODO: Wire Jito into executeBuySnipe/executeSellSnipe when PumpPortal returns raw transactions
// Currently PumpPortal handles tx construction + submission internally

/** Submit a transaction via Jito bundle for MEV protection (Phase 6) */
/** @internal Exported for future use when PumpPortal supports raw tx return */
export async function submitViaJito(
  serializedTx: Buffer | Uint8Array,
  tipLamports: number,
): Promise<{ success: boolean; bundleId: string | null }> {
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();

    // Create tip transaction to Jito
    const { SystemProgram, Transaction, PublicKey: PubKey } = await import('@solana/web3.js');
    // Jito tip accounts (pick random one)
    const jitoTipAccounts = [
      '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
      'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiYHn37n',
      'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
      'ADaUMid9yfUytqMBgopwjb2o2J3AY5VPgENJKd3XZPVL',
      'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
      'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
      'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
      '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    ];
    const tipAccount = jitoTipAccounts[Math.floor(Math.random() * jitoTipAccounts.length)];

    const tipTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PubKey(tipAccount),
        lamports: tipLamports,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tipTx.recentBlockhash = blockhash;
    tipTx.feePayer = keypair.publicKey;
    tipTx.sign(keypair);

    // Bundle: [main tx, tip tx]
    const mainTxBase64 = Buffer.from(serializedTx).toString('base64');
    const tipTxBase64 = tipTx.serialize().toString('base64');

    const res = await fetch(JITO_BUNDLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[mainTxBase64, tipTxBase64]],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[Jito] Bundle submission failed: ${res.status}`);
      return { success: false, bundleId: null };
    }

    const data = await res.json() as { result?: string };
    console.log(`[Jito] Bundle submitted: ${data.result ?? 'unknown'}`);
    return { success: true, bundleId: data.result ?? null };
  } catch (err) {
    console.warn(`[Jito] Bundle error:`, err instanceof Error ? err.message : err);
    return { success: false, bundleId: null };
  }
}

export async function executeBuySnipe(params: {
  mint: string;
  symbol: string;
  name: string;
  trigger: SnipeExecution['trigger'];
  priceUsd?: number;
  templateId?: string;
  description?: string;
}): Promise<SnipeExecution> {
  const templateId = params.templateId ?? DEFAULT_TEMPLATE_ID;
  const template = sniperTemplates.get(templateId);

  if (!template) {
    const execution = buildFailedExecution(
      params,
      templateId,
      'Unknown',
      `Template not found: ${templateId}`,
    );
    storeAndBroadcastExecution(execution);
    return execution;
  }

  // ── EARLY SOL BALANCE CHECK (silent skip — no log spam, no execution record) ──
  // Uses cached balance to avoid an RPC call per buy attempt
  // Paper mode skips real balance check — uses virtual paperBalanceSol instead
  if (params.trigger !== 'manual' && !template.paperMode) {
    const minRequiredLamports = Math.floor((template.buyAmountSol + 0.005) * LAMPORTS_PER_SOL);
    const currentBalance = await getCachedSolBalance();
    if (currentBalance < minRequiredLamports) {
      // Silently skip — don't log, don't create execution record, don't spam
      return buildFailedExecution(params, templateId, template.name, 'Insufficient SOL (silent skip)');
    }
  }

  const runtime = getRuntime(templateId);
  const positions = getTemplatePositions(templateId);

  const id = `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const execution: SnipeExecution = {
    id,
    mint: params.mint,
    symbol: params.symbol,
    name: params.name,
    action: 'buy',
    amountSol: template.buyAmountSol,
    amountTokens: null,
    priceUsd: params.priceUsd ?? null,
    signature: null,
    status: 'pending',
    error: null,
    trigger: params.trigger,
    templateId,
    templateName: template.name,
    timestamp: new Date().toISOString(),
  };

  try {
    // Budget checks
    resetDailyBudgetIfNeeded(runtime);
    if (runtime.dailySpentSol + template.buyAmountSol > template.dailyBudgetSol) {
      if (params.trigger !== 'manual') {
        return execution; // Silent skip — don't spam execution history
      }
      throw new Error(
        `Daily budget exceeded for "${template.name}": spent ${runtime.dailySpentSol.toFixed(4)} / ${template.dailyBudgetSol} SOL`,
      );
    }
    // Count pending buys for this template to avoid exceeding max positions
    const pendingPrefix = templateId + ':';
    let pendingForTemplate = 0;
    for (const key of pendingBuys) {
      if (key.startsWith(pendingPrefix)) pendingForTemplate++;
    }
    if (positions.size + pendingForTemplate >= template.maxOpenPositions) {
      // Silent skip for auto-triggers — don't spam execution history with failures
      if (params.trigger !== 'manual') {
        return execution;
      }
      throw new Error(
        `Max open positions reached for "${template.name}": ${positions.size} active + ${pendingForTemplate} pending >= ${template.maxOpenPositions}`,
      );
    }

    // ── PAPER MODE BUY ──────────────────────────────────────────────────
    if (template.paperMode) {
      // Check virtual SOL balance — silently skip (don't record as failed)
      if (runtime.paperBalanceSol < template.buyAmountSol) {
        console.log(
          `[Sniper][${template.name}] ⏸️ Paper balance low (${runtime.paperBalanceSol.toFixed(4)} SOL < ${template.buyAmountSol} SOL) — waiting for sells to recover`,
        );
        return execution;
      }

      // Get realistic token amount via Jupiter quote (no execution)
      let estimatedTokens = 0;
      try {
        const amountLamports = Math.floor(template.buyAmountSol * LAMPORTS_PER_SOL);
        const quoteUrl = `https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=${SOL_MINT}&outputMint=${params.mint}&amount=${amountLamports}&slippageBps=${template.slippageBps}&txVersion=V0`;
        const quoteResp = await fetch(quoteUrl);
        if (quoteResp.ok) {
          const quoteData = await quoteResp.json() as { success?: boolean; data?: { outputAmount?: string } };
          if (quoteData.success && quoteData.data?.outputAmount) {
            estimatedTokens = parseFloat(quoteData.data.outputAmount);
          }
        }
      } catch (quoteErr) {
        console.warn(`[Sniper][${template.name}] Paper buy Raydium quote failed, using price estimate`);
      }

      // Fallback: estimate from current price if quote failed
      if (estimatedTokens <= 0 && params.priceUsd && params.priceUsd > 0) {
        // Rough estimate: (buyAmountSol * ~150 USD/SOL) / priceUsd
        const solPriceUsd = 150; // approximate, good enough for paper mode
        estimatedTokens = (template.buyAmountSol * solPriceUsd) / params.priceUsd;
      }
      if (estimatedTokens <= 0) {
        estimatedTokens = 1000000; // fallback placeholder
      }

      // Deduct from virtual balance
      runtime.paperBalanceSol -= template.buyAmountSol;
      runtime.dailySpentSol += template.buyAmountSol;

      execution.signature = `paper_${Date.now()}`;
      execution.status = 'success';
      execution.amountTokens = estimatedTokens;
      execution.paperMode = true;

      // Create paper position
      const now = new Date().toISOString();
      const newPosition: ActivePosition = {
        mint: params.mint,
        symbol: params.symbol,
        name: params.name,
        buyPrice: params.priceUsd ?? 0,
        currentPrice: params.priceUsd ?? 0,
        amountTokens: estimatedTokens,
        pnlPercent: 0,
        buySignature: execution.signature,
        boughtAt: now,
        templateId,
        templateName: template.name,
        priceFetchFailCount: 0,
        lastPriceChangeAt: now,
        highWaterMarkPrice: params.priceUsd ?? 0,
        buyCostSol: template.buyAmountSol,
        paperMode: true,
        description: params.description,
      };

      positions.set(params.mint, newPosition);
      syncActivePositionsMap();

      // Subscribe to REAL trade events for price updates
      subscribeTokenTrades([params.mint]);

      template.stats.totalTrades++;
      lastBuyTimestamp = Date.now();

      persistPositions();
      persistDailySpend();
      persistTemplateStats();

      console.log(
        `[Sniper][${template.name}] PAPER BUY ${params.symbol}: ~${estimatedTokens.toFixed(0)} tokens for ${template.buyAmountSol} SOL (virtual balance: ${runtime.paperBalanceSol.toFixed(4)} SOL)`,
      );
    } else {
      // ── REAL MODE BUY ──────────────────────────────────────────────────
      // Strategy: PumpPortal first (bonding curve + graduated), Jupiter fallback
      let result: SwapResult;

      try {
        console.log(`[Sniper][${template.name}] Trying PumpPortal buy for ${params.symbol}...`);
        result = await executePumpPortalSwap({
          action: 'buy',
          mint: params.mint,
          amount: template.buyAmountSol,
          denominatedInSol: true,
          slippageBps: template.slippageBps,
          priorityFeeLamports: template.priorityFee,
        });
      } catch (ppErr) {
        console.warn(
          `[Sniper][${template.name}] PumpPortal failed, falling back to Jupiter:`,
          ppErr instanceof Error ? ppErr.message : ppErr,
        );
        const amountLamports = String(Math.floor(template.buyAmountSol * LAMPORTS_PER_SOL));
        result = await executeSwap({
          inputMint: SOL_MINT,
          outputMint: params.mint,
          amountLamports,
          slippageBps: template.slippageBps,
          priorityFee: template.priorityFee,
        });
      }

      execution.signature = result.signature;
      execution.status = result.success ? 'success' : 'failed';

      if (result.success) {
        runtime.dailySpentSol += template.buyAmountSol;
        execution.amountTokens = result.outAmount ? parseFloat(result.outAmount) : null;

        // PumpPortal doesn't return output amount — fetch actual balance from wallet
        if (!execution.amountTokens || execution.amountTokens <= 0) {
          // Small delay to let the transaction finalize on-chain
          await new Promise(resolve => setTimeout(resolve, 2000));
          const walletBalance = await fetchTokenBalance(params.mint);
          if (walletBalance > 0) {
            execution.amountTokens = walletBalance;
            console.log(`[Sniper][${template.name}] Got token balance from wallet: ${walletBalance.toFixed(2)} ${params.symbol}`);
          }
        }

        // Track position under this template
        const now = new Date().toISOString();
        const newPosition: ActivePosition = {
          mint: params.mint,
          symbol: params.symbol,
          name: params.name,
          buyPrice: params.priceUsd ?? 0,
          currentPrice: params.priceUsd ?? 0,
          amountTokens: execution.amountTokens ?? 0,
          pnlPercent: 0,
          buySignature: result.signature,
          boughtAt: now,
          templateId,
          templateName: template.name,
          priceFetchFailCount: 0,
          lastPriceChangeAt: now,
          highWaterMarkPrice: params.priceUsd ?? 0,
          buyCostSol: template.buyAmountSol,
          description: params.description,
        };

        positions.set(params.mint, newPosition);
        syncActivePositionsMap();

        // Subscribe to real-time trade events for this token (instant price updates)
        subscribeTokenTrades([params.mint]);

        // Stats: increment totalTrades on successful buy
        template.stats.totalTrades++;

        // Update buy cooldown
        lastBuyTimestamp = Date.now();

        // Persist state
        persistPositions();
        persistDailySpend();
        persistTemplateStats();
      }
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';
  }

  storeAndBroadcastExecution(execution);

  console.log(
    `[Sniper][${template.name}] ${execution.status.toUpperCase()} -- ${execution.action} ${execution.symbol} (${execution.trigger}): ${execution.signature ?? execution.error}`,
  );

  return execution;
}

/**
 * Fetch the actual token balance for a specific mint from the wallet.
 * Used when position.amountTokens is 0 (PumpPortal doesn't return output amount).
 */
async function fetchTokenBalance(mintAddress: string): Promise<number> {
  try {
    const connection = getSolanaConnection();
    const keypair = getSolanaKeypair();
    if (!keypair) return 0;

    const mintPubkey = new PublicKey(mintAddress);
    const tokenAccounts = await withRpcRetry(
      () => connection.getParsedTokenAccountsByOwner(keypair.publicKey, { mint: mintPubkey }),
      3, // up to 3 retries for 429s
    );

    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed?.info as Record<string, unknown> | undefined;
      if (!parsed) continue;
      const tokenAmount = parsed.tokenAmount as { uiAmount: number } | undefined;
      if (tokenAmount && tokenAmount.uiAmount > 0) return tokenAmount.uiAmount;
    }
  } catch (err) {
    console.warn(`[Sniper] fetchTokenBalance failed for ${mintAddress.slice(0, 8)}:`, err instanceof Error ? err.message : err);
  }
  return 0;
}

export async function executeSellSnipe(
  mint: string,
  trigger: SnipeExecution['trigger'],
  templateId?: string,
  /** When true, skip enqueuing to failedSellQueue (caller handles retry) */
  skipRetryEnqueue = false,
  /** Fraction of position to sell (0-1). Default 1.0 = sell all */
  sellPct = 1.0,
): Promise<SnipeExecution | null> {
  // Resolve templateId: if not provided, find which template owns this position
  const resolvedTemplateId = templateId ?? findTemplateForPosition(mint);
  if (!resolvedTemplateId) return null;

  const template = sniperTemplates.get(resolvedTemplateId);
  if (!template) return null;

  const positions = getTemplatePositions(resolvedTemplateId);
  const position = positions.get(mint);
  if (!position) return null;

  // If amountTokens is 0 (PumpPortal buy doesn't return output), fetch from wallet
  // Paper positions skip wallet fetch — they have no real tokens
  let sellAmount = position.amountTokens;
  if (sellAmount <= 0 && !position.paperMode) {
    console.log(`[Sniper][${template.name}] Position amount is 0, fetching wallet balance for ${position.symbol}...`);
    sellAmount = await fetchTokenBalance(mint);
    if (sellAmount > 0) {
      position.amountTokens = sellAmount;
      console.log(`[Sniper][${template.name}] Wallet balance: ${sellAmount.toFixed(2)} ${position.symbol}`);
    } else {
      console.warn(`[Sniper][${template.name}] No tokens found in wallet for ${position.symbol} — removing ghost position`);
      positions.delete(mint);
      syncActivePositionsMap();
      unsubscribeTokenTrades([mint]);
      return null;
    }
  }

  // Partial sell support (tiered exits)
  if (sellPct < 1.0 && sellPct > 0) {
    sellAmount = Math.floor(sellAmount * sellPct);
    if (sellAmount <= 0) {
      // Rounding killed the amount — clean up
      positions.delete(mint);
      syncActivePositionsMap();
      return null;
    }
  }

  const id = `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const execution: SnipeExecution = {
    id,
    mint,
    symbol: position.symbol,
    name: position.name,
    action: 'sell',
    amountSol: 0,
    amountTokens: sellAmount,
    priceUsd: position.currentPrice,
    signature: null,
    status: 'pending',
    error: null,
    trigger,
    templateId: resolvedTemplateId,
    templateName: template.name,
    timestamp: new Date().toISOString(),
  };

  try {
    // ── PAPER MODE SELL ────────────────────────────────────────────────
    if (template.paperMode || position.paperMode) {
      // Calculate sell value via Jupiter quote (no execution)
      let estimatedSolReturn = 0;
      try {
        const sellAmountRawForQuote = Math.floor(sellAmount * 1_000_000); // 6 decimals for pump.fun
        const quoteUrl = `https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${sellAmountRawForQuote}&slippageBps=${template.slippageBps}&txVersion=V0`;
        const quoteResp = await fetch(quoteUrl);
        if (quoteResp.ok) {
          const quoteData = await quoteResp.json() as { success?: boolean; data?: { outputAmount?: string } };
          if (quoteData.success && quoteData.data?.outputAmount) {
            estimatedSolReturn = parseFloat(quoteData.data.outputAmount) / LAMPORTS_PER_SOL;
          }
        }
      } catch (quoteErr) {
        console.warn(`[Sniper][${template.name}] Paper sell Raydium quote failed, using price estimate`);
      }

      // Fallback: estimate from current price and buy cost
      if (estimatedSolReturn <= 0 && position.currentPrice > 0 && position.buyPrice > 0) {
        const priceRatio = position.currentPrice / position.buyPrice;
        const buyCostSol = position.buyCostSol ?? template.buyAmountSol;
        estimatedSolReturn = buyCostSol * priceRatio;
      }

      // Add returned SOL to virtual balance
      const runtime = getRuntime(resolvedTemplateId);
      runtime.paperBalanceSol += estimatedSolReturn;

      execution.signature = `paper_sell_${Date.now()}`;
      execution.status = 'success';
      execution.amountSol = estimatedSolReturn;
      execution.paperMode = true;

      // Stats tracking
      const buyCostSol = position.buyCostSol ?? template.buyAmountSol;
      const pnlSol = estimatedSolReturn - buyCostSol;

      if (trigger === 'take_profit') {
        template.stats.wins++;
        const runtimeCb = getRuntime(resolvedTemplateId);
        runtimeCb.consecutiveLosses = 0; // Reset on win
      } else if (trigger === 'stop_loss') {
        template.stats.losses++;
        const runtimeCb = getRuntime(resolvedTemplateId);
        runtimeCb.consecutiveLosses++;
        if (pnlSol < 0) runtimeCb.dailyRealizedLossSol += Math.abs(pnlSol);
        if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
          const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
            ? template.consecutiveLossPauseMs * 3
            : template.consecutiveLossPauseMs;
          runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
          console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
        }
      } else {
        if (pnlSol >= 0) {
          template.stats.wins++;
          const runtimeCb = getRuntime(resolvedTemplateId);
          runtimeCb.consecutiveLosses = 0; // Reset on win
        } else {
          template.stats.losses++;
          const runtimeCb = getRuntime(resolvedTemplateId);
          runtimeCb.consecutiveLosses++;
          runtimeCb.dailyRealizedLossSol += Math.abs(pnlSol);
          if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
            const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
              ? template.consecutiveLossPauseMs * 3
              : template.consecutiveLossPauseMs;
            runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
            console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
          }
        }
      }
      template.stats.totalPnlSol += pnlSol;

      // Only fully remove position if this was a full sell
      if (sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01) {
        positions.delete(mint);
        syncActivePositionsMap();
        unsubscribeTokenTrades([mint]);
      } else {
        // Partial sell — update remaining tokens
        position.amountTokens -= sellAmount;
        syncActivePositionsMap();
      }

      // Persist (no real wallet ops needed)
      persistPositions();
      persistTemplateStats();

      console.log(
        `[Sniper][${template.name}] PAPER SELL ${position.symbol} (${trigger}): ~${estimatedSolReturn.toFixed(4)} SOL returned, PnL: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (virtual balance: ${runtime.paperBalanceSol.toFixed(4)} SOL)`,
      );
    } else {
      // ── REAL MODE SELL ───────────────────────────────────────────────
      // Capture pre-sell SOL balance for on-chain verification
      const connection = getSolanaConnection();
      const walletPubkey = getSolanaKeypair().publicKey;
      const preSellLamports = await connection.getBalance(walletPubkey);

      // Sell all tokens back to SOL — PumpPortal first, Jupiter fallback
      let result: SwapResult;

      try {
        console.log(`[Sniper][${template.name}] Trying PumpPortal sell for ${position.symbol} (${sellAmount.toFixed(2)} tokens)...`);
        result = await executePumpPortalSwap({
          action: 'sell',
          mint,
          amount: sellAmount, // PumpPortal expects UI token amount when denominatedInSol=false
          denominatedInSol: false,
          slippageBps: template.slippageBps,
          priorityFeeLamports: template.priorityFee,
        });
      } catch (ppErr) {
        console.warn(
          `[Sniper][${template.name}] PumpPortal sell failed, falling back to Jupiter:`,
          ppErr instanceof Error ? ppErr.message : ppErr,
        );
        result = await executeSwap({
          inputMint: mint,
          outputMint: SOL_MINT,
          amountLamports: String(Math.floor(sellAmount * 1_000_000)), // pump.fun tokens = 6 decimals
          slippageBps: Math.max(template.slippageBps, 2500), // min 25% slippage for Jupiter sells
          priorityFee: template.priorityFee,
        });
      }

      execution.signature = result.signature;

      if (result.success) {
        // Wait for transaction to settle
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check actual SOL received
        const postSellLamports = await connection.getBalance(walletPubkey);
        const actualSolReceived = Math.max(0, (postSellLamports - preSellLamports) / LAMPORTS_PER_SOL);

        // Check if tokens actually left the wallet
        let tokensRemaining = 0;
        try {
          const allAccounts = await getAllTokenAccounts();
          const tokenAccount = allAccounts.find(a => a.mint === mint);
          tokensRemaining = tokenAccount?.balance ?? 0;
        } catch (err) {
          console.warn(`[Sniper] Failed to verify token balance after sell: ${err}`);
        }

        if (tokensRemaining > 10) {
          // Sell verification failed — tokens still in wallet
          console.warn(`[Sniper][${template.name}] SELL VERIFICATION FAILED for ${position.symbol} — ${tokensRemaining.toFixed(0)} tokens still in wallet`);
          execution.status = 'failed';
          execution.error = `Tokens still in wallet (${tokensRemaining.toFixed(0)} remaining)`;
          // Don't delete position, don't update stats — let retry handle it
        } else {
          // Sell confirmed on-chain
          execution.status = 'success';

          // Use actual SOL received if available, otherwise fall back to estimates
          if (actualSolReceived > 0) {
            execution.amountSol = actualSolReceived;
          } else if (result.outAmount) {
            execution.amountSol = parseFloat(result.outAmount) / LAMPORTS_PER_SOL;
          } else if (position.currentPrice > 0 && position.buyPrice > 0) {
            const priceRatio = position.currentPrice / position.buyPrice;
            const buyCost = position.buyCostSol ?? template.buyAmountSol;
            execution.amountSol = buyCost * priceRatio * sellPct;
          } else {
            const buyCost = position.buyCostSol ?? template.buyAmountSol;
            const pnlPct = position.pnlPercent ?? 0;
            execution.amountSol = buyCost * (1 + pnlPct / 100) * sellPct;
          }

          // Stats tracking on sell
          const buyAmountSol = (position.buyCostSol ?? template.buyAmountSol) * sellPct;
          const sellAmountSol = execution.amountSol;
          const pnlSol = sellAmountSol - buyAmountSol;

          if (trigger === 'take_profit') {
            template.stats.wins++;
            template.stats.totalPnlSol += pnlSol;
            const runtimeCb = getRuntime(resolvedTemplateId);
            runtimeCb.consecutiveLosses = 0; // Reset on win
          } else if (trigger === 'stop_loss') {
            template.stats.losses++;
            template.stats.totalPnlSol += pnlSol;
            const runtimeCb = getRuntime(resolvedTemplateId);
            runtimeCb.consecutiveLosses++;
            if (pnlSol < 0) runtimeCb.dailyRealizedLossSol += Math.abs(pnlSol);
            if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
              const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
                ? template.consecutiveLossPauseMs * 3
                : template.consecutiveLossPauseMs;
              runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
              console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
            }
          } else {
            // Manual or other sells still track PnL
            if (pnlSol >= 0) {
              template.stats.wins++;
              const runtimeCb = getRuntime(resolvedTemplateId);
              runtimeCb.consecutiveLosses = 0; // Reset on win
            } else {
              template.stats.losses++;
              const runtimeCb = getRuntime(resolvedTemplateId);
              runtimeCb.consecutiveLosses++;
              runtimeCb.dailyRealizedLossSol += Math.abs(pnlSol);
              if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
                const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
                  ? template.consecutiveLossPauseMs * 3
                  : template.consecutiveLossPauseMs;
                runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
                console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
              }
            }
            template.stats.totalPnlSol += pnlSol;
          }

          // Only fully remove position if this was a full sell
          if (sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01) {
            positions.delete(mint);
            syncActivePositionsMap();
            unsubscribeTokenTrades([mint]);
          } else {
            // Partial sell — update remaining tokens
            position.amountTokens -= sellAmount;
            syncActivePositionsMap();
          }

          // Refresh cached SOL balance after sell (so auto-buy can resume faster)
          void refreshCachedSolBalance();

          // Close the token account to recover rent (~0.002 SOL) — only on full sell
          if (sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01) {
            void closeTokenAccountForMint(mint).then(closeResult => {
              if (closeResult) {
                console.log(
                  `[Sniper] Closed token account for ${position.symbol}, recovered ~0.002 SOL`,
                );
                // Refresh balance again after rent recovery
                void refreshCachedSolBalance();
              }
            });
          }

          // Persist state
          persistPositions();
          persistTemplateStats();
        }
      } else {
        execution.status = 'failed';
      }
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';

    // Paper positions don't need sell retries — just close them
    if (position.paperMode) {
      console.warn(`[Sniper][${template.name}] Paper sell failed for ${position.symbol}, auto-closing`);
      void autoClosePosition(mint, resolvedTemplateId, 'Paper sell failed');
    } else if (!skipRetryEnqueue
        && trigger !== 'manual'
        && !permanentlyFailedSells.has(mint)
        && !failedSellQueue.some(e => e.mint === mint)) {
      // Queue for retry if this was an automated exit (not manual)
      position.sellFailCount = (position.sellFailCount ?? 0) + 1;

      if (position.sellFailCount >= MAX_POSITION_SELL_ATTEMPTS) {
        console.warn(
          `[Sniper] 🗑️ AUTO-CLOSING ${position.symbol} (${mint.slice(0, 8)}...) — ${position.sellFailCount} sell attempts failed, writing off as loss`,
        );
        permanentlyFailedSells.add(mint);
        void autoClosePosition(mint, resolvedTemplateId, 'Unsellable — all sell attempts failed');
      } else {
        failedSellQueue.push({
          mint,
          trigger,
          templateId: resolvedTemplateId,
          failedAt: Date.now(),
          retryCount: 0,
        });
        console.log(`[Sniper] Queued failed sell for retry: ${position.symbol} (${trigger}) [attempt ${position.sellFailCount}/${MAX_POSITION_SELL_ATTEMPTS}]`);
      }
    }
  }

  storeAndBroadcastExecution(execution);

  console.log(
    `[Sniper][${template.name}] ${execution.status.toUpperCase()} -- ${execution.action} ${position.symbol} (${trigger}): ${execution.signature ?? execution.error}`,
  );

  return execution;
}

/** Find which template owns a given mint position */
function findTemplateForPosition(mint: string): string | null {
  for (const [templateId, positions] of positionsMap) {
    if (positions.has(mint)) return templateId;
  }
  return null;
}

/**
 * Find and close the SPL token account for a given mint address.
 * Searches all token accounts in the wallet for this mint and closes the first match.
 * Returns true if successful, false otherwise. Fire-and-forget safe.
 */
async function closeTokenAccountForMint(mintAddress: string): Promise<boolean> {
  try {
    const allAccounts = await getAllTokenAccounts();
    const account = allAccounts.find(a => a.mint === mintAddress);
    if (!account) return false;

    const result = await closeTokenAccount(account.pubkey, account.programId);
    return result.success;
  } catch (err) {
    console.warn(
      `[Sniper] Failed to close token account for mint ${mintAddress.slice(0, 8)}...:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Auto-close a position that can't be sold (dead/rugged token).
 * Records it as a loss and removes from active positions.
 * Also attempts to close the on-chain token account to recover rent.
 */
async function autoClosePosition(mint: string, templateId: string, reason: string): Promise<void> {
  const positions = positionsMap.get(templateId);
  const position = positions?.get(mint);
  if (!position) return;

  // Check if tokens are actually still in wallet — attempt final sell if so
  if (!position.paperMode) {
    let tokensRemaining = 0;
    try {
      const allAccounts = await getAllTokenAccounts();
      const tokenAccount = allAccounts.find(a => a.mint === mint);
      tokensRemaining = tokenAccount?.balance ?? 0;
    } catch { /* ignore */ }

    if (tokensRemaining > 10) {
      console.log(`[Sniper] autoClose ${mint}: ${tokensRemaining.toFixed(0)} tokens still in wallet — attempting final Jupiter sell`);
      try {
        const result = await executeSwap({
          inputMint: mint,
          outputMint: SOL_MINT,
          amountLamports: String(Math.floor(tokensRemaining * (10 ** 6))), // pump.fun tokens use 6 decimals
          slippageBps: 5000, // 50% slippage for desperate sells
          priorityFee: 100000,
        });
        if (result.success) {
          console.log(`[Sniper] autoClose final sell SUCCESS for ${mint}: sig=${result.signature}`);
        }
      } catch (err) {
        console.warn(`[Sniper] autoClose final sell FAILED for ${mint}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const template = sniperTemplates.get(templateId);
  const buyCostSol = position.buyCostSol ?? template?.buyAmountSol ?? 0.005;

  console.warn(
    `[Sniper] 🗑️ Writing off ${position.symbol} (${mint.slice(0, 8)}...) — ${reason}. Loss: ${buyCostSol.toFixed(4)} SOL`,
  );

  // Record as a loss
  if (template) {
    template.stats.losses++;
    template.stats.totalPnlSol -= buyCostSol;
    template.stats.totalTrades++;
    const runtimeCb = getRuntime(templateId);
    runtimeCb.consecutiveLosses++;
    runtimeCb.dailyRealizedLossSol += buyCostSol;
    if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
      const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
        ? template.consecutiveLossPauseMs * 3
        : template.consecutiveLossPauseMs;
      runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
      console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
    }
  }

  // Store a write-off execution for the log
  const execution: SnipeExecution = {
    id: `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mint,
    symbol: position.symbol,
    name: position.name,
    action: 'sell',
    amountSol: 0,
    amountTokens: position.amountTokens,
    priceUsd: 0,
    signature: null,
    status: 'failed',
    error: `Write-off: ${reason}`,
    trigger: 'max_age',
    templateId,
    templateName: template?.name ?? 'Unknown',
    timestamp: new Date().toISOString(),
  };
  storeAndBroadcastExecution(execution);

  // Remove position
  positions?.delete(mint);
  syncActivePositionsMap();
  unsubscribeTokenTrades([mint]);

  // Cleanup tracking
  pendingSells.delete(mint);
  const queueIdx = failedSellQueue.findIndex(e => e.mint === mint);
  if (queueIdx !== -1) failedSellQueue.splice(queueIdx, 1);

  // Persist
  persistPositions();
  persistTemplateStats();

  // Attempt to close the on-chain token account to recover rent (~0.002 SOL)
  // Skip for paper positions — no real token account exists
  if (!position.paperMode) {
    void closeTokenAccountForMint(mint).then(closed => {
      if (closed) {
        console.log(`[Sniper] Closed token account for write-off ${position.symbol}, recovered ~0.002 SOL`);
      }
    });
  }
}

/**
 * Reconcile wallet positions: sell untracked tokens and close empty accounts.
 * Finds tokens in the wallet that aren't tracked as active positions and
 * attempts to sell them, recovering SOL. Also closes empty token accounts
 * to recover rent.
 */
async function reconcileWalletPositions(): Promise<{ recovered: number; closed: number; soldSol: number }> {
  console.log('[Sniper] Starting wallet reconciliation...');
  const allAccounts = await getAllTokenAccounts();
  let recovered = 0;
  let closed = 0;
  let soldSol = 0;

  // Get all currently tracked mints
  const trackedMints = new Set<string>();
  for (const [, positions] of positionsMap) {
    for (const [mint] of positions) {
      trackedMints.add(mint);
    }
  }

  for (const account of allAccounts) {
    if (account.balance <= 0) {
      // Close empty token accounts to recover rent
      try {
        await closeTokenAccount(account.pubkey, account.programId);
        closed++;
        console.log(`[Sniper] Closed empty token account for ${account.mint.slice(0, 8)}...`);
      } catch { /* ignore */ }
      continue;
    }

    // Skip if already tracked as open position
    if (trackedMints.has(account.mint)) continue;

    // Skip SOL-like tokens (WSOL etc)
    if (account.mint === SOL_MINT) continue;

    // Try to sell untracked tokens
    console.log(`[Sniper] Reconcile: Found untracked token ${account.mint.slice(0, 8)}... with ${account.balance.toFixed(2)} tokens — selling`);
    try {
      const amountRaw = Math.floor(account.balance * (10 ** account.decimals));
      const preBal = await getSolanaConnection().getBalance(getSolanaKeypair().publicKey);

      // Try PumpPortal first (most pump.fun tokens)
      let success = false;
      try {
        const ppResult = await executePumpPortalSwap({
          action: 'sell',
          mint: account.mint,
          amount: amountRaw,
          denominatedInSol: false,
          slippageBps: 5000,
          priorityFeeLamports: 100000,
        });
        success = ppResult.success;
      } catch {
        // Fallback to Jupiter
        try {
          const jupResult = await executeSwap({
            inputMint: account.mint,
            outputMint: SOL_MINT,
            amountLamports: String(amountRaw),
            slippageBps: 5000,
            priorityFee: 100000,
          });
          success = jupResult.success;
        } catch { /* ignore */ }
      }

      if (success) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const postBal = await getSolanaConnection().getBalance(getSolanaKeypair().publicKey);
        const solGained = (postBal - preBal) / LAMPORTS_PER_SOL;
        soldSol += Math.max(0, solGained);
        recovered++;
        console.log(`[Sniper] Reconcile: Sold ${account.mint.slice(0, 8)}... for ~${solGained.toFixed(4)} SOL`);
      }
    } catch (err) {
      console.warn(`[Sniper] Reconcile: Failed to sell ${account.mint.slice(0, 8)}...: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Refresh cached balance
  void refreshCachedSolBalance();
  console.log(`[Sniper] Reconciliation complete: ${recovered} tokens sold (~${soldSol.toFixed(4)} SOL recovered), ${closed} empty accounts closed`);
  return { recovered, closed, soldSol };
}

function buildFailedExecution(
  params: { mint: string; symbol: string; name: string; trigger: SnipeExecution['trigger'] },
  templateId: string,
  templateName: string,
  errorMessage: string,
): SnipeExecution {
  return {
    id: `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mint: params.mint,
    symbol: params.symbol,
    name: params.name,
    action: 'buy',
    amountSol: 0,
    amountTokens: null,
    priceUsd: null,
    signature: null,
    status: 'failed',
    error: errorMessage,
    trigger: params.trigger,
    templateId,
    templateName,
    timestamp: new Date().toISOString(),
  };
}

function storeAndBroadcastExecution(execution: SnipeExecution): void {
  executionHistory.unshift(execution);
  if (executionHistory.length > MAX_HISTORY) executionHistory.pop();

  broadcast('solana:sniper', {
    event: 'snipe:executed',
    execution,
  });

  // Persist to disk
  persistExecutions();
}

// ── Position monitoring (take-profit / stop-loss) ──────────────────────

interface DexscreenerPair {
  chainId: string;
  priceUsd?: string;
  [key: string]: unknown;
}

interface DexscreenerTokenResponse {
  pairs?: DexscreenerPair[];
}

interface JupiterPriceData {
  price: string;
}

interface JupiterPriceResponse {
  data: Record<string, JupiterPriceData | undefined>;
}

// PumpFunCoinResponse removed — using Record<string, unknown> for flexible API parsing

/**
 * Fetch the current USD price of a token from multiple sources.
 * Tries DexScreener → Jupiter → PumpFun API, returns 0 if all fail.
 */
async function fetchTokenPrice(mint: string): Promise<number> {
  // Source 1: DexScreener (works for graduated/DEX-listed tokens)
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as DexscreenerTokenResponse;
      const pair = (data.pairs ?? []).find(
        (p: DexscreenerPair) => p.chainId === 'solana',
      );
      if (pair?.priceUsd) {
        const price = parseFloat(pair.priceUsd);
        if (price > 0) return price;
      }
    }
  } catch (err) {
    // DexScreener unavailable — expected for brand-new tokens
  }

  // Source 2: Jupiter Price API (works for any token with liquidity)
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as JupiterPriceResponse;
      const price = parseFloat(data.data[mint]?.price ?? '0');
      if (price > 0) return price;
    }
  } catch (err) {
    // Jupiter unavailable — expected for very new tokens
  }

  // Source 3: PumpFun API (works for bonding curve tokens)
  try {
    const res = await fetch(`https://frontend-api-v2.pump.fun/coins/${mint}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json', 'User-Agent': 'TradeWorks/1.0' },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      // Try multiple field names — PumpFun API format varies
      const mcap = (data.usd_market_cap as number) ?? (data.market_cap as number) ?? 0;
      if (mcap > 0) {
        // pump.fun tokens have 1 billion supply; derive price per token from market cap
        return mcap / 1e9;
      }
    } else {
      console.warn(`[Sniper] PumpFun API returned ${res.status} for ${mint.slice(0, 8)}...`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Sniper] PumpFun API error for ${mint.slice(0, 8)}...: ${msg}`);
  }

  // Source 4: PumpFun frontend API v3 fallback
  try {
    const res = await fetch(`https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${mint}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const mcap = (data.usd_market_cap as number) ?? (data.market_cap as number) ?? 0;
      if (mcap > 0) return mcap / 1e9;
    }
  } catch {
    // PumpFun fallback unavailable
  }

  return 0; // All sources failed
}

/**
 * Batch-fetch prices from Helius DAS API for all mints at once.
 * Returns a map of mint → price. Much more reliable than individual API calls.
 */
async function fetchHeliusBatchPrices(mints: string[]): Promise<Record<string, { price: number; symbol?: string; name?: string }>> {
  const results: Record<string, { price: number; symbol?: string; name?: string }> = {};
  if (mints.length === 0) return results;

  const rpcUrl = getSolanaRpcUrl();
  if (!rpcUrl || !rpcUrl.includes('helius')) return results;

  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAssetBatch',
      params: { ids: mints },
    });

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return results;

    const json = (await res.json()) as {
      result?: Array<{
        id: string;
        content?: { metadata?: { name?: string; symbol?: string } };
        token_info?: {
          symbol?: string;
          price_info?: { price_per_token?: number };
        };
      }>;
    };

    if (!json.result || !Array.isArray(json.result)) return results;

    for (const asset of json.result) {
      const price = asset.token_info?.price_info?.price_per_token ?? 0;
      const symbol = asset.content?.metadata?.symbol ?? asset.token_info?.symbol;
      const name = asset.content?.metadata?.name;
      results[asset.id] = { price, symbol, name };
    }
  } catch (err) {
    console.warn('[Sniper] Helius batch price fetch failed:', err instanceof Error ? err.message : err);
  }

  return results;
}

/** Cache for Helius batch price results to avoid duplicate calls */
let heliusBatchCache: {
  data: Record<string, { price: number; symbol?: string; name?: string }>;
  fetchedAt: number;
} | null = null;
const HELIUS_CACHE_TTL_MS = 20_000; // 20 seconds

async function checkPositions(): Promise<void> {
  // Pre-fetch: collect ALL mints across all templates for Helius batch pricing
  const allMints: string[] = [];
  for (const positions of positionsMap.values()) {
    for (const mint of positions.keys()) {
      allMints.push(mint);
    }
  }

  // Use cached Helius results if fresh enough (avoids duplicate calls within 20s)
  let heliusPrices: Record<string, { price: number; symbol?: string; name?: string }>;
  const cacheNow = Date.now();
  if (heliusBatchCache && (cacheNow - heliusBatchCache.fetchedAt) < HELIUS_CACHE_TTL_MS) {
    heliusPrices = heliusBatchCache.data;
  } else {
    heliusPrices = await fetchHeliusBatchPrices(allMints);
    heliusBatchCache = { data: heliusPrices, fetchedAt: cacheNow };
  }
  const heliusHits = Object.values(heliusPrices).filter(v => v.price > 0).length;
  if (allMints.length > 0 && heliusHits > 0) {
    console.log(`[Sniper] Helius batch: ${heliusHits}/${allMints.length} prices resolved`);
  }

  const now = Date.now();

  for (const [templateId, positions] of positionsMap) {
    if (positions.size === 0) continue;

    const template = sniperTemplates.get(templateId);
    if (!template) continue;

    const runtime = getRuntime(templateId);
    if (!runtime.running) continue;

    let checkedCount = 0;
    let pricedCount = 0;

    for (const [mint, position] of positions) {
      checkedCount++;
      try {
        // Skip protected mints — NEVER sell or auto-close these
        if (isProtectedMint(mint)) continue;

        // Skip if sell already in-flight (auto-clears stale entries >60s)
        if (isPendingSell(mint)) continue;

        // Skip positions that have permanently failed to sell (will be auto-closed)
        if (permanentlyFailedSells.has(mint)) {
          void autoClosePosition(mint, templateId, 'Permanently failed to sell');
          continue;
        }

        // Skip if already queued for retry (prevent duplicate sells per cycle)
        if (failedSellQueue.some(e => e.mint === mint)) continue;

        const positionAgeMs = now - new Date(position.boughtAt).getTime();

        // ── MAX AGE EXIT: force sell after maxPositionAgeMs regardless ──
        if (template.maxPositionAgeMs > 0 && positionAgeMs > template.maxPositionAgeMs) {
          console.log(
            `[Sniper][${template.name}] ⏰ MAX AGE EXIT ${position.symbol} — ${Math.floor(positionAgeMs / 60000)}min old (limit: ${Math.floor(template.maxPositionAgeMs / 60000)}min)`,
          );
          pendingSells.set(mint, Date.now());
          try {
            await executeSellSnipe(mint, 'max_age', templateId);
          } finally {
            pendingSells.delete(mint);
          }
          continue;
        }

        // Priority 1: Use Helius batch result (most reliable for all Solana tokens)
        let currentPrice = heliusPrices[mint]?.price ?? 0;

        // Update symbol/name from Helius if position has placeholder names
        if (heliusPrices[mint]) {
          if (position.symbol === 'UNKNOWN' && heliusPrices[mint].symbol) {
            position.symbol = heliusPrices[mint].symbol!;
          }
          if (position.name === 'Unknown Token' && heliusPrices[mint].name) {
            position.name = heliusPrices[mint].name!;
          }
        }

        // Priority 2: Fall back to individual API calls if Helius didn't have this token
        if (currentPrice === 0) {
          currentPrice = await fetchTokenPrice(mint);

          // Resolve UNKNOWN symbol/name (regardless of price)
          if (position.symbol === 'UNKNOWN') {
            try {
              const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
                signal: AbortSignal.timeout(3000),
              });
              if (dexRes.ok) {
                const dexData = (await dexRes.json()) as DexscreenerTokenResponse;
                const pair = (dexData.pairs ?? []).find((p: DexscreenerPair) => p.chainId === 'solana');
                const baseToken = pair as unknown as { baseToken?: { symbol?: string; name?: string } } | undefined;
                if (baseToken?.baseToken?.symbol) {
                  position.symbol = baseToken.baseToken.symbol;
                  position.name = baseToken.baseToken.name ?? position.name;
                }
              }
            } catch { /* DexScreener failed */ }

            // PumpFun fallback if DexScreener didn't resolve
            if (position.symbol === 'UNKNOWN') {
              try {
                const pfRes = await fetch(`https://frontend-api-v2.pump.fun/coins/${mint}`, {
                  signal: AbortSignal.timeout(3000),
                });
                if (pfRes.ok) {
                  const pfData = (await pfRes.json()) as Record<string, unknown>;
                  if (pfData.symbol) position.symbol = pfData.symbol as string;
                  if (pfData.name) position.name = pfData.name as string;
                }
              } catch { /* PumpFun failed */ }
            }
          }
        }

        if (currentPrice === 0) {
          position.priceFetchFailCount = (position.priceFetchFailCount ?? 0) + 1;
          if (position.priceFetchFailCount % 10 === 0) {
            console.warn(
              `[Sniper][${template.name}] Cannot fetch price for ${position.symbol} (${mint.slice(0, 8)}...) — ${position.priceFetchFailCount} consecutive failures`,
            );
          }

          // EMERGENCY SELL: if we can't get a price after 2 minutes, token is likely dead/rugged
          const MAX_NO_PRICE_AGE_MS = 2 * 60 * 1000;
          if (positionAgeMs > MAX_NO_PRICE_AGE_MS) {
            console.warn(
              `[Sniper][${template.name}] 🚨 EMERGENCY SELL ${position.symbol} — no price data for ${Math.floor(positionAgeMs / 60000)}min, likely dead/rugged`,
            );
            pendingSells.set(mint, Date.now());
            try {
              await executeSellSnipe(mint, 'stop_loss', templateId);
            } finally {
              pendingSells.delete(mint);
            }
          }
          continue;
        }

        // Reset fail counter on successful fetch
        position.priceFetchFailCount = 0;
        pricedCount++;

        // Lazy buyPrice initialization: if unknown at buy time, use first successful price
        if (position.buyPrice === 0) {
          position.buyPrice = currentPrice;
          position.highWaterMarkPrice = currentPrice;
          position.lastPriceChangeAt = new Date().toISOString();
          console.log(
            `[Sniper][${template.name}] Set initial buyPrice for ${position.symbol}: $${currentPrice.toFixed(10)}`,
          );
        }

        const prevPrice = position.currentPrice;
        position.currentPrice = currentPrice;
        position.pnlPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;

        // Track meaningful price movement (>1% change)
        if (prevPrice > 0 && Math.abs((currentPrice - prevPrice) / prevPrice) > 0.01) {
          position.lastPriceChangeAt = new Date().toISOString();
        }

        // Update high water mark
        if (currentPrice > (position.highWaterMarkPrice ?? 0)) {
          position.highWaterMarkPrice = currentPrice;
        }

        // Broadcast live P&L to dashboard via WebSocket
        broadcast('solana:sniper', {
          event: 'position:pnl_update',
          templateId,
          templateName: template.name,
          mint,
          symbol: position.symbol,
          name: position.name,
          buyPrice: position.buyPrice,
          currentPrice,
          amountTokens: position.amountTokens,
          pnlPercent: position.pnlPercent,
          unrealizedPnlUsd: position.amountTokens * (currentPrice - position.buyPrice),
          boughtAt: position.boughtAt,
        });

        // ── STALE PRICE EXIT: sell if no meaningful movement for stalePriceTimeoutMs ──
        if (template.stalePriceTimeoutMs > 0 && positionAgeMs > 180_000) {
          // Grace period: skip for positions less than 3 min old
          const lastChangeMs = now - new Date(position.lastPriceChangeAt ?? position.boughtAt).getTime();
          if (lastChangeMs > template.stalePriceTimeoutMs) {
            console.log(
              `[Sniper][${template.name}] 💤 STALE PRICE EXIT ${position.symbol} — no movement for ${Math.floor(lastChangeMs / 60000)}min`,
            );
            pendingSells.set(mint, Date.now());
            try {
              await executeSellSnipe(mint, 'stale_price', templateId);
            } finally {
              pendingSells.delete(mint);
            }
            continue;
          }
        }

        // ── Tiered Exits (Phase 5) ──
        if (template.enableTieredExits && position.pnlPercent > 0) {
          const tiersSold = position.tiersSold ?? [];
          const tiers = [
            { num: 1, pctGain: template.exitTier1PctGain, sellPct: template.exitTier1SellPct },
            { num: 2, pctGain: template.exitTier2PctGain, sellPct: template.exitTier2SellPct },
            { num: 3, pctGain: template.exitTier3PctGain, sellPct: template.exitTier3SellPct },
            { num: 4, pctGain: template.exitTier4PctGain, sellPct: template.exitTier4SellPct },
          ];

          let tieredExitTriggered = false;
          for (const tier of tiers) {
            if (tiersSold.includes(tier.num)) continue;
            if (position.pnlPercent >= tier.pctGain) {
              const remaining = position.remainingPct ?? 1.0;
              const sellFraction = tier.sellPct / 100;
              const actualSellPct = Math.min(sellFraction, remaining);

              if (actualSellPct <= 0) continue;

              console.log(
                `[Sniper][${template.name}] TIER ${tier.num} EXIT ${position.symbol}: +${position.pnlPercent.toFixed(1)}% — selling ${(actualSellPct * 100).toFixed(0)}% of position`,
              );

              position.tiersSold = [...tiersSold, tier.num];
              position.remainingPct = remaining - actualSellPct;

              pendingSells.set(mint, Date.now());
              try {
                await executeSellSnipe(mint, 'take_profit', templateId, false, actualSellPct);
              } finally {
                pendingSells.delete(mint);
              }
              tieredExitTriggered = true;
              break; // Only one tier per check cycle
            }
          }
          if (tieredExitTriggered) continue;
        }

        // Check take-profit
        if (template.takeProfitPercent > 0 && position.pnlPercent >= template.takeProfitPercent) {
          console.log(
            `[Sniper][${template.name}] Take profit triggered for ${position.symbol}: +${position.pnlPercent.toFixed(1)}%`,
          );
          pendingSells.set(mint, Date.now());
          try {
            await executeSellSnipe(mint, 'take_profit', templateId);
          } finally {
            pendingSells.delete(mint);
          }
          continue;
        }

        // ── TRAILING STOP: activate at +trailingStopActivatePercent%, trail below HWM ──
        if (
          template.trailingStopActivatePercent > 0 &&
          position.pnlPercent >= template.trailingStopActivatePercent &&
          (position.highWaterMarkPrice ?? 0) > 0
        ) {
          const trailingStopPrice = position.highWaterMarkPrice * (1 + template.trailingStopPercent / 100);
          if (currentPrice <= trailingStopPrice) {
            const dropFromHigh = ((currentPrice - position.highWaterMarkPrice) / position.highWaterMarkPrice) * 100;
            console.log(
              `[Sniper][${template.name}] 📉 TRAILING STOP ${position.symbol}: ${dropFromHigh.toFixed(1)}% from high, P&L: +${position.pnlPercent.toFixed(1)}%`,
            );
            pendingSells.set(mint, Date.now());
            try {
              await executeSellSnipe(mint, 'trailing_stop', templateId);
            } finally {
              pendingSells.delete(mint);
            }
            continue;
          }
        }

        // Check stop-loss
        if (template.stopLossPercent < 0 && position.pnlPercent <= template.stopLossPercent) {
          console.log(
            `[Sniper][${template.name}] 🛑 Stop loss triggered for ${position.symbol}: ${position.pnlPercent.toFixed(1)}%`,
          );
          pendingSells.set(mint, Date.now());
          try {
            await executeSellSnipe(mint, 'stop_loss', templateId);
          } finally {
            pendingSells.delete(mint);
          }
          continue;
        }
      } catch (posErr) {
        const msg = posErr instanceof Error ? posErr.message : 'Unknown';
        console.error(`[Sniper][${template.name}] Error monitoring ${position.symbol}:`, msg);
      }
    }

    if (checkedCount > 0) {
      console.log(
        `[Sniper][${template.name}] Positions checked: ${pricedCount}/${checkedCount} priced, ${checkedCount - pricedCount} no-price`,
      );
    }
  }

  // Process failed sell retry queue at end of each check cycle
  await processSellRetryQueue();
}

/** Process queued failed sells, retrying after SELL_RETRY_DELAY_MS */
async function processSellRetryQueue(): Promise<void> {
  const now = Date.now();
  const ready = failedSellQueue.filter(
    entry => (now - entry.failedAt) >= SELL_RETRY_DELAY_MS,
  );

  for (const entry of ready) {
    const idx = failedSellQueue.indexOf(entry);
    if (idx !== -1) failedSellQueue.splice(idx, 1);

    if (isPendingSell(entry.mint)) continue;

    console.log(
      `[Sniper] Retrying failed sell for ${entry.mint.slice(0, 8)}... (attempt ${entry.retryCount + 1}/${MAX_SELL_RETRIES})`,
    );
    pendingSells.set(entry.mint, Date.now());

    try {
      const result = await executeSellSnipe(entry.mint, entry.trigger, entry.templateId, true);
      if (!result || result.status === 'failed') {
        if (entry.retryCount + 1 < MAX_SELL_RETRIES) {
          failedSellQueue.push({
            ...entry,
            failedAt: Date.now(),
            retryCount: entry.retryCount + 1,
          });
        } else {
          console.error(`[Sniper] Sell permanently failed for ${entry.mint.slice(0, 8)}... after ${MAX_SELL_RETRIES} retries`);
          permanentlyFailedSells.add(entry.mint);
          void autoClosePosition(entry.mint, entry.templateId, `Exhausted ${MAX_SELL_RETRIES} sell retries`);
        }
      }
    } catch {
      if (entry.retryCount + 1 < MAX_SELL_RETRIES) {
        failedSellQueue.push({
          ...entry,
          failedAt: Date.now(),
          retryCount: entry.retryCount + 1,
        });
      } else {
        permanentlyFailedSells.add(entry.mint);
        void autoClosePosition(entry.mint, entry.templateId, `Exhausted ${MAX_SELL_RETRIES} sell retries (exception)`);
      }
    } finally {
      pendingSells.delete(entry.mint);
    }
  }
}

// ── Auto-snipe hook (called from pumpfun and whale monitors) ────────────

/**
 * Called when a new token is detected by pump.fun monitor or trending scanner.
 * Checks ALL enabled templates and executes buys for matching ones.
 *
 * Exported for use by solana-pumpfun.ts and solana-whales.ts.
 */
export function onNewTokenDetected(token: {
  mint: string;
  symbol: string;
  name: string;
  usdMarketCap: number;
  source: 'pumpfun' | 'trending';
  creator?: string;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
  marketCapSol?: number;
}): void {
  if (!isSolanaConnected()) return;

  // ── WALLET DEPLETED: silently skip all new tokens when SOL is too low ──
  // Skip this check if any running template is in paper mode (doesn't need real SOL)
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  const anyPaperModeRunning = [...sniperTemplates.values()].some(
    t => t.paperMode && getRuntime(t.id).running,
  );
  if (!anyPaperModeRunning) {
    const minBuyLamports = Math.floor(
      ((defaultTemplate?.buyAmountSol ?? 0.005) + 0.005) * LAMPORTS_PER_SOL,
    );
    if (cachedSolBalanceLamports > 0 && cachedSolBalanceLamports < minBuyLamports) {
      // Log once when first pausing, then stay silent
      if (!pumpFeedPaused) {
        pumpFeedPaused = true;
        pumpFeedPausedAt = Date.now();
        console.log(
          `[Sniper] ⏸️ Pausing auto-buy — wallet depleted (${(cachedSolBalanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL < ${(minBuyLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL needed)`,
        );
      }
      return;
    }
    // Resume if balance recovered
    if (pumpFeedPaused) {
      pumpFeedPaused = false;
      const pausedForMs = Date.now() - pumpFeedPausedAt;
      console.log(
        `[Sniper] ▶️ Resuming auto-buy — balance recovered (${(cachedSolBalanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL), was paused for ${Math.round(pausedForMs / 1000)}s`,
      );
    }
  }

  // ── GLOBAL COOLDOWN: skip if we just bought recently ──
  const cooldownMs = defaultTemplate?.buyCooldownMs ?? 30_000;
  if (Date.now() - lastBuyTimestamp < cooldownMs) {
    return; // Silent skip — too many logs otherwise
  }

  // ── CREATOR SPAM DETECTION: clean up old entries, check creator ──
  if (token.creator) {
    const oneHourAgo = Date.now() - 3_600_000;

    // Clean expired entries
    for (const [addr, data] of recentCreators) {
      if (data.firstSeen < oneHourAgo) recentCreators.delete(addr);
    }

    const maxDeploys = defaultTemplate?.maxCreatorDeploysPerHour ?? 3;
    const creatorData = recentCreators.get(token.creator);
    if (creatorData) {
      creatorData.count++;
      if (creatorData.count > maxDeploys) {
        console.log(
          `[Sniper] 🚫 Creator spam blocked: ${token.creator.slice(0, 8)}... deployed ${creatorData.count} tokens this hour (${token.symbol})`,
        );
        return;
      }
    } else {
      recentCreators.set(token.creator, { count: 1, firstSeen: Date.now() });
    }
  }

  for (const [templateId, template] of sniperTemplates) {
    const runtime = getRuntime(templateId);
    if (!runtime.running || !template.enabled) continue;

    // Source check
    if (token.source === 'pumpfun' && !template.autoBuyPumpFun) continue;
    if (token.source === 'trending' && !template.autoBuyTrending) continue;

    // Market cap ceiling (use higher cap for trending tokens)
    const effectiveMaxCap = token.source === 'trending'
      ? (template.maxTrendingMarketCapUsd ?? template.maxMarketCapUsd)
      : template.maxMarketCapUsd;
    if (token.usdMarketCap > effectiveMaxCap) continue;

    // ── MARKET CAP FLOOR: skip tokens with near-zero liquidity ──
    if (token.usdMarketCap > 0 && token.usdMarketCap < template.minMarketCapUsd) {
      continue;
    }

    // AI filter — skip tokens with low moonshot score (if scored)
    const moonshotScore = getMoonshotScore(token.mint);
    if (moonshotScore !== null && moonshotScore < (template.minMoonshotScore ?? 0)) {
      console.log(
        `[Sniper][${template.name}] Skipping ${token.symbol} — moonshot score ${moonshotScore} < ${template.minMoonshotScore ?? 0}`,
      );
      continue;
    }

    // Don't double-buy within the same template (by mint)
    const positions = getTemplatePositions(templateId);
    if (positions.has(token.mint)) continue;

    // Race-condition guard: skip if a buy is already in-flight for this template+mint
    const pendingKey = templateId + ':' + token.mint;
    if (pendingBuys.has(pendingKey)) {
      continue;
    }

    // SYMBOL deduplication: skip if we already hold OR are pending a token with the same symbol
    // Prevents buying 4x "BLUECOLLAR" deployed on different mint addresses (pump.fun spam)
    const upperSymbol = token.symbol.toUpperCase();
    let symbolAlreadyHeld = false;
    for (const pos of positions.values()) {
      if (pos.symbol.toUpperCase() === upperSymbol) {
        symbolAlreadyHeld = true;
        break;
      }
    }
    if (!symbolAlreadyHeld) {
      // Check recent execution history for same symbol (last 20 executions)
      for (const exec of executionHistory.slice(0, 20)) {
        if (exec.symbol.toUpperCase() === upperSymbol && exec.status === 'success' && exec.action === 'buy') {
          symbolAlreadyHeld = true;
          break;
        }
      }
    }
    if (symbolAlreadyHeld) {
      continue;
    }

    // Capture template vars for async closures
    const tplName = template.name;
    const tplId = templateId;
    const requireMint = template.requireMintRevoked;
    const requireFreeze = template.requireFreezeRevoked;

    // ── MOMENTUM GATE: observe token before buying ──
    // Skip momentum gate for trending (already have proven volume data)
    if (token.source === 'trending') {
      // Trending tokens already have proven momentum — buy directly
      pendingBuys.add(pendingKey);
      const tplNameLocal = tplName;
      void (async () => {
        try {
          if (requireMint || requireFreeze) {
            const connection = getSecondaryConnection();
            const mintPubkey = new PublicKey(token.mint);
            const mintAccountInfo = await connection.getParsedAccountInfo(mintPubkey);
            const mintData = (mintAccountInfo.value?.data as ParsedAccountData)?.parsed?.info as
              Record<string, unknown> | undefined;
            if (mintData) {
              if (requireMint && mintData.mintAuthority !== null) {
                console.log(`[Sniper][${tplNameLocal}] Skipping ${token.symbol} — mint authority NOT revoked`);
                return;
              }
              if (requireFreeze && mintData.freezeAuthority !== null) {
                console.log(`[Sniper][${tplNameLocal}] Skipping ${token.symbol} — freeze authority NOT revoked`);
                return;
              }
            }
          }
          await executeBuySnipe({
            mint: token.mint,
            symbol: token.symbol,
            name: token.name,
            trigger: 'trending',
            priceUsd: token.usdMarketCap > 0 ? token.usdMarketCap / 1e9 : undefined,
            templateId: tplId,
          });
        } catch (err: unknown) {
          console.error(`[Sniper][${tplNameLocal}] Auto-snipe error:`, err instanceof Error ? err.message : 'Unknown error');
        } finally {
          pendingBuys.delete(pendingKey);
        }
      })();
      continue;
    }

    // ── Phase 2: Instant reject filters ──
    if (template.enableSpamFilter && isSpamTokenName(token.name, token.symbol)) {
      console.log(`[Sniper][${tplName}] Spam filter rejected: ${token.symbol} ("${token.name}")`);
      continue;
    }

    // Bonding curve filters (if data available from PumpPortal)
    if (token.vSolInBondingCurve !== undefined && token.vSolInBondingCurve > 0) {
      if (token.vSolInBondingCurve < template.minBondingCurveSol) {
        console.log(`[Sniper][${tplName}] Bonding curve too low: ${token.vSolInBondingCurve.toFixed(2)} SOL < ${template.minBondingCurveSol}`);
        continue;
      }
      // Estimate bonding curve progress: typical pump.fun starts at ~80 SOL virtual
      const estimatedProgress = token.vSolInBondingCurve / 85;
      if (estimatedProgress > template.maxBondingCurveProgress) {
        console.log(`[Sniper][${tplName}] Bonding curve too far: ${(estimatedProgress * 100).toFixed(0)}% > ${(template.maxBondingCurveProgress * 100).toFixed(0)}%`);
        continue;
      }
    }

    // ── Phase 3: Circuit breaker check ──
    const runtimeForBreaker = getRuntime(tplId);
    if (runtimeForBreaker.circuitBreakerPausedUntil > Date.now()) {
      const remainingSec = Math.round((runtimeForBreaker.circuitBreakerPausedUntil - Date.now()) / 1000);
      // Log occasionally, not every token
      if (Math.random() < 0.05) {
        console.log(`[Sniper][${tplName}] Circuit breaker active — ${remainingSec}s remaining`);
      }
      continue;
    }
    if (runtimeForBreaker.dailyRealizedLossSol >= template.maxDailyLossSol) {
      continue; // Silent skip — daily loss limit hit
    }

    // Don't observe more than MAX_PENDING_TOKENS at once
    if (pendingTokens.size >= MAX_PENDING_TOKENS) {
      continue;
    }

    // Already observing this token
    if (pendingTokens.has(token.mint)) {
      continue;
    }

    // Add to momentum observation queue
    const pendingToken: PendingToken = {
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      creatorAddress: token.creator ?? '',
      detectedAt: Date.now(),
      trades: [],
      uniqueBuyers: new Set(),
      uniqueSellers: new Set(),
      totalBuySol: 0,
      totalSellSol: 0,
      templateId: tplId,
      source: token.source,
      usdMarketCap: token.usdMarketCap,
      rugCheckResult: null,
      rugCheckDone: !template.enableRugCheck, // Mark as done if disabled
    };
    pendingTokens.set(token.mint, pendingToken);

    // Subscribe to real-time trades for this token during observation
    subscribeTokenTrades([token.mint]);

    console.log(
      `[Sniper][${tplName}] OBSERVING ${token.symbol} (${token.mint.slice(0, 8)}...) — ${template.momentumWindowMs / 1000}s momentum window`,
    );

    // Fire RugCheck asynchronously (Phase 4)
    if (template.enableRugCheck) {
      void fetchRugCheck(token.mint, template.rugCheckTimeoutMs).then(result => {
        const pt = pendingTokens.get(token.mint);
        if (pt) {
          pt.rugCheckResult = result;
          pt.rugCheckDone = true;
          // Re-evaluate immediately with RugCheck result
          evaluatePendingToken(pt);
        }
      });
    }
  }
}

// ── Trending Token Auto-Snipe ─────────────────────────────────────────

/** Set of mint addresses already evaluated by the trending loop (avoid re-evaluation) */
const evaluatedTrendingMints: Set<string> = new Set();

/**
 * Poll DexScreener trending tokens and feed qualifying ones into the sniper.
 * Runs every 60 seconds when any template has autoBuyTrending enabled.
 */
async function pollTrendingForSnipe(): Promise<void> {
  // Check if any running template has autoBuyTrending enabled
  let anyTrendingEnabled = false;
  for (const [templateId, template] of sniperTemplates) {
    const runtime = getRuntime(templateId);
    if (runtime.running && template.enabled && template.autoBuyTrending) {
      anyTrendingEnabled = true;
      break;
    }
  }
  if (!anyTrendingEnabled) return;

  try {
    const trending = await fetchTrendingTokens();
    let fed = 0;

    for (const token of trending) {
      // Skip already-evaluated mints (avoid re-evaluating same token every cycle)
      if (evaluatedTrendingMints.has(token.mint)) continue;
      evaluatedTrendingMints.add(token.mint);

      // Skip tokens we already hold
      if (activePositions.has(token.mint)) continue;

      // Check against first matching template filters
      for (const [, template] of sniperTemplates) {
        const runtime = getRuntime(template.id);
        if (!runtime.running || !template.enabled || !template.autoBuyTrending) continue;

        // Trending-specific market cap ceiling
        const maxCap = template.maxTrendingMarketCapUsd ?? 500_000;
        if (token.marketCap > maxCap) continue;

        // Minimum momentum filter
        const minMomentum = template.minTrendingMomentumPercent ?? 50;
        if (token.priceChange24h < minMomentum) continue;

        // Minimum liquidity
        if (token.liquidity < template.minLiquidityUsd) continue;

        console.log(
          `[Sniper] Trending candidate: ${token.symbol} mcap=$${token.marketCap.toFixed(0)} +${token.priceChange24h.toFixed(0)}% 24h liq=$${token.liquidity.toFixed(0)}`,
        );

        onNewTokenDetected({
          mint: token.mint,
          symbol: token.symbol,
          name: token.name,
          usdMarketCap: token.marketCap,
          source: 'trending',
        });

        fed++;
        break; // Only feed to first matching template
      }
    }

    if (fed > 0) {
      console.log(`[Sniper] Fed ${fed} trending tokens to sniper engine`);
    }

    // Cap the evaluated set to prevent memory growth
    if (evaluatedTrendingMints.size > 2000) {
      const arr = [...evaluatedTrendingMints];
      evaluatedTrendingMints.clear();
      for (const mint of arr.slice(arr.length - 1000)) {
        evaluatedTrendingMints.add(mint);
      }
    }
  } catch (err) {
    console.error('[Sniper] Trending poll error:', err instanceof Error ? err.message : err);
  }
}

// ── Template CRUD helpers ──────────────────────────────────────────────

function createTemplate(
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

function deleteTemplate(id: string): boolean {
  if (id === DEFAULT_TEMPLATE_ID) return false;

  sniperTemplates.delete(id);
  templateRuntime.delete(id);
  positionsMap.delete(id);
  syncActivePositionsMap();
  return true;
}

// ── Routes: Template Management ─────────────────────────────────────────

// GET /sniper/templates -- List all templates with stats
sniperRouter.get('/sniper/templates', (_req, res) => {
  const templates = [...sniperTemplates.values()].map(template => {
    const runtime = getRuntime(template.id);
    const positions = getTemplatePositions(template.id);
    resetDailyBudgetIfNeeded(runtime);

    return {
      ...template,
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

  stopPositionCheckIfIdle();

  const positions = getTemplatePositions(id);

  res.json({
    message: `Template "${template.name}" stopped`,
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
    return {
      ...pos,
      buyCostSol: costSol,
      costUsd: costSol * cachedSolPriceUsd,
      valueUsd: pos.currentPrice * pos.amountTokens,
      unrealizedPnlUsd: pos.amountTokens * (pos.currentPrice - pos.buyPrice),
    };
  });

  const totalInvestedSol = openPositionsWithUsd.reduce((sum, p) => sum + p.buyCostSol, 0);
  const totalInvestedUsd = totalInvestedSol * cachedSolPriceUsd;

  res.json({
    // Legacy fields (from default template)
    running: defaultRuntime.running,
    startedAt: defaultRuntime.startedAt?.toISOString() ?? null,
    dailySpentSol: defaultRuntime.dailySpentSol,
    dailyBudgetSol: defaultTemplate?.dailyBudgetSol ?? 0,
    dailyRemainingSol: Math.max(
      0,
      (defaultTemplate?.dailyBudgetSol ?? 0) - defaultRuntime.dailySpentSol,
    ),
    openPositions: openPositionsWithUsd,
    totalInvestedSol,
    totalInvestedUsd,
    totalExecutions: executionHistory.length,
    recentExecutions: executionHistory.slice(0, 10),
    // New template fields
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

// Cleanup
process.on('SIGINT', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
process.on('SIGTERM', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
