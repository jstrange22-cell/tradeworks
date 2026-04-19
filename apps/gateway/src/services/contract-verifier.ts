/**
 * Contract Address Verifier — Multi-Source Token Safety Pipeline
 *
 * Verifies a token contract is legitimate before any bot trades it.
 * Sources: DexScreener, RugCheck, Jupiter verified list, on-chain checks.
 *
 * Result: SAFE / RISKY / SCAM with score 0-100 and reasons.
 */

import { logger } from '../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface VerificationResult {
  address: string;
  chain: 'solana' | 'ethereum' | 'base' | 'unknown';
  status: 'SAFE' | 'RISKY' | 'SCAM' | 'UNKNOWN';
  score: number;          // 0-100 (higher = safer)
  reasons: string[];
  dexData: {
    hasLiquidity: boolean;
    liquidityUsd: number;
    volumeUsd: number;
    pairCount: number;
    ageMinutes: number;
    priceUsd: number;
  } | null;
  rugCheck: {
    riskScore: number;
    mintRevoked: boolean;
    freezeRevoked: boolean;
    bundleDetected: boolean;
    risks: string[];
  } | null;
  jupiterVerified: boolean;
  verifiedAt: string;
}

// ── Verification Cache ──────────────────────────────────────────────────

const verificationCache = new Map<string, { result: VerificationResult; cachedAt: number }>();
const CACHE_TTL = 10 * 60_000; // 10 minutes

export function getCachedVerification(address: string): VerificationResult | null {
  const cached = verificationCache.get(address);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) return cached.result;
  return null;
}

// ── DexScreener Verification ────────────────────────────────────────────

async function checkDexScreener(address: string): Promise<VerificationResult['dexData']> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      pairs?: Array<{
        chainId: string;
        liquidity?: { usd?: number };
        volume?: { h24?: number };
        priceUsd?: string;
        pairCreatedAt?: number;
      }>;
    };

    const pairs = data.pairs ?? [];
    if (pairs.length === 0) return null;

    const bestPair = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const liquidityUsd = bestPair.liquidity?.usd ?? 0;
    const volumeUsd = bestPair.volume?.h24 ?? 0;
    const priceUsd = parseFloat(bestPair.priceUsd ?? '0');
    const createdAt = bestPair.pairCreatedAt ?? Date.now();
    const ageMinutes = (Date.now() - createdAt) / 60_000;

    return {
      hasLiquidity: liquidityUsd > 0,
      liquidityUsd,
      volumeUsd,
      pairCount: pairs.length,
      ageMinutes,
      priceUsd,
    };
  } catch {
    return null;
  }
}

// ── RugCheck Verification (Solana) ──────────────────────────────────────

async function checkRugCheck(address: string): Promise<VerificationResult['rugCheck']> {
  try {
    const res = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      score?: number;
      score_normalised?: number;
      risks?: Array<{ name: string; level: string; description: string }>;
    };

    const risks = data.risks ?? [];
    const mintRevoked = !risks.some(r => r.name.toLowerCase().includes('mint authority'));
    const freezeRevoked = !risks.some(r => r.name.toLowerCase().includes('freeze authority'));
    const bundleDetected = risks.some(r => r.name.toLowerCase().includes('bundle'));

    return {
      riskScore: data.score_normalised ?? data.score ?? 100,
      mintRevoked,
      freezeRevoked,
      bundleDetected,
      risks: risks.filter(r => r.level === 'danger' || r.level === 'warn').map(r => r.name),
    };
  } catch {
    return null;
  }
}

// ── Jupiter Verified Check (Solana) ─────────────────────────────────────

async function checkJupiterVerified(address: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://tokens.jup.ag/token/${address}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return false;

    const data = await res.json() as { tags?: string[] };
    return data.tags?.includes('verified') ?? false;
  } catch {
    return false;
  }
}

// ── Main Verification Pipeline ──────────────────────────────────────────

