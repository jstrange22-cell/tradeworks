/**
 * Multi-Launchpad Monitor for Solana Token Launches
 *
 * Monitors 4 additional Solana launchpads beyond pump.fun using native
 * connection.onLogs() subscriptions -- zero cost, real-time detection.
 *
 * Supported launchpads:
 *   - Raydium LaunchLab
 *   - Moonshot (DEXScreener)
 *   - Boop.fun
 *   - Meteora DBC (Dynamic Bonding Curves)
 */

import { Router } from 'express';
import { PublicKey, type Logs, type Context } from '@solana/web3.js';
import { getSolanaConnection, withRpcRetry } from './solana-utils.js';
import { broadcast } from '../websocket/server.js';
import { onNewTokenDetected } from './solana-sniper/index.js';
import type { LaunchpadSource } from './solana-sniper/types.js';

// ── Types ────────────────────────────────────────────────────────────────

interface LaunchpadConfig {
  name: string;
  programId: string;
  source: LaunchpadSource;
  enabled: boolean;
  createPatterns: string[];
}

interface MonitorState {
  subscriptionId: number | null;
  lastLogTimestamp: number;
  logsProcessed: number;
  tokensDetected: number;
}

interface ParsedTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  creator: string | undefined;
}

// ── Metaplex Constants ───────────────────────────────────────────────────

const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

// ── Launchpad Definitions ────────────────────────────────────────────────

const LAUNCHPAD_CONFIGS: Record<string, LaunchpadConfig> = {
  raydium_launchlab: {
    name: 'Raydium LaunchLab',
    programId: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
    source: 'raydium_launchlab',
    enabled: true,
    createPatterns: ['Instruction: InitializeV2', 'Instruction: Initialize'],
  },
  moonshot: {
    name: 'Moonshot',
    programId: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG',
    source: 'moonshot',
    enabled: true,
    createPatterns: ['Instruction: TokenMint', 'Instruction: Initialize'],
  },
  boop: {
    name: 'Boop.fun',
    programId: 'boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4',
    source: 'boop',
    enabled: true,
    createPatterns: ['Instruction: Create', 'Instruction: Initialize'],
  },
  meteora_dbc: {
    name: 'Meteora DBC',
    programId: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
    source: 'meteora_dbc',
    enabled: true,
    createPatterns: ['Instruction: CreatePool', 'Instruction: InitializePool'],
  },
};

// ── Runtime State ────────────────────────────────────────────────────────

const monitorStates = new Map<string, MonitorState>();
const seenMints = new Map<string, Set<string>>();

/** Rate limiter: max 5 getParsedTransaction calls/sec across all launchpads */
let rpcCallTimestamps: number[] = [];
const MAX_RPC_CALLS_PER_SEC = 5;

/** Health check interval handle */
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 90_000;

// ── Rate Limiting ────────────────────────────────────────────────────────

function canMakeRpcCall(): boolean {
  const now = Date.now();
  // Purge timestamps older than 1 second
  rpcCallTimestamps = rpcCallTimestamps.filter(
    (ts) => now - ts < 1000,
  );
  if (rpcCallTimestamps.length >= MAX_RPC_CALLS_PER_SEC) {
    return false;
  }
  rpcCallTimestamps.push(now);
  return true;
}

async function waitForRpcSlot(): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (canMakeRpcCall()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

// ── Dedup Management ─────────────────────────────────────────────────────

const DEDUP_CAP = 3000;

function isDuplicate(key: string, mint: string): boolean {
  let mintSet = seenMints.get(key);
  if (!mintSet) {
    mintSet = new Set<string>();
    seenMints.set(key, mintSet);
  }
  if (mintSet.has(mint)) return true;

  // Trim oldest half when cap exceeded
  if (mintSet.size >= DEDUP_CAP) {
    const entries = [...mintSet];
    const keepFrom = Math.floor(entries.length / 2);
    mintSet.clear();
    for (let idx = keepFrom; idx < entries.length; idx++) {
      mintSet.add(entries[idx]);
    }
  }

  mintSet.add(mint);
  return false;
}

// ── Metaplex Metadata Parsing ────────────────────────────────────────────

function deriveMetadataPDA(mintPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );
  return pda;
}

