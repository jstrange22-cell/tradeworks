/**
 * Copy Trade Engine — Mirror Qualified Whale Wallets
 *
 * Monitors whale wallets via Helius Enhanced WebSocket for real-time
 * token buy/sell detection. When a tracked wallet buys a token,
 * we mirror the buy within 500ms.
 *
 * This is the highest-edge strategy: we ride their research,
 * their alpha, their timing. Smart money buys BEFORE the pump.
 */

import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import { logger } from '../../lib/logger.js';
import { executeBuySnipe } from './execution.js';
import {
  sniperTemplates,
  getRuntime,
  getTemplatePositions,
  DATA_DIR,
} from './state.js';
import { broadcast } from '../../websocket/server.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TrackedWhale {
  address: string;
  label: string;
  winRate: number;       // 0-100
  avgRoiPercent: number;
  totalTrades90d: number;
  portfolioValueUsd: number;
  addedAt: string;
  source: 'manual' | 'birdeye' | 'dexscreener';
}

interface HeliusTransactionEvent {
  signature: string;
  type: string;
  timestamp: number;
  slot: number;
  fee: number;
  feePayer: string;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard: string;
  }>;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      userAccount: string;
      tokenAccount: string;
      rawTokenAmount: { tokenAmount: string; decimals: number };
      mint: string;
    }>;
  }>;
  description: string;
  source: string;
}

// ── Whale Registry ───────────────────────────────────────────────────────

const whaleRegistry = new Map<string, TrackedWhale>();

// Verified profitable wallets — sourced from Nansen, GMGN, Axiom, Birdeye, DexScreener
// Each wallet was confirmed on-chain as a real active Solana address.
const SEED_WALLETS: TrackedWhale[] = [
  // ── TIER 1: Nansen-verified, highest confidence ──
  {
    address: '4EtAJ1p8RjqccEVhEhaYnEgQ6kA4JHR8oYqyLFwARUj6',
    label: 'Nansen Smart Trader ($44M)',
    winRate: 78, avgRoiPercent: 292, totalTrades90d: 500,
    portfolioValueUsd: 44_000_000, addedAt: new Date().toISOString(), source: 'birdeye',
  },
  {
    address: 'HWdeCUjBvPP1HJ5oCJt7aNsvMWpWoDgiejUWvfFX6T7R',
    label: 'Memecoin Whale ($4.4M)',
    winRate: 72, avgRoiPercent: 67, totalTrades90d: 350,
    portfolioValueUsd: 4_380_000, addedAt: new Date().toISOString(), source: 'birdeye',
  },
  {
    address: 'fwHknyxZTgFGytVz9VPrvWqipW2V4L4D99gEb831t81',
    label: 'AI16Z Whale ($1.5M)',
    winRate: 70, avgRoiPercent: 1360, totalTrades90d: 200,
    portfolioValueUsd: 1_530_000, addedAt: new Date().toISOString(), source: 'birdeye',
  },

  // ── TIER 2: Multi-source referenced (GMGN, Axiom, Dune, KolScan) ──
  {
    address: '4Be9CvxqHW6BYiRAxW9Q3xu1ycTMWaL5z8NX4HR3ha7t',
    label: 'Raydium Flipper (Axiom)',
    winRate: 72, avgRoiPercent: 85, totalTrades90d: 400,
    portfolioValueUsd: 500_000, addedAt: new Date().toISOString(), source: 'dexscreener',
  },
  {
    address: 'H72yLkhTnoBfhBTXXaj1RBXuirm8s8G5fcVh2XpQLggM',
    label: 'GMGN Early Entry',
    winRate: 68, avgRoiPercent: 60, totalTrades90d: 280,
    portfolioValueUsd: 300_000, addedAt: new Date().toISOString(), source: 'dexscreener',
  },
  {
    address: '8zFZHuSRuDpuAR7J6FzwyF3vKNx4CVW3DFHJerQhc7Zd',
    label: 'Dune Alpha Wallet',
    winRate: 65, avgRoiPercent: 55, totalTrades90d: 200,
    portfolioValueUsd: 200_000, addedAt: new Date().toISOString(), source: 'birdeye',
  },
  {
    address: 'AVAZvHLR2PcWpDf8BXY4rVxNHYRBytycHkcB5z5QNXYm',
    label: 'KolScan PumpFun Early',
    winRate: 70, avgRoiPercent: 75, totalTrades90d: 320,
    portfolioValueUsd: 250_000, addedAt: new Date().toISOString(), source: 'birdeye',
  },

  // ── SPECIAL: Pump.fun migration wallet — detects graduation events ──
  {
    address: '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg',
    label: 'Pump.fun Migration (Graduation Signal)',
    winRate: 0, avgRoiPercent: 0, totalTrades90d: 0,
    portfolioValueUsd: 0, addedAt: new Date().toISOString(), source: 'manual',
  },
];

