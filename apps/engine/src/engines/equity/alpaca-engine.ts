import type { EngineExecutionResult } from '../../orchestrator.js';
import type { EngineTradeOrder, EnginePosition } from '../crypto/coinbase-engine.js';

/**
 * Alpaca Markets integration for equity and options trading.
 *
 * Uses Alpaca Trade API v2 for:
 * - Market/limit/stop order placement
 * - Position management
 * - Real-time and historical quotes
 * - Account information
 *
 * Note: @alpacahq/alpaca-trade-api is a placeholder until installed.
 */

interface AlpacaConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  dataUrl: string;
  paper: boolean;
}

interface AlpacaQuote {
  symbol: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  lastPrice: number;
  lastSize: number;
  timestamp: string;
}

const PAPER_URL = 'https://paper-api.alpaca.markets';
const LIVE_URL = 'https://api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

export class AlpacaEngine {
  private config: AlpacaConfig;
  private initialized = false;

  constructor(config: AlpacaConfig) {
    this.config = config;
  }

  /**
   * Initialize the Alpaca client and verify API connectivity.
   */
  async initialize(): Promise<void> {
    console.log(`[AlpacaEngine] Initializing (${this.config.paper ? 'PAPER' : 'LIVE'})...`);

    try {
      // Verify API key by fetching account info
      const response = await fetch(`${this.config.baseUrl}/v2/account`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Alpaca API auth failed: ${response.status}`);
      }

      const account = (await response.json()) as {
        id: string;
        status: string;
        buying_power: string;
        equity: string;
      };

      this.initialized = true;
      console.log(
        `[AlpacaEngine] Initialized. Account: ${account.id}, Status: ${account.status}, Equity: $${account.equity}`,
      );
    } catch (error) {
      console.error('[AlpacaEngine] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Place a market, limit, or stop order.
   */
  async placeOrder(order: EngineTradeOrder): Promise<EngineExecutionResult> {
    this.ensureInitialized();

    console.log(
      `[AlpacaEngine] Placing ${order.type ?? 'market'} order: ${order.side} ${order.quantity} ${order.instrument}`,
    );

    try {
      const alpacaOrder: Record<string, unknown> = {
        symbol: order.instrument,
        qty: order.quantity.toString(),
        side: order.side,
        type: order.type ?? 'market',
        time_in_force: order.timeInForce ?? 'day',
      };

      if (order.type === 'limit' && order.price) {
        alpacaOrder.limit_price = order.price.toString();
      }

      if (order.type === 'stop' && order.stopPrice) {
        alpacaOrder.stop_price = order.stopPrice.toString();
      }

      if (order.type === 'stop_limit' && order.price && order.stopPrice) {
        alpacaOrder.limit_price = order.price.toString();
        alpacaOrder.stop_price = order.stopPrice.toString();
      }

      const response = await fetch(`${this.config.baseUrl}/v2/orders`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alpacaOrder),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Alpaca order failed: ${response.status} - ${errorBody}`);
      }

      const result = (await response.json()) as {
        id: string;
        status: string;
        filled_avg_price: string | null;
        filled_qty: string;
        symbol: string;
        side: string;
      };

      console.log(`[AlpacaEngine] Order placed: ${result.id} (${result.status})`);

      return {
        orderId: result.id,
        instrument: result.symbol,
        status: this.mapAlpacaStatus(result.status),
        side: order.side,
        quantity: parseFloat(result.filled_qty) || order.quantity,
        price: parseFloat(result.filled_avg_price ?? '0'),
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('[AlpacaEngine] Order placement failed:', error);
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

    console.log(`[AlpacaEngine] Cancelling order: ${orderId}`);

    try {
      const response = await fetch(`${this.config.baseUrl}/v2/orders/${orderId}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok && response.status !== 204) {
        throw new Error(`Cancel failed: ${response.status}`);
      }

      console.log(`[AlpacaEngine] Order cancelled: ${orderId}`);
      return true;
    } catch (error) {
      console.error(`[AlpacaEngine] Failed to cancel order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Get current open positions.
   */
  async getPositions(): Promise<EnginePosition[]> {
    this.ensureInitialized();

    console.log('[AlpacaEngine] Fetching positions...');

    try {
      const response = await fetch(`${this.config.baseUrl}/v2/positions`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch positions: ${response.status}`);
      }

      const data = (await response.json()) as Array<{
        symbol: string;
        side: string;
        qty: string;
        avg_entry_price: string;
        current_price: string;
        unrealized_pl: string;
        market_value: string;
      }>;

      return data.map((p) => ({
        instrument: p.symbol,
        side: p.side === 'long' ? ('buy' as const) : ('sell' as const),
        quantity: parseFloat(p.qty),
        entryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        unrealizedPnl: parseFloat(p.unrealized_pl),
        marketValue: parseFloat(p.market_value),
        timestamp: new Date(),
      }));
    } catch (error) {
      console.error('[AlpacaEngine] Failed to get positions:', error);
      throw error;
    }
  }

  /**
   * Get a real-time quote for a symbol.
   */
  async getQuote(symbol: string): Promise<AlpacaQuote> {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${this.config.dataUrl}/v2/stocks/${symbol}/quotes/latest`,
        { headers: this.getHeaders() },
      );

      if (!response.ok) {
        throw new Error(`Failed to get quote for ${symbol}: ${response.status}`);
      }

      const data = (await response.json()) as {
        quote: {
          bp: number;
          bs: number;
          ap: number;
          as: number;
          t: string;
        };
      };

      return {
        symbol,
        bidPrice: data.quote.bp,
        bidSize: data.quote.bs,
        askPrice: data.quote.ap,
        askSize: data.quote.as,
        lastPrice: (data.quote.bp + data.quote.ap) / 2,
        lastSize: 0,
        timestamp: data.quote.t,
      };
    } catch (error) {
      console.error(`[AlpacaEngine] Failed to get quote for ${symbol}:`, error);
      throw error;
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.config.apiKey,
      'APCA-API-SECRET-KEY': this.config.apiSecret,
    };
  }

  private mapAlpacaStatus(status: string): string {
    switch (status) {
      case 'filled':
        return 'filled';
      case 'partially_filled':
        return 'partial';
      case 'new':
      case 'accepted':
      case 'pending_new':
        return 'pending';
      case 'canceled':
      case 'expired':
      case 'replaced':
        return 'cancelled';
      case 'rejected':
        return 'failed';
      default:
        return 'pending';
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('[AlpacaEngine] Not initialized. Call initialize() first.');
    }
  }
}

/**
 * Factory function to create an AlpacaEngine from environment variables.
 */
export function createAlpacaEngine(): AlpacaEngine {
  const paper = process.env.ALPACA_PAPER !== 'false';
  return new AlpacaEngine({
    apiKey: process.env.ALPACA_API_KEY ?? '',
    apiSecret: process.env.ALPACA_API_SECRET ?? '',
    baseUrl: paper ? PAPER_URL : LIVE_URL,
    dataUrl: process.env.ALPACA_DATA_URL ?? DATA_URL,
    paper,
  });
}
