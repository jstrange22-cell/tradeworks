import { Router, type Router as RouterType } from 'express';
import { broadcast } from '../websocket/server.js';
import { getSolanaConnection } from './solana-utils.js';
import {
  executeBuySnipe,
  executeSellSnipe,
  activePositions,
} from './solana-sniper.js';

/**
 * Whale Tracker / Copy Trading — Sprint 8.4
 *
 * Monitors whale wallets for large Solana token transactions.
 * Detects buy/sell patterns and enables copy-trade automation
 * with sell mirroring, per-whale stats, and quick copy.
 *
 * Routes:
 *   GET    /api/v1/solana/whales/list                — List tracked whales
 *   POST   /api/v1/solana/whales/add                 — Add whale wallet to track
 *   DELETE /api/v1/solana/whales/:address             — Remove tracked whale
 *   GET    /api/v1/solana/whales/activity             — Recent whale activity feed
 *   POST   /api/v1/solana/whales/monitor/start        — Start whale monitoring
 *   POST   /api/v1/solana/whales/monitor/stop         — Stop whale monitoring
 *   GET    /api/v1/solana/whales/monitor/status        — Monitor status
 *   GET    /api/v1/solana/whales/leaderboard          — Top whale wallets by activity
 *   PUT    /api/v1/solana/whales/copy-trade            — Configure global copy-trade settings
 *   GET    /api/v1/solana/whales/copy-trade            — Get global copy-trade settings
 *   POST   /api/v1/solana/whales/:address/copy         — Quick 1-click copy for whale
 *   PUT    /api/v1/solana/whales/:address/copy-config  — Set per-whale copy config
 *   GET    /api/v1/solana/whales/:address/stats        — Detailed per-whale stats
 *   GET    /api/v1/solana/whales/discover              — Pre-seeded notable whale addresses
 */

export const whaleRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface WhaleCopyConfig {
  enabled: boolean;
  buyAmountSol: number;
  maxSlippageBps: number;
  /** Mirror sell transactions when whale sells a token we hold */
  copySells: boolean;
  takeProfitPercent: number;
  stopLossPercent: number;
  /** Flag for future Jito bundle integration to avoid MEV sandwich attacks */
  antiMev: boolean;
  priorityFee: number;
}

interface TrackedWhale {
  address: string;
  label: string;
  addedAt: string;
  totalTxns: number;
  lastActivity: string | null;
  copyTradeEnabled: boolean;
  pnlEstimate: number;
  /** Win rate percentage (0-100) computed from matched buy/sell pairs */
  winRate: number;
  /** 7-day rolling PnL estimate in USD */
  pnl7d: number;
  /** 30-day rolling PnL estimate in USD */
  pnl30d: number;
  /** Cumulative tracked USD volume */
  totalVolume: number;
  /** Transaction count in rolling 7-day window */
  txCount7d: number;
  /** User-assigned tags for categorization */
  tags: string[];
  /** Per-whale copy configuration override (null = use global config) */
  copyConfig: WhaleCopyConfig | null;
}

interface WhaleActivity {
  id: string;
  whaleAddress: string;
  whaleLabel: string;
  type: 'buy' | 'sell' | 'transfer';
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  amountUsd: number;
  amountTokens: number;
  priceUsd: number;
  signature: string;
  timestamp: string;
  copied: boolean;
}

interface CopyTradeConfig {
  enabled: boolean;
  /** Scale factor: 0.1 = 10% of whale's position size */
  scaleFactor: number;
  /** Max SOL per copy trade */
  maxAmountSol: number;
  /** Only copy buys (not sells) — legacy global flag */
  buyOnly: boolean;
  /** Min whale trade USD value to copy */
  minTradeValueUsd: number;
  /** Delay before copying (ms) — helps avoid front-running detection */
  delayMs: number;
}

/** Record for tracking whale buy/sell pairs and computing PnL */
interface WhaleTradeRecord {
  tokenMint: string;
  tokenSymbol: string;
  type: 'buy' | 'sell';
  priceUsd: number;
  amountTokens: number;
  amountUsd: number;
  timestamp: string;
  /** Matched with a corresponding sell (for buys) or buy (for sells) */
  matched: boolean;
  /** PnL for this matched pair (only set after matching) */
  pnlUsd: number | null;
}

interface DiscoverWhale {
  address: string;
  label: string;
  tags: string[];
  description: string;
}

