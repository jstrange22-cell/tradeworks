import { Router, type Router as RouterType } from 'express';
import { getApiKeysByService, decryptApiKey } from '@tradeworks/db';

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

// ── Live exchange fetchers ─────────────────────────────────────────────

async function fetchCoinbaseBalances(apiKey: string, apiSecret: string): Promise<AssetBalance[]> {
  try {
    // Coinbase Advanced Trade API — list accounts
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = 'GET';
    const path = '/api/v3/brokerage/accounts';
    const message = timestamp + method + path;

    // Sign with HMAC SHA-256
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', apiSecret).update(message).digest('hex');

    const response = await fetch(`https://api.coinbase.com${path}?limit=50`, {
      headers: {
        'CB-ACCESS-KEY': apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
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

    return (data.accounts ?? [])
      .filter(a => parseFloat(a.available_balance.value) > 0 || a.currency === 'USD')
      .map(a => {
        const available = parseFloat(a.available_balance.value);
        const hold = parseFloat(a.hold?.value ?? '0');
        return {
          symbol: a.currency,
          available,
          total: available + hold,
          valueUsd: 0, // Would need price feed for accurate USD conversion
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

// ── Main route ─────────────────────────────────────────────────────────

balancesRouter.get('/', async (_req, res) => {
  const exchanges: ExchangeBalance[] = [];

  // Define which exchanges to check
  const exchangeConfigs = [
    { service: 'coinbase', label: 'Coinbase' },
    { service: 'alpaca', label: 'Alpaca' },
    { service: 'polymarket', label: 'Polymarket' },
  ];

  for (const config of exchangeConfigs) {
    try {
      const keys = await getApiKeysByService(config.service);

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

      const totalValueUsd = assets.reduce((sum, a) => sum + a.valueUsd, 0);

      exchanges.push({
        exchange: config.label,
        environment,
        connected: true,
        assets,
        totalValueUsd,
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

  const grandTotal = exchanges.reduce((sum, e) => sum + e.totalValueUsd, 0);

  res.json({
    data: exchanges,
    totalValueUsd: grandTotal,
    message: 'Deposits and withdrawals are managed directly on each exchange. TradeWorks reads your balances for portfolio tracking.',
  });
});
