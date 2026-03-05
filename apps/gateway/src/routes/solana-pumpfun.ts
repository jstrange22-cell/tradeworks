import { Router, type Router as RouterType } from 'express';
import { broadcast } from '../websocket/server.js';

/**
 * pump.fun Real-Time Monitor — Sprint 8.1
 *
 * Monitors for new token launches on pump.fun via:
 *   1. Polling pump.fun unofficial API for latest coins
 *   2. Broadcasting new launches to 'solana:tokens' WebSocket channel
 *
 * Routes:
 *   GET  /api/v1/solana/pumpfun/latest        — Latest pump.fun launches
 *   GET  /api/v1/solana/pumpfun/token/:mint    — Token bonding curve status
 *   POST /api/v1/solana/pumpfun/monitor/start  — Start real-time monitor
 *   POST /api/v1/solana/pumpfun/monitor/stop   — Stop real-time monitor
 *   GET  /api/v1/solana/pumpfun/monitor/status — Monitor status
 */

export const pumpFunRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

export interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  creator: string;
  createdAt: string;
  marketCap: number;
  usdMarketCap: number;
  replyCount: number;
  bondingCurveProgress: number;
  graduated: boolean;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  kingOfTheHill: boolean;
}

// ── Monitor State ──────────────────────────────────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let monitorRunning = false;
let lastSeenMints = new Set<string>();
let totalDetected = 0;
let monitorStartedAt: Date | null = null;
const recentLaunches: PumpFunToken[] = [];
const MAX_RECENT = 100;

// ── pump.fun API helpers ───────────────────────────────────────────────

const PUMPFUN_API = 'https://frontend-api.pump.fun';