export async function verifyContract(address: string): Promise<VerificationResult> {
  // Check cache first
  const cached = getCachedVerification(address);
  if (cached) return cached;

  const start = Date.now();
  let score = 50; // Start neutral
  const reasons: string[] = [];

  // Detect chain from address format
  const chain = address.startsWith('0x') ? 'ethereum' as const
    : address.length >= 32 && address.length <= 44 ? 'solana' as const
    : 'unknown' as const;

  // Run all checks in parallel
  const [dexData, rugCheck, jupiterVerified] = await Promise.all([
    checkDexScreener(address),
    chain === 'solana' ? checkRugCheck(address) : Promise.resolve(null),
    chain === 'solana' ? checkJupiterVerified(address) : Promise.resolve(false),
  ]);

  // ── Score DexScreener data ──────────────────────────────────────────

  if (dexData) {
    if (dexData.hasLiquidity && dexData.liquidityUsd >= 5_000) {
      score += 15;
      reasons.push(`Liquidity: $${Math.round(dexData.liquidityUsd).toLocaleString()}`);
    } else if (dexData.liquidityUsd < 1_000) {
      score -= 20;
      reasons.push(`LOW LIQUIDITY: $${Math.round(dexData.liquidityUsd)}`);
    }

    if (dexData.volumeUsd > 50_000) {
      score += 10;
      reasons.push(`Volume: $${Math.round(dexData.volumeUsd).toLocaleString()}/24h`);
    }

    if (dexData.ageMinutes < 5) {
      score -= 15;
      reasons.push(`VERY NEW: ${Math.round(dexData.ageMinutes)} minutes old`);
    } else if (dexData.ageMinutes > 60) {
      score += 5;
      reasons.push(`Age: ${Math.round(dexData.ageMinutes / 60)}h old`);
    }

    if (dexData.pairCount >= 2) {
      score += 5;
      reasons.push(`${dexData.pairCount} trading pairs`);
    }
  } else {
    score -= 25;
    reasons.push('NOT ON DEXSCREENER — no trading pairs found');
  }

  // ── Score RugCheck data ─────────────────────────────────────────────

  if (rugCheck) {
    if (rugCheck.mintRevoked) {
      score += 15;
      reasons.push('Mint authority revoked');
    } else {
      score -= 25;
      reasons.push('DANGER: Mint authority NOT revoked');
    }

    if (rugCheck.freezeRevoked) {
      score += 10;
      reasons.push('Freeze authority revoked');
    } else {
      score -= 15;
      reasons.push('WARNING: Freeze authority enabled');
    }

    if (rugCheck.bundleDetected) {
      score -= 30;
      reasons.push('DANGER: Bundle/sniper detected');
    }

    if (rugCheck.riskScore < 30) {
      score += 10;
      reasons.push(`RugCheck score: ${rugCheck.riskScore} (good)`);
    } else if (rugCheck.riskScore > 70) {
      score -= 15;
      reasons.push(`RugCheck score: ${rugCheck.riskScore} (risky)`);
    }
  }

  // ── Jupiter verified bonus ──────────────────────────────────────────

  if (jupiterVerified) {
    score += 15;
    reasons.push('Jupiter VERIFIED token');
  }

  // ── Clamp and classify ──────────────────────────────────────────────

  score = Math.max(0, Math.min(100, score));
  const status = score >= 70 ? 'SAFE' : score >= 40 ? 'RISKY' : 'SCAM';

  const result: VerificationResult = {
    address,
    chain,
    status,
    score,
    reasons,
    dexData,
    rugCheck,
    jupiterVerified,
    verifiedAt: new Date().toISOString(),
  };

  // Cache result
  verificationCache.set(address, { result, cachedAt: Date.now() });

  logger.info(
    { address: address.slice(0, 8), status, score, chain, durationMs: Date.now() - start },
    `[ContractVerifier] ${address.slice(0, 8)}... → ${status} (${score}/100)`,
  );

  return result;
}

// ── Batch verification ──────────────────────────────────────────────────

export async function verifyBatch(addresses: string[]): Promise<VerificationResult[]> {
  // Run up to 5 in parallel to respect rate limits
  const results: VerificationResult[] = [];
  for (let i = 0; i < addresses.length; i += 5) {
    const batch = addresses.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(verifyContract));
    results.push(...batchResults);
    if (i + 5 < addresses.length) {
      await new Promise(r => setTimeout(r, 1_000)); // 1s delay between batches
    }
  }
  return results;
}

export function getVerificationStats() {
  const all = [...verificationCache.values()].map(v => v.result);
  return {
    cached: verificationCache.size,
    safe: all.filter(r => r.status === 'SAFE').length,
    risky: all.filter(r => r.status === 'RISKY').length,
    scam: all.filter(r => r.status === 'SCAM').length,
  };
}
