/**
 * Liquidity Monitor — Phase 5: On-Chain Analytics
 *
 * Monitors liquidity changes for tokens in active positions.
 * Critical for detecting rug pulls in progress — a rapid liquidity
 * drop is the strongest on-chain signal of a rug.
 *
 * Data source: DexScreener pairs API (free, no key needed)
 *   - liquidity.usd field from pair data
 *
 * Stores up to 10 snapshots per token (30s recommended interval).
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface LiquiditySnapshot {
  mint: string;
  liquidityUsd: number;
  timestamp: number; // ms
}

export interface LiquidityCheck {
  currentLiquidityUsd: number;
  change5m: number;     // % change in last 5 minutes
  change1h: number;     // % change in last hour
  isDropping: boolean;  // >30% drop in 5 min
  alert: string | null; // human-readable alert if concerning
}

interface DexScreenerPairData {
  chainId?: string;
  liquidity?: { usd?: number };
  baseToken?: { symbol?: string };
}

interface DexScreenerResponse {
  pairs?: DexScreenerPairData[];
}

// ── State ──────────────────────────────────────────────────────────────

const MAX_SNAPSHOTS_PER_TOKEN = 10;
const liquidityHistory: Map<string, LiquiditySnapshot[]> = new Map();

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Record a liquidity snapshot for a token.
 * Call this each monitoring cycle (~30s) for active positions.
 */
export function recordLiquiditySnapshot(mint: string, liquidityUsd: number): void {
  if (!Number.isFinite(liquidityUsd) || liquidityUsd < 0) return;

  const snapshots = liquidityHistory.get(mint) ?? [];
  snapshots.push({ mint, liquidityUsd, timestamp: Date.now() });

  // Keep only the most recent N snapshots
  if (snapshots.length > MAX_SNAPSHOTS_PER_TOKEN) {
    snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS_PER_TOKEN);
  }

  liquidityHistory.set(mint, snapshots);
}

/**
 * Get the full liquidity history for a token.
 */
export function getLiquidityHistory(mint: string): LiquiditySnapshot[] {
  return liquidityHistory.get(mint) ?? [];
}

/**
 * Clear liquidity data for a token (e.g., after position is closed).
 */
export function clearLiquidityData(mint: string): void {
  liquidityHistory.delete(mint);
}

/**
 * Check current liquidity status with change detection and alerts.
 *
 * Fetches live liquidity from DexScreener, records a snapshot,
 * and computes % changes over 5-minute and 1-hour windows.
 */
export async function checkLiquidity(mint: string): Promise<LiquidityCheck> {
  const fallback: LiquidityCheck = {
    currentLiquidityUsd: 0,
    change5m: 0,
    change1h: 0,
    isDropping: false,
    alert: null,
  };

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { signal: AbortSignal.timeout(5000) },
    );

    if (!response.ok) return fallback;

    const data = (await response.json()) as DexScreenerResponse;
    const pair = (data.pairs ?? []).find(
      (p) => p.chainId === 'solana' && p.liquidity?.usd !== undefined,
    );

    if (!pair?.liquidity?.usd) return fallback;

    const currentLiquidityUsd = pair.liquidity.usd;
    const symbol = pair.baseToken?.symbol ?? mint.slice(0, 8);

    // Record this snapshot
    recordLiquiditySnapshot(mint, currentLiquidityUsd);

    const snapshots = liquidityHistory.get(mint) ?? [];
    const now = Date.now();

    // Calculate 5-minute change
    const fiveMinAgo = now - 5 * 60 * 1000;
    const snapshot5m = findClosestSnapshot(snapshots, fiveMinAgo);
    const change5m = snapshot5m && snapshot5m.liquidityUsd > 0
      ? ((currentLiquidityUsd - snapshot5m.liquidityUsd) / snapshot5m.liquidityUsd) * 100
      : 0;

    // Calculate 1-hour change
    const oneHourAgo = now - 60 * 60 * 1000;
    const snapshot1h = findClosestSnapshot(snapshots, oneHourAgo);
    const change1h = snapshot1h && snapshot1h.liquidityUsd > 0
      ? ((currentLiquidityUsd - snapshot1h.liquidityUsd) / snapshot1h.liquidityUsd) * 100
      : 0;

    // Alert logic
    const isDropping = change5m < -30;
    let alert: string | null = null;

    if (change5m < -30) {
      alert = `LIQUIDITY CRASH: ${symbol} lost ${Math.abs(change5m).toFixed(1)}% liquidity in 5 min — possible rug pull`;
      console.warn(`[LiqMonitor] ${alert}`);
    } else if (change1h < -50) {
      alert = `MAJOR LIQUIDITY EXIT: ${symbol} lost ${Math.abs(change1h).toFixed(1)}% liquidity in 1 hour`;
      console.warn(`[LiqMonitor] ${alert}`);
    }

    return { currentLiquidityUsd, change5m, change1h, isDropping, alert };
  } catch (err) {
    console.warn(
      `[LiqMonitor] Failed to check liquidity for ${mint.slice(0, 8)}...:`,
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Find the snapshot closest to the target timestamp.
 * Returns null if no snapshot is within a reasonable window.
 */
function findClosestSnapshot(
  snapshots: LiquiditySnapshot[],
  targetTimestamp: number,
): LiquiditySnapshot | null {
  if (snapshots.length === 0) return null;

  let closest: LiquiditySnapshot | null = null;
  let closestDiff = Infinity;

  for (const snap of snapshots) {
    // Only consider snapshots older than or equal to the target
    if (snap.timestamp > targetTimestamp) continue;
    const diff = targetTimestamp - snap.timestamp;
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = snap;
    }
  }

  return closest;
}
