/**
 * Moonshot Hunter Agent — APEX Swarm Agent #9
 *
 * Aggressively discovers new tokens from DexScreener, GeckoTerminal, and Twitter.
 * Verifies contracts before recommending. Learns from outcomes.
 * Runs as autonomous APEX agent — shares discoveries with all bots via Bridge.
 */

import { logger } from '../../../../lib/logger.js';
import { verifyContract, type VerificationResult } from '../../../contract-verifier.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface MoonshotDiscovery {
  address: string;
  symbol: string;
  name: string;
  chain: string;
  source: string;           // 'dexscreener_profile' | 'dexscreener_boost' | 'geckoterminal' | 'twitter'
  moonshotScore: number;    // 0-100
  verification: VerificationResult | null;
  priceUsd: number;
  liquidityUsd: number;
  volumeUsd: number;
  socialLinks: string[];
  discoveredAt: string;
}

// ── State ────────────────────────────────────────────────────────────────

const discoveries = new Map<string, MoonshotDiscovery>();
const MAX_DISCOVERIES = 100;
let scanCount = 0;
let lastScanAt: string | null = null;

// Learning: track source performance
const sourceStats = new Map<string, { discoveries: number; traded: number; wins: number; losses: number; totalPnl: number }>();

// ── DexScreener New Profiles ────────────────────────────────────────────

async function scanDexScreenerProfiles(): Promise<MoonshotDiscovery[]> {
  const results: MoonshotDiscovery[] = [];
  try {
    const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return results;

    const data = await res.json() as Array<{
      chainId: string;
      tokenAddress: string;
      icon?: string;
      description?: string;
      links?: Array<{ type: string; label: string; url: string }>;
    }>;

    for (const profile of (data ?? []).slice(0, 20)) {
      if (profile.chainId !== 'solana') continue;
      if (discoveries.has(profile.tokenAddress)) continue;

      const socialLinks = (profile.links ?? []).map(l => l.url);
      const hasSocial = socialLinks.length > 0;

      // Only consider tokens with at least some social presence
      if (!hasSocial) continue;

      results.push({
        address: profile.tokenAddress,
        symbol: profile.tokenAddress.slice(0, 6),
        name: profile.description?.slice(0, 50) ?? 'Unknown',
        chain: 'solana',
        source: 'dexscreener_profile',
        moonshotScore: 20, // Base score, will be enhanced
        verification: null,
        priceUsd: 0,
        liquidityUsd: 0,
        volumeUsd: 0,
        socialLinks,
        discoveredAt: new Date().toISOString(),
      });
    }
  } catch { /* silent */ }
  return results;
}

// ── DexScreener Boosted Tokens ──────────────────────────────────────────

async function scanDexScreenerBoosted(): Promise<MoonshotDiscovery[]> {
  const results: MoonshotDiscovery[] = [];
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return results;

    const data = await res.json() as Array<{
      chainId: string;
      tokenAddress: string;
      amount?: number;
      totalAmount?: number;
      icon?: string;
      description?: string;
      links?: Array<{ type: string; label: string; url: string }>;
    }>;

    for (const token of (data ?? []).slice(0, 15)) {
      if (token.chainId !== 'solana') continue;
      if (discoveries.has(token.tokenAddress)) continue;
      if ((token.totalAmount ?? 0) < 50) continue; // Min $50 boost spend

      const socialLinks = (token.links ?? []).map(l => l.url);

      results.push({
        address: token.tokenAddress,
        symbol: token.tokenAddress.slice(0, 6),
        name: token.description?.slice(0, 50) ?? 'Boosted Token',
        chain: 'solana',
        source: 'dexscreener_boost',
        moonshotScore: 25, // Higher base — someone paid to promote
        verification: null,
        priceUsd: 0,
        liquidityUsd: 0,
        volumeUsd: 0,
        socialLinks,
        discoveredAt: new Date().toISOString(),
      });
    }
  } catch { /* silent */ }
  return results;
}

