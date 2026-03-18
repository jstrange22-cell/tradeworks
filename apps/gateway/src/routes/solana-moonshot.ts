import { Router, type Router as RouterType } from 'express';
import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { getSolanaConnection } from './solana-utils.js';

/**
 * Moonshot Scoring AI — Sprint 8.4
 *
 * Multi-factor scoring engine to identify potential moonshot tokens.
 * Combines on-chain data, social signals, volume patterns, and rug
 * detection into a single 0-100 "moonshot score".
 *
 * Routes:
 *   POST /api/v1/solana/moonshot/score          — Score a single token
 *   POST /api/v1/solana/moonshot/scan           — Scan & score trending tokens
 *   GET  /api/v1/solana/moonshot/leaderboard    — Top scored tokens
 *   GET  /api/v1/solana/moonshot/alerts          — Recent high-score alerts
 *   PUT  /api/v1/solana/moonshot/config          — Update scoring weights
 *   GET  /api/v1/solana/moonshot/config          — Get scoring config
 */

export const moonshotRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface MoonshotScore {
  mint: string;
  symbol: string;
  name: string;
  /** Overall moonshot score: 0-100 */
  score: number;
  /** Score breakdown by category */
  factors: {
    safety: FactorScore;
    volume: FactorScore;
    momentum: FactorScore;
    social: FactorScore;
    liquidity: FactorScore;
    age: FactorScore;
    holderDistribution: FactorScore;
  };
  /** Rug detection */
  rugRisk: 'low' | 'medium' | 'high' | 'critical';
  rugWarnings: string[];
  /** Market data snapshot */
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  priceChange24h: number;
  /** Metadata */
  scoredAt: string;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'avoid' | 'danger';
}

interface FactorScore {
  score: number; // 0-100
  weight: number; // 0-1
  weighted: number; // score * weight
  details: string;
}

interface ScoringConfig {
  weights: {
    safety: number;
    volume: number;
    momentum: number;
    social: number;
    liquidity: number;
    age: number;
    holderDistribution: number;
  };
  /** Min score to trigger alert */
  alertThreshold: number;
  /** Auto-scan interval in seconds (0 = disabled) */
  autoScanIntervalSec: number;
}

// ── State ──────────────────────────────────────────────────────────────

let scoringConfig: ScoringConfig = {
  weights: {
    safety: 0.25,
    volume: 0.15,
    momentum: 0.20,
    social: 0.10,
    liquidity: 0.15,
    age: 0.05,
    holderDistribution: 0.10,
  },
  alertThreshold: 70,
  autoScanIntervalSec: 0,
};

const scoreCache: Map<string, MoonshotScore> = new Map();

/**
 * Look up a token's moonshot score from the cache.
 * Returns the 0-100 score if the token has been scored, null otherwise.
 * Used by the sniper engine to make AI-informed buy decisions.
 */
export function getMoonshotScore(mint: string): number | null {
  const scored = scoreCache.get(mint);
  return scored?.score ?? null;
}
const scoreHistory: MoonshotScore[] = [];
const alerts: MoonshotScore[] = [];
const MAX_HISTORY = 500;
const MAX_ALERTS = 100;
let autoScanInterval: ReturnType<typeof setInterval> | null = null;

// ── Scoring Engine ─────────────────────────────────────────────────────

