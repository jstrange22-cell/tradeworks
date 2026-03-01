import { createHmac, randomBytes } from 'node:crypto';
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
 *
 * Supports paper trading mode for development/testing — simulates order fills
 * with realistic slippage and fee modeling, identical to the Coinbase engine pattern.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolymarketConfig {
  clobApiUrl: string;
  gammaApiUrl: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  funderAddress: string;
  paperTrading: boolean;
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

interface ClobOrderBookResponse {
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

interface ClobOrderResponse {
  orderID: string;
  status: string;
}

interface ClobTimeResponse {
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CLOB_URL = 'https://clob.polymarket.com';
const DEFAULT_GAMMA_URL = 'https://gamma-api.polymarket.com';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class PolymarketEngine {
  private config: PolymarketConfig;
  private initialized = false;

  constructor(config: PolymarketConfig) {
    this.config = config;
  }

  /**
   * Initialize the Polymarket CLOB client.
   * Auto-falls back to paper trading mode if no API keys are configured.
   */
  async initialize(): Promise<void> {
    console.log(
      `[PolymarketEngine] Initializing (${this.config.paperTrading ? 'PAPER' : 'LIVE'})...`,
    );

    if (this.config.paperTrading) {
      console.log('[PolymarketEngine] Paper trading mode — no API calls required.');
      this.initialized = true;
      return;
    }

    if (!this.config.apiKey || !this.config.apiSecret) {
      console.warn('[PolymarketEngine] No API keys configured. Running in paper mode.');
      this.config.paperTrading = true;
      this.initialized = true;
      return;
    }

    try {
      // Verify API connectivity
      const response = await fetch(`${this.config.clobApiUrl}/time`);
      if (!response.ok) {
        throw new Error(`CLOB API health check failed: ${response.status}`);
      }

      const timeData = (await response.json()) as ClobTimeResponse;
      console.log(`[PolymarketEngine] CLOB server time: ${timeData.timestamp}`);

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
   * Get the current midpoint price for an outcome token from the CLOB order book.
   *
   * Returns a value between 0 and 1 representing the implied probability.
   * If no order book data is available, returns 0.
   */
  async getPrice(tokenId: string): Promise<number> {
    this.ensureInitialized();

    try {
      const response = await this.request(
        'GET',
        `/book?token_id=${encodeURIComponent(tokenId)}`,
      );
      const book = response as unknown as ClobOrderBookResponse;

      const bestBid = book.bids?.[0]?.price ? parseFloat(book.bids[0].price) : 0;
      const bestAsk = book.asks?.[0]?.price ? parseFloat(book.asks[0].price) : 0;

      if (bestBid > 0 && bestAsk > 0) {
        const midpoint = (bestBid + bestAsk) / 2;
        console.log(
          `[PolymarketEngine] Price for ${tokenId}: mid=${midpoint.toFixed(4)} (bid=${bestBid}, ask=${bestAsk})`,
        );
        return midpoint;
      }

      if (bestBid > 0) return bestBid;
      if (bestAsk > 0) return bestAsk;

      console.warn(`[PolymarketEngine] No order book data for token: ${tokenId}`);
      return 0;
    } catch (error) {
      console.error(`[PolymarketEngine] Failed to get price for ${tokenId}:`, error);
      return 0;
    }
  }

  /**
   * Place a limit or FOK (Fill or Kill) order on the CLOB.
   * In paper mode, simulates execution with realistic slippage and fees.
   */
  async placeOrder(
    order: EngineTradeOrder & { outcome: string; orderType?: 'GTC' | 'FOK' },
  ): Promise<EngineExecutionResult> {
    this.ensureInitialized();

    console.log(
      `[PolymarketEngine] Placing order: ${order.side} ${order.quantity} ${order.instrument} @ ${order.price ?? 'market'}`,
    );

    if (this.config.paperTrading) {
      return this.simulateTrade(order);
    }

    try {
      const clobOrder = {
        tokenID: order.instrument, // Condition token ID
        side: order.side === 'buy' ? 'BUY' : 'SELL',
        size: order.quantity.toString(),
        price: order.price?.toString() ?? '0',
        funder: this.config.funderAddress,
        orderType: order.orderType ?? 'GTC',
      };

      const response = (await this.request(
        'POST',
        '/order',
        clobOrder,
      )) as unknown as ClobOrderResponse;

      console.log(`[PolymarketEngine] Order placed: ${response.orderID}`);
      return {
        orderId: response.orderID,
        instrument: order.instrument,
        status: response.status === 'matched' ? 'filled' : 'pending',
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

    if (this.config.paperTrading) {
      console.log(`[PolymarketEngine] Paper mode — simulated cancel: ${orderId}`);
      return true;
    }

    console.log(`[PolymarketEngine] Cancelling order: ${orderId}`);

    try {
      await this.request('DELETE', `/order/${orderId}`);
      console.log(`[PolymarketEngine] Order cancelled: ${orderId}`);
      return true;
    } catch (error) {
      console.error(`[PolymarketEngine] Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Get open positions.
   * In paper mode, returns an empty array (no simulated position tracking).
   */
  async getPositions(): Promise<EnginePosition[]> {
    this.ensureInitialized();

    if (this.config.paperTrading) {
      console.log('[PolymarketEngine] Paper mode — no live positions.');
      return [];
    }

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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Sign a CLOB API request using HMAC-SHA256.
   *
   * The signature message is: timestamp + method + path + body
   * Signed with the API secret key, output as hex.
   */
  private signRequest(
    timestamp: string,
    method: string,
    path: string,
    body: string,
  ): string {
    const message = timestamp + method.toUpperCase() + path + body;

    return createHmac('sha256', this.config.apiSecret)
      .update(message)
      .digest('hex');
  }

  /**
   * Make an authenticated request to the Polymarket CLOB API.
   * Builds HMAC-SHA256 signature headers for every request.
   */
  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = body ? JSON.stringify(body) : '';

    const signature = this.signRequest(timestamp, method, path, bodyStr);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'POLY-ADDRESS': this.config.funderAddress,
      'POLY-API-KEY': this.config.apiKey,
      'POLY-PASSPHRASE': this.config.apiPassphrase,
      'POLY-SIGNATURE': signature,
      'POLY-TIMESTAMP': timestamp,
    };

    const url = `${this.config.clobApiUrl}${path}`;
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
      throw new Error(
        `Polymarket CLOB API ${method} ${path} failed: ${response.status} - ${errorBody}`,
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Simulate a trade for paper trading mode.
   * Models realistic slippage (1-3 bps) and fees (0.1%) for prediction markets.
   */
  private async simulateTrade(
    order: EngineTradeOrder & { outcome?: string },
  ): Promise<EngineExecutionResult> {
    // Use provided price or try to look up real market price
    let price = order.price ?? 0;

    if (!price) {
      try {
        price = await this.getPrice(order.instrument);
      } catch {
        // Default to 0.50 (even odds) if price lookup fails
        price = 0.5;
      }
    }

    // Clamp price to valid prediction market range (0, 1)
    price = Math.max(0.01, Math.min(0.99, price));

    // Simulate slippage: 1-3 basis points (tighter than crypto due to CLOB structure)
    const slippageBps = 1 + Math.random() * 2; // 1-3 bps
    const slippage = price * (slippageBps / 10000);
    const fillPrice =
      order.side === 'buy' ? price + slippage : price - slippage;

    // Simulate fees: 0.1% of notional (Polymarket fee structure)
    const notional = fillPrice * order.quantity;
    const feeRate = 0.001; // 0.1%
    const fees = notional * feeRate;

    const orderId = `paper-poly-${Date.now()}-${randomBytes(4).toString('hex')}`;

    console.log(
      `[PolymarketEngine] Paper trade: ${order.side} ${order.quantity} ${order.instrument} @ ${fillPrice.toFixed(4)} (fees: $${fees.toFixed(4)}, slippage: ${slippageBps.toFixed(1)} bps)`,
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
  const paperTrading = process.env.POLYMARKET_PAPER_TRADING !== 'false';

  return new PolymarketEngine({
    clobApiUrl: process.env.POLYMARKET_CLOB_URL ?? DEFAULT_CLOB_URL,
    gammaApiUrl: process.env.POLYMARKET_GAMMA_URL ?? DEFAULT_GAMMA_URL,
    apiKey: process.env.POLYMARKET_API_KEY ?? '',
    apiSecret: process.env.POLYMARKET_API_SECRET ?? '',
    apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE ?? '',
    funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? '',
    paperTrading,
  });
}