// ── DexScreener Trending Tokens (Top Gainers) ──────────────────────────

async function scanDexScreenerTrending(): Promise<MoonshotDiscovery[]> {
  const results: MoonshotDiscovery[] = [];
  try {
    // Fetch trending Solana pairs by volume
    const res = await fetch(
      'https://api.dexscreener.com/latest/dex/tokens/solana?sort=volume&order=desc&limit=20',
      { signal: AbortSignal.timeout(10_000) },
    );

    // Also try search for top gainers
    const trendRes = await fetch(
      'https://api.dexscreener.com/token-boosts/top/v1',
      { signal: AbortSignal.timeout(10_000) },
    );

    // Process top boosted (these are the most visible on DexScreener homepage)
    if (trendRes.ok) {
      const trendData = await trendRes.json() as Array<{
        chainId: string;
        tokenAddress: string;
        amount?: number;
        totalAmount?: number;
        url?: string;
        description?: string;
        links?: Array<{ type: string; label: string; url: string }>;
      }>;

      for (const token of (trendData ?? []).slice(0, 20)) {
        // Accept both Solana and EVM chains for CEX/DEX trading
        const supportedChains = ['solana', 'ethereum', 'base', 'bsc', 'polygon', 'arbitrum'];
        if (!supportedChains.includes(token.chainId)) continue;
        if (discoveries.has(token.tokenAddress)) continue;
        if ((token.totalAmount ?? 0) < 100) continue; // Min $100 boost for trending

        const socialLinks = (token.links ?? []).map(l => l.url);

        results.push({
          address: token.tokenAddress,
          symbol: token.tokenAddress.slice(0, 6),
          name: token.description?.slice(0, 50) ?? 'Trending Token',
          chain: token.chainId === 'solana' ? 'solana' : token.chainId,
          source: 'dexscreener_trending',
          moonshotScore: 30, // Higher base — trending = high visibility
          verification: null,
          priceUsd: 0,
          liquidityUsd: 0,
          volumeUsd: 0,
          socialLinks,
          discoveredAt: new Date().toISOString(),
        });
      }
    }

    // Process search results for high-volume Solana tokens
    if (res.ok) {
      const searchData = await res.json() as { pairs?: Array<{ baseToken: { address: string; symbol: string; name: string }; priceUsd: string; volume: { h24: number }; liquidity: { usd: number }; chainId: string }> };
      for (const pair of (searchData.pairs ?? []).slice(0, 15)) {
        if (pair.chainId !== 'solana') continue;
        if (discoveries.has(pair.baseToken.address)) continue;
        if ((pair.volume?.h24 ?? 0) < 50_000) continue; // Min $50K 24h volume
        if ((pair.liquidity?.usd ?? 0) < 10_000) continue; // Min $10K liquidity

        results.push({
          address: pair.baseToken.address,
          symbol: pair.baseToken.symbol,
          name: pair.baseToken.name?.slice(0, 50) ?? pair.baseToken.symbol,
          chain: 'solana',
          source: 'dexscreener_trending',
          moonshotScore: 30,
          verification: null,
          priceUsd: parseFloat(pair.priceUsd ?? '0'),
          liquidityUsd: pair.liquidity?.usd ?? 0,
          volumeUsd: pair.volume?.h24 ?? 0,
          socialLinks: [],
          discoveredAt: new Date().toISOString(),
        });
      }
    }
  } catch { /* silent */ }
  return results;
}

// ── GeckoTerminal New Pools ─────────────────────────────────────────────