function parseMetadataBuffer(
  data: Buffer,
): { name: string; symbol: string } | null {
  try {
    // Layout: key(1) + updateAuthority(32) + mint(32) = 65 bytes offset
    let offset = 65;

    if (data.length < offset + 4) return null;

    // Read name
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    if (nameLen > 200 || data.length < offset + nameLen) return null;
    const name = data
      .subarray(offset, offset + nameLen)
      .toString('utf8')
      .replace(/\0/g, '')
      .trim();
    offset += nameLen;

    // Read symbol
    if (data.length < offset + 4) return { name, symbol: '' };
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    if (symbolLen > 50 || data.length < offset + symbolLen) {
      return { name, symbol: '' };
    }
    const symbol = data
      .subarray(offset, offset + symbolLen)
      .toString('utf8')
      .replace(/\0/g, '')
      .trim();

    return { name, symbol };
  } catch {
    return null;
  }
}

async function fetchMetaplexMetadata(
  mintAddress: string,
): Promise<{ name: string; symbol: string }> {
  const fallback = { name: 'Unknown', symbol: mintAddress.slice(0, 6) };

  try {
    const mintPubkey = new PublicKey(mintAddress);
    const metadataPDA = deriveMetadataPDA(mintPubkey);
    const connection = getSolanaConnection();

    const accountInfo = await withRpcRetry(
      () => connection.getAccountInfo(metadataPDA),
      2,
      500,
    );

    if (!accountInfo?.data) return fallback;

    const parsed = parseMetadataBuffer(Buffer.from(accountInfo.data));
    if (!parsed || !parsed.name) return fallback;

    return {
      name: parsed.name || fallback.name,
      symbol: parsed.symbol || fallback.symbol,
    };
  } catch (err) {
    console.warn(
      `[Launchpads] Failed to fetch metadata for ${mintAddress.slice(0, 8)}...:`,
      err instanceof Error ? err.message : String(err),
    );
    return fallback;
  }
}

// ── Mint Extraction from Parsed Transaction ──────────────────────────────

interface ParsedInnerInstruction {
  instructions: Array<{
    parsed?: {
      type?: string;
      info?: Record<string, unknown>;
    };
    programId?: PublicKey;
  }>;
}

interface TokenBalance {
  mint: string;
  owner?: string;
}

function extractMintFromTransaction(
  tx: {
    meta?: {
      innerInstructions?: ParsedInnerInstruction[] | null;
      preTokenBalances?: TokenBalance[] | null;
      postTokenBalances?: TokenBalance[] | null;
    } | null;
    transaction?: {
      message?: {
        instructions?: Array<{
          parsed?: {
            type?: string;
            info?: Record<string, unknown>;
          };
          programId?: PublicKey;
        }>;
      };
    };
  } | null,
): { mint: string; creator: string | undefined } | null {
  if (!tx?.meta) return null;

  // Strategy A: Look for initializeMint/initializeMint2 in inner instructions
  const innerInstructions = tx.meta.innerInstructions ?? [];
  for (const innerGroup of innerInstructions) {
    for (const ix of innerGroup.instructions) {
      const parsedType = ix.parsed?.type;
      if (
        parsedType === 'initializeMint' ||
        parsedType === 'initializeMint2'
      ) {
        const mint = ix.parsed?.info?.['mint'] as string | undefined;
        const creator = ix.parsed?.info?.['mintAuthority'] as
          | string
          | undefined;
        if (mint) return { mint, creator };
      }
    }
  }

  // Strategy B: Look in top-level instructions
  const topLevelInstructions =
    tx.transaction?.message?.instructions ?? [];
  for (const ix of topLevelInstructions) {
    const parsedType = ix.parsed?.type;
    if (
      parsedType === 'initializeMint' ||
      parsedType === 'initializeMint2'
    ) {
      const mint = ix.parsed?.info?.['mint'] as string | undefined;
      const creator = ix.parsed?.info?.['mintAuthority'] as
        | string
        | undefined;
      if (mint) return { mint, creator };
    }
  }

  // Strategy C: Find new mints in postTokenBalances not in preTokenBalances
  const preMints = new Set(
    (tx.meta.preTokenBalances ?? []).map((b) => b.mint),
  );
  const postBalances = tx.meta.postTokenBalances ?? [];
  for (const balance of postBalances) {
    if (!preMints.has(balance.mint)) {
      return { mint: balance.mint, creator: balance.owner };
    }
  }

  return null;
}

