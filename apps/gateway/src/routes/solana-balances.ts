import { Router, type Router as RouterType } from 'express';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  isSolanaConnected,
  getSolanaKeypair,
  getSolanaConnection,
  getSolanaRpcUrl,
} from './solana-utils.js';

/**
 * Solana balance endpoints.
 *
 * GET /api/v1/solana/balances
 *   Returns SOL balance + all SPL token balances with USD values.
 *
 * GET /api/v1/solana/wallet
 *   Returns wallet connection status and public key.
 */

export const solanaBalancesRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface SolanaTokenBalance {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  valueUsd: number;
  logoUri?: string;
}

interface SolanaBalanceResponse {
  wallet: string;
  rpcUrl: string;
  solBalance: number;
  solValueUsd: number;
  tokens: SolanaTokenBalance[];
  totalValueUsd: number;
}

// ── Jupiter Price API ──────────────────────────────────────────────────

const SOL_MINT = 'So11111111111111111111111111111111111111112';

async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  if (mints.length === 0) return prices;

  try {
    // Jupiter Price API v2
    const ids = mints.join(',');
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`);
    if (!res.ok) return prices;

    const json = (await res.json()) as {
      data: Record<string, { price: string } | undefined>;
    };

    for (const [mint, info] of Object.entries(json.data)) {
      if (info?.price) {
        prices[mint] = parseFloat(info.price);
      }
    }
  } catch (err) {
    console.error('[Solana] Jupiter price fetch failed:', err);
  }

  return prices;
}

// ── Jupiter Token List (metadata) ──────────────────────────────────────

interface JupiterToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

let tokenListCache: Map<string, JupiterToken> | null = null;
let tokenListFetchedAt = 0;
const TOKEN_LIST_TTL = 30 * 60 * 1000; // 30 minutes

async function getTokenMetadata(mint: string): Promise<{ symbol: string; name: string; logoUri?: string }> {
  // Refresh cache if stale
  if (!tokenListCache || Date.now() - tokenListFetchedAt > TOKEN_LIST_TTL) {
    try {
      const res = await fetch('https://token.jup.ag/strict');
      if (res.ok) {
        const tokens = (await res.json()) as JupiterToken[];
        tokenListCache = new Map(tokens.map(t => [t.address, t]));
        tokenListFetchedAt = Date.now();
      }
    } catch {
      // Use existing cache or empty
      if (!tokenListCache) tokenListCache = new Map();
    }
  }

  const token = tokenListCache?.get(mint);
  if (token) {
    return { symbol: token.symbol, name: token.name, logoUri: token.logoURI };
  }

  // Unknown token — use truncated mint as symbol
  return {
    symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
    name: 'Unknown Token',
  };
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /wallet — connection status
solanaBalancesRouter.get('/wallet', (_req, res) => {
  if (!isSolanaConnected()) {
    res.json({
      connected: false,
      wallet: null,
      rpcUrl: null,
    });
    return;
  }

  try {
    const keypair = getSolanaKeypair();
    res.json({
      connected: true,
      wallet: keypair.publicKey.toBase58(),
      rpcUrl: getSolanaRpcUrl(),
    });
  } catch (err) {
    res.json({
      connected: false,
      wallet: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /balances — full balance breakdown
solanaBalancesRouter.get('/balances', async (_req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({
      error: 'No Solana wallet configured',
      message: 'Add a Solana bot wallet in Settings → API Keys',
    });
    return;
  }

  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();
    const publicKey = keypair.publicKey;

    // Fetch SOL balance
    const lamports = await connection.getBalance(publicKey);
    const solBalance = lamports / 1e9;

    // Fetch all SPL token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      { programId: TOKEN_PROGRAM_ID },
    );

    // Build token list
    const tokens: SolanaTokenBalance[] = [];
    const mintsToPrice: string[] = [SOL_MINT];

    for (const account of tokenAccounts.value) {
      const parsed = account.account.data.parsed?.info;
      if (!parsed) continue;

      const amount = parseFloat(parsed.tokenAmount?.uiAmountString ?? '0');
      if (amount <= 0) continue;

      const mint = parsed.mint as string;
      mintsToPrice.push(mint);

      const metadata = await getTokenMetadata(mint);
      tokens.push({
        mint,
        symbol: metadata.symbol,
        name: metadata.name,
        amount,
        decimals: parsed.tokenAmount?.decimals ?? 0,
        valueUsd: 0, // filled after price fetch
        logoUri: metadata.logoUri,
      });
    }

    // Fetch USD prices
    const prices = await fetchJupiterPrices(mintsToPrice);
    const solPrice = prices[SOL_MINT] ?? 0;
    const solValueUsd = solBalance * solPrice;

    for (const token of tokens) {
      token.valueUsd = token.amount * (prices[token.mint] ?? 0);
    }

    // Sort by USD value descending
    tokens.sort((a, b) => b.valueUsd - a.valueUsd);

    const totalValueUsd = solValueUsd + tokens.reduce((sum, t) => sum + t.valueUsd, 0);

    const response: SolanaBalanceResponse = {
      wallet: publicKey.toBase58(),
      rpcUrl: getSolanaRpcUrl(),
      solBalance,
      solValueUsd,
      tokens,
      totalValueUsd,
    };

    res.json({ data: response });
  } catch (err) {
    console.error('[Solana] Balance fetch failed:', err);
    res.status(500).json({
      error: 'Failed to fetch Solana balances',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