// ── State ──────────────────────────────────────────────────────────────

const trackedWhales: Map<string, TrackedWhale> = new Map();
const activityFeed: WhaleActivity[] = [];
const MAX_ACTIVITY = 500;

/**
 * Per-whale trade history for PnL and win-rate computation.
 * Key = whale address, Value = ordered list of trade records.
 */
const whaleTradeHistory: Map<string, WhaleTradeRecord[]> = new Map();
const MAX_TRADE_HISTORY_PER_WHALE = 1000;

let copyTradeConfig: CopyTradeConfig = {
  enabled: false,
  scaleFactor: 0.1,
  maxAmountSol: 0.5,
  buyOnly: true,
  minTradeValueUsd: 1000,
  delayMs: 2000,
};

let monitorRunning = false;
let monitorStartedAt: Date | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

// ── Pre-seeded notable wallets (discover endpoint) ────────────────────

const DISCOVER_WHALES: readonly DiscoverWhale[] = [
  {
    address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
    label: 'Raydium Authority',
    tags: ['dex', 'amm'],
    description: 'Raydium AMM authority account. High-volume DEX liquidity movements.',
  },
  {
    address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    label: 'Jupiter Aggregator',
    tags: ['dex', 'aggregator'],
    description: 'Jupiter v6 aggregator program. Routes trades across Solana DEXs.',
  },
  {
    address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    label: 'Wintermute Solana',
    tags: ['market_maker', 'smart_money'],
    description: 'Wintermute market-making wallet. Institutional-grade trading activity.',
  },
  {
    address: 'CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo',
    label: 'Alameda / FTX Remnant',
    tags: ['smart_money', 'institutional'],
    description: 'Known wallet associated with former Alameda Research liquidation flows.',
  },
  {
    address: 'HWHvQhFmJB3NUcu1aihKmrKegfVxBEHzwVX6yZCKEsi1',
    label: 'Wormhole Bridge',
    tags: ['bridge', 'cross_chain'],
    description: 'Wormhole cross-chain bridge. Large token transfers between chains.',
  },
  {
    address: '7oo7u7iXVsWrDm5yMJDSMRtqSJW1RFHbx1wQ1BFNkKm8',
    label: 'Known Meme Sniper',
    tags: ['sniper', 'meme_coins', 'smart_money'],
    description: 'Prolific meme coin sniper wallet. Frequently early on pump.fun launches.',
  },
] as const;

// ── Default per-whale copy config ─────────────────────────────────────

function getDefaultWhaleCopyConfig(): WhaleCopyConfig {
  return {
    enabled: true,
    buyAmountSol: copyTradeConfig.maxAmountSol,
    maxSlippageBps: 500,
    copySells: false,
    takeProfitPercent: 100,
    stopLossPercent: -50,
    antiMev: false,
    priorityFee: 100000,
  };
}

// ── Trade history helpers ─────────────────────────────────────────────

function recordWhaleTrade(whaleAddress: string, activity: WhaleActivity): void {
  if (!whaleTradeHistory.has(whaleAddress)) {
    whaleTradeHistory.set(whaleAddress, []);
  }

  const history = whaleTradeHistory.get(whaleAddress)!;

  const record: WhaleTradeRecord = {
    tokenMint: activity.tokenMint,
    tokenSymbol: activity.tokenSymbol,
    type: activity.type === 'transfer' ? 'buy' : activity.type,
    priceUsd: activity.priceUsd,
    amountTokens: activity.amountTokens,
    amountUsd: activity.amountUsd,
    timestamp: activity.timestamp,
    matched: false,
    pnlUsd: null,
  };

  // If this is a sell, try to match it with the most recent unmatched buy of the same token
  if (record.type === 'sell') {
    const unmatchedBuy = history.find(
      trade =>
        trade.tokenMint === record.tokenMint &&
        trade.type === 'buy' &&
        !trade.matched,
    );

    if (unmatchedBuy) {
      const pnl = (record.priceUsd - unmatchedBuy.priceUsd) * Math.min(record.amountTokens, unmatchedBuy.amountTokens);
      unmatchedBuy.matched = true;
      unmatchedBuy.pnlUsd = pnl;
      record.matched = true;
      record.pnlUsd = pnl;
    }
  }

  history.push(record);

  // Cap history size per whale
  if (history.length > MAX_TRADE_HISTORY_PER_WHALE) {
    history.splice(0, history.length - MAX_TRADE_HISTORY_PER_WHALE);
  }
}