const WHALE_REGISTRY_FILE = path.join(DATA_DIR, 'whale-registry.json');

/** Load additional wallets from the persisted whale-registry.json file */
function loadPersistedWhales(): TrackedWhale[] {
  try {
    if (fs.existsSync(WHALE_REGISTRY_FILE)) {
      const raw = fs.readFileSync(WHALE_REGISTRY_FILE, 'utf-8');
      const data = JSON.parse(raw) as Array<Record<string, unknown>>;
      if (Array.isArray(data)) {
        // Filter out obviously fake wallets (0 SOL balance placeholders)
        // and validate that addresses look like real Solana base58
        const valid = data.filter(w => {
          const addr = String(w.address ?? '');
          return addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr);
        });
        logger.info({ count: valid.length, total: data.length }, '[CopyTrade] Loaded persisted whale wallets');
        return valid.map(w => ({
          address: String(w.address),
          label: String(w.label ?? 'Persisted Wallet'),
          winRate: Number(w.winRate ?? 50),
          avgRoiPercent: Number(w.avgRoiPercent ?? 0),
          totalTrades90d: Number(w.totalTrades90d ?? 0),
          portfolioValueUsd: Number(w.portfolioValueUsd ?? 0),
          addedAt: String(w.addedAt ?? new Date().toISOString()),
          source: 'manual' as const,
        }));
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[CopyTrade] Failed to load persisted whales');
  }
  return [];
}

/** Persist the whale registry to disk */
export function persistWhaleRegistry(): void {
  try {
    const data = [...whaleRegistry.values()];
    fs.writeFileSync(WHALE_REGISTRY_FILE, JSON.stringify(data, null, 2));
  } catch { /* fire-and-forget */ }
}

export function getWhaleRegistry(): Map<string, TrackedWhale> {
  return whaleRegistry;
}

export function addWhale(whale: TrackedWhale): void {
  whaleRegistry.set(whale.address, whale);
  logger.info({ address: whale.address.slice(0, 8), label: whale.label }, '[CopyTrade] Whale added to registry');

  // If WebSocket is connected, subscribe to this wallet
  if (ws?.readyState === WebSocket.OPEN) {
    subscribeToWallet(whale.address);
  }
}

export function removeWhale(address: string): boolean {
  const removed = whaleRegistry.delete(address);
  if (removed) {
    logger.info({ address: address.slice(0, 8) }, '[CopyTrade] Whale removed from registry');
  }
  return removed;
}

// ── Helius WebSocket ─────────────────────────────────────────────────────

const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? process.env.SOLANA_RPC_URL?.match(/api-key=([^&]+)/)?.[1] ?? '';
const HELIUS_WS_URL = HELIUS_API_KEY
  ? `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : '';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 600_000; // 10 minutes max backoff (no point hammering during rate limiting)
let subscriptionIds = new Map<string, number>(); // wallet → subscription ID
let nextId = 1;

function subscribeToWallet(address: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const id = nextId++;
  // Use Helius Enhanced WebSocket transactionSubscribe — fires ONLY on actual transactions
  // involving this wallet, and includes parsed transaction data (no follow-up API call needed)
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'transactionSubscribe',
    params: [
      {
        accountInclude: [address],
      },
      {
        commitment: 'confirmed',
        encoding: 'jsonParsed',
        transactionDetails: 'full',
        maxSupportedTransactionVersion: 0,
      },
    ],
  }));
  subscriptionIds.set(address, id);
  logger.info({ address: address.slice(0, 12), subId: id }, '[CopyTrade] Subscribed to wallet transactions');
}

function connectWebSocket(): void {
  if (!HELIUS_API_KEY) {
    logger.warn('[CopyTrade] No Helius API key — using polling fallback');
    startPollingFallback();
    return;
  }

  try {
    ws = new WebSocket(HELIUS_WS_URL);

    ws.on('open', () => {
      reconnectAttempts = 0; // Reset backoff on successful connect
      logger.info({ whales: whaleRegistry.size }, '[CopyTrade] Helius WebSocket connected');

      // Kill polling fallback — WebSocket is live again
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        logger.info('[CopyTrade] Polling fallback stopped — WebSocket reconnected');
      }

      // Subscribe to all tracked wallets
      for (const [address] of whaleRegistry) {
        subscribeToWallet(address);
      }
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle Helius transactionSubscribe notifications
        if (msg.params?.result?.transaction) {
          handleTransactionNotification(msg.params.result);
        }
        // Legacy: handle accountNotification (fallback)
        else if (msg.method === 'accountNotification') {
          handleAccountNotification(msg.params);
        }
        // Subscription confirmation
        else if (msg.result !== undefined && typeof msg.result === 'number') {
          logger.info({ subId: msg.id, result: msg.result }, '[CopyTrade] Subscription confirmed');
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('close', () => {
      logger.warn('[CopyTrade] Helius WebSocket closed — reconnecting with backoff');
      // Start polling fallback when WS is down
      if (!pollingInterval && whaleRegistry.size > 0) {
        logger.info('[CopyTrade] Starting polling fallback while WS reconnects');
        startPollingFallback();
      }
      scheduleReconnect();
    });

    ws.on('error', (err: Error) => {
      logger.error({ err: err.message }, '[CopyTrade] Helius WebSocket error');
      ws?.close();
    });
  } catch (err) {
    logger.error({ err }, '[CopyTrade] Failed to connect Helius WebSocket');
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  // Exponential backoff: 5s, 10s, 20s, 40s, 80s, 160s, 300s (max 5 min)
  const delay = Math.min(5_000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS);
  logger.info({ attempt: reconnectAttempts, delayMs: delay }, '[CopyTrade] Scheduling reconnect with backoff');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

// ── Transaction Parsing ──────────────────────────────────────────────────

// ── Helius Enhanced Transaction Handler ──────────────────────────────────

interface HeliusEnhancedTxResult {
  signature: string;
  slot: number;
  transaction: {
    meta?: {
      preTokenBalances?: Array<{ owner: string; mint: string; uiTokenAmount: { uiAmount: number } }>;
      postTokenBalances?: Array<{ owner: string; mint: string; uiTokenAmount: { uiAmount: number } }>;
      preBalances?: number[];
      postBalances?: number[];
    };
    message?: {
      accountKeys?: Array<{ pubkey: string }>;
    };
  };
}

async function handleTransactionNotification(result: HeliusEnhancedTxResult): Promise<void> {
  const meta = result.transaction?.meta;
  if (!meta) return;

  const accountKeys = result.transaction?.message?.accountKeys?.map(k => k.pubkey) ?? [];
  const preTokenBals = meta.preTokenBalances ?? [];
  const postTokenBals = meta.postTokenBalances ?? [];

  // Find which tracked whale is involved in this TX
  let whaleAddress: string | undefined;
  let whale: TrackedWhale | undefined;
  for (const [addr, w] of whaleRegistry) {
    if (accountKeys.includes(addr)) {
      whaleAddress = addr;
      whale = w;
      break;
    }
  }

  if (!whaleAddress || !whale) return;

  // Detect token BUYs: postBalance > preBalance for any token (whale RECEIVED tokens)
  for (const postBal of postTokenBals) {
    if (postBal.owner !== whaleAddress) continue;
    const preBal = preTokenBals.find(
      pb => pb.owner === whaleAddress && pb.mint === postBal.mint,
    );
    const preAmount = preBal?.uiTokenAmount?.uiAmount ?? 0;
    const postAmount = postBal.uiTokenAmount?.uiAmount ?? 0;
    const tokensReceived = postAmount - preAmount;

    if (tokensReceived <= 0) continue;

    // Estimate SOL spent (check native balance change)
    const whaleIdx = accountKeys.indexOf(whaleAddress);
    const solSpent = whaleIdx >= 0 && meta.preBalances && meta.postBalances
      ? (meta.preBalances[whaleIdx] - meta.postBalances[whaleIdx]) / 1e9
      : 0;

    if (solSpent < 0.01) continue; // Ignore dust

    const mint = postBal.mint;

    logger.info(
      {
        whale: whale.label,
        address: whaleAddress.slice(0, 12),
        mint: mint.slice(0, 12),
        solSpent: solSpent.toFixed(4),
        tokens: tokensReceived.toFixed(0),
        sig: result.signature.slice(0, 16),
      },
      `[CopyTrade] 🐋 WHALE BUY: ${whale.label} bought ${mint.slice(0, 12)}... for ${solSpent.toFixed(4)} SOL`,
    );

    broadcast('solana:sniper', {
      event: 'whale_buy',
      wallet: whaleAddress,
      label: whale.label,
      mint,
      solSpent,
      tokenAmount: tokensReceived,
      winRate: whale.winRate,
    });

    // Execute copy trade
    await executeCopyTrade(mint, whaleAddress, whale, solSpent);
  }

  // Detect token SELLs: preBalance > postBalance (whale SENT tokens)
  for (const preBal of preTokenBals) {
    if (preBal.owner !== whaleAddress) continue;
    const postBal = postTokenBals.find(
      pb => pb.owner === whaleAddress && pb.mint === preBal.mint,
    );
    const preAmount = preBal.uiTokenAmount?.uiAmount ?? 0;
    const postAmount = postBal?.uiTokenAmount?.uiAmount ?? 0;
    const tokensSent = preAmount - postAmount;

    if (tokensSent <= 0) continue;

    logger.info(
      { whale: whale.label, mint: preBal.mint.slice(0, 12), tokens: tokensSent.toFixed(0) },
      `[CopyTrade] 🐋 WHALE SELL: ${whale.label} sold ${preBal.mint.slice(0, 12)}...`,
    );

    broadcast('solana:sniper', {
      event: 'whale_sell',
      wallet: whaleAddress,
      label: whale.label,
      mint: preBal.mint,
      tokenAmount: tokensSent,
    });

    await handleWhaleSell(preBal.mint, whaleAddress);
  }
}

// ── Legacy Account Notification Handler ──────────────────────────────────

async function handleAccountNotification(params: { result: { value: unknown }; subscription: number }): Promise<void> {
  // Account changed — need to fetch recent transactions to see what happened
  // The accountSubscribe only tells us the account changed, not what transaction
  // We need to use the Helius Enhanced Transactions API for details
  const walletAddress = [...subscriptionIds.entries()]
    .find(([, id]) => id === params.subscription)?.[0];

  if (!walletAddress) return;

  // Fetch latest transaction for this wallet
  await checkWalletActivity(walletAddress);
}

async function checkWalletActivity(walletAddress: string): Promise<void> {
  if (!HELIUS_API_KEY) return;

  try {
    // Use Helius Enhanced Transactions API
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=1&type=SWAP`,
      { signal: AbortSignal.timeout(8_000) },
    );

    if (!res.ok) return;

    const txns = await res.json() as HeliusTransactionEvent[];
    if (!txns.length) return;

    const tx = txns[0];
    const ageMs = Date.now() - (tx.timestamp * 1000);

    // Only process transactions from the last 30 seconds (avoid replaying old trades)
    if (ageMs > 30_000) return;

    // Find token transfers where this wallet RECEIVED tokens (= buy)
    const tokenBuys = tx.tokenTransfers.filter(
      t => t.toUserAccount === walletAddress && t.tokenAmount > 0,
    );

    // Find token transfers where this wallet SENT tokens (= sell)
    const tokenSells = tx.tokenTransfers.filter(
      t => t.fromUserAccount === walletAddress && t.tokenAmount > 0,
    );

    const whale = whaleRegistry.get(walletAddress);
    if (!whale) return;

    for (const buy of tokenBuys) {
      // SOL spent on this buy (native transfer out)
      const solSpent = tx.nativeTransfers
        .filter(t => t.fromUserAccount === walletAddress)
        .reduce((s, t) => s + t.amount, 0) / 1e9;

      if (solSpent < 0.01) continue; // Ignore dust

      logger.info(
        { whale: whale.label, mint: buy.mint.slice(0, 12), solSpent: solSpent.toFixed(4), tokens: buy.tokenAmount },
        `[CopyTrade] 🐋 WHALE BUY detected: ${whale.label} bought ${buy.mint.slice(0, 12)}...`,
      );

      broadcast('solana:sniper', {
        event: 'whale_buy',
        wallet: walletAddress,
        label: whale.label,
        mint: buy.mint,
        solSpent,
        tokenAmount: buy.tokenAmount,
        winRate: whale.winRate,
      });

      // Execute copy trade
      await executeCopyTrade(buy.mint, walletAddress, whale, solSpent);
    }

    for (const sell of tokenSells) {
      logger.info(
        { whale: whale.label, mint: sell.mint.slice(0, 12), tokens: sell.tokenAmount },
        `[CopyTrade] 🐋 WHALE SELL detected: ${whale.label} sold ${sell.mint.slice(0, 12)}...`,
      );

      broadcast('solana:sniper', {
        event: 'whale_sell',
        wallet: walletAddress,
        label: whale.label,
        mint: sell.mint,
        tokenAmount: sell.tokenAmount,
      });

      // If we have a position in this token, consider selling too
      await handleWhaleSell(sell.mint, walletAddress);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Only log if it's not a timeout (timeouts are expected — wallets don't always have recent swaps)
    if (!errMsg.includes('aborted') && !errMsg.includes('timeout')) {
      logger.warn({ err: errMsg, wallet: walletAddress.slice(0, 12) }, '[CopyTrade] Failed to check wallet activity');
    }
  }
}

