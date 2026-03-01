import { createHmac, randomBytes } from 'node:crypto';
import type { EngineExecutionResult } from '../../orchestrator.js';

/**
 * Coinbase Advanced Trade API integration for crypto trading.
 *
 * Uses Coinbase Advanced Trade API v3 for:
 * - Account management and balance retrieval
 * - Market/limit order placement and cancellation
 * - Position tracking from account holdings
 *
 * Authentication: CDP API keys with JWT (ES256) or Cloud API HMAC signing.
 * Paper trading mode simulates execution without hitting the exchange.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoinbaseConfig {
  cdpApiKeyName: string;
  cdpApiKeySecret: string;
  networkId: string;
  walletDataPath?: string;
  paperTrading: boolean;
}

interface WalletBalance {
  asset: string;
  amount: string;
  usdValue: number;
}

export interface EngineTradeOrder {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  type?: string;
  price?: number;
  stopPrice?: number;
  timeInForce?: string;
  exchange?: string;
  outcome?: string;
}

export interface EnginePosition {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  timestamp: Date;
  marketValue?: number;
}

interface CoinbaseAccount {
  uuid: string;
  name: string;
  currency: string;
  available_balance: { value: string; currency: string };
  default: boolean;
  active: boolean;
  hold: { value: string; currency: string };
}

interface CoinbaseOrder {
  order_id: string;
  product_id: string;
  side: string;
  status: string;
  average_filled_price: string;
  filled_size: string;
  total_fees: string;
  created_time: string;
}

// Response shapes returned by the Coinbase Advanced Trade API
interface CoinbaseOrderResponse {
  success: boolean;
  error_response?: { error: string };
  success_response?: { order_id?: string; client_order_id?: string };
  order_configuration?: unknown;
  order_id?: string;
  client_order_id?: string;
}

interface CoinbaseCancelResponse {
  results?: Array<{ success: boolean }>;
}

interface CoinbaseProductResponse {
  price?: string;
}

interface CoinbaseAccountsResponse {
  accounts?: CoinbaseAccount[];
}

interface CoinbaseOrdersResponse {
  orders?: CoinbaseOrder[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.coinbase.com';
const API_PREFIX = '/api/v3/brokerage';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class CoinbaseEngine {
  private config: CoinbaseConfig;
  private initialized = false;
  private accounts: CoinbaseAccount[] = [];

  constructor(config: CoinbaseConfig) {
    this.config = config;
  }

  /**
   * Initialize the engine by verifying API connectivity.
   */
  async initialize(): Promise<void> {
    console.log(`[CoinbaseEngine] Initializing (${this.config.paperTrading ? 'PAPER' : 'LIVE'})...`);

    if (this.config.paperTrading) {
      console.log('[CoinbaseEngine] Paper trading mode — no API calls required.');
      this.initialized = true;
      return;
    }

    if (!this.config.cdpApiKeyName || !this.config.cdpApiKeySecret) {
      console.warn('[CoinbaseEngine] No CDP API keys configured. Running in paper mode.');
      this.config.paperTrading = true;
      this.initialized = true;
      return;
    }

    try {
      // Verify API key by fetching accounts
      this.accounts = await this.fetchAccounts();
      this.initialized = true;
      console.log(
        `[CoinbaseEngine] Initialized. ${this.accounts.length} accounts found on network: ${this.config.networkId}`,
      );
    } catch (error) {
      console.error('[CoinbaseEngine] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Execute a trade on Coinbase.
   * In paper mode, simulates the execution with current market price.
   */
  async executeTrade(order: EngineTradeOrder): Promise<EngineExecutionResult> {
    this.ensureInitialized();

    console.log(`[CoinbaseEngine] Executing trade: ${order.side} ${order.quantity} ${order.instrument}`);

    if (this.config.paperTrading) {
      return this.simulateTrade(order);
    }

    try {
      // Convert instrument format: BTC_USDT -> BTC-USD, ETH_USDT -> ETH-USD
      const productId = this.toProductId(order.instrument);

      const orderConfig: Record<string, unknown> = {
        client_order_id: randomBytes(16).toString('hex'),
        product_id: productId,
        side: order.side.toUpperCase(),
      };

      if (!order.type || order.type === 'market') {
        if (order.side === 'buy') {
          // Market buy uses quote_size (USD amount) or base_size
          orderConfig.order_configuration = {
            market_market_ioc: {
              base_size: order.quantity.toString(),
            },
          };
        } else {
          orderConfig.order_configuration = {
            market_market_ioc: {
              base_size: order.quantity.toString(),
            },
          };
        }
      } else if (order.type === 'limit' && order.price) {
        orderConfig.order_configuration = {
          limit_limit_gtc: {
            base_size: order.quantity.toString(),
            limit_price: order.price.toString(),
          },
        };
      } else if (order.type === 'stop' && order.stopPrice) {
        orderConfig.order_configuration = {
          stop_limit_stop_limit_gtc: {
            base_size: order.quantity.toString(),
            limit_price: (order.stopPrice * 0.995).toFixed(2), // 0.5% slippage buffer
            stop_price: order.stopPrice.toString(),
          },
        };
      }

      const response = await this.request('POST', `${API_PREFIX}/orders`, orderConfig) as unknown as CoinbaseOrderResponse;

      if (!response.success) {
        throw new Error(`Order failed: ${response.error_response?.error ?? 'Unknown error'}`);
      }

      const result = response.order_configuration
        ? response
        : response.success_response ?? response;

      const orderId = result.order_id ?? result.client_order_id ?? `cb-${Date.now()}`;

      console.log(`[CoinbaseEngine] Order placed: ${orderId}`);

      return {
        orderId,
        instrument: order.instrument,
        status: 'pending',
        side: order.side,
        quantity: order.quantity,
        price: order.price ?? 0,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('[CoinbaseEngine] Trade execution failed:', error);
      return {
        orderId: '',
        instrument: order.instrument,
        status: 'failed',
        side: order.side,
        quantity: order.quantity,
        price: 0,
        timestamp: new Date(),
        error: String(error),
      };
    }
  }

  /**
   * Cancel an open order.
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    this.ensureInitialized();

    if (this.config.paperTrading) {
      console.log(`[CoinbaseEngine] Paper mode — simulated cancel: ${orderId}`);
      return true;
    }

    console.log(`[CoinbaseEngine] Cancelling order: ${orderId}`);

    try {
      const response = await this.request('POST', `${API_PREFIX}/orders/batch_cancel`, {
        order_ids: [orderId],
      }) as unknown as CoinbaseCancelResponse;

      const results = response.results ?? [];
      const success = results.length > 0 && results[0].success;

      if (success) {
        console.log(`[CoinbaseEngine] Order cancelled: ${orderId}`);
      } else {
        console.warn(`[CoinbaseEngine] Cancel may have failed for: ${orderId}`);
      }

      return success;
    } catch (error) {
      console.error(`[CoinbaseEngine] Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Get wallet balances for all assets.
   */
  async getBalance(): Promise<WalletBalance[]> {
    this.ensureInitialized();

    if (this.config.paperTrading) {
      return [
        { asset: 'USD', amount: '10000.00', usdValue: 10000 },
        { asset: 'BTC', amount: '0.00', usdValue: 0 },
        { asset: 'ETH', amount: '0.00', usdValue: 0 },
      ];
    }

    console.log('[CoinbaseEngine] Fetching wallet balances...');

    try {
      const accounts = await this.fetchAccounts();

      return accounts
        .filter(a => parseFloat(a.available_balance.value) > 0 || a.currency === 'USD')
        .map(a => ({
          asset: a.currency,
          amount: a.available_balance.value,
          usdValue: 0, // Would need price lookup for non-USD assets
        }));
    } catch (error) {
      console.error('[CoinbaseEngine] Failed to get balances:', error);
      throw error;
    }
  }

  /**
   * Get current open positions derived from account holdings.
   */
  async getPositions(): Promise<EnginePosition[]> {
    this.ensureInitialized();

    if (this.config.paperTrading) {
      return [];
    }

    console.log('[CoinbaseEngine] Fetching positions...');

    try {
      const accounts = await this.fetchAccounts();

      // Filter to crypto holdings with non-zero balances (exclude USD/stablecoins)
      const stablecoins = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD']);
      const positions: EnginePosition[] = [];

      for (const account of accounts) {
        const balance = parseFloat(account.available_balance.value);
        if (balance <= 0 || stablecoins.has(account.currency)) continue;

        // Fetch current price for position valuation
        const productId = `${account.currency}-USD`;
        let currentPrice = 0;

        try {
          const product = await this.request(
            'GET',
            `${API_PREFIX}/products/${productId}`,
          ) as unknown as CoinbaseProductResponse;
          currentPrice = parseFloat(product.price ?? '0');
        } catch {
          // Skip if can't get price
          continue;
        }

        if (currentPrice > 0) {
          positions.push({
            instrument: `${account.currency}_USDT`,
            side: 'buy',
            quantity: balance,
            entryPrice: 0, // Cost basis not available from accounts API
            currentPrice,
            unrealizedPnl: 0, // Can't compute without cost basis
            marketValue: balance * currentPrice,
            timestamp: new Date(),
          });
        }
      }

      return positions;
    } catch (error) {
      console.error('[CoinbaseEngine] Failed to get positions:', error);
      throw error;
    }
  }

  /**
   * Get order history for an instrument.
   */
  async getOrders(productId?: string): Promise<CoinbaseOrder[]> {
    this.ensureInitialized();

    if (this.config.paperTrading) return [];

    try {
      const params = new URLSearchParams();
      if (productId) params.set('product_id', this.toProductId(productId));
      params.set('limit', '50');
      params.set('order_status', 'OPEN');

      const response = await this.request(
        'GET',
        `${API_PREFIX}/orders/historical/batch?${params.toString()}`,
      ) as unknown as CoinbaseOrdersResponse;

      return response.orders ?? [];
    } catch (error) {
      console.error('[CoinbaseEngine] Failed to get orders:', error);
      return [];
    }
  }

  /**
   * Get current price for a product.
   */
  async getPrice(instrument: string): Promise<number> {
    this.ensureInitialized();

    const productId = this.toProductId(instrument);

    try {
      const response = await this.request('GET', `${API_PREFIX}/products/${productId}`) as unknown as CoinbaseProductResponse;
      return parseFloat(response.price ?? '0');
    } catch (error) {
      console.error(`[CoinbaseEngine] Failed to get price for ${instrument}:`, error);
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch all accounts from Coinbase.
   */
  private async fetchAccounts(): Promise<CoinbaseAccount[]> {
    const response = await this.request('GET', `${API_PREFIX}/accounts?limit=250`) as unknown as CoinbaseAccountsResponse;
    return response.accounts ?? [];
  }

  /**
   * Make an authenticated request to the Coinbase Advanced Trade API.
   * Uses HMAC-SHA256 signing with the CDP API key.
   */
  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = body ? JSON.stringify(body) : '';

    // Build the signature message: timestamp + method + path + body
    const message = timestamp + method.toUpperCase() + path + bodyStr;

    // Sign with HMAC-SHA256 using the API secret
    const signature = createHmac('sha256', this.config.cdpApiKeySecret)
      .update(message)
      .digest('hex');

    const headers: Record<string, string> = {
      'CB-ACCESS-KEY': this.config.cdpApiKeyName,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    };

    const url = `${BASE_URL}${path}`;
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = bodyStr;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Coinbase API ${method} ${path} failed: ${response.status} - ${errorBody}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Simulate a trade for paper trading mode.
   */
  private async simulateTrade(order: EngineTradeOrder): Promise<EngineExecutionResult> {
    // Try to get real market price for realistic simulation
    let price = order.price ?? 0;

    if (!price) {
      try {
        price = await this.getPrice(order.instrument);
      } catch {
        // Use a reasonable default if price lookup fails
        const defaults: Record<string, number> = {
          'BTC_USDT': 95000, 'ETH_USDT': 3500, 'SOL_USDT': 180,
          'BTC-USD': 95000, 'ETH-USD': 3500, 'SOL-USD': 180,
        };
        price = defaults[order.instrument] ?? 100;
      }
    }

    // Simulate slippage (0.01% to 0.05%)
    const slippageBps = 1 + Math.random() * 4; // 1-5 bps
    const slippage = price * (slippageBps / 10000);
    const fillPrice = order.side === 'buy'
      ? price + slippage
      : price - slippage;

    // Simulate fees (0.1% maker, 0.2% taker for market)
    const feeRate = (!order.type || order.type === 'market') ? 0.002 : 0.001;
    const fees = fillPrice * order.quantity * feeRate;

    const orderId = `paper-${Date.now()}-${randomBytes(4).toString('hex')}`;

    console.log(
      `[CoinbaseEngine] Paper trade: ${order.side} ${order.quantity} ${order.instrument} @ $${fillPrice.toFixed(2)} (fees: $${fees.toFixed(4)})`,
    );

    return {
      orderId,
      instrument: order.instrument,
      status: 'filled',
      side: order.side,
      quantity: order.quantity,
      price: fillPrice,
      slippage: slippageBps / 10000,
      fees,
      timestamp: new Date(),
    };
  }

  /**
   * Convert engine instrument format to Coinbase product ID.
   * BTC_USDT -> BTC-USD, ETH_USDT -> ETH-USD
   */
  private toProductId(instrument: string): string {
    // If already in Coinbase format, return as-is
    if (instrument.includes('-')) return instrument;

    // Convert BTC_USDT -> BTC-USD
    const [base] = instrument.split('_');
    return `${base}-USD`;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[CoinbaseEngine] Not initialized. Call initialize() first.');
    }
  }
}

/**
 * Factory function to create a CoinbaseEngine from environment variables.
 */
export function createCoinbaseEngine(): CoinbaseEngine {
  const paperTrading = process.env.PAPER_TRADING !== 'false';

  return new CoinbaseEngine({
    cdpApiKeyName: process.env.CDP_API_KEY_NAME ?? '',
    cdpApiKeySecret: process.env.CDP_API_KEY_SECRET ?? '',
    networkId: process.env.CDP_NETWORK_ID ?? 'base-mainnet',
    walletDataPath: process.env.CDP_WALLET_DATA_PATH,
    paperTrading,
  });
}
