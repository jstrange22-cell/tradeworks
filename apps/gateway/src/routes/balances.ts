import { Router, type Router as RouterType } from 'express';
import { getApiKeysByService, decryptApiKey } from '@tradeworks/db';
import { getMemoryKeysByService } from './api-keys.js';
import { isSolanaConnected, getSolanaKeypair, getSolanaConnection } from './solana-utils.js';

/**
 * Exchange balance endpoints.
 *
 * GET /api/v1/portfolio/balances
 *   Returns per-exchange balance breakdown with total USD value.
 *   For each exchange with stored API keys, decrypts keys and queries the exchange.
 *   Returns simulated balances for sandbox/paper environments.
 *
 * Deposits and withdrawals are managed directly on each exchange.
 * TradeWorks reads your balances for portfolio tracking.
 */

export const balancesRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface AssetBalance {
  symbol: string;
  available: number;
  total: number;
  valueUsd: number;
}

interface ExchangeBalance {
  exchange: string;
  environment: string;
  connected: boolean;
  error?: string;
  assets: AssetBalance[];
  totalValueUsd: number;
  isSandbox?: boolean;
}

// ── Simulated balances for sandbox mode ────────────────────────────────

function getCoinbaseSandboxBalances(): AssetBalance[] {
  return [
    { symbol: 'USD', available: 10_000, total: 10_000, valueUsd: 10_000 },
    { symbol: 'BTC', available: 0.15, total: 0.15, valueUsd: 14_475 },
    { symbol: 'ETH', available: 2.5, total: 2.5, valueUsd: 8_750 },
    { symbol: 'SOL', available: 50, total: 50, valueUsd: 7_000 },
  ];
}

function getAlpacaSandboxBalances(): AssetBalance[] {
  return [
    { symbol: 'USD', available: 50_000, total: 100_000, valueUsd: 50_000 },
    { symbol: 'AAPL', available: 10, total: 10, valueUsd: 2_420 },
    { symbol: 'SPY', available: 5, total: 5, valueUsd: 3_010 },
    { symbol: 'NVDA', available: 3, total: 3, valueUsd: 2_625 },
  ];
}

function getPolymarketSandboxBalances(): AssetBalance[] {
  return [
    { symbol: 'USDC', available: 500, total: 500, valueUsd: 500 },
  ];
}

// ── Crypto price lookup (Crypto.com public API) ──────────────────────

const PRICE_SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTC_USDT', ETH: 'ETH_USDT', SOL: 'SOL_USDT', AVAX: 'AVAX_USDT',
  LINK: 'LINK_USDT', DOGE: 'DOGE_USDT', ADA: 'ADA_USDT', XRP: 'XRP_USDT',
  DOT: 'DOT_USDT', MATIC: 'MATIC_USDT', SHIB: 'SHIB_USDT', UNI: 'UNI_USDT',
  ATOM: 'ATOM_USDT', LTC: 'LTC_USDT', NEAR: 'NEAR_USDT', APT: 'APT_USDT',
  OP: 'OP_USDT', ARB: 'ARB_USDT', FIL: 'FIL_USDT', ALGO: 'ALGO_USDT',
  STX: 'STX_USDT', XLM: 'XLM_USDT', HBAR: 'HBAR_USDT', ONDO: 'ONDO_USDT',
  ALEO: 'ALEO_USDT', TOSHI: 'TOSHI_USDT', PROMPT: 'PROMPT_USDT',
};

const STABLECOINS = new Set(['USD', 'USDC', 'USDT', 'DAI', 'BUSD', 'GUSD', 'USDP']);

async function fetchCryptoPrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  // Stablecoins are always $1
  for (const s of symbols) {
    if (STABLECOINS.has(s)) prices[s] = 1;
  }

  // Fetch real prices in parallel
  const toFetch = symbols.filter(s => PRICE_SYMBOL_MAP[s] && !(s in prices));
  await Promise.allSettled(
    toFetch.map(async (symbol) => {
      try {
        const instrument = PRICE_SYMBOL_MAP[symbol];
        const res = await fetch(
          `https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=${instrument}`,
        );
        const json = (await res.json()) as {
          code: number;
          result?: { data?: Array<{ a: string }> };
        };
        if (json.code === 0 && json.result?.data?.length) {
          prices[symbol] = parseFloat(json.result.data[0].a);
        }
      } catch {
        // Price unavailable — stays at 0
      }
    }),
  );

  return prices;
}

