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
 *
 * Price sources (in priority order):
 *   1. Helius DAS getAssetBatch — prices + metadata in one call
 *   2. DexScreener — fallback for missing prices (Solana chain only)
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

// ── Retry Helper ──────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelay = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * (attempt + 1);
      console.warn(
        `[Balances] RPC attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
        err instanceof Error ? err.message : err,
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

// ── Helius DAS API (prices + metadata in one batch call) ─────────────

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Get the Helius RPC URL for DAS API calls.
 * Uses getSolanaRpcUrl() from solana-utils which reads from encrypted key storage
 * (same source as getSolanaConnection), with env var fallback.
 */
function getHeliusRpcUrl(): string {
  // First try the same source as getSolanaConnection (encrypted storage)
  const rpcUrl = getSolanaRpcUrl();
  // Only use Helius URLs (they support DAS methods like getAssetBatch)
  if (rpcUrl.includes('helius')) return rpcUrl;
  // Fallback to env var (may be set in .env at monorepo root)
  return process.env.SOLANA_RPC_URL ?? '';
}

interface HeliusAsset {
  id: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
    links?: { image?: string };
  };
  token_info?: {
    symbol?: string;
    decimals?: number;
    price_info?: {
      price_per_token?: number;
      currency?: string;
    };
  };
}

interface AssetData {
  prices: Record<string, number>;
  metadata: Record<string, { symbol: string; name: string; logoUri?: string }>;
}

/**
 * Fetch prices and metadata for all mints via Helius DAS getAssetBatch.
 * Single API call returns both price_info and token metadata (name, symbol, logo).
 */
async function fetchHeliusAssetData(mints: string[]): Promise<AssetData> {
  const prices: Record<string, number> = {};
  const metadata: Record<string, { symbol: string; name: string; logoUri?: string }> = {};

  const rpcUrl = getHeliusRpcUrl();

  if (mints.length === 0) return { prices, metadata };

  if (!rpcUrl) {
    console.warn('[Solana] SOLANA_RPC_URL not set — skipping Helius price lookup');
    return { prices, metadata };
  }

  try {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAssetBatch',
      params: { ids: mints },
    });

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      console.error(`[Solana] Helius getAssetBatch HTTP ${res.status}: ${res.statusText}`);
      return { prices, metadata };
    }

    const json = (await res.json()) as { result?: HeliusAsset[]; error?: unknown };

    if (json.error) {
      console.error('[Solana] Helius JSON-RPC error:', JSON.stringify(json.error));
      return { prices, metadata };
    }

    if (!json.result || !Array.isArray(json.result)) {
      console.warn('[Solana] Helius returned no result array');
      return { prices, metadata };
    }

    for (const asset of json.result) {
      const mint = asset.id;

      // Extract price
      const price = asset.token_info?.price_info?.price_per_token;
      if (price && price > 0) {
        prices[mint] = price;
      }

      // Extract metadata
      const name = asset.content?.metadata?.name
        ?? asset.token_info?.symbol
        ?? 'Unknown Token';
      const symbol = asset.content?.metadata?.symbol
        ?? asset.token_info?.symbol
        ?? `${mint.slice(0, 4)}...${mint.slice(-4)}`;
      const logoUri = asset.content?.links?.image ?? undefined;

      metadata[mint] = { symbol, name, logoUri };
    }

    const priceCount = Object.keys(prices).length;
    console.log(
      `[Solana] Helius resolved ${priceCount}/${mints.length} prices (${json.result.length} assets returned)`,
    );
  } catch (err) {
    console.error(
      '[Solana] Helius getAssetBatch failed:',
      err instanceof Error ? err.message : err,
    );
  }

  return { prices, metadata };
}

// ── DexScreener Fallback (Solana chain only) ─────────────────────────

/**
 * Fetch prices from DexScreener for mints missing from Helius.
 * CRITICAL: Filters for chainId === 'solana' to avoid cross-chain price confusion
 * (e.g. SOL mint address exists on "fogo" chain as a $0.02 token).
 */
async function fetchDexScreenerPrices(
  mints: string[],
  existingPrices: Record<string, number>,
): Promise<void> {
  const missing = mints.filter(m => !existingPrices[m]);
  if (missing.length === 0) return;

  for (const mint of missing) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      if (res.ok) {
        const json = (await res.json()) as {
          pairs?: Array<{ chainId?: string; priceUsd?: string }>;
        };
        // Filter for Solana chain to avoid cross-chain price confusion
        const solanaPair = json.pairs?.find(
          p => p.chainId === 'solana' && p.priceUsd,
        );
        if (solanaPair?.priceUsd) {
          const price = parseFloat(solanaPair.priceUsd);
          if (price > 0) existingPrices[mint] = price;
        }
      }
    } catch {
      // Skip — no price available for this mint
    }
  }

  const resolved = missing.filter(m => existingPrices[m]);
  if (resolved.length > 0) {
    console.log(
      `[Solana] DexScreener resolved ${resolved.length}/${missing.length} missing prices`,
    );
  }
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

    // Fetch SOL balance (with retry for transient RPC failures)
    const lamports = await withRetry(() => connection.getBalance(publicKey));
    const solBalance = lamports / 1e9;

    // Fetch all SPL token accounts (with retry)
    const tokenAccounts = await withRetry(() =>
      connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID }),
    );

    // Collect all mints and raw token data
    const mintsToPrice: string[] = [SOL_MINT];
    const rawTokens: Array<{ mint: string; amount: number; decimals: number }> = [];

    for (const account of tokenAccounts.value) {
      const parsed = account.account.data.parsed?.info;
      if (!parsed) continue;

      const amount = parseFloat(parsed.tokenAmount?.uiAmountString ?? '0');
      if (amount <= 0) continue;

      const mint = parsed.mint as string;
      mintsToPrice.push(mint);
      rawTokens.push({
        mint,
        amount,
        decimals: parsed.tokenAmount?.decimals ?? 0,
      });
    }

    // Single Helius batch call → prices + metadata for ALL mints
    const { prices, metadata } = await fetchHeliusAssetData(mintsToPrice);

    // DexScreener fallback for any mints Helius couldn't price
    await fetchDexScreenerPrices(mintsToPrice, prices);

    // Build SOL values
    const solPrice = prices[SOL_MINT] ?? 0;
    const solValueUsd = solBalance * solPrice;

    // Build token list with Helius metadata
    const tokens: SolanaTokenBalance[] = rawTokens.map(raw => {
      const meta = metadata[raw.mint];
      return {
        mint: raw.mint,
        symbol: meta?.symbol ?? `${raw.mint.slice(0, 4)}...${raw.mint.slice(-4)}`,
        name: meta?.name ?? 'Unknown Token',
        amount: raw.amount,
        decimals: raw.decimals,
        valueUsd: raw.amount * (prices[raw.mint] ?? 0),
        logoUri: meta?.logoUri,
      };
    });

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