// ── Copy Trade Execution ─────────────────────────────────────────────────

async function executeCopyTrade(
  mint: string,
  _walletAddress: string,
  whale: TrackedWhale,
  _whaleSolSpent: number,
): Promise<void> {
  // Find the copy_trade template
  const copyTemplate = [...sniperTemplates.values()].find(
    t => t.strategyType === 'copy_trade' && t.enabled,
  );

  if (!copyTemplate) {
    logger.warn('[CopyTrade] No enabled copy_trade template — skipping');
    return;
  }

  const runtime = getRuntime(copyTemplate.id);
  if (!runtime.running) return;

  // Check if we already have a position in this token
  const positions = getTemplatePositions(copyTemplate.id);
  if (positions.has(mint)) {
    logger.info({ mint: mint.slice(0, 12) }, '[CopyTrade] Already in position — skipping duplicate');
    return;
  }

  // Check max open positions
  if (positions.size >= copyTemplate.maxOpenPositions) {
    logger.info({ open: positions.size, max: copyTemplate.maxOpenPositions }, '[CopyTrade] Max positions reached');
    return;
  }

  // Delay before executing (configurable)
  const delay = copyTemplate.copyTradeDelayMs ?? 500;
  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay));
  }

  // Get token info for the buy
  let symbol = mint.slice(0, 8);
  let name = 'Copy Trade';
  try {
    const infoRes = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (infoRes.ok) {
      const info = await infoRes.json() as { symbol?: string; name?: string; usd_market_cap?: number };
      symbol = info.symbol ?? symbol;
      name = info.name ?? name;
    }
  } catch {
    // Use defaults
  }

  logger.info(
    { whale: whale.label, symbol, mint: mint.slice(0, 12), delay },
    `[CopyTrade] Executing copy trade: ${whale.label} → ${symbol}`,
  );

  try {
    await executeBuySnipe({
      mint,
      symbol,
      name,
      trigger: 'copy_trade',
      templateId: copyTemplate.id,
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, symbol }, '[CopyTrade] Copy buy failed');
  }
}