async function scoreToken(mint: string): Promise<MoonshotScore> {
  // 1. Fetch market data from Dexscreener
  const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  let priceUsd = 0, marketCap = 0, volume24h = 0, liquidity = 0, priceChange24h = 0;
  let priceChange1h = 0, priceChange5m = 0, txnsBuys24h = 0, txnsSells24h = 0;
  let symbol = 'UNKNOWN', name = 'Unknown Token';
  let pairCreatedAt: number | null = null;
  let website: string | null = null, twitter: string | null = null;

  if (dexRes.ok) {
    const data = (await dexRes.json()) as { pairs?: Array<Record<string, unknown>> };
    const pair = (data.pairs ?? [])
      .filter(p => (p.chainId as string) === 'solana')
      .sort((a, b) =>
        ((b.liquidity as Record<string, number>)?.usd ?? 0) -
        ((a.liquidity as Record<string, number>)?.usd ?? 0),
      )[0];

    if (pair) {
      const baseToken = pair.baseToken as Record<string, string> | undefined;
      symbol = baseToken?.symbol ?? 'UNKNOWN';
      name = baseToken?.name ?? 'Unknown Token';
      priceUsd = parseFloat((pair.priceUsd as string) ?? '0');
      marketCap = (pair.marketCap as number) ?? 0;
      volume24h = ((pair.volume as Record<string, number>)?.h24 ?? 0);
      liquidity = ((pair.liquidity as Record<string, number>)?.usd ?? 0);

      const priceChange = pair.priceChange as Record<string, number> | undefined;
      priceChange24h = priceChange?.h24 ?? 0;
      priceChange1h = priceChange?.h1 ?? 0;
      priceChange5m = priceChange?.m5 ?? 0;

      const txns = pair.txns as Record<string, Record<string, number>> | undefined;
      txnsBuys24h = txns?.h24?.buys ?? 0;
      txnsSells24h = txns?.h24?.sells ?? 0;

      pairCreatedAt = (pair.pairCreatedAt as number) ?? null;

      const info = pair.info as Record<string, unknown> | undefined;
      const socials = info?.socials as Array<Record<string, string>> | undefined;
      website = (info?.websites as Array<Record<string, string>>)?.[0]?.url ?? null;
      twitter = socials?.find(s => s.type === 'twitter')?.url ?? null;
    }
  }

  // 2. On-chain safety checks
  let mintAuthorityRevoked = false;
  let freezeAuthorityRevoked = false;
  let top10HolderPercent: number | null = null;
  const rugWarnings: string[] = [];

  try {
    const connection = getSolanaConnection();
    const mintPubkey = new PublicKey(mint);
    const mintInfo = await getMint(connection, mintPubkey);

    mintAuthorityRevoked = mintInfo.mintAuthority === null;
    freezeAuthorityRevoked = mintInfo.freezeAuthority === null;

    if (!mintAuthorityRevoked) rugWarnings.push('Mint authority NOT revoked');
    if (!freezeAuthorityRevoked) rugWarnings.push('Freeze authority NOT revoked');

    // Holder distribution
    try {
      const largest = await connection.getTokenLargestAccounts(mintPubkey);
      if (largest.value.length > 0) {
        const supply = await connection.getTokenSupply(mintPubkey);
        const totalSupply = parseFloat(supply.value.uiAmountString ?? '0');
        if (totalSupply > 0) {
          const top10 = largest.value
            .slice(0, 10)
            .reduce((s, a) => s + parseFloat(a.uiAmountString ?? '0'), 0);
          top10HolderPercent = (top10 / totalSupply) * 100;

          if (top10HolderPercent > 90) rugWarnings.push('Top 10 holders own >90% — extreme concentration');
          else if (top10HolderPercent > 70) rugWarnings.push('Top 10 holders own >70% — high concentration');
        }
      }
    } catch { /* RPC limitation */ }
  } catch {
    rugWarnings.push('Could not verify on-chain data');
  }

  // 3. Score each factor
  const w = scoringConfig.weights;

  // Safety (25%): mint/freeze authority, holder concentration
  const safetyRaw = (
    (mintAuthorityRevoked ? 40 : 0) +
    (freezeAuthorityRevoked ? 30 : 0) +
    (top10HolderPercent !== null
      ? (top10HolderPercent < 30 ? 30 : top10HolderPercent < 50 ? 20 : top10HolderPercent < 70 ? 10 : 0)
      : 15) // Give partial credit if unknown
  );
  const safety: FactorScore = {
    score: Math.min(100, safetyRaw),
    weight: w.safety,
    weighted: Math.min(100, safetyRaw) * w.safety,
    details: `Mint ${mintAuthorityRevoked ? '✓' : '✗'}, Freeze ${freezeAuthorityRevoked ? '✓' : '✗'}, Top10: ${top10HolderPercent?.toFixed(0) ?? '?'}%`,
  };

  // Volume (15%): 24h volume relative to market cap
  const volumeToMcap = marketCap > 0 ? (volume24h / marketCap) * 100 : 0;
  const volumeRaw = Math.min(100, volumeToMcap > 200 ? 100 : volumeToMcap > 100 ? 85 : volumeToMcap > 50 ? 70 : volumeToMcap > 20 ? 50 : volumeToMcap > 5 ? 30 : 10);
  const volume: FactorScore = {
    score: volumeRaw,
    weight: w.volume,
    weighted: volumeRaw * w.volume,
    details: `Vol/MCap: ${volumeToMcap.toFixed(0)}%, Vol: $${formatCompact(volume24h)}`,
  };

  // Momentum (20%): price change acceleration
  const momentumRaw = Math.min(100, Math.max(0,
    (priceChange5m > 5 ? 30 : priceChange5m > 0 ? 15 : 0) +
    (priceChange1h > 10 ? 30 : priceChange1h > 0 ? 15 : 0) +
    (priceChange24h > 50 ? 40 : priceChange24h > 20 ? 30 : priceChange24h > 0 ? 15 : 0),
  ));
  const momentum: FactorScore = {
    score: momentumRaw,
    weight: w.momentum,
    weighted: momentumRaw * w.momentum,
    details: `5m: ${priceChange5m.toFixed(1)}%, 1h: ${priceChange1h.toFixed(1)}%, 24h: ${priceChange24h.toFixed(1)}%`,
  };

  // Social (10%): presence of website/twitter + reply count (pump.fun)
  let socialRaw = 0;
  if (website) socialRaw += 30;
  if (twitter) socialRaw += 30;

  // Check pump.fun for social signals
  try {
    const pfRes = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);
    if (pfRes.ok) {
      const pfData = (await pfRes.json()) as Record<string, unknown>;
      const replies = (pfData.reply_count as number) ?? 0;
      socialRaw += Math.min(40, replies > 100 ? 40 : replies > 50 ? 30 : replies > 10 ? 20 : replies > 0 ? 10 : 0);
    }
  } catch { /* not a pump.fun token */ }

  const social: FactorScore = {
    score: Math.min(100, socialRaw),
    weight: w.social,
    weighted: Math.min(100, socialRaw) * w.social,
    details: `Web: ${website ? '✓' : '✗'}, Twitter: ${twitter ? '✓' : '✗'}`,
  };

  // Liquidity (15%): absolute liquidity + ratio to market cap
  const liqRaw = Math.min(100,
    (liquidity > 100000 ? 50 : liquidity > 50000 ? 40 : liquidity > 10000 ? 30 : liquidity > 5000 ? 20 : 10) +
    (marketCap > 0 && liquidity / marketCap > 0.1 ? 50 : liquidity / marketCap > 0.05 ? 30 : 10),
  );
  const liqScore: FactorScore = {
    score: liqRaw,
    weight: w.liquidity,
    weighted: liqRaw * w.liquidity,
    details: `$${formatCompact(liquidity)} (${marketCap > 0 ? ((liquidity / marketCap) * 100).toFixed(1) : '?'}% of MCap)`,
  };

  // Age (5%): newer tokens have higher moonshot potential
  const ageHours = pairCreatedAt ? (Date.now() - pairCreatedAt) / 3600000 : 999;
  const ageRaw = ageHours < 1 ? 100 : ageHours < 6 ? 85 : ageHours < 24 ? 70 : ageHours < 72 ? 50 : ageHours < 168 ? 30 : 10;
  const age: FactorScore = {
    score: ageRaw,
    weight: w.age,
    weighted: ageRaw * w.age,
    details: ageHours < 24 ? `${ageHours.toFixed(1)}h old` : `${(ageHours / 24).toFixed(1)}d old`,
  };

  // Holder distribution (10%)
  const holderRaw = top10HolderPercent !== null
    ? (top10HolderPercent < 20 ? 100 : top10HolderPercent < 40 ? 75 : top10HolderPercent < 60 ? 50 : top10HolderPercent < 80 ? 25 : 5)
    : 40; // Unknown gets middle score
  const holderDist: FactorScore = {
    score: holderRaw,
    weight: w.holderDistribution,
    weighted: holderRaw * w.holderDistribution,
    details: top10HolderPercent !== null ? `Top 10: ${top10HolderPercent.toFixed(1)}%` : 'Unknown',
  };

  // 4. Calculate overall score
  const totalScore = Math.round(
    safety.weighted + volume.weighted + momentum.weighted +
    social.weighted + liqScore.weighted + age.weighted + holderDist.weighted,
  );

  // 5. Rug risk assessment
  let rugRisk: MoonshotScore['rugRisk'] = 'low';
  if (!mintAuthorityRevoked && !freezeAuthorityRevoked) rugRisk = 'critical';
  else if (!mintAuthorityRevoked || !freezeAuthorityRevoked) rugRisk = 'high';
  else if (top10HolderPercent !== null && top10HolderPercent > 80) rugRisk = 'high';
  else if (top10HolderPercent !== null && top10HolderPercent > 50) rugRisk = 'medium';

  // Buy/sell ratio check
  const totalTxns = txnsBuys24h + txnsSells24h;
  if (totalTxns > 20 && txnsSells24h > txnsBuys24h * 2) {
    rugWarnings.push('Sell pressure > 2x buy pressure — possible dump');
    if (rugRisk === 'low') rugRisk = 'medium';
  }

  // 6. Recommendation
  let recommendation: MoonshotScore['recommendation'] = 'hold';
  if (rugRisk === 'critical') recommendation = 'danger';
  else if (rugRisk === 'high') recommendation = 'avoid';
  else if (totalScore >= 80) recommendation = 'strong_buy';
  else if (totalScore >= 60) recommendation = 'buy';
  else if (totalScore < 30) recommendation = 'avoid';

  const result: MoonshotScore = {
    mint,
    symbol,
    name,
    score: totalScore,
    factors: {
      safety,
      volume,
      momentum,
      social,
      liquidity: liqScore,
      age,
      holderDistribution: holderDist,
    },
    rugRisk,
    rugWarnings,
    priceUsd,
    marketCap,
    volume24h,
    liquidity,
    priceChange24h,
    scoredAt: new Date().toISOString(),
    recommendation,
  };

  // Cache and store
  scoreCache.set(mint, result);
  scoreHistory.unshift(result);
  if (scoreHistory.length > MAX_HISTORY) scoreHistory.pop();

  // Alert if above threshold
  if (totalScore >= scoringConfig.alertThreshold && rugRisk !== 'critical') {
    alerts.unshift(result);
    if (alerts.length > MAX_ALERTS) alerts.pop();
  }

  return result;
}