// ── Log Event Handler ────────────────────────────────────────────────────

function createLogHandler(key: string, config: LaunchpadConfig) {
  return async (logs: Logs, _ctx: Context): Promise<void> => {
    try {
      const state = monitorStates.get(key);
      if (state) {
        state.lastLogTimestamp = Date.now();
        state.logsProcessed++;
      }

      // Skip failed transactions
      if (logs.err) return;

      // Check if any log line matches a creation pattern (cheap string check)
      const logLines = logs.logs;
      let isCreate = false;
      for (const line of logLines) {
        for (const pattern of config.createPatterns) {
          if (line.includes(pattern)) {
            isCreate = true;
            break;
          }
        }
        if (isCreate) break;
      }

      // Most transactions are trades, not creates -- bail early
      if (!isCreate) return;

      console.log(
        `[Launchpads] ${config.name}: Create pattern detected in tx ${logs.signature.slice(0, 12)}...`,
      );

      // Rate-limit getParsedTransaction calls
      const hasSlot = await waitForRpcSlot();
      if (!hasSlot) {
        console.warn(
          `[Launchpads] ${config.name}: RPC rate limit reached, skipping tx ${logs.signature.slice(0, 12)}...`,
        );
        return;
      }

      // Fetch full parsed transaction
      const connection = getSolanaConnection();
      const parsedTx = await withRpcRetry(
        () =>
          connection.getParsedTransaction(logs.signature, {
            maxSupportedTransactionVersion: 0,
          }),
        2,
        500,
      );

      if (!parsedTx) {
        console.warn(
          `[Launchpads] ${config.name}: Could not fetch tx ${logs.signature.slice(0, 12)}...`,
        );
        return;
      }

      // Extract mint address
      const extracted = extractMintFromTransaction(parsedTx);
      if (!extracted) {
        console.warn(
          `[Launchpads] ${config.name}: No mint found in tx ${logs.signature.slice(0, 12)}...`,
        );
        return;
      }

      // Dedup check
      if (isDuplicate(key, extracted.mint)) return;

      // Fetch Metaplex metadata
      const metadata = await fetchMetaplexMetadata(extracted.mint);

      const tokenInfo: ParsedTokenInfo = {
        mint: extracted.mint,
        name: metadata.name,
        symbol: metadata.symbol,
        creator: extracted.creator,
      };

      if (state) {
        state.tokensDetected++;
      }

      console.log(
        `[Launchpads] ${config.name}: New token detected: ${tokenInfo.symbol} (${tokenInfo.mint.slice(0, 8)}...)`,
      );

      // Broadcast to WebSocket subscribers
      broadcast('solana:tokens', {
        type: 'launchpad_token',
        source: config.source,
        launchpad: config.name,
        mint: tokenInfo.mint,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        creator: tokenInfo.creator,
        signature: logs.signature,
        detectedAt: new Date().toISOString(),
      });

      // Feed into sniper engine
      onNewTokenDetected({
        mint: tokenInfo.mint,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        usdMarketCap: 0,
        source: config.source,
        creator: tokenInfo.creator,
      });
    } catch (err) {
      console.warn(
        `[Launchpads] ${config.name}: Error processing log event:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  };
}

// ── Monitor Lifecycle ────────────────────────────────────────────────────

function startLaunchpadMonitor(key: string): {
  success: boolean;
  error?: string;
} {
  const config = LAUNCHPAD_CONFIGS[key];
  if (!config) {
    return { success: false, error: `Unknown launchpad: ${key}` };
  }

  const existing = monitorStates.get(key);
  if (existing?.subscriptionId !== null && existing?.subscriptionId !== undefined) {
    return { success: false, error: `${config.name} monitor is already running` };
  }

  try {
    const connection = getSolanaConnection();
    const programPubkey = new PublicKey(config.programId);
    const handler = createLogHandler(key, config);

    const subscriptionId = connection.onLogs(
      programPubkey,
      (logs, ctx) => {
        // Fire-and-forget async handler -- errors are caught internally
        handler(logs, ctx).catch((err) => {
          console.warn(
            `[Launchpads] ${config.name}: Unhandled handler error:`,
            err instanceof Error ? err.message : String(err),
          );
        });
      },
      'confirmed',
    );

    monitorStates.set(key, {
      subscriptionId,
      lastLogTimestamp: Date.now(),
      logsProcessed: 0,
      tokensDetected: 0,
    });

    console.log(
      `[Launchpads] Started ${config.name} monitor (program: ${config.programId.slice(0, 12)}..., subId: ${subscriptionId})`,
    );

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Launchpads] Failed to start ${config.name} monitor:`, message);
    return { success: false, error: message };
  }
}

function stopLaunchpadMonitor(key: string): {
  success: boolean;
  error?: string;
} {
  const config = LAUNCHPAD_CONFIGS[key];
  if (!config) {
    return { success: false, error: `Unknown launchpad: ${key}` };
  }

  const state = monitorStates.get(key);
  if (!state || state.subscriptionId === null) {
    return { success: false, error: `${config.name} monitor is not running` };
  }

  try {
    const connection = getSolanaConnection();
    connection.removeOnLogsListener(state.subscriptionId);

    console.log(
      `[Launchpads] Stopped ${config.name} monitor (subId: ${state.subscriptionId}, logs: ${state.logsProcessed}, tokens: ${state.tokensDetected})`,
    );

    state.subscriptionId = null;
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Launchpads] Failed to stop ${config.name} monitor:`, message);
    return { success: false, error: message };
  }
}

function initLaunchpadMonitors(): void {
  console.log('[Launchpads] Initializing launchpad monitors...');

  let started = 0;
  let skipped = 0;

  for (const [key, config] of Object.entries(LAUNCHPAD_CONFIGS)) {
    if (!config.enabled) {
      console.log(`[Launchpads] ${config.name}: disabled, skipping`);
      skipped++;
      continue;
    }

    const result = startLaunchpadMonitor(key);
    if (result.success) {
      started++;
    } else {
      console.warn(
        `[Launchpads] ${config.name}: failed to start - ${result.error}`,
      );
    }
  }

  // Start health check interval
  if (!healthCheckInterval) {
    healthCheckInterval = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL_MS);
  }

  console.log(
    `[Launchpads] Initialized: ${started} started, ${skipped} skipped`,
  );
}

function stopAllLaunchpadMonitors(): void {
  console.log('[Launchpads] Stopping all launchpad monitors...');

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }

  for (const key of Object.keys(LAUNCHPAD_CONFIGS)) {
    const state = monitorStates.get(key);
    if (state?.subscriptionId !== null && state?.subscriptionId !== undefined) {
      stopLaunchpadMonitor(key);
    }
  }

  console.log('[Launchpads] All monitors stopped');
}

// ── Health Check ─────────────────────────────────────────────────────────

function runHealthCheck(): void {
  const now = Date.now();

  for (const [key, config] of Object.entries(LAUNCHPAD_CONFIGS)) {
    if (!config.enabled) continue;

    const state = monitorStates.get(key);
    if (!state || state.subscriptionId === null) continue;

    const silenceDuration = now - state.lastLogTimestamp;
    if (silenceDuration > STALE_THRESHOLD_MS) {
      console.warn(
        `[Launchpads] ${config.name}: No logs in ${Math.round(silenceDuration / 1000)}s, reconnecting...`,
      );

      // Stop and restart
      stopLaunchpadMonitor(key);
      const result = startLaunchpadMonitor(key);

      if (result.success) {
        console.log(`[Launchpads] ${config.name}: Reconnected successfully`);
      } else {
        console.warn(
          `[Launchpads] ${config.name}: Reconnect failed - ${result.error}`,
        );
      }
    }
  }
}

// ── REST Routes ──────────────────────────────────────────────────────────

const launchpadRouter: ReturnType<typeof Router> = Router();

launchpadRouter.get('/launchpads/status', (_req, res) => {
  const statuses = Object.entries(LAUNCHPAD_CONFIGS).map(([key, config]) => {
    const state = monitorStates.get(key);
    return {
      key,
      name: config.name,
      source: config.source,
      programId: config.programId,
      enabled: config.enabled,
      active: state?.subscriptionId !== null && state?.subscriptionId !== undefined,
      subscriptionId: state?.subscriptionId ?? null,
      lastLogTimestamp: state?.lastLogTimestamp ?? null,
      lastLogAge: state?.lastLogTimestamp
        ? `${Math.round((Date.now() - state.lastLogTimestamp) / 1000)}s ago`
        : null,
      logsProcessed: state?.logsProcessed ?? 0,
      tokensDetected: state?.tokensDetected ?? 0,
      seenMintsCount: seenMints.get(key)?.size ?? 0,
    };
  });

  res.json({
    launchpads: statuses,
    rpcCallsLastSecond: rpcCallTimestamps.filter(
      (ts) => Date.now() - ts < 1000,
    ).length,
    healthCheckIntervalMs: HEALTH_CHECK_INTERVAL_MS,
    staleThresholdMs: STALE_THRESHOLD_MS,
  });
});

launchpadRouter.post('/launchpads/:key/start', (req, res) => {
  const { key } = req.params;

  if (!LAUNCHPAD_CONFIGS[key]) {
    res.status(404).json({
      error: {
        code: 'LAUNCHPAD_NOT_FOUND',
        message: `Unknown launchpad: ${key}. Valid keys: ${Object.keys(LAUNCHPAD_CONFIGS).join(', ')}`,
      },
    });
    return;
  }

  const result = startLaunchpadMonitor(key);
  if (result.success) {
    res.json({ message: `${LAUNCHPAD_CONFIGS[key].name} monitor started` });
  } else {
    res.status(409).json({
      error: {
        code: 'MONITOR_START_FAILED',
        message: result.error,
      },
    });
  }
});

launchpadRouter.post('/launchpads/:key/stop', (req, res) => {
  const { key } = req.params;

  if (!LAUNCHPAD_CONFIGS[key]) {
    res.status(404).json({
      error: {
        code: 'LAUNCHPAD_NOT_FOUND',
        message: `Unknown launchpad: ${key}. Valid keys: ${Object.keys(LAUNCHPAD_CONFIGS).join(', ')}`,
      },
    });
    return;
  }

  const result = stopLaunchpadMonitor(key);
  if (result.success) {
    res.json({ message: `${LAUNCHPAD_CONFIGS[key].name} monitor stopped` });
  } else {
    res.status(409).json({
      error: {
        code: 'MONITOR_STOP_FAILED',
        message: result.error,
      },
    });
  }
});

// ── Exports ──────────────────────────────────────────────────────────────

export { launchpadRouter, initLaunchpadMonitors, stopAllLaunchpadMonitors };
