import { Router, type Router as RouterType } from 'express';
import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { getSolanaConnection } from './solana-utils.js';

/**
 * Solana token scanner endpoints.
 *
 * GET /api/v1/solana/trending            — Trending tokens (Dexscreener)
 * GET /api/v1/solana/new-tokens          — Recently launched tokens
 * GET /api/v1/solana/token/:mint         — Token detail + safety check
 * GET /api/v1/solana/token/:mint/price   — Price chart data
 */

export const solanaScannerRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  pairCreatedAt: string | null;
  imageUrl: string | null;
  dexId: string;
  pairAddress: string;
  url: string;
}

interface TokenSafety {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPercent: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
}

// ── Dexscreener API helpers ────────────────────────────────────────────

function parseDexscreenerPair(pair: Record<string, unknown>): TokenInfo | null {
  try {
    const baseToken = pair.baseToken as Record<string, string> | undefined;
    if (!baseToken?.address) return null;

    return {
      mint: baseToken.address,
      symbol: baseToken.symbol ?? 'UNKNOWN',
      name: baseToken.name ?? 'Unknown Token',
      priceUsd: parseFloat((pair.priceUsd as string) ?? '0'),
      priceChange24h: ((pair.priceChange as Record<string, number>)?.h24 ?? 0),
      volume24h: ((pair.volume as Record<string, number>)?.h24 ?? 0),
      liquidity: ((pair.liquidity as Record<string, number>)?.usd ?? 0),
      marketCap: (pair.marketCap as number) ?? 0,
      pairCreatedAt: (pair.pairCreatedAt as string) ?? null,
      imageUrl: (((pair as Record<string, unknown>).info as Record<string, unknown>)?.imageUrl as string) ?? null,
      dexId: (pair.dexId as string) ?? '',
      pairAddress: (pair.pairAddress as string) ?? '',
      url: (pair.url as string) ?? '',
    };
  } catch {
    return null;
  }
}

// ── GET /trending — Trending tokens ────────────────────────────────────