function computeWhaleStats(
  whaleAddress: string,
): { winRate: number; pnl7d: number; pnl30d: number; totalVolume: number; txCount7d: number } {
  const history = whaleTradeHistory.get(whaleAddress) ?? [];

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Win rate: matched pairs where pnl > 0
  const matchedTrades = history.filter(trade => trade.matched && trade.pnlUsd !== null && trade.type === 'sell');
  const wins = matchedTrades.filter(trade => (trade.pnlUsd ?? 0) > 0).length;
  const winRate = matchedTrades.length > 0 ? (wins / matchedTrades.length) * 100 : 0;

  // 7-day PnL
  const pnl7d = history
    .filter(trade => trade.matched && trade.pnlUsd !== null && trade.type === 'sell' && new Date(trade.timestamp).getTime() >= sevenDaysAgo)
    .reduce((sum, trade) => sum + (trade.pnlUsd ?? 0), 0);

  // 30-day PnL
  const pnl30d = history
    .filter(trade => trade.matched && trade.pnlUsd !== null && trade.type === 'sell' && new Date(trade.timestamp).getTime() >= thirtyDaysAgo)
    .reduce((sum, trade) => sum + (trade.pnlUsd ?? 0), 0);

  // Total volume
  const totalVolume = history.reduce((sum, trade) => sum + trade.amountUsd, 0);

  // 7-day tx count
  const txCount7d = history.filter(trade => new Date(trade.timestamp).getTime() >= sevenDaysAgo).length;

  return { winRate, pnl7d, pnl30d, totalVolume, txCount7d };
}

function updateWhaleStatsFromHistory(whale: TrackedWhale): void {
  const stats = computeWhaleStats(whale.address);
  whale.winRate = Math.round(stats.winRate * 100) / 100;
  whale.pnl7d = Math.round(stats.pnl7d * 100) / 100;
  whale.pnl30d = Math.round(stats.pnl30d * 100) / 100;
  whale.totalVolume = Math.round(stats.totalVolume * 100) / 100;
  whale.txCount7d = stats.txCount7d;
  whale.pnlEstimate = whale.pnl30d;
}

// ── Whale activity detection ───────────────────────────────────────────

