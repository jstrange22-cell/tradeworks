/**
 * Wallet Discovery Agent — Always-On Profitable Trader Finder
 *
 * A dedicated discovery agent that continuously scans pump.fun activity
 * to find wallets that consistently buy tokens that survive. Wallets
 * that prove profitable get auto-promoted to the whale copy registry.
 *
 * Data Sources:
 *   1. Helius Enhanced API — polls bonding curve SWAP transactions every 60s
 *   2. Pump.fun Graduation API — checks recently graduated tokens every 5min
 *   3. DexScreener — verifies token survival for outcome tracking
 *
 * Bot Filtering:
 *   - >30 buys/hour = bot (velocity filter)
 *   - >20 unique tokens/hour = spray-and-pray bot
 *   - Known program addresses ignored
 *
 * Auto-Promotion:
 *   - >= 5 tracked buys with resolved outcomes
 *   - >= 40% win rate (token survived with liquidity)
 *   - Active in last 24 hours
 *   → Added to whale copy registry via addWhale()
 */

import { logger } from '../../lib/logger.js';
import { addWhale, getWhaleRegistry, persistWhaleRegistry, type TrackedWhale } from './copy-trade.js';

// ── Types ────────────────────────────────────────────────────────────────

interface WalletBuyRecord {
  mint: string;
  buyTimestamp: number;
  solSpent: number;
  outcome: 'win' | 'loss' | 'pending';
  outcomeCheckedAt?: number;
}

interface TrackedTrader {
  address: string;
  buys: WalletBuyRecord[];
  wins: number;
  losses: number;
  lastBuyTimestamp: number;
  promotedToWhale: boolean;
  /** Timestamps of buys in the current rolling hour — for velocity detection */
  recentBuyTimestamps: number[];
  /** Unique mints bought in the current rolling hour — for spray detection */
  recentMints: Set<string>;
}

/** Shape returned by Helius Enhanced Transactions API */
interface HeliusEnhancedTx {
  signature: string;
  type: string;
  timestamp: number;
  feePayer: string;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  source: string;
  description: string;
}

/** Shape returned by pump.fun currently-live API */
interface PumpFunCoin {
  mint: string;
  symbol: string;
  name: string;
  complete: boolean;
  created_timestamp: number;
  usd_market_cap?: number;
}

/** Shape returned by DexScreener token API */
interface DexScreenerResponse {
  pairs?: Array<{
    priceUsd?: string;
    liquidity?: { usd?: number };
    pairAddress?: string;
  }>;
}

// ── Configuration ────────────────────────────────────────────────────────

const HELIUS_API_KEY = process.env.HELIUS_API_KEY
  ?? process.env.SOLANA_RPC_URL?.match(/api-key=([^&]+)/)?.[1]
  ?? '';

const PUMP_BONDING_CURVE = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/** Max wallets in the tracker — evict oldest inactive when exceeded */
const MAX_TRACKED_WALLETS = 1_000;
/** Max buy records kept per wallet (rolling window) */
const MAX_BUYS_PER_WALLET = 30;
/** Minimum SOL spent to count as a real buy */
const MIN_BUY_SOL = 0.05;

// Bot detection thresholds
const BOT_BUYS_PER_HOUR = 30;
const BOT_UNIQUE_TOKENS_PER_HOUR = 20;

// Promotion thresholds
const PROMOTION_MIN_RESOLVED = 5;
const PROMOTION_MIN_WIN_RATE = 0.40;
const PROMOTION_ACTIVE_HOURS = 24;

// Outcome checking
const OUTCOME_CHECK_DELAY_MS = 10 * 60_000; // 10 minutes after buy
const MIN_LIQUIDITY_USD = 500;

