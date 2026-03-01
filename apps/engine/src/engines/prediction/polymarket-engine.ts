import type { EngineExecutionResult } from '../../orchestrator.js';
import type { EngineTradeOrder, EnginePosition } from '../crypto/coinbase-engine.js';

/**
 * Polymarket CLOB (Central Limit Order Book) integration for prediction market trading.
 *
 * Uses:
 * - Gamma API: Market discovery, metadata, resolution
 * - CLOB API: Order placement, cancellation, position management
 *
 * Polymarket operates on Polygon network with USDC as the settlement currency.
 */

interface PolymarketConfig {
  clobApiUrl: string;
  gammaApiUrl: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  funderAddress: string;
}

interface PolymarketMarket {
  conditionId: string;
  questionId: string;
  question: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  endDate: string;
  active: boolean;
  closed: boolean;
}

const DEFAULT_CLOB_URL = 'https://clob.polymarket.com';
const DEFAULT_GAMMA_URL = 'https://gamma-api.polymarket.com';

export class PolymarketEngine {
  private config: PolymarketConfig;
  private initialized = false;

  constructor(config: PolymarketConfig) {
    this.config = config;
  }

  /**
   * Initialize the Polymarket CLOB client.
   */
  async initialize(): Promise<void> {
    console.log('[PolymarketEngine] Initializing CLOB client...');

    try {
      // Verify API connectivity
      const response = await fetch(`${this.config.clobApiUrl}/time`);
      if (!response.ok) {
        throw new Error(`CLOB API health check failed: ${response.status}`);
      }

      this.initialized = true;
      console.log('[PolymarketEngine] Initialized successfully');
    } catch (error) {
      console.error('[PolymarketEngine] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Discover active prediction markets via Gamma API.
   */
  async getMarkets(params?: {
    limit?: number;
    offset?: number;
    active?: boolean;
    closed?: boolean;
    tag?: string;
  }): Promise<PolymarketMarket[]> {
    this.ensureInitialized();

    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.active !== undefined) searchParams.set('active', String(params.active));
    if (params?.closed !== undefined) searchParams.set('closed', String(params.closed));
    if (params?.tag) searchParams.set('tag', params.tag);

    const url = `${this.config.gammaApiUrl}/markets?${searchParams.toString()}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as PolymarketMarket[];
      console.log(`[PolymarketEngine] Fetched ${data.length} markets`);
      return data;
    } catch (error) {
      console.error('[PolymarketEngine] Failed to fetch markets:', error);
      throw error;
    }
  }

  /**
   * Place a limit or FOK (Fill or Kill) order on the CLOB.
   */
  async placeOrder(order: EngineTradeOrder & { outcome: string; orderType?: 'GTC' | 'FOK' }): Promise<EngineExecutionResult> {
    this.ensureInitialized();

    console.log(
      `[PolymarketEngine] Placing order: ${order.side} ${order.quantity} ${order.instrument} @ ${order.price ?? 'market'}`,
    );

    try {
      const clobOrder = {
        tokenID: order.instrument, // Condition token ID
        side: order.side === 'buy' ? 'BUY' : 'SELL',
        size: order.quantity.toString(),
        price: order.price?.toString() ?? '0',
        funder: this.config.funderAddress,
        orderType: order.orderType ?? 'GTC',
      };

      const response = await fetch(`${this.config.clobApiUrl}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'POLY-ADDRESS': this.config.funderAddress,
          'POLY-API-KEY': this.config.apiKey,
          'POLY-PASSPHRASE': this.config.apiPassphrase,
          'POLY-SIGNATURE': await this.signRequest(clobOrder),
          'POLY-TIMESTAMP': Date.now().toString(),
        },
        body: JSON.stringify(clobOrder),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`CLOB order failed: ${response.status} - ${errorBody}`);
      }

      const result = (await response.json()) as { orderID: string; status: string };

      console.log(`[PolymarketEngine] Order placed: ${result.orderID}`);
      return {
        orderId: result.orderID,
        instrument: order.instrument,
        status: result.status === 'matched' ? 'filled' : 'pending',
        side: order.side,
        quantity: order.quantity,
        price: order.price ?? 0,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('[PolymarketEngine] Order placement failed:', error);
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

    console.log(`[PolymarketEngine] Cancelling order: ${orderId}`);

    try {
      const response = await fetch(`${this.config.clobApiUrl}/order/${orderId}`, {
        method: 'DELETE',
        headers: {
          'POLY-ADDRESS': this.config.funderAddress,
          'POLY-API-KEY': this.config.apiKey,
          'POLY-PASSPHRASE': this.config.apiPassphrase,
          'POLY-TIMESTAMP': Date.now().toString(),
        },
      });

      if (!response.ok) {
        throw new Error(`Cancel failed: ${response.status}`);
      }

      console.log(`[PolymarketEngine] Order cancelled: ${orderId}`);
      return true;
    } catch (error) {
      console.error(`[PolymarketEngine] Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Get open positions.
   */
  async getPositions(): Promise<EnginePosition[]> {
    this.ensureInitialized();

    console.log('[PolymarketEngine] Fetching positions...');

    try {
      const response = await fetch(
        `${this.config.gammaApiUrl}/positions?user=${this.config.funderAddress}`,
        {
          headers: {
            'POLY-ADDRESS': this.config.funderAddress,
            'POLY-API-KEY': this.config.apiKey,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch positions: ${response.status}`);
      }

      const data = (await response.json()) as Array<{
        asset: string;
        size: string;
        avgPrice: string;
        currentPrice: string;
        pnl: string;
      }>;

      return data.map((p) => ({
        instrument: p.asset,
        side: 'buy' as const,
        quantity: parseFloat(p.size),
        entryPrice: parseFloat(p.avgPrice),
        currentPrice: parseFloat(p.currentPrice),
        unrealizedPnl: parseFloat(p.pnl),
        timestamp: new Date(),
      }));
    } catch (error) {
      console.error('[PolymarketEngine] Failed to get positions:', error);
      throw error;
    }
  }

  /**
   * Sign a CLOB API request.
   * TODO: Implement proper EIP-712 signing with wallet private key
   */
  private async signRequest(_payload: unknown): Promise<string> {
    // Placeholder - would use ethers.js or viem for actual signing
    return 'placeholder-signature';
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[PolymarketEngine] Not initialized. Call initialize() first.');
    }
  }
}

/**
 * Factory function to create a PolymarketEngine from environment variables.
 */
export function createPolymarketEngine(): PolymarketEngine {
  return new PolymarketEngine({
    clobApiUrl: process.env.POLYMARKET_CLOB_URL ?? DEFAULT_CLOB_URL,
    gammaApiUrl: process.env.POLYMARKET_GAMMA_URL ?? DEFAULT_GAMMA_URL,
    apiKey: process.env.POLYMARKET_API_KEY ?? '',
    apiSecret: process.env.POLYMARKET_API_SECRET ?? '',
    apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE ?? '',
    funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? '',
  });
}