async function pollWhaleActivity(): Promise<void> {
  if (trackedWhales.size === 0) return;

  const connection = getSolanaConnection();

  for (const [address, whale] of trackedWhales) {
    try {
      // Get recent signatures for this wallet
      const signatures = await connection.getSignaturesForAddress(
        new (await import('@solana/web3.js')).PublicKey(address),
        { limit: 5 },
        'confirmed',
      );

      for (const sig of signatures) {
        // Skip if we already have this transaction
        if (activityFeed.some(a => a.signature === sig.signature)) continue;

        // Fetch transaction details
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta) continue;

        // Analyze token transfers
        const preBalances = tx.meta.preTokenBalances ?? [];
        const postBalances = tx.meta.postTokenBalances ?? [];

        // Find token balance changes for this wallet
        for (const post of postBalances) {
          if (post.owner !== address) continue;

          const pre = preBalances.find(
            p => p.owner === address && p.mint === post.mint,
          );

          const preAmount = parseFloat(pre?.uiTokenAmount?.uiAmountString ?? '0');
          const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString ?? '0');
          const diff = postAmount - preAmount;

          if (Math.abs(diff) < 0.01) continue;

          // Determine if buy or sell
          const type: 'buy' | 'sell' = diff > 0 ? 'buy' : 'sell';

          // Get token price from Dexscreener
          let priceUsd = 0;
          let tokenSymbol = 'UNKNOWN';
          let tokenName = 'Unknown Token';

          try {
            const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${post.mint}`);
            if (dexRes.ok) {
              const dexData = (await dexRes.json()) as { pairs?: Array<Record<string, unknown>> };
              const pair = (dexData.pairs ?? []).find(p => (p.chainId as string) === 'solana');
              if (pair) {
                priceUsd = parseFloat((pair.priceUsd as string) ?? '0');
                const baseToken = pair.baseToken as Record<string, string> | undefined;
                tokenSymbol = baseToken?.symbol ?? 'UNKNOWN';
                tokenName = baseToken?.name ?? 'Unknown Token';
              }
            }
          } catch { /* skip price lookup */ }

          const amountUsd = Math.abs(diff) * priceUsd;

          const activity: WhaleActivity = {
            id: `whale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            whaleAddress: address,
            whaleLabel: whale.label,
            type,
            tokenMint: post.mint!,
            tokenSymbol,
            tokenName,
            amountUsd,
            amountTokens: Math.abs(diff),
            priceUsd,
            signature: sig.signature,
            timestamp: sig.blockTime
              ? new Date(sig.blockTime * 1000).toISOString()
              : new Date().toISOString(),
            copied: false,
          };

          // Store activity
          activityFeed.unshift(activity);
          if (activityFeed.length > MAX_ACTIVITY) activityFeed.pop();

          // Record trade for per-whale stats
          recordWhaleTrade(address, activity);

          whale.totalTxns++;
          whale.lastActivity = activity.timestamp;

          // Update rolling stats on the whale object
          updateWhaleStatsFromHistory(whale);

          // Broadcast to WebSocket
          broadcast('solana:whales' as Parameters<typeof broadcast>[0], {
            event: 'whale:activity',
            activity,
          });

          console.log(`[Whale] ${whale.label} ${type.toUpperCase()} ${tokenSymbol}: ${Math.abs(diff).toFixed(2)} ($${amountUsd.toFixed(2)})`);

          // Copy trade logic — check per-whale config first, then global
          const whaleConfig = whale.copyConfig;
          const shouldCopy = whaleConfig
            ? whaleConfig.enabled
            : (copyTradeConfig.enabled && whale.copyTradeEnabled);

          if (shouldCopy) {
            const skipSell = whaleConfig
              ? (!whaleConfig.copySells && type === 'sell')
              : (copyTradeConfig.buyOnly && type === 'sell');

            if (skipSell) continue;
            if (amountUsd < copyTradeConfig.minTradeValueUsd) continue;

            // Fire copy trade with delay
            const delay = copyTradeConfig.delayMs;
            setTimeout(() => {
              triggerCopyTrade(activity, whale).catch(err =>
                console.error('[Whale] Copy trade failed:', err),
              );
            }, delay);
          }
        }
      }
    } catch (err) {
      console.error(`[Whale] Error polling ${whale.label}:`, err);
    }
  }
}