// Rate limits / intervals — tuned to stay within Helius 500K daily credit budget
const BROAD_SCAN_INTERVAL_MS = 300_000;      // 5 minutes (was 60s — reduces 1,440 calls/day → 288)
const GRADUATION_CHECK_INTERVAL_MS = 600_000; // 10 minutes (was 5min)
const OUTCOME_CHECK_INTERVAL_MS = 300_000;    // 5 minutes (was 2min — reduces DexScreener calls too)
const BROAD_SCAN_BACKOFF_MS = 900_000;        // 15 minutes — used after consecutive failures
const BROAD_SCAN_MAX_FAILURES = 5;            // consecutive failures before backing off
const DEXSCREENER_DELAY_MS = 500;             // 500ms between calls (max 5/min ≈ 12s/5 = 2.4s, this is even more conservative)

// Known program addresses to ignore (not real traders)
const IGNORE_WALLETS = new Set([
  PUMP_BONDING_CURVE,
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg', // pump.fun migration wallet
  'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM',  // Raydium LP
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium LP V4
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter V6
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  'So11111111111111111111111111111111111111112',     // Wrapped SOL
  '11111111111111111111111111111111',                // System Program
  'ComputeBudget111111111111111111111111111111',     // Compute Budget
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // Associated Token Program
]);

// ── State ────────────────────────────────────────────────────────────────

const traderMap = new Map<string, TrackedTrader>();

/** Set of signatures already processed — prevent double-counting from overlapping polls */
const processedSignatures = new Set<string>();
const MAX_PROCESSED_SIGS = 5_000;

/** Timers for the three scan loops */
let broadScanTimer: ReturnType<typeof setInterval> | null = null;
let graduationTimer: ReturnType<typeof setInterval> | null = null;
let outcomeTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Consecutive Helius broad scan failure counter for adaptive backoff */
let broadScanConsecutiveFailures = 0;
let broadScanBackedOff = false;

// ── Utility ──────────────────────────────────────────────────────────────

function pruneProcessedSignatures(): void {
  if (processedSignatures.size > MAX_PROCESSED_SIGS) {
    // Keep the most recent half
    const arr = [...processedSignatures];
    const toRemove = arr.slice(0, arr.length - MAX_PROCESSED_SIGS / 2);
    for (const sig of toRemove) processedSignatures.delete(sig);
  }
}

/** Purge stale velocity data older than 1 hour from a trader */
function pruneVelocityData(trader: TrackedTrader, now: number): void {
  const oneHourAgo = now - 3_600_000;
  trader.recentBuyTimestamps = trader.recentBuyTimestamps.filter(t => t > oneHourAgo);
  // For mints, we rebuild from recentBuyTimestamps-aligned buy records
  // But since we track per-buy, just clear if all timestamps are old
  if (trader.recentBuyTimestamps.length === 0) {
    trader.recentMints.clear();
  }
}

/** Check if a wallet looks like a bot based on recent activity */
function isBot(trader: TrackedTrader, now: number): boolean {
  pruneVelocityData(trader, now);
  if (trader.recentBuyTimestamps.length > BOT_BUYS_PER_HOUR) return true;
  if (trader.recentMints.size > BOT_UNIQUE_TOKENS_PER_HOUR) return true;
  return false;
}