solanaScannerRouter.get('/trending', async (_req, res) => {
  try {
    // Dexscreener token boosts (trending / promoted tokens)
    const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
    let tokens: TokenInfo[] = [];

    if (boostsRes.ok) {
      const boosts = (await boostsRes.json()) as Array<{
        tokenAddress: string;
        chainId: string;
        icon?: string;
        description?: string;
        url?: string;
      }>;

      // Filter to Solana only, deduplicate by mint
      const solanaMints = [...new Set(
        boosts
          .filter(b => b.chainId === 'solana')
          .map(b => b.tokenAddress),
      )].slice(0, 20);

      if (solanaMints.length > 0) {
        // Fetch pair data for each mint
        const pairPromises = solanaMints.map(async (mint) => {
          try {
            const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
            if (!r.ok) return null;
            const data = (await r.json()) as { pairs?: Array<Record<string, unknown>> };
            const solanaPairs = (data.pairs ?? []).filter(
              (p) => (p.chainId as string) === 'solana',
            );
            if (solanaPairs.length === 0) return null;
            // Pick highest liquidity pair
            solanaPairs.sort((a, b) =>
              ((b.liquidity as Record<string, number>)?.usd ?? 0) -
              ((a.liquidity as Record<string, number>)?.usd ?? 0),
            );
            return parseDexscreenerPair(solanaPairs[0]);
          } catch {
            return null;
          }
        });

        const results = await Promise.allSettled(pairPromises);
        tokens = results
          .filter((r): r is PromiseFulfilledResult<TokenInfo | null> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter((t): t is TokenInfo => t !== null);
      }
    }

    // Fallback: use Dexscreener search for trending Solana pairs
    if (tokens.length === 0) {
      try {
        const searchRes = await fetch('https://api.dexscreener.com/latest/dex/pairs/solana?sort=trending&limit=20');
        if (searchRes.ok) {
          const data = (await searchRes.json()) as { pairs?: Array<Record<string, unknown>> };
          tokens = (data.pairs ?? [])
            .map(parseDexscreenerPair)
            .filter((t): t is TokenInfo => t !== null)
            .slice(0, 20);
        }
      } catch { /* no fallback data */ }
    }

    res.json({
      data: tokens,
      total: tokens.length,
      source: 'dexscreener',
    });
  } catch (err) {
    console.error('[Solana] Trending fetch failed:', err);
    res.status(500).json({
      error: 'Failed to fetch trending tokens',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── GET /new-tokens — Recently launched tokens ─────────────────────────

solanaScannerRouter.get('/new-tokens', async (req, res) => {
  try {
    const minLiquidity = parseInt((req.query.minLiquidity as string) ?? '1000', 10);

    // Dexscreener new pairs on Solana
    const response = await fetch('https://api.dexscreener.com/latest/dex/pairs/solana');

    if (!response.ok) {
      res.status(response.status).json({
        error: 'Dexscreener API error',
        message: `Status: ${response.status}`,
      });
      return;
    }

    const data = (await response.json()) as { pairs?: Array<Record<string, unknown>> };
    const allPairs = data.pairs ?? [];

    // Filter: Solana, recent (24h), minimum liquidity
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const newTokens = allPairs
      .filter((pair) => {
        const createdAt = pair.pairCreatedAt as number | undefined;
        if (!createdAt || createdAt < oneDayAgo) return false;
        const liq = (pair.liquidity as Record<string, number>)?.usd ?? 0;
        return liq >= minLiquidity;
      })
      .map(parseDexscreenerPair)
      .filter((t): t is TokenInfo => t !== null)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 30);

    res.json({
      data: newTokens,
      total: newTokens.length,
      source: 'dexscreener',
      filters: { minLiquidity },
    });
  } catch (err) {
    console.error('[Solana] New tokens fetch failed:', err);
    res.status(500).json({
      error: 'Failed to fetch new tokens',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── GET /token/:mint — Token detail + safety ───────────────────────────

solanaScannerRouter.get('/token/:mint', async (req, res) => {
  try {
    const { mint } = req.params;

    // Fetch token data from Dexscreener
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    let tokenInfo: TokenInfo | null = null;

    if (dexRes.ok) {
      const data = (await dexRes.json()) as { pairs?: Array<Record<string, unknown>> };
      const solanaPairs = (data.pairs ?? []).filter(
        (p) => (p.chainId as string) === 'solana',
      );
      if (solanaPairs.length > 0) {
        // Highest liquidity pair
        solanaPairs.sort((a, b) =>
          ((b.liquidity as Record<string, number>)?.usd ?? 0) -
          ((a.liquidity as Record<string, number>)?.usd ?? 0),
        );
        tokenInfo = parseDexscreenerPair(solanaPairs[0]);
      }
    }

    // On-chain safety checks
    const safety = await checkTokenSafety(mint as string);

    res.json({
      data: {
        token: tokenInfo,
        safety,
        allPairsCount: tokenInfo ? 1 : 0,
      },
    });
  } catch (err) {
    console.error('[Solana] Token detail failed:', err);
    res.status(500).json({
      error: 'Failed to fetch token details',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── GET /token/:mint/price — Price chart data ──────────────────────────

solanaScannerRouter.get('/token/:mint/price', async (req, res) => {
  try {
    const { mint } = req.params;

    // Use Dexscreener pair data (includes price history in chart URL)
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);

    if (!dexRes.ok) {
      res.status(dexRes.status).json({ error: 'Dexscreener API error' });
      return;
    }

    const data = (await dexRes.json()) as { pairs?: Array<Record<string, unknown>> };
    const solanaPairs = (data.pairs ?? []).filter(
      (p) => (p.chainId as string) === 'solana',
    );

    if (solanaPairs.length === 0) {
      res.status(404).json({ error: 'No Solana pairs found for this token' });
      return;
    }

    // Return the best pair with price data
    const bestPair = solanaPairs[0];
    res.json({
      data: {
        mint,
        priceUsd: parseFloat((bestPair.priceUsd as string) ?? '0'),
        priceChange: bestPair.priceChange as Record<string, number> ?? {},
        volume: bestPair.volume as Record<string, number> ?? {},
        txns: bestPair.txns as Record<string, unknown> ?? {},
        liquidity: bestPair.liquidity as Record<string, number> ?? {},
        pairAddress: bestPair.pairAddress,
        dexId: bestPair.dexId,
        url: bestPair.url,
      },
    });
  } catch (err) {
    console.error('[Solana] Price fetch failed:', err);
    res.status(500).json({
      error: 'Failed to fetch price data',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// ── Token Safety Checker ───────────────────────────────────────────────

async function checkTokenSafety(mintAddress: string): Promise<TokenSafety> {
  const warnings: string[] = [];
  let mintAuthorityRevoked = false;
  let freezeAuthorityRevoked = false;

  try {
    const connection = getSolanaConnection();
    const mintPubkey = new PublicKey(mintAddress);

    // Fetch mint info from on-chain
    const mintInfo = await getMint(connection, mintPubkey);

    // Check mint authority
    mintAuthorityRevoked = mintInfo.mintAuthority === null;
    if (!mintAuthorityRevoked) {
      warnings.push('Mint authority NOT revoked — supply can be inflated');
    }

    // Check freeze authority
    freezeAuthorityRevoked = mintInfo.freezeAuthority === null;
    if (!freezeAuthorityRevoked) {
      warnings.push('Freeze authority NOT revoked — tokens can be frozen');
    }
  } catch (err) {
    warnings.push('Could not verify on-chain mint info');
  }

  // Top holder concentration — would need getTokenLargestAccounts
  // which requires a paid RPC for reliability. Set to null for now.
  let top10HolderPercent: number | null = null;
  try {
    const connection = getSolanaConnection();
    const mintPubkey = new PublicKey(mintAddress);
    const largest = await connection.getTokenLargestAccounts(mintPubkey);

    if (largest.value.length > 0) {
      const totalSupplyRes = await connection.getTokenSupply(mintPubkey);
      const totalSupply = parseFloat(totalSupplyRes.value.uiAmountString ?? '0');

      if (totalSupply > 0) {
        const top10Amount = largest.value
          .slice(0, 10)
          .reduce((sum, a) => sum + parseFloat(a.uiAmountString ?? '0'), 0);
        top10HolderPercent = (top10Amount / totalSupply) * 100;

        if (top10HolderPercent > 80) {
          warnings.push(`Top 10 holders own ${top10HolderPercent.toFixed(1)}% — very concentrated`);
        } else if (top10HolderPercent > 50) {
          warnings.push(`Top 10 holders own ${top10HolderPercent.toFixed(1)}% — moderately concentrated`);
        }
      }
    }
  } catch {
    // Token largest accounts may fail on free RPCs
  }

  // Determine risk level
  let riskLevel: TokenSafety['riskLevel'] = 'low';
  if (!mintAuthorityRevoked && !freezeAuthorityRevoked) {
    riskLevel = 'critical';
  } else if (!mintAuthorityRevoked || !freezeAuthorityRevoked) {
    riskLevel = 'high';
  } else if (top10HolderPercent !== null && top10HolderPercent > 80) {
    riskLevel = 'high';
  } else if (top10HolderPercent !== null && top10HolderPercent > 50) {
    riskLevel = 'medium';
  }

  return {
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    top10HolderPercent,
    riskLevel,
    warnings,
  };
}
