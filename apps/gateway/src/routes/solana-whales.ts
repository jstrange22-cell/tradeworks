import { Router, type Router as RouterType } from 'express';
import { broadcast } from '../websocket/server.js';
import { getSolanaConnection } from './solana-utils.js';

/**
 * Whale Tracker — Sprint 8.3
 *
 * Monitors whale wallets for large Solana token transactions.
 * Detects buy/sell patterns and enables copy-trade automation.
 *
 * Routes:
 *   GET    /api/v1/solana/whales/list              — List tracked whales
 *   POST   /api/v1/solana/whales/add               — Add whale wallet to track
 *   DELETE /api/v1/solana/whales/:address           — Remove tracked whale
 *   GET    /api/v1/solana/whales/activity           — Recent whale activity feed
 *   POST   /api/v1/solana/whales/monitor/start      — Start whale monitoring
 *   POST   /api/v1/solana/whales/monitor/stop       — Stop whale monitoring
 *   GET    /api/v1/solana/whales/monitor/status      — Monitor status
 *   GET    /api/v1/solana/whales/leaderboard        — Top whale wallets by activity
 *   PUT    /api/v1/solana/whales/copy-trade          — Configure copy-trade settings
 *   GET    /api/v1/solana/whales/copy-trade          — Get copy-trade settings
 */

export const whaleRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface TrackedWhale {
  address: string;
  label: string;
  addedAt: string;
  totalTxns: number;
  lastActivity: string | null;
  copyTradeEnabled: boolean;
  pnlEstimate: number;
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
  /** Only copy buys (not sells) */
  buyOnly: boolean;
  /** Min whale trade USD value to copy */
  minTradeValueUsd: number;
  /** Delay before copying (ms) — helps avoid front-running detection */
  delayMs: number;
}

// ── State ──────────────────────────────────────────────────────────────

const trackedWhales: Map<string, TrackedWhale> = new Map();
const activityFeed: WhaleActivity[] = [];
const MAX_ACTIVITY = 500;

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

// ── Known whale wallets (pre-seeded) ───────────────────────────────────

// Known whale wallets can be added via the API
// Users build their own watchlist of whale wallets to track

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

          whale.totalTxns++;
          whale.lastActivity = activity.timestamp;

          // Broadcast to WebSocket
          broadcast('solana:whales' as any, {
            event: 'whale:activity',
            activity,
          });

          console.log(`[Whale] ${whale.label} ${type.toUpperCase()} ${tokenSymbol}: ${Math.abs(diff).toFixed(2)} ($${amountUsd.toFixed(2)})`);

          // Copy trade logic
          if (copyTradeConfig.enabled && whale.copyTradeEnabled) {
            if (copyTradeConfig.buyOnly && type === 'sell') continue;
            if (amountUsd < copyTradeConfig.minTradeValueUsd) continue;

            // Fire copy trade with delay
            setTimeout(() => {
              triggerCopyTrade(activity).catch(err =>
                console.error('[Whale] Copy trade failed:', err),
              );
            }, copyTradeConfig.delayMs);
          }
        }
      }
    } catch (err) {
      console.error(`[Whale] Error polling ${whale.label}:`, err);
    }
  }
}

async function triggerCopyTrade(activity: WhaleActivity): Promise<void> {
  // Import sniper execution
  const { executeBuySnipe } = await import('./solana-sniper.js');

  const scaledAmountUsd = activity.amountUsd * copyTradeConfig.scaleFactor;
  const maxUsd = copyTradeConfig.maxAmountSol * 150; // rough SOL price estimate

  if (scaledAmountUsd > maxUsd) return;

  const execution = await executeBuySnipe({
    mint: activity.tokenMint,
    symbol: activity.tokenSymbol,
    name: activity.tokenName,
    trigger: 'manual', // Will show as manual in history
    priceUsd: activity.priceUsd,
  });

  if (execution.status === 'success') {
    activity.copied = true;
    broadcast('solana:whales' as any, {
      event: 'whale:copy_executed',
      originalActivity: activity,
      execution,
    });
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
  const { address, label, copyTradeEnabled = false } = req.body as {
    address: string;
    label?: string;
    copyTradeEnabled?: boolean;
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

// GET /whales/leaderboard — Top whales by activity volume
whaleRouter.get('/whales/leaderboard', (_req, res) => {
  const whaleStats = [...trackedWhales.values()]
    .map(whale => {
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
        totalVolume: buyVolume + sellVolume,
        tradeCount: activities.length,
      };
    })
    .sort((a, b) => b.totalVolume - a.totalVolume);

  res.json({ data: whaleStats });
});

// PUT /whales/copy-trade — Configure copy-trade
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

// Cleanup
process.on('SIGINT', () => { if (pollInterval) clearInterval(pollInterval); });
process.on('SIGTERM', () => { if (pollInterval) clearInterval(pollInterval); });
