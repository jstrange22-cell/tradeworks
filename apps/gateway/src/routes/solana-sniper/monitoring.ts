/**
 * Solana Sniper Engine — Monitoring Module
 *
 * Extracted from the monolithic solana-sniper.ts. Contains:
 * - Real-time trade event handler (position P&L updates)
 * - Position monitoring loop (price fetching, TP/SL/trailing/tiered exits)
 * - Sell retry queue processing
 * - Auto-snipe hook (new token detection → template evaluation → buy)
 * - Trending token polling
 * - Momentum gate functions (RugCheck, spam filter, pending token evaluation)
 * - Unknown position resolution (Helius/DexScreener/PumpFun metadata)
 * - Wallet sync (recover positions from on-chain data)
 * - Auto-start initialization
 */

import { PublicKey } from '@solana/web3.js';
import type { ParsedAccountData } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { broadcast } from '../../websocket/server.js';
import {
  isSolanaConnected,
  getSolanaKeypair,
  getSolanaConnection,
  getSecondaryConnection,
  getSolanaRpcUrl,
  withRpcRetry,
} from '../solana-utils.js';
import { getMoonshotScore } from '../solana-moonshot.js';
import { fetchTrendingTokens } from '../solana-scanner.js';
import {
  subscribeTokenTrades,
  unsubscribeTokenTrades,
  onTradeEvent,
  type PumpPortalTradeEvent,
} from '../solana-pumpfun.js';

import type {
  ActivePosition,
  PendingToken,
  DexscreenerPair,
  DexscreenerTokenResponse,
  JupiterPriceResponse,
} from './types.js';

import {
  sniperTemplates,
  positionsMap,
  activePositions,
  executionHistory,
  pendingBuys,
  pendingSells,
  failedSellQueue,
  permanentlyFailedSells,
  pendingTokens,
  MAX_PENDING_TOKENS,
  lastBuyTimestamp,
  recentCreators,
  getRuntime,
  getTemplatePositions,
  syncActivePositionsMap,
  ensurePositionCheckRunning,
  isProtectedMint,
  refreshCachedSolBalance,
  cachedSolPriceUsd,
  persistPositions,
  DEFAULT_CONFIG_FIELDS,
  trendingPollInterval,
  setTrendingPollInterval,
  pumpFeedPaused,
  setPumpFeedPaused,
  pumpFeedPausedAt,
  isPendingSell,
  cachedSolBalanceLamports,
  SOL_BALANCE_CACHE_TTL_MS,
  MAX_SELL_RETRIES,
  SELL_RETRY_DELAY_MS,
  DEFAULT_TEMPLATE_ID,
} from './state.js';

import {
  executeBuySnipe,
  executeSellSnipe,
  autoClosePosition,
  LAMPORTS_PER_SOL,
} from './execution.js';

// ── Momentum Confirmation Gate (Phase 1) ──────────────────────────────

/** Fetch RugCheck report for a token (Phase 4) */
export async function fetchRugCheck(mint: string, timeoutMs: number): Promise<{ score: number; topHolderPct: number; bundleDetected: boolean } | null> {
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
export function isSpamTokenName(name: string, symbol: string): boolean {
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
export function evaluatePendingToken(pending: PendingToken): void {
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
export function handlePendingTokenTradeEvent(event: PumpPortalTradeEvent): void {
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

// ── UNKNOWN Token Name Resolution ───────────────────────────────────

/**
 * Resolve UNKNOWN symbol/name for positions loaded from persistence.
 * Tries: Helius DAS batch → DexScreener → PumpFun API.
 * Called on startup and periodically every 5 minutes.
 */
export async function resolveUnknownPositions(): Promise<void> {
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
export function applyResolvedMetadata(
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

// ── Real-Time Trade Event Handler ────────────────────────────────────

/**
 * Called on every trade event from PumpPortal WebSocket for tokens we hold.
 * Updates position prices in real-time and triggers TP/SL immediately.
 * This is the PRIMARY price source for bonding curve tokens (replaces polling).
 */
export function handlePositionTradeEvent(event: PumpPortalTradeEvent): void {
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

// ── Price Fetching ────────────────────────────────────────────────────

/**
 * Fetch the current USD price of a token from multiple sources.
 * Tries DexScreener → Jupiter → PumpFun API, returns 0 if all fail.
 */
export async function fetchTokenPrice(mint: string): Promise<number> {
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
export async function fetchHeliusBatchPrices(mints: string[]): Promise<Record<string, { price: number; symbol?: string; name?: string }>> {
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

// ── Position Monitoring Loop ──────────────────────────────────────────

export async function checkPositions(): Promise<void> {
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

// ── Sell Retry Queue ──────────────────────────────────────────────────

/** Process queued failed sells, retrying after SELL_RETRY_DELAY_MS */
export async function processSellRetryQueue(): Promise<void> {
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
        setPumpFeedPaused(true);
        console.log(
          `[Sniper] ⏸️ Pausing auto-buy — wallet depleted (${(cachedSolBalanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL < ${(minBuyLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL needed)`,
        );
      }
      return;
    }
    // Resume if balance recovered
    if (pumpFeedPaused) {
      setPumpFeedPaused(false);
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
export const evaluatedTrendingMints: Set<string> = new Set();

/**
 * Poll DexScreener trending tokens and feed qualifying ones into the sniper.
 * Runs every 60 seconds when any template has autoBuyTrending enabled.
 */
export async function pollTrendingForSnipe(): Promise<void> {
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

// ── Wallet Sync ───────────────────────────────────────────────────────

/**
 * Read all SPL token holdings from the Solana wallet and populate
 * positions that are missing from in-memory tracking.
 * This runs on startup to recover positions lost on gateway restart.
 */
export async function syncWalletPositions(): Promise<void> {
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

// ── Auto-Start ────────────────────────────────────────────────────────

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
    setTrendingPollInterval(setInterval(() => {
      void pollTrendingForSnipe();
    }, 60_000));
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