/** Evict the oldest inactive trader to make room */
function evictOldest(): void {
  let oldestKey: string | undefined;
  let oldestTs = Infinity;
  for (const [addr, t] of traderMap) {
    if (t.promotedToWhale) continue;
    if (t.lastBuyTimestamp < oldestTs) {
      oldestTs = t.lastBuyTimestamp;
      oldestKey = addr;
    }
  }
  if (oldestKey) {
    traderMap.delete(oldestKey);
  }
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Core: Record a buy ───────────────────────────────────────────────────

/**
 * Record a single wallet buy event. Called from the broad scan, graduation
 * tracking, or externally from the pump.fun WebSocket feed.
 *
 * Returns false if the buy was filtered (bot, dust, ignored wallet).
 */
export function recordWalletBuy(
  walletAddress: string,
  mint: string,
  _symbol: string,
  solSpent: number,
  _tokensReceived: number,
): boolean {
  if (solSpent < MIN_BUY_SOL) return false;
  if (IGNORE_WALLETS.has(walletAddress)) return false;
  if (getWhaleRegistry().has(walletAddress)) return false;

  const now = Date.now();

  let trader = traderMap.get(walletAddress);
  if (!trader) {
    if (traderMap.size >= MAX_TRACKED_WALLETS) {
      evictOldest();
    }
    trader = {
      address: walletAddress,
      buys: [],
      wins: 0,
      losses: 0,
      lastBuyTimestamp: now,
      promotedToWhale: false,
      recentBuyTimestamps: [],
      recentMints: new Set(),
    };
    traderMap.set(walletAddress, trader);
  }

  // Update velocity tracking
  trader.recentBuyTimestamps.push(now);
  trader.recentMints.add(mint);

  // Bot check AFTER updating velocity (so we catch the pattern)
  if (isBot(trader, now)) {
    // Remove from tracking entirely — bots waste memory
    traderMap.delete(walletAddress);
    return false;
  }

  // Dedupe: don't track the same mint twice for the same wallet within 60s
  const recentDupe = trader.buys.find(
    b => b.mint === mint && now - b.buyTimestamp < 60_000,
  );
  if (recentDupe) return false;

  const record: WalletBuyRecord = {
    mint,
    buyTimestamp: now,
    solSpent,
    outcome: 'pending',
  };

  trader.buys.push(record);
  trader.lastBuyTimestamp = now;

  // Rolling window
  if (trader.buys.length > MAX_BUYS_PER_WALLET) {
    trader.buys.shift();
  }

  logger.info(
    {
      wallet: walletAddress.slice(0, 12),
      mint: mint.slice(0, 12),
      sol: solSpent.toFixed(3),
      tracked: traderMap.size,
    },
    `[Discovery] Buy tracked: ${walletAddress.slice(0, 12)}... → ${mint.slice(0, 12)}... (${solSpent.toFixed(3)} SOL)`,
  );

  return true;
}

// ── Scan 1: Broad Helius Bonding Curve Poll ──────────────────────────────

async function broadScan(): Promise<void> {
  if (!HELIUS_API_KEY) return;

  try {
    const url = `https://api.helius.xyz/v0/addresses/${PUMP_BONDING_CURVE}/transactions?api-key=${HELIUS_API_KEY}&limit=50&type=SWAP`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!res.ok) {
      broadScanConsecutiveFailures++;
      logger.warn(
        { status: res.status, failures: broadScanConsecutiveFailures },
        '[Discovery] Helius broad scan failed',
      );

      // After consecutive failures, back off to 15-minute interval to conserve credits
      if (broadScanConsecutiveFailures >= BROAD_SCAN_MAX_FAILURES && !broadScanBackedOff) {
        broadScanBackedOff = true;
        if (broadScanTimer) {
          clearInterval(broadScanTimer);
          broadScanTimer = setInterval(() => {
            broadScan().catch(() => {});
          }, BROAD_SCAN_BACKOFF_MS);
        }
        logger.warn(
          { intervalMs: BROAD_SCAN_BACKOFF_MS, failures: broadScanConsecutiveFailures },
          '[Discovery] Helius broad scan backed off to 15min interval after consecutive failures — likely rate limited or credit exhausted',
        );
      }
      return;
    }

    // Success — reset failure counter and restore normal interval if backed off
    if (broadScanConsecutiveFailures > 0) {
      logger.info(
        { previousFailures: broadScanConsecutiveFailures },
        '[Discovery] Helius broad scan recovered',
      );
    }
    broadScanConsecutiveFailures = 0;

    if (broadScanBackedOff) {
      broadScanBackedOff = false;
      if (broadScanTimer) {
        clearInterval(broadScanTimer);
        broadScanTimer = setInterval(() => {
          broadScan().catch(() => {});
        }, BROAD_SCAN_INTERVAL_MS);
      }
      logger.info(
        { intervalMs: BROAD_SCAN_INTERVAL_MS },
        '[Discovery] Helius broad scan restored to normal interval',
      );
    }

    const txns = (await res.json()) as HeliusEnhancedTx[];
    let newBuys = 0;

    for (const tx of txns) {
      // Skip already-processed transactions
      if (processedSignatures.has(tx.signature)) continue;
      processedSignatures.add(tx.signature);

      // Skip transactions older than 5 minutes (stale data)
      const ageMs = Date.now() - tx.timestamp * 1000;
      if (ageMs > 300_000) continue;

      // The buyer is the feePayer who sent SOL into the bonding curve.
      // In a pump.fun buy, the feePayer sends SOL and receives tokens.
      const buyer = tx.feePayer;
      if (!buyer || IGNORE_WALLETS.has(buyer)) continue;

      // Find the token mint from tokenTransfers where the buyer received tokens
      const tokenReceived = tx.tokenTransfers?.find(
        t => t.toUserAccount === buyer && t.tokenAmount > 0,
      );
      if (!tokenReceived) continue;

      // Calculate SOL spent from native transfers (buyer sends SOL)
      const solSpent = (tx.nativeTransfers ?? [])
        .filter(t => t.fromUserAccount === buyer)
        .reduce((sum, t) => sum + t.amount, 0) / 1e9;

      if (solSpent < MIN_BUY_SOL) continue;

      const recorded = recordWalletBuy(
        buyer,
        tokenReceived.mint,
        '', // symbol unknown from Helius
        solSpent,
        tokenReceived.tokenAmount,
      );
      if (recorded) newBuys++;
    }

    pruneProcessedSignatures();

    if (newBuys > 0) {
      logger.info(
        { newBuys, totalTxns: txns.length, tracked: traderMap.size },
        `[Discovery] Broad scan: ${newBuys} new buys from ${txns.length} transactions`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('aborted') && !msg.includes('timeout')) {
      broadScanConsecutiveFailures++;
      logger.warn({ err: msg, failures: broadScanConsecutiveFailures }, '[Discovery] Broad scan error');

      if (broadScanConsecutiveFailures >= BROAD_SCAN_MAX_FAILURES && !broadScanBackedOff) {
        broadScanBackedOff = true;
        if (broadScanTimer) {
          clearInterval(broadScanTimer);
          broadScanTimer = setInterval(() => {
            broadScan().catch(() => {});
          }, BROAD_SCAN_BACKOFF_MS);
        }
        logger.warn(
          { intervalMs: BROAD_SCAN_BACKOFF_MS, failures: broadScanConsecutiveFailures },
          '[Discovery] Helius broad scan backed off to 15min interval after consecutive errors',
        );
      }
    }
  }
}

// ── Scan 2: Graduation Winner Tracking ───────────────────────────────────

async function graduationScan(): Promise<void> {
  if (!HELIUS_API_KEY) return;

  try {
    // Fetch recently graduated tokens from pump.fun
    const pumpRes = await fetch(
      'https://frontend-api-v3.pump.fun/coins/currently-live?limit=50&offset=0&includeNsfw=false',
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!pumpRes.ok) {
      logger.warn({ status: pumpRes.status }, '[Discovery] Pump.fun graduation fetch failed');
      return;
    }

    const coins = (await pumpRes.json()) as PumpFunCoin[];
    const graduated = coins.filter(c => c.complete === true);

    if (graduated.length === 0) return;

    logger.info(
      { graduated: graduated.length, total: coins.length },
      `[Discovery] Found ${graduated.length} graduated tokens`,
    );

    // For each graduated token, check who bought it early via Helius
    // Rate limit: process max 3 per cycle to stay within Helius limits
    const toCheck = graduated.slice(0, 3);

    for (const coin of toCheck) {
      try {
        // Get early transactions for this token's mint via Helius
        const txUrl = `https://api.helius.xyz/v0/addresses/${coin.mint}/transactions?api-key=${HELIUS_API_KEY}&limit=20&type=SWAP`;
        const txRes = await fetch(txUrl, { signal: AbortSignal.timeout(10_000) });

        if (!txRes.ok) continue;

        const txns = (await txRes.json()) as HeliusEnhancedTx[];

        for (const tx of txns) {
          if (processedSignatures.has(tx.signature)) continue;
          processedSignatures.add(tx.signature);

          const buyer = tx.feePayer;
          if (!buyer || IGNORE_WALLETS.has(buyer)) continue;

          const tokenReceived = tx.tokenTransfers?.find(
            t => t.toUserAccount === buyer && t.tokenAmount > 0,
          );
          if (!tokenReceived) continue;

          const solSpent = (tx.nativeTransfers ?? [])
            .filter(t => t.fromUserAccount === buyer)
            .reduce((sum, t) => sum + t.amount, 0) / 1e9;

          if (solSpent < MIN_BUY_SOL) continue;

          recordWalletBuy(buyer, coin.mint, coin.symbol, solSpent, tokenReceived.tokenAmount);
        }

        // Small delay between Helius calls for graduated tokens
        await sleep(1_000);
      } catch {
        // Skip this coin, try the next
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('aborted') && !msg.includes('timeout')) {
      logger.warn({ err: msg }, '[Discovery] Graduation scan error');
    }
  }
}

// ── Scan 3: Outcome Checking via DexScreener ─────────────────────────────

async function checkOutcomes(): Promise<void> {
  const now = Date.now();
  let checked = 0;
  let promoted = 0;
  let dexCalls = 0;
  const MAX_DEX_CALLS_PER_CYCLE = 5;

  for (const [, trader] of traderMap) {
    if (trader.promotedToWhale) continue;
    if (dexCalls >= MAX_DEX_CALLS_PER_CYCLE) break;

    for (const buy of trader.buys) {
      if (buy.outcome !== 'pending') continue;
      if (now - buy.buyTimestamp < OUTCOME_CHECK_DELAY_MS) continue;
      if (dexCalls >= MAX_DEX_CALLS_PER_CYCLE) break;

      try {
        const res = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${buy.mint}`,
          { signal: AbortSignal.timeout(5_000) },
        );

        dexCalls++;

        if (!res.ok) continue;

        const data = (await res.json()) as DexScreenerResponse;
        const pair = data.pairs?.[0];

        if (!pair?.liquidity?.usd || pair.liquidity.usd < MIN_LIQUIDITY_USD) {
          // No pair, no liquidity, or liquidity too low — token is dead
          buy.outcome = 'loss';
          trader.losses++;
        } else {
          // Token has meaningful liquidity 10+ minutes after buy — survived
          buy.outcome = 'win';
          trader.wins++;
        }

        buy.outcomeCheckedAt = now;
        checked++;
      } catch {
        // Will retry next cycle
      }

      await sleep(DEXSCREENER_DELAY_MS);
    }

    // Check for promotion after resolving outcomes
    if (!trader.promotedToWhale) {
      const resolved = trader.wins + trader.losses;
      if (resolved >= PROMOTION_MIN_RESOLVED) {
        const winRate = trader.wins / resolved;
        const activeRecently = now - trader.lastBuyTimestamp < PROMOTION_ACTIVE_HOURS * 3_600_000;

        if (winRate >= PROMOTION_MIN_WIN_RATE && activeRecently) {
          const whale: TrackedWhale = {
            address: trader.address,
            label: `Discovered (${(winRate * 100).toFixed(0)}% WR, ${resolved} trades)`,
            winRate: Math.round(winRate * 100),
            avgRoiPercent: 0, // Unknown — we track survival, not exact ROI
            totalTrades90d: resolved,
            portfolioValueUsd: 0,
            addedAt: new Date().toISOString(),
            source: 'dexscreener',
          };

          addWhale(whale);
          persistWhaleRegistry();
          trader.promotedToWhale = true;
          promoted++;

          logger.info(
            {
              address: trader.address.slice(0, 12),
              winRate: (winRate * 100).toFixed(0),
              wins: trader.wins,
              losses: trader.losses,
              resolved,
            },
            `[Discovery] PROMOTED: ${trader.address.slice(0, 12)}... → whale registry (${(winRate * 100).toFixed(0)}% WR, ${resolved} resolved)`,
          );
        }
      }
    }
  }

  if (checked > 0 || promoted > 0) {
    logger.info(
      { checked, promoted, tracked: traderMap.size },
      `[Discovery] Outcome check: ${checked} resolved, ${promoted} promoted`,
    );
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────

export function startWalletDiscovery(): void {
  if (running) {
    logger.warn('[Discovery] Already running');
    return;
  }

  running = true;

  if (!HELIUS_API_KEY) {
    logger.warn('[Discovery] No Helius API key found — broad scan and graduation scan disabled. Only manual recordWalletBuy() will work.');
  } else {
    logger.info('[Discovery] Starting wallet discovery agent');

    // Scan 1: Broad bonding curve poll — every 60 seconds
    // Run first scan after a short delay to let the server finish startup
    setTimeout(() => {
      if (!running) return;
      broadScan().catch(() => {});
    }, 5_000);
    broadScanTimer = setInterval(() => {
      broadScan().catch(() => {});
    }, BROAD_SCAN_INTERVAL_MS);

    // Scan 2: Graduation winner tracking — every 5 minutes
    setTimeout(() => {
      if (!running) return;
      graduationScan().catch(() => {});
    }, 30_000); // First run after 30s
    graduationTimer = setInterval(() => {
      graduationScan().catch(() => {});
    }, GRADUATION_CHECK_INTERVAL_MS);
  }

  // Scan 3: Outcome checking — every 2 minutes (works even without Helius,
  // since buys can come from external recordWalletBuy calls)
  outcomeTimer = setInterval(() => {
    checkOutcomes().catch(() => {});
  }, OUTCOME_CHECK_INTERVAL_MS);

  logger.info(
    {
      helius: !!HELIUS_API_KEY,
      broadScanMs: BROAD_SCAN_INTERVAL_MS,
      graduationMs: GRADUATION_CHECK_INTERVAL_MS,
      outcomeMs: OUTCOME_CHECK_INTERVAL_MS,
      maxWallets: MAX_TRACKED_WALLETS,
      maxBuysPerWallet: MAX_BUYS_PER_WALLET,
      botThreshold: BOT_BUYS_PER_HOUR,
      promotionWinRate: `${PROMOTION_MIN_WIN_RATE * 100}%`,
    },
    '[Discovery] Wallet discovery agent started',
  );
}

export function stopWalletDiscovery(): void {
  running = false;

  if (broadScanTimer) {
    clearInterval(broadScanTimer);
    broadScanTimer = null;
  }
  if (graduationTimer) {
    clearInterval(graduationTimer);
    graduationTimer = null;
  }
  if (outcomeTimer) {
    clearInterval(outcomeTimer);
    outcomeTimer = null;
  }

  broadScanConsecutiveFailures = 0;
  broadScanBackedOff = false;

  logger.info({ tracked: traderMap.size }, '[Discovery] Wallet discovery agent stopped');
}

export function getDiscoveryStats(): {
  trackedWallets: number;
  totalBuysTracked: number;
  promotedCount: number;
  pendingOutcomes: number;
  totalWins: number;
  totalLosses: number;
  running: boolean;
  heliusEnabled: boolean;
} {
  let totalBuys = 0;
  let promotedCount = 0;
  let pendingOutcomes = 0;
  let totalWins = 0;
  let totalLosses = 0;

  for (const [, trader] of traderMap) {
    totalBuys += trader.buys.length;
    if (trader.promotedToWhale) promotedCount++;
    totalWins += trader.wins;
    totalLosses += trader.losses;
    for (const buy of trader.buys) {
      if (buy.outcome === 'pending') pendingOutcomes++;
    }
  }

  return {
    trackedWallets: traderMap.size,
    totalBuysTracked: totalBuys,
    promotedCount,
    pendingOutcomes,
    totalWins,
    totalLosses,
    running,
    heliusEnabled: !!HELIUS_API_KEY,
  };
}