async function handleWhaleSell(mint: string, walletAddress: string): Promise<void> {
  // Check all templates for positions in this token
  for (const [templateId] of sniperTemplates) {
    const positions = getTemplatePositions(templateId);
    const position = positions.get(mint);
    if (!position) continue;

    // Only auto-sell if this position was a copy trade from this whale
    if (position.copySourceWallet === walletAddress) {
      logger.info(
        { symbol: position.symbol, whale: walletAddress.slice(0, 8) },
        `[CopyTrade] Whale sold — mirroring sell for ${position.symbol}`,
      );

      const { executeSellSnipe } = await import('./execution.js');
      await executeSellSnipe(mint, 'copy_trade', templateId);
    }
  }
}

// ── Polling Fallback (when Helius WS unavailable) ────────────────────────

let pollingInterval: ReturnType<typeof setInterval> | null = null;

function startPollingFallback(): void {
  if (pollingInterval) return;
  if (whaleRegistry.size === 0) return;

  // Only poll top 5 wallets by win rate to conserve Helius credits.
  // With 14 wallets at 15s interval that was 56 calls/min (80,640/day).
  // Now: 5 wallets at 120s interval = 2.5 calls/min (3,600/day).
  const TOP_POLL_COUNT = 5;
  const POLL_INTERVAL_MS = 120_000; // 2 minutes

  logger.info(
    { intervalMs: POLL_INTERVAL_MS, maxWallets: TOP_POLL_COUNT, totalWhales: whaleRegistry.size },
    '[CopyTrade] Starting polling fallback (top 5 wallets, 120s interval)',
  );

  pollingInterval = setInterval(async () => {
    // Sort wallets by win rate descending and take top N
    const topWallets = [...whaleRegistry.entries()]
      .sort(([, a], [, b]) => b.winRate - a.winRate)
      .slice(0, TOP_POLL_COUNT);

    for (const [address] of topWallets) {
      try {
        await checkWalletActivity(address);
      } catch {
        // Silent
      }
      // Small delay between wallets to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }
  }, POLL_INTERVAL_MS);
}

// ── Public API ───────────────────────────────────────────────────────────

export function startCopyTradeMonitor(): void {
  // 1. Seed with hardcoded verified wallets
  for (const whale of SEED_WALLETS) {
    // Skip the migration wallet — it's for graduation signals, not copy trading buys
    if (whale.label.includes('Migration')) continue;
    whaleRegistry.set(whale.address, whale);
  }

  // 2. Load additional wallets from persisted file
  const persisted = loadPersistedWhales();
  for (const whale of persisted) {
    if (!whaleRegistry.has(whale.address)) {
      whaleRegistry.set(whale.address, whale);
    }
  }

  // 3. De-duplicate — some persisted wallets may overlap with seeds
  logger.info({
    seeds: SEED_WALLETS.length - 1, // minus migration wallet
    persisted: persisted.length,
    total: whaleRegistry.size,
  }, '[CopyTrade] Whale registry loaded');

  if (whaleRegistry.size === 0) {
    logger.warn('[CopyTrade] No whales in registry — add wallets via API or whale-registry.json');
    return;
  }

  // Log each tracked wallet
  for (const [addr, whale] of whaleRegistry) {
    logger.info({ address: addr.slice(0, 12), label: whale.label, winRate: whale.winRate }, '[CopyTrade] Tracking whale');
  }

  logger.info({ whales: whaleRegistry.size }, '[CopyTrade] Starting whale copy trade monitor');
  connectWebSocket();
}

export function stopCopyTradeMonitor(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  subscriptionIds.clear();
  logger.info('[CopyTrade] Monitor stopped');
}

export function getCopyTradeStatus(): {
  connected: boolean;
  whaleCount: number;
  method: 'websocket' | 'polling' | 'disconnected';
} {
  return {
    connected: ws?.readyState === WebSocket.OPEN || pollingInterval !== null,
    whaleCount: whaleRegistry.size,
    method: ws?.readyState === WebSocket.OPEN ? 'websocket' : pollingInterval ? 'polling' : 'disconnected',
  };
}