// ── Live exchange fetchers ─────────────────────────────────────────────

async function fetchCoinbaseBalances(apiKey: string, apiSecret: string): Promise<AssetBalance[]> {
  try {
    // Coinbase Advanced Trade API — list accounts
    const method = 'GET';
    const path = '/api/v3/brokerage/accounts';
    // CDP keys — JWT Bearer auth (Ed25519 or ES256, auto-detected by secret format)
    const { SignJWT, importJWK, importPKCS8 } = await import('jose');
    const { randomBytes } = await import('node:crypto');
    const now = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('hex');
    const uri = `${method} api.coinbase.com${path}`;
    const secretStr = apiSecret.trim();

    // Detect key type: Ed25519 (base64 → 64 bytes) vs ECDSA (PEM)
    let isEd25519 = false;
    try {
      const decoded = Buffer.from(secretStr, 'base64');
      isEd25519 = !secretStr.includes('BEGIN') && decoded.length === 64;
    } catch { /* not base64 */ }

    let signingKey: CryptoKey;
    let alg: string;

    if (isEd25519) {
      const keyBytes = Buffer.from(secretStr, 'base64');
      const jwk = {
        kty: 'OKP' as const,
        crv: 'Ed25519' as const,
        d: Buffer.from(keyBytes.subarray(0, 32)).toString('base64url'),
        x: Buffer.from(keyBytes.subarray(32, 64)).toString('base64url'),
      };
      signingKey = (await importJWK(jwk, 'EdDSA')) as CryptoKey;
      alg = 'EdDSA';
    } else {
      const pem = secretStr.replace(/\\n/g, '\n');
      signingKey = (await importPKCS8(pem, 'ES256')) as CryptoKey;
      alg = 'ES256';
    }

    const token = await new SignJWT({ iss: 'cdp', sub: apiKey, nbf: now, exp: now + 120, uri })
      .setProtectedHeader({ alg, typ: 'JWT', kid: apiKey, nonce })
      .sign(signingKey);

    const response = await fetch(`https://api.coinbase.com${path}?limit=50`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Coinbase API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      accounts: Array<{
        currency: string;
        available_balance: { value: string };
        hold: { value: string };
      }>;
    };

    const accounts = (data.accounts ?? [])
      .filter(a => parseFloat(a.available_balance.value) > 0 || a.currency === 'USD');

    // Fetch current USD prices for all held assets
    const symbols = accounts.map(a => a.currency);
    const prices = await fetchCryptoPrices(symbols);

    return accounts.map(a => {
      const available = parseFloat(a.available_balance.value);
      const hold = parseFloat(a.hold?.value ?? '0');
      const total = available + hold;
      const price = prices[a.currency] ?? 0;
      return {
        symbol: a.currency,
        available,
        total,
        valueUsd: price > 0 ? total * price : 0,
      };
    });
  } catch (error) {
    console.error('[Balances] Coinbase fetch failed:', error);
    throw error;
  }
}

async function fetchAlpacaBalances(apiKey: string, apiSecret: string, paper: boolean): Promise<AssetBalance[]> {
  try {
    const baseUrl = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    // Fetch account info
    const accountRes = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (!accountRes.ok) {
      throw new Error(`Alpaca API error: ${accountRes.status}`);
    }

    const account = (await accountRes.json()) as {
      cash: string;
      buying_power: string;
      equity: string;
      portfolio_value: string;
    };

    const assets: AssetBalance[] = [
      {
        symbol: 'USD',
        available: parseFloat(account.buying_power),
        total: parseFloat(account.cash),
        valueUsd: parseFloat(account.cash),
      },
    ];

    // Fetch positions for asset breakdown
    const posRes = await fetch(`${baseUrl}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (posRes.ok) {
      const positions = (await posRes.json()) as Array<{
        symbol: string;
        qty: string;
        market_value: string;
        current_price: string;
      }>;

      for (const pos of positions) {
        assets.push({
          symbol: pos.symbol,
          available: parseFloat(pos.qty),
          total: parseFloat(pos.qty),
          valueUsd: parseFloat(pos.market_value),
        });
      }
    }

    return assets;
  } catch (error) {
    console.error('[Balances] Alpaca fetch failed:', error);
    throw error;
  }
}

async function fetchPolymarketBalances(apiKey: string, funderAddress: string): Promise<AssetBalance[]> {
  try {
    // Polymarket uses USDC on Polygon — query positions via Gamma API
    const response = await fetch(
      `https://gamma-api.polymarket.com/positions?user=${funderAddress}`,
      {
        headers: {
          'POLY-ADDRESS': funderAddress,
          'POLY-API-KEY': apiKey,
        },
      },
    );

    if (!response.ok) {
      // If no positions, just return USDC placeholder
      return [{ symbol: 'USDC', available: 0, total: 0, valueUsd: 0 }];
    }

    const positions = (await response.json()) as Array<{
      asset: string;
      size: string;
      currentPrice: string;
    }>;

    const totalValue = positions.reduce((sum, p) => {
      return sum + parseFloat(p.size) * parseFloat(p.currentPrice || '0');
    }, 0);

    return [
      { symbol: 'USDC', available: totalValue, total: totalValue, valueUsd: totalValue },
    ];
  } catch (error) {
    console.error('[Balances] Polymarket fetch failed:', error);
    throw error;
  }
}