async function triggerCopyTrade(activity: WhaleActivity, whale: TrackedWhale): Promise<void> {
  const whaleConfig = whale.copyConfig;

  if (activity.type === 'buy') {
    // Buy mirroring
    const scaledAmountUsd = activity.amountUsd * copyTradeConfig.scaleFactor;
    const maxSol = whaleConfig ? whaleConfig.buyAmountSol : copyTradeConfig.maxAmountSol;
    const maxUsd = maxSol * 150; // rough SOL price estimate

    if (scaledAmountUsd > maxUsd) return;

    const execution = await executeBuySnipe({
      mint: activity.tokenMint,
      symbol: activity.tokenSymbol,
      name: activity.tokenName,
      trigger: 'manual', // Shows as manual in sniper history
      priceUsd: activity.priceUsd,
    });

    if (execution.status === 'success') {
      activity.copied = true;
      broadcast('solana:whales' as Parameters<typeof broadcast>[0], {
        event: 'whale:copy_executed',
        action: 'buy',
        whaleAddress: whale.address,
        whaleLabel: whale.label,
        originalActivity: activity,
        execution,
      });
    }
  } else if (activity.type === 'sell') {
    // Sell mirroring — only if per-whale config has copySells enabled
    const copySells = whaleConfig?.copySells ?? false;
    if (!copySells) return;

    // Check if we hold a position in this token
    const position = activePositions.get(activity.tokenMint);
    if (!position) {
      console.log(`[Whale] Sell mirror skipped for ${activity.tokenSymbol}: no active position`);
      return;
    }

    // Execute sell via sniper
    const execution = await executeSellSnipe(activity.tokenMint, 'manual');

    if (execution && execution.status === 'success') {
      activity.copied = true;
      broadcast('solana:whales' as Parameters<typeof broadcast>[0], {
        event: 'whale:copy_executed',
        action: 'sell',
        whaleAddress: whale.address,
        whaleLabel: whale.label,
        originalActivity: activity,
        execution,
      });

      console.log(`[Whale] Sell mirrored for ${activity.tokenSymbol} from ${whale.label}`);
    }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /whales/list
whaleRouter.get('/whales/list', (_req, res) => {
  res.json({
    data: [...trackedWhales.values()],
    total: trackedWhales.size,
  });
});

// POST /whales/add
whaleRouter.post('/whales/add', (req, res) => {
  const { address, label, copyTradeEnabled = false, tags = [] } = req.body as {
    address: string;
    label?: string;
    copyTradeEnabled?: boolean;
    tags?: string[];
  };

  if (!address) {
    res.status(400).json({ error: 'Missing required field: address' });
    return;
  }

  if (trackedWhales.has(address)) {
    res.status(409).json({ error: 'Whale already tracked' });
    return;
  }

  // Validate address format
  try {
    new (require('@solana/web3.js').PublicKey)(address);
  } catch {
    res.status(400).json({ error: 'Invalid Solana address' });
    return;
  }

  const whale: TrackedWhale = {
    address,
    label: label ?? `Whale ${trackedWhales.size + 1}`,
    addedAt: new Date().toISOString(),
    totalTxns: 0,
    lastActivity: null,
    copyTradeEnabled,
    pnlEstimate: 0,
    winRate: 0,
    pnl7d: 0,
    pnl30d: 0,
    totalVolume: 0,
    txCount7d: 0,
    tags,
    copyConfig: null,
  };

  trackedWhales.set(address, whale);

  res.json({
    data: whale,
    message: `Whale "${whale.label}" added to tracking list`,
  });
});

// DELETE /whales/:address
whaleRouter.delete('/whales/:address', (req, res) => {
  const { address } = req.params;

  if (!trackedWhales.has(address)) {
    res.status(404).json({ error: 'Whale not found' });
    return;
  }

  trackedWhales.delete(address);
  whaleTradeHistory.delete(address);
  res.json({ message: 'Whale removed from tracking list' });
});

// GET /whales/activity
whaleRouter.get('/whales/activity', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const type = req.query.type as string | undefined; // buy | sell | all
  const whaleAddress = req.query.whale as string | undefined;

  let filtered = activityFeed;

  if (type && type !== 'all') {
    filtered = filtered.filter(a => a.type === type);
  }
  if (whaleAddress) {
    filtered = filtered.filter(a => a.whaleAddress === whaleAddress);
  }

  res.json({
    data: filtered.slice(0, limit),
    total: filtered.length,
  });
});

// POST /whales/monitor/start
whaleRouter.post('/whales/monitor/start', (_req, res) => {
  if (monitorRunning) {
    res.json({ message: 'Whale monitor already running', status: 'running' });
    return;
  }

  monitorRunning = true;
  monitorStartedAt = new Date();

  // Poll every 15 seconds (RPC rate limit friendly)
  pollInterval = setInterval(() => pollWhaleActivity(), 15_000);

  // Initial poll
  pollWhaleActivity().catch(console.error);

  res.json({
    message: 'Whale monitor started',
    status: 'running',
    trackedWhales: trackedWhales.size,
    pollIntervalMs: 15000,
  });
});

// POST /whales/monitor/stop
whaleRouter.post('/whales/monitor/stop', (_req, res) => {
  monitorRunning = false;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  res.json({ message: 'Whale monitor stopped', status: 'stopped' });
});

// GET /whales/monitor/status
whaleRouter.get('/whales/monitor/status', (_req, res) => {
  res.json({
    running: monitorRunning,
    startedAt: monitorStartedAt?.toISOString() ?? null,
    trackedWhales: trackedWhales.size,
    totalActivities: activityFeed.length,
    copyTradeConfig,
  });
});

// GET /whales/leaderboard — Top whales by activity volume with win rates
whaleRouter.get('/whales/leaderboard', (_req, res) => {
  const whaleStats = [...trackedWhales.values()]
    .map(whale => {
      // Refresh stats from trade history
      updateWhaleStatsFromHistory(whale);

      const activities = activityFeed.filter(a => a.whaleAddress === whale.address);
      const buyVolume = activities
        .filter(a => a.type === 'buy')
        .reduce((sum, a) => sum + a.amountUsd, 0);
      const sellVolume = activities
        .filter(a => a.type === 'sell')
        .reduce((sum, a) => sum + a.amountUsd, 0);

      return {
        ...whale,
        buyVolume,
        sellVolume,
        totalVolume: whale.totalVolume > 0 ? whale.totalVolume : buyVolume + sellVolume,
        tradeCount: activities.length,
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);

  res.json({ data: whaleStats });
});

// PUT /whales/copy-trade — Configure global copy-trade settings
whaleRouter.put('/whales/copy-trade', (req, res) => {
  const updates = req.body as Partial<CopyTradeConfig>;
  copyTradeConfig = { ...copyTradeConfig, ...updates };

  res.json({
    data: copyTradeConfig,
    message: 'Copy-trade configuration updated',
  });
});

// GET /whales/copy-trade
whaleRouter.get('/whales/copy-trade', (_req, res) => {
  res.json({ data: copyTradeConfig });
});

// ── New Routes: Quick Copy, Per-Whale Config, Stats, Discover ─────────

// POST /whales/:address/copy — Quick 1-click copy: add + monitor + enable copy with defaults
whaleRouter.post('/whales/:address/copy', (req, res) => {
  const { address } = req.params;
  const { label, tags = [] } = req.body as { label?: string; tags?: string[] };

  // Validate address format
  try {
    new (require('@solana/web3.js').PublicKey)(address);
  } catch {
    res.status(400).json({ error: 'Invalid Solana address' });
    return;
  }

  let whale = trackedWhales.get(address);

  if (!whale) {
    // Auto-add the whale if not already tracked
    whale = {
      address,
      label: label ?? `Whale ${trackedWhales.size + 1}`,
      addedAt: new Date().toISOString(),
      totalTxns: 0,
      lastActivity: null,
      copyTradeEnabled: true,
      pnlEstimate: 0,
      winRate: 0,
      pnl7d: 0,
      pnl30d: 0,
      totalVolume: 0,
      txCount7d: 0,
      tags,
      copyConfig: getDefaultWhaleCopyConfig(),
    };
    trackedWhales.set(address, whale);
  } else {
    // Already tracked — just enable copy with default config
    whale.copyTradeEnabled = true;
    if (!whale.copyConfig) {
      whale.copyConfig = getDefaultWhaleCopyConfig();
    } else {
      whale.copyConfig.enabled = true;
    }
    if (label) whale.label = label;
    if (tags.length > 0) {
      // Merge tags without duplicates
      whale.tags = [...new Set([...whale.tags, ...tags])];
    }
  }

  // Auto-start monitoring if not running
  if (!monitorRunning) {
    monitorRunning = true;
    monitorStartedAt = new Date();
    pollInterval = setInterval(() => pollWhaleActivity(), 15_000);
    pollWhaleActivity().catch(console.error);
  }

  res.json({
    data: whale,
    monitorStarted: monitorRunning,
    message: `Copy trading enabled for "${whale.label}". Monitoring active.`,
  });
});

// PUT /whales/:address/copy-config — Set per-whale copy configuration override
whaleRouter.put('/whales/:address/copy-config', (req, res) => {
  const { address } = req.params;
  const whale = trackedWhales.get(address);

  if (!whale) {
    res.status(404).json({ error: 'Whale not found. Add via POST /whales/add or POST /whales/:address/copy first.' });
    return;
  }

  const updates = req.body as Partial<WhaleCopyConfig>;

  // Validate numeric ranges
  if (updates.buyAmountSol !== undefined && (updates.buyAmountSol <= 0 || updates.buyAmountSol > 10)) {
    res.status(400).json({ error: 'buyAmountSol must be between 0 and 10 SOL' });
    return;
  }
  if (updates.maxSlippageBps !== undefined && (updates.maxSlippageBps < 1 || updates.maxSlippageBps > 5000)) {
    res.status(400).json({ error: 'maxSlippageBps must be between 1 and 5000' });
    return;
  }
  if (updates.takeProfitPercent !== undefined && updates.takeProfitPercent < 0) {
    res.status(400).json({ error: 'takeProfitPercent must be >= 0' });
    return;
  }
  if (updates.stopLossPercent !== undefined && updates.stopLossPercent > 0) {
    res.status(400).json({ error: 'stopLossPercent must be <= 0 (negative value)' });
    return;
  }
  if (updates.priorityFee !== undefined && updates.priorityFee < 0) {
    res.status(400).json({ error: 'priorityFee must be >= 0' });
    return;
  }

  if (whale.copyConfig) {
    whale.copyConfig = { ...whale.copyConfig, ...updates };
  } else {
    whale.copyConfig = { ...getDefaultWhaleCopyConfig(), ...updates };
  }

  // Sync the legacy flag
  whale.copyTradeEnabled = whale.copyConfig.enabled;

  res.json({
    data: whale.copyConfig,
    message: `Copy config updated for "${whale.label}"`,
  });
});

// GET /whales/:address/stats — Detailed per-whale stats
whaleRouter.get('/whales/:address/stats', (req, res) => {
  const { address } = req.params;
  const whale = trackedWhales.get(address);

  if (!whale) {
    res.status(404).json({ error: 'Whale not found' });
    return;
  }

  // Refresh stats
  updateWhaleStatsFromHistory(whale);

  const history = whaleTradeHistory.get(address) ?? [];
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Compute per-timeframe breakdowns
  const last7dTrades = history.filter(t => new Date(t.timestamp).getTime() >= sevenDaysAgo);
  const last30dTrades = history.filter(t => new Date(t.timestamp).getTime() >= thirtyDaysAgo);

  const computeBreakdown = (trades: WhaleTradeRecord[]) => {
    const buys = trades.filter(t => t.type === 'buy');
    const sells = trades.filter(t => t.type === 'sell');
    const matchedSells = sells.filter(t => t.matched && t.pnlUsd !== null);
    const wins = matchedSells.filter(t => (t.pnlUsd ?? 0) > 0).length;
    const losses = matchedSells.filter(t => (t.pnlUsd ?? 0) <= 0).length;
    const totalPnl = matchedSells.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
    const buyVolume = buys.reduce((sum, t) => sum + t.amountUsd, 0);
    const sellVolume = sells.reduce((sum, t) => sum + t.amountUsd, 0);

    return {
      totalTrades: trades.length,
      buys: buys.length,
      sells: sells.length,
      matchedPairs: matchedSells.length,
      wins,
      losses,
      winRate: matchedSells.length > 0 ? Math.round((wins / matchedSells.length) * 10000) / 100 : 0,
      pnlUsd: Math.round(totalPnl * 100) / 100,
      buyVolumeUsd: Math.round(buyVolume * 100) / 100,
      sellVolumeUsd: Math.round(sellVolume * 100) / 100,
      totalVolumeUsd: Math.round((buyVolume + sellVolume) * 100) / 100,
    };
  };

  // Unique tokens traded
  const uniqueTokens = [...new Set(history.map(t => t.tokenMint))];

  // Top tokens by volume
  const tokenVolumes = new Map<string, { symbol: string; volume: number; trades: number }>();
  for (const trade of history) {
    const existing = tokenVolumes.get(trade.tokenMint);
    if (existing) {
      existing.volume += trade.amountUsd;
      existing.trades++;
    } else {
      tokenVolumes.set(trade.tokenMint, {
        symbol: trade.tokenSymbol,
        volume: trade.amountUsd,
        trades: 1,
      });
    }
  }
  const topTokens = [...tokenVolumes.entries()]
    .map(([mint, data]) => ({ mint, ...data }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  res.json({
    data: {
      whale: {
        address: whale.address,
        label: whale.label,
        tags: whale.tags,
        addedAt: whale.addedAt,
        copyTradeEnabled: whale.copyTradeEnabled,
        copyConfig: whale.copyConfig,
      },
      overall: {
        winRate: whale.winRate,
        pnlEstimate: whale.pnlEstimate,
        totalVolume: whale.totalVolume,
        totalTxns: whale.totalTxns,
        totalTradeRecords: history.length,
        uniqueTokensTraded: uniqueTokens.length,
      },
      last7d: computeBreakdown(last7dTrades),
      last30d: computeBreakdown(last30dTrades),
      allTime: computeBreakdown(history),
      topTokens,
    },
  });
});

// GET /whales/discover — Pre-seeded notable whale/KOL wallets
whaleRouter.get('/whales/discover', (_req, res) => {
  const enriched = DISCOVER_WHALES.map(discoverWhale => {
    const tracked = trackedWhales.get(discoverWhale.address);
    return {
      ...discoverWhale,
      isTracked: !!tracked,
      copyEnabled: tracked?.copyTradeEnabled ?? false,
    };
  });

  res.json({
    data: enriched,
    total: enriched.length,
    message: 'Notable Solana whale and protocol wallets. Use POST /whales/:address/copy to start copy trading.',
  });
});

// Cleanup
process.on('SIGINT', () => { if (pollInterval) clearInterval(pollInterval); });
process.on('SIGTERM', () => { if (pollInterval) clearInterval(pollInterval); });