async function fetchLatestPumpFun(limit = 50): Promise<PumpFunToken[]> {
  try {
    const res = await fetch(
      `${PUMPFUN_API}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
    );
    if (!res.ok) return [];

    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map(parsePumpFunToken).filter((t): t is PumpFunToken => t !== null);
  } catch (err) {
    console.error('[PumpFun] API fetch failed:', err);
    return [];
  }
}

async function fetchPumpFunToken(mint: string): Promise<PumpFunToken | null> {
  try {
    const res = await fetch(`${PUMPFUN_API}/coins/${mint}`);
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    return parsePumpFunToken(data);
  } catch {
    return null;
  }
}

function parsePumpFunToken(data: Record<string, unknown>): PumpFunToken | null {
  try {
    const mint = data.mint as string;
    if (!mint) return null;

    // Bonding curve: pump.fun tokens start at 0% and graduate to Raydium at 100%
    const bondingCurveProgress = typeof data.bonding_curve_progress === 'number'
      ? data.bonding_curve_progress
      : (typeof data.progress === 'number' ? data.progress : 0);

    return {
      mint,
      name: (data.name as string) ?? 'Unknown',
      symbol: (data.symbol as string) ?? '???',
      description: (data.description as string) ?? '',
      imageUri: (data.image_uri as string) ?? (data.uri as string) ?? null,
      creator: (data.creator as string) ?? '',
      createdAt: (data.created_timestamp as string)
        ?? (typeof data.created_timestamp === 'number'
          ? new Date(data.created_timestamp).toISOString()
          : new Date().toISOString()),
      marketCap: (data.market_cap as number) ?? 0,
      usdMarketCap: (data.usd_market_cap as number) ?? 0,
      replyCount: (data.reply_count as number) ?? 0,
      bondingCurveProgress,
      graduated: bondingCurveProgress >= 100 || (data.complete as boolean) === true,
      website: (data.website as string) ?? null,
      twitter: (data.twitter as string) ?? null,
      telegram: (data.telegram as string) ?? null,
      kingOfTheHill: (data.king_of_the_hill_timestamp as unknown) !== null
        && (data.king_of_the_hill_timestamp as unknown) !== undefined,
    };
  } catch {
    return null;
  }
}

// ── Monitor Logic ──────────────────────────────────────────────────────

function startMonitor(pollIntervalMs = 5000): void {
  if (monitorRunning) return;

  monitorRunning = true;
  monitorStartedAt = new Date();
  console.log(`[PumpFun] Monitor started — polling every ${pollIntervalMs}ms`);

  // Initial seed
  fetchLatestPumpFun(20).then((tokens) => {
    for (const t of tokens) lastSeenMints.add(t.mint);
    console.log(`[PumpFun] Seeded with ${lastSeenMints.size} known tokens`);
  });

  monitorInterval = setInterval(async () => {
    try {
      const latest = await fetchLatestPumpFun(30);
      const newTokens: PumpFunToken[] = [];

      for (const token of latest) {
        if (!lastSeenMints.has(token.mint)) {
          lastSeenMints.add(token.mint);
          newTokens.push(token);
          totalDetected++;

          // Keep recent launches bounded
          recentLaunches.unshift(token);
          if (recentLaunches.length > MAX_RECENT) recentLaunches.pop();
        }
      }

      // Broadcast new tokens to WebSocket subscribers
      if (newTokens.length > 0) {
        for (const token of newTokens) {
          broadcast('solana:tokens' as any, {
            event: 'pumpfun:new_token',
            token,
          });
        }
        console.log(`[PumpFun] Detected ${newTokens.length} new launch(es)`);
      }

      // Cap the seen set to prevent memory growth
      if (lastSeenMints.size > 5000) {
        const arr = [...lastSeenMints];
        lastSeenMints = new Set(arr.slice(arr.length - 2000));
      }
    } catch (err) {
      console.error('[PumpFun] Monitor poll error:', err);
    }
  }, pollIntervalMs);
}

function stopMonitor(): void {
  if (!monitorRunning) return;
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  monitorRunning = false;
  console.log('[PumpFun] Monitor stopped');
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /pumpfun/latest — Latest pump.fun launches
pumpFunRouter.get('/pumpfun/latest', async (req, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '30', 10), 100);
    const sort = (req.query.sort as string) ?? 'created'; // created | marketCap | replies

    let tokens = await fetchLatestPumpFun(limit);

    // Sort options
    if (sort === 'marketCap') {
      tokens.sort((a, b) => b.usdMarketCap - a.usdMarketCap);
    } else if (sort === 'replies') {
      tokens.sort((a, b) => b.replyCount - a.replyCount);
    }

    res.json({
      data: tokens,
      total: tokens.length,
      source: 'pump.fun',
    });
  } catch (err) {
    console.error('[PumpFun] Latest fetch failed:', err);
    res.status(500).json({
      error: 'Failed to fetch pump.fun tokens',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /pumpfun/token/:mint — Single token bonding curve status
pumpFunRouter.get('/pumpfun/token/:mint', async (req, res) => {
  try {
    const { mint } = req.params;
    const token = await fetchPumpFunToken(mint);

    if (!token) {
      res.status(404).json({ error: 'Token not found on pump.fun' });
      return;
    }

    res.json({ data: token });
  } catch (err) {
    console.error('[PumpFun] Token fetch failed:', err);
    res.status(500).json({
      error: 'Failed to fetch token',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /pumpfun/monitor/start — Start the real-time monitor
pumpFunRouter.post('/pumpfun/monitor/start', (_req, res) => {
  const interval = 5000; // 5 second poll
  startMonitor(interval);
  res.json({
    message: 'pump.fun monitor started',
    status: 'running',
    pollIntervalMs: interval,
  });
});

// POST /pumpfun/monitor/stop — Stop the real-time monitor
pumpFunRouter.post('/pumpfun/monitor/stop', (_req, res) => {
  stopMonitor();
  res.json({
    message: 'pump.fun monitor stopped',
    status: 'stopped',
  });
});

// GET /pumpfun/monitor/status — Monitor status + recent detections
pumpFunRouter.get('/pumpfun/monitor/status', (_req, res) => {
  res.json({
    running: monitorRunning,
    startedAt: monitorStartedAt?.toISOString() ?? null,
    totalDetected,
    knownTokens: lastSeenMints.size,
    recentLaunches: recentLaunches.slice(0, 20),
  });
});

// ---------------------------------------------------------------------------
// Auto-start — called from index.ts on server boot
// ---------------------------------------------------------------------------

/**
 * Auto-start pump.fun monitor if not already running.
 * Runs unconditionally (no Solana wallet needed — this monitors public data).
 */
export function initPumpFunMonitor(): void {
  if (monitorRunning) {
    console.log('[PumpFun] Monitor already running, skipping auto-start');
    return;
  }
  console.log('[PumpFun] Auto-starting monitor (polls pump.fun API every 5s)...');
  startMonitor(5000);
}

// Cleanup on shutdown
process.on('SIGINT', () => stopMonitor());
process.on('SIGTERM', () => stopMonitor());
