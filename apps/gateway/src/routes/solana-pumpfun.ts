import { Router, type Router as RouterType } from 'express';
import WebSocket from 'ws';
import { broadcast } from '../websocket/server.js';
import { onNewTokenDetected } from './solana-sniper.js';

/**
 * pump.fun Real-Time Monitor — Sprint 12.4
 *
 * Monitors for new token launches on pump.fun via PumpPortal WebSocket:
 *   1. Connects to wss://pumpportal.fun/api/data
 *   2. Subscribes to 'subscribeNewToken' for real-time creation events
 *   3. Feeds new tokens into sniper engine via onNewTokenDetected()
 *   4. Broadcasts to 'solana:tokens' WebSocket channel for dashboard
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

let wsConnection: WebSocket | null = null;
let monitorRunning = false;
let lastSeenMints = new Set<string>();
let totalDetected = 0;
let monitorStartedAt: Date | null = null;
const recentLaunches: PumpFunToken[] = [];
const MAX_RECENT = 100;

// ── PumpPortal WebSocket ─────────────────────────────────────────────

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';

// REST fallback for /latest endpoint (v3 API or cache)
const PUMPFUN_API_V3 = 'https://frontend-api-v3.pump.fun';

/**
 * Parse a PumpPortal WebSocket `subscribeNewToken` event into our PumpFunToken format.
 *
 * PumpPortal fields: mint, name, symbol, uri, traderPublicKey, initialBuy,
 * bondingCurveKey, vTokensInBondingCurve, vSolInBondingCurve, marketCapSol,
 * signature, txType
 */
function parsePumpPortalToken(data: Record<string, unknown>): PumpFunToken {
  // Estimate USD market cap from SOL market cap
  // Sniper engine does its own Jupiter price check before buying
  const solPrice = 170; // conservative estimate
  const marketCapSol = Number(data.marketCapSol ?? 0);
  const usdMarketCap = marketCapSol * solPrice;

  return {
    mint: data.mint as string,
    name: (data.name as string) ?? 'Unknown',
    symbol: (data.symbol as string) ?? '???',
    description: '',
    imageUri: (data.uri as string) ?? null,
    creator: (data.traderPublicKey as string) ?? '',
    createdAt: new Date().toISOString(),
    marketCap: marketCapSol,
    usdMarketCap,
    replyCount: 0,
    bondingCurveProgress: 0,
    graduated: false,
    website: null,
    twitter: null,
    telegram: null,
    kingOfTheHill: false,
  };
}

/**
 * Parse a pump.fun REST API response (v3) into PumpFunToken.
 * Kept for /latest and /token/:mint endpoints.
 */
function parsePumpFunToken(data: Record<string, unknown>): PumpFunToken | null {
  try {
    const mint = data.mint as string;
    if (!mint) return null;

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

// ── WebSocket Connection ──────────────────────────────────────────────

let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

function connectWebSocket(): void {
  if (wsConnection) {
    try { wsConnection.close(); } catch { /* ignore */ }
    wsConnection = null;
  }

  console.log('[PumpFun] Connecting to PumpPortal WebSocket...');
  const ws = new WebSocket(PUMPPORTAL_WS);
  wsConnection = ws;

  ws.on('open', () => {
    console.log('[PumpFun] Connected to PumpPortal WebSocket — subscribing to new tokens');
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const data = JSON.parse(raw.toString()) as Record<string, unknown>;
      handleNewToken(data);
    } catch (err) {
      console.error('[PumpFun] WS message parse error:', err);
    }
  });

  ws.on('close', () => {
    wsConnection = null;
    if (monitorRunning) {
      console.log('[PumpFun] WebSocket closed — reconnecting in 5s...');
      reconnectTimeout = setTimeout(connectWebSocket, 5000);
    }
  });

  ws.on('error', (err: Error) => {
    console.error('[PumpFun] WebSocket error:', err.message);
    // 'close' event fires after 'error', so reconnect logic is handled there
  });
}

function handleNewToken(data: Record<string, unknown>): void {
  const mint = data.mint as string;
  if (!mint || lastSeenMints.has(mint)) return;

  lastSeenMints.add(mint);
  totalDetected++;

  const token = parsePumpPortalToken(data);

  // Keep recent launches bounded
  recentLaunches.unshift(token);
  if (recentLaunches.length > MAX_RECENT) recentLaunches.pop();

  // Broadcast to dashboard WebSocket subscribers
  broadcast('solana:tokens' as Parameters<typeof broadcast>[0], {
    event: 'pumpfun:new_token',
    token,
  });

  // Feed into sniper engine for auto-buy evaluation
  onNewTokenDetected({
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    usdMarketCap: token.usdMarketCap,
    source: 'pumpfun',
  });

  console.log(
    `[PumpFun] New token: ${token.symbol} (${token.mint.slice(0, 8)}...) mcap=$${token.usdMarketCap.toFixed(0)}`,
  );

  // Cap the seen set to prevent memory growth
  if (lastSeenMints.size > 5000) {
    const arr = [...lastSeenMints];
    lastSeenMints = new Set(arr.slice(arr.length - 2000));
  }
}

// ── Monitor Logic ──────────────────────────────────────────────────────

function startMonitor(): void {
  if (monitorRunning) return;

  monitorRunning = true;
  monitorStartedAt = new Date();
  console.log('[PumpFun] Monitor started — connecting to PumpPortal WebSocket');

  connectWebSocket();
}

function stopMonitor(): void {
  if (!monitorRunning) return;

  monitorRunning = false;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (wsConnection) {
    try { wsConnection.close(); } catch { /* ignore */ }
    wsConnection = null;
  }

  console.log('[PumpFun] Monitor stopped');
}

// ── REST API helpers (for /latest and /token/:mint routes) ────────────

async function fetchLatestPumpFun(limit = 50): Promise<PumpFunToken[]> {
  // Try v3 REST API first
  try {
    const res = await fetch(
      `${PUMPFUN_API_V3}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
    );
    if (res.ok) {
      const data = (await res.json()) as Array<Record<string, unknown>>;
      const parsed = data.map(parsePumpFunToken).filter((t): t is PumpFunToken => t !== null);
      if (parsed.length > 0) return parsed;
    }
  } catch {
    // v3 API may also be unavailable — fall through to cache
  }

  // Fallback: return cached tokens from WebSocket stream
  return recentLaunches.slice(0, limit);
}

async function fetchPumpFunToken(mint: string): Promise<PumpFunToken | null> {
  // Try v3 API
  try {
    const res = await fetch(`${PUMPFUN_API_V3}/coins/${mint}`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      return parsePumpFunToken(data);
    }
  } catch {
    // Fall through
  }

  // Check WebSocket cache
  return recentLaunches.find(t => t.mint === mint) ?? null;
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
  startMonitor();
  res.json({
    message: 'pump.fun monitor started (PumpPortal WebSocket)',
    status: 'running',
    source: 'wss://pumpportal.fun/api/data',
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
    wsConnected: wsConnection?.readyState === WebSocket.OPEN,
    source: 'PumpPortal WebSocket',
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
  console.log('[PumpFun] Auto-starting monitor (PumpPortal WebSocket)...');
  startMonitor();
}

// Cleanup on shutdown
process.on('SIGINT', () => stopMonitor());
process.on('SIGTERM', () => stopMonitor());