// ── Solana balance fetcher ──────────────────────────────────────────────

async function fetchSolanaBalances(): Promise<AssetBalance[]> {
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();
    const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');

    // SOL balance
    const lamports = await connection.getBalance(keypair.publicKey);
    const solBalance = lamports / 1e9;

    // Fetch SOL price
    let solPrice = 0;
    try {
      const priceRes = await fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112');
      if (priceRes.ok) {
        const priceJson = (await priceRes.json()) as {
          data: Record<string, { price: string } | undefined>;
        };
        solPrice = parseFloat(priceJson.data['So11111111111111111111111111111111111111112']?.price ?? '0');
      }
    } catch { /* price unavailable */ }

    const assets: AssetBalance[] = [
      {
        symbol: 'SOL',
        available: solBalance,
        total: solBalance,
        valueUsd: solBalance * solPrice,
      },
    ];

    // SPL token balances
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      keypair.publicKey,
      { programId: TOKEN_PROGRAM_ID },
    );

    const mints: string[] = [];
    const tokenEntries: { symbol: string; amount: number; mint: string }[] = [];

    for (const account of tokenAccounts.value) {
      const parsed = account.account.data.parsed?.info;
      if (!parsed) continue;
      const amount = parseFloat(parsed.tokenAmount?.uiAmountString ?? '0');
      if (amount <= 0) continue;
      const mint = parsed.mint as string;
      mints.push(mint);
      tokenEntries.push({ symbol: mint.slice(0, 6), amount, mint });
    }

    // Fetch token prices
    if (mints.length > 0) {
      try {
        const priceRes = await fetch(`https://api.jup.ag/price/v2?ids=${mints.join(',')}`);
        if (priceRes.ok) {
          const priceJson = (await priceRes.json()) as {
            data: Record<string, { price: string } | undefined>;
          };
          for (const entry of tokenEntries) {
            const price = parseFloat(priceJson.data[entry.mint]?.price ?? '0');
            assets.push({
              symbol: entry.symbol,
              available: entry.amount,
              total: entry.amount,
              valueUsd: entry.amount * price,
            });
          }
        }
      } catch { /* prices unavailable */ }
    }

    return assets;
  } catch (error) {
    console.error('[Balances] Solana fetch failed:', error);
    throw error;
  }
}

// ── Shared balance fetcher (used by portfolio.ts too) ──────────────────