// ── Routes ─────────────────────────────────────────────────────────────

// POST /moonshot/score — Score a single token
moonshotRouter.post('/moonshot/score', async (req, res) => {
  try {
    const { mint } = req.body as { mint: string };
    if (!mint) {
      res.status(400).json({ error: 'Missing required field: mint' });
      return;
    }

    const score = await scoreToken(mint);
    res.json({ data: score });
  } catch (err) {
    console.error('[Moonshot] Score failed:', err);
    res.status(500).json({
      error: 'Failed to score token',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /moonshot/scan — Scan and score trending tokens
moonshotRouter.post('/moonshot/scan', async (req, res) => {
  try {
    const { limit = 10 } = req.body as { limit?: number };

    // Fetch trending from Dexscreener
    const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    if (!boostsRes.ok) {
      res.status(500).json({ error: 'Failed to fetch trending tokens' });
      return;
    }

    const boosts = (await boostsRes.json()) as Array<{ tokenAddress: string; chainId: string }>;
    const solanaMints = [...new Set(
      boosts.filter(b => b.chainId === 'solana').map(b => b.tokenAddress),
    )].slice(0, Math.min(limit, 20));

    const scores: MoonshotScore[] = [];
    for (const mint of solanaMints) {
      try {
        const score = await scoreToken(mint);
        scores.push(score);
      } catch (err) {
        console.error(`[Moonshot] Failed to score ${mint}:`, err);
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    res.json({
      data: scores,
      total: scores.length,
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Moonshot] Scan failed:', err);
    res.status(500).json({
      error: 'Failed to scan tokens',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /moonshot/leaderboard — Top scored tokens
moonshotRouter.get('/moonshot/leaderboard', (_req, res) => {
  const topScores = [...scoreCache.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  res.json({
    data: topScores,
    total: topScores.length,
  });
});

// GET /moonshot/alerts — Recent high-score alerts
moonshotRouter.get('/moonshot/alerts', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10), 100);

  res.json({
    data: alerts.slice(0, limit),
    total: alerts.length,
    threshold: scoringConfig.alertThreshold,
  });
});

// PUT /moonshot/config
moonshotRouter.put('/moonshot/config', (req, res) => {
  const updates = req.body as Partial<ScoringConfig>;

  if (updates.weights) {
    // Validate weights sum to ~1.0
    const total = Object.values(updates.weights).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 1.0) > 0.05) {
      res.status(400).json({
        error: `Weights must sum to 1.0 (got ${total.toFixed(3)})`,
      });
      return;
    }
    scoringConfig.weights = { ...scoringConfig.weights, ...updates.weights };
  }

  if (updates.alertThreshold !== undefined) {
    scoringConfig.alertThreshold = updates.alertThreshold;
  }

  if (updates.autoScanIntervalSec !== undefined) {
    scoringConfig.autoScanIntervalSec = updates.autoScanIntervalSec;

    // Update auto-scan interval
    if (autoScanInterval) {
      clearInterval(autoScanInterval);
      autoScanInterval = null;
    }

    if (updates.autoScanIntervalSec > 0) {
      autoScanInterval = setInterval(async () => {
        try {
          const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
          if (!boostsRes.ok) return;
          const boosts = (await boostsRes.json()) as Array<{ tokenAddress: string; chainId: string }>;
          const mints = [...new Set(
            boosts.filter(b => b.chainId === 'solana').map(b => b.tokenAddress),
          )].slice(0, 10);

          for (const mint of mints) {
            try { await scoreToken(mint); } catch { /* skip */ }
          }
          console.log(`[Moonshot] Auto-scan scored ${mints.length} tokens`);
        } catch (err) {
          console.error('[Moonshot] Auto-scan error:', err);
        }
      }, updates.autoScanIntervalSec * 1000);
    }
  }

  res.json({
    data: scoringConfig,
    message: 'Moonshot scoring configuration updated',
  });
});

// ---------------------------------------------------------------------------
// Auto-start — called from index.ts on server boot
// ---------------------------------------------------------------------------

/**
 * Auto-start moonshot scanner with 5-minute interval.
 * Runs unconditionally (uses public DexScreener API, no wallet needed).
 * Starts with a 30-second delay to let other services initialize first.
 */
export function initMoonshotScanner(): void {
  if (autoScanInterval) {
    console.log('[Moonshot] Scanner already running, skipping auto-start');
    return;
  }

  const intervalSec = 300; // 5 minutes
  scoringConfig.autoScanIntervalSec = intervalSec;

  console.log(`[Moonshot] Auto-starting scanner (every ${intervalSec}s, first scan in 30s)...`);

  // Delay first scan by 30s to let server fully boot
  setTimeout(async () => {
    try {
      const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      if (!boostsRes.ok) return;
      const boosts = (await boostsRes.json()) as Array<{ tokenAddress: string; chainId: string }>;
      const mints = [...new Set(
        boosts.filter(b => b.chainId === 'solana').map(b => b.tokenAddress),
      )].slice(0, 10);

      for (const mint of mints) {
        try { await scoreToken(mint); } catch { /* skip */ }
      }
      console.log(`[Moonshot] Initial scan scored ${mints.length} tokens`);
    } catch (err) {
      console.error('[Moonshot] Initial scan error:', err);
    }
  }, 30_000);

  // Recurring scan
  autoScanInterval = setInterval(async () => {
    try {
      const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      if (!boostsRes.ok) return;
      const boosts = (await boostsRes.json()) as Array<{ tokenAddress: string; chainId: string }>;
      const mints = [...new Set(
        boosts.filter(b => b.chainId === 'solana').map(b => b.tokenAddress),
      )].slice(0, 10);

      for (const mint of mints) {
        try { await scoreToken(mint); } catch { /* skip */ }
      }
      console.log(`[Moonshot] Auto-scan scored ${mints.length} tokens`);
    } catch (err) {
      console.error('[Moonshot] Auto-scan error:', err);
    }
  }, intervalSec * 1000);
}

// GET /moonshot/config
moonshotRouter.get('/moonshot/config', (_req, res) => {
  res.json({ data: scoringConfig });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

// Cleanup
process.on('SIGINT', () => { if (autoScanInterval) clearInterval(autoScanInterval); });
process.on('SIGTERM', () => { if (autoScanInterval) clearInterval(autoScanInterval); });