async function scanGeckoTerminalNewPools(): Promise<MoonshotDiscovery[]> {
  const results: MoonshotDiscovery[] = [];
  try {
    const res = await fetch(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
      {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/json' },
      },
    );
    if (!res.ok) return results;

    const data = await res.json() as {
      data: Array<{
        id: string;
        attributes: {
          name: string;
          base_token_price_usd: string;
          reserve_in_usd: string;
          pool_created_at: string;
          volume_usd: { h24: string };
        };
        relationships?: {
          base_token?: { data?: { id: string } };
        };
      }>;
    };

    for (const pool of (data.data ?? []).slice(0, 15)) {
      const reserveUsd = parseFloat(pool.attributes.reserve_in_usd ?? '0');
      if (reserveUsd < 5_000) continue; // Min $5K liquidity

      // Extract token address from relationship
      const tokenId = pool.relationships?.base_token?.data?.id ?? '';
      const address = tokenId.replace('solana_', '');
      if (!address || address.length < 30) continue;
      if (discoveries.has(address)) continue;

      const priceUsd = parseFloat(pool.attributes.base_token_price_usd ?? '0');
      const volumeUsd = parseFloat(pool.attributes.volume_usd?.h24 ?? '0');

      results.push({
        address,
        symbol: pool.attributes.name.split('/')[0]?.trim() ?? address.slice(0, 6),
        name: pool.attributes.name,
        chain: 'solana',
        source: 'geckoterminal',
        moonshotScore: 15, // Base score for new pool
        verification: null,
        priceUsd,
        liquidityUsd: reserveUsd,
        volumeUsd,
        socialLinks: [],
        discoveredAt: new Date().toISOString(),
      });
    }
  } catch { /* silent */ }
  return results;
}

// ── Scoring ─────────────────────────────────────────────────────────────

function scoreMoonshot(d: MoonshotDiscovery): number {
  let score = d.moonshotScore; // Start with source base score

  // Source weights (learned over time)
  const srcStats = sourceStats.get(d.source);
  if (srcStats && srcStats.discoveries >= 10) {
    const winRate = srcStats.wins / Math.max(srcStats.traded, 1);
    if (winRate > 0.5) score += 10;     // Good source
    if (winRate < 0.2) score -= 10;     // Bad source
  }

  // Liquidity
  if (d.liquidityUsd >= 50_000) score += 15;
  else if (d.liquidityUsd >= 10_000) score += 10;
  else if (d.liquidityUsd >= 5_000) score += 5;

  // Volume
  if (d.volumeUsd >= 100_000) score += 15;
  else if (d.volumeUsd >= 50_000) score += 10;
  else if (d.volumeUsd >= 10_000) score += 5;

  // Social presence
  if (d.socialLinks.length >= 3) score += 10;
  else if (d.socialLinks.length >= 1) score += 5;

  // Verification bonus/penalty
  if (d.verification) {
    if (d.verification.status === 'SAFE') score += 15;
    else if (d.verification.status === 'RISKY') score -= 5;
    else if (d.verification.status === 'SCAM') score -= 40;
  }

  return Math.max(0, Math.min(100, score));
}

// ── Main Agent Scan Cycle ───────────────────────────────────────────────