export async function fetchAllExchangeBalances(): Promise<{
  exchanges: ExchangeBalance[];
  totalValueUsd: number;
}> {
  const exchanges: ExchangeBalance[] = [];

  // Define which exchanges to check
  const exchangeConfigs = [
    { service: 'coinbase', label: 'Coinbase' },
    { service: 'alpaca', label: 'Alpaca' },
    { service: 'polymarket', label: 'Polymarket' },
  ];

  for (const config of exchangeConfigs) {
    try {
      let keys;
      try {
        keys = await getApiKeysByService(config.service);
      } catch {
        // DB unavailable — try in-memory/disk-persisted store
        const memKeys = getMemoryKeysByService(config.service);
        keys = memKeys as unknown as Awaited<ReturnType<typeof getApiKeysByService>>;
      }

      if (keys.length === 0) {
        exchanges.push({
          exchange: config.label,
          environment: 'none',
          connected: false,
          assets: [],
          totalValueUsd: 0,
        });
        continue;
      }

      const keyRecord = keys[0]; // Use first key for this exchange
      const environment = keyRecord.environment;
      const isSandbox = environment === 'sandbox';

      let assets: AssetBalance[];

      if (isSandbox) {
        // Return simulated balances for sandbox environments
        switch (config.service) {
          case 'coinbase':
            assets = getCoinbaseSandboxBalances();
            break;
          case 'alpaca':
            assets = getAlpacaSandboxBalances();
            break;
          case 'polymarket':
            assets = getPolymarketSandboxBalances();
            break;
          default:
            assets = [];
        }
      } else {
        // Decrypt keys and fetch real balances
        const decryptedKey = decryptApiKey(keyRecord.encryptedKey as Buffer);
        const decryptedSecret = keyRecord.encryptedSecret
          ? decryptApiKey(keyRecord.encryptedSecret as Buffer)
          : '';

        switch (config.service) {
          case 'coinbase':
            assets = await fetchCoinbaseBalances(decryptedKey, decryptedSecret);
            break;
          case 'alpaca':
            assets = await fetchAlpacaBalances(decryptedKey, decryptedSecret, false);
            break;
          case 'polymarket':
            assets = await fetchPolymarketBalances(decryptedKey, decryptedKey);
            break;
          default:
            assets = [];
        }
      }

      // Sort assets: USD/stablecoins first, then by value descending
      const PRIORITY_SYMBOLS = ['USD', 'USDC', 'USDT', 'DAI'];
      assets.sort((a, b) => {
        const aPri = PRIORITY_SYMBOLS.indexOf(a.symbol);
        const bPri = PRIORITY_SYMBOLS.indexOf(b.symbol);
        if (aPri !== -1 && bPri === -1) return -1;
        if (aPri === -1 && bPri !== -1) return 1;
        if (aPri !== -1 && bPri !== -1) return aPri - bPri;
        return b.valueUsd - a.valueUsd;
      });

      const totalValueUsd = assets.reduce((sum, a) => sum + a.valueUsd, 0);

      exchanges.push({
        exchange: config.label,
        environment,
        connected: true,
        assets,
        totalValueUsd,
        isSandbox,
      });
    } catch (error) {
      console.error(`[Balances] Error fetching ${config.label} balances:`, error);
      exchanges.push({
        exchange: config.label,
        environment: 'unknown',
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to fetch balances',
        assets: [],
        totalValueUsd: 0,
      });
    }
  }

  // ── Solana Wallet (separate from exchange key pattern) ──────────────
  if (isSolanaConnected()) {
    try {
      const assets = await fetchSolanaBalances();
      // Sort: SOL first, then stablecoins, then by value
      const SOL_PRIORITY = ['SOL', 'USDC', 'USDT'];
      assets.sort((a, b) => {
        const aPri = SOL_PRIORITY.indexOf(a.symbol);
        const bPri = SOL_PRIORITY.indexOf(b.symbol);
        if (aPri !== -1 && bPri === -1) return -1;
        if (aPri === -1 && bPri !== -1) return 1;
        if (aPri !== -1 && bPri !== -1) return aPri - bPri;
        return b.valueUsd - a.valueUsd;
      });
      const totalValueUsd = assets.reduce((sum, a) => sum + a.valueUsd, 0);
      exchanges.push({
        exchange: 'Solana Wallet',
        environment: 'production',
        connected: true,
        assets,
        totalValueUsd,
      });
    } catch (error) {
      exchanges.push({
        exchange: 'Solana Wallet',
        environment: 'production',
        connected: false,
        error: error instanceof Error ? error.message : 'Failed to fetch balances',
        assets: [],
        totalValueUsd: 0,
      });
    }
  }

  const grandTotal = exchanges.reduce((sum, e) => sum + e.totalValueUsd, 0);
  return { exchanges, totalValueUsd: grandTotal };
}

// ── Main route ─────────────────────────────────────────────────────────

balancesRouter.get('/', async (_req, res) => {
  const result = await fetchAllExchangeBalances();
  res.json({
    data: result.exchanges,
    totalValueUsd: result.totalValueUsd,
    message: 'Deposits and withdrawals are managed directly on each exchange. TradeWorks reads your balances for portfolio tracking.',
  });
});