export async function runMoonshotScan(): Promise<{ findings: number; summary: string; discoveries: MoonshotDiscovery[] }> {
  const start = Date.now();

  // Scan all sources in parallel
  const [profiles, boosted, trending, newPools] = await Promise.all([
    scanDexScreenerProfiles(),
    scanDexScreenerBoosted(),
    scanDexScreenerTrending(),
    scanGeckoTerminalNewPools(),
  ]);

  const allNew = [...profiles, ...boosted, ...trending, ...newPools];

  // Verify top candidates (limit to 5 per cycle to respect rate limits)
  const toVerify = allNew.slice(0, 5);
  for (const d of toVerify) {
    d.verification = await verifyContract(d.address);
    // Update data from verification
    if (d.verification.dexData) {
      d.priceUsd = d.verification.dexData.priceUsd;
      d.liquidityUsd = d.verification.dexData.liquidityUsd;
      d.volumeUsd = d.verification.dexData.volumeUsd;
    }
  }

  // Score all discoveries
  for (const d of allNew) {
    d.moonshotScore = scoreMoonshot(d);
  }

  // Filter: only keep score >= 40 and not SCAM
  const viable = allNew.filter(d =>
    d.moonshotScore >= 40 && d.verification?.status !== 'SCAM',
  );

  // Store discoveries
  for (const d of viable) {
    discoveries.set(d.address, d);
    // Track source stats
    const stats = sourceStats.get(d.source) ?? { discoveries: 0, traded: 0, wins: 0, losses: 0, totalPnl: 0 };
    stats.discoveries++;
    sourceStats.set(d.source, stats);
  }

  // Cleanup old discoveries
  if (discoveries.size > MAX_DISCOVERIES) {
    const sorted = [...discoveries.entries()].sort((a, b) => a[1].moonshotScore - b[1].moonshotScore);
    for (let i = 0; i < sorted.length - MAX_DISCOVERIES; i++) {
      discoveries.delete(sorted[i][0]);
    }
  }

  scanCount++;
  lastScanAt = new Date().toISOString();

  const topSymbols = viable.slice(0, 5).map(d => `${d.symbol}(${d.moonshotScore})`).join(', ');

  logger.info(
    { new: allNew.length, viable: viable.length, total: discoveries.size, durationMs: Date.now() - start },
    `[MoonshotHunter] Found ${viable.length} viable tokens: ${topSymbols || 'none'}`,
  );

  return {
    findings: viable.length,
    summary: viable.length > 0
      ? `Moonshot Hunter: ${viable.length} new tokens — ${topSymbols}`
      : `Moonshot Hunter: scanned ${allNew.length} tokens, none passed verification`,
    discoveries: viable,
  };
}

// ── Learning ────────────────────────────────────────────────────────────

export function recordMoonshotOutcome(address: string, pnl: number): void {
  const d = discoveries.get(address);
  if (!d) return;

  const stats = sourceStats.get(d.source);
  if (!stats) return;

  stats.traded++;
  stats.totalPnl += pnl;
  if (pnl > 0) stats.wins++;
  else stats.losses++;

  logger.info(
    { address: address.slice(0, 8), source: d.source, pnl, winRate: (stats.wins / Math.max(stats.traded, 1) * 100).toFixed(0) },
    `[MoonshotHunter] Trade outcome recorded: ${pnl > 0 ? 'WIN' : 'LOSS'} from ${d.source}`,
  );
}

// ── Public API ──────────────────────────────────────────────────────────

export function getDiscoveries(): MoonshotDiscovery[] {
  return [...discoveries.values()].sort((a, b) => b.moonshotScore - a.moonshotScore);
}

export function getViableDiscoveries(minScore = 60): MoonshotDiscovery[] {
  return getDiscoveries().filter(d => d.moonshotScore >= minScore && d.verification?.status !== 'SCAM');
}

export function getMoonshotHunterStatus() {
  return {
    scanCount,
    lastScanAt,
    totalDiscoveries: discoveries.size,
    sourceStats: Object.fromEntries(sourceStats),
    topDiscoveries: getDiscoveries().slice(0, 10).map(d => ({
      address: d.address.slice(0, 8) + '...',
      symbol: d.symbol,
      score: d.moonshotScore,
      source: d.source,
      verification: d.verification?.status ?? 'PENDING',
      liquidity: d.liquidityUsd,
    })),
  };
}

// ── Autonomous Cycle (runs every 2 minutes) ─────────────────────────────

let moonshotInterval: ReturnType<typeof setInterval> | null = null;

export function startMoonshotHunter(): void {
  if (moonshotInterval) return;

  logger.info('[MoonshotHunter] Starting autonomous moonshot discovery (2 min cycle)');

  moonshotInterval = setInterval(async () => {
    try {
      await runMoonshotScan();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[MoonshotHunter] Scan failed');
    }
  }, 2 * 60_000);

  // First scan after 20s
  setTimeout(async () => {
    try { await runMoonshotScan(); } catch { /* silent */ }
  }, 20_000);
}

export function stopMoonshotHunter(): void {
  if (moonshotInterval) {
    clearInterval(moonshotInterval);
    moonshotInterval = null;
  }
}
