import type { EngineExecutionResult } from '../orchestrator.js';
import type { EngineTradeOrder, EnginePosition } from '../engines/crypto/coinbase-engine.js';
import { CoinbaseEngine, createCoinbaseEngine } from '../engines/crypto/coinbase-engine.js';
import { PolymarketEngine, createPolymarketEngine } from '../engines/prediction/polymarket-engine.js';
import { AlpacaEngine, createAlpacaEngine } from '../engines/equity/alpaca-engine.js';
import type { MCPTool } from './types.js';

// ---------------------------------------------------------------------------
// Engine instances (lazily initialised)
// ---------------------------------------------------------------------------

let coinbaseEngine: CoinbaseEngine | null = null;
let polymarketEngine: PolymarketEngine | null = null;
let alpacaEngine: AlpacaEngine | null = null;

async function getCoinbaseEngine(): Promise<CoinbaseEngine> {
  if (!coinbaseEngine) {
    coinbaseEngine = createCoinbaseEngine();
    await coinbaseEngine.initialize();
  }
  return coinbaseEngine;
}

async function getPolymarketEngine(): Promise<PolymarketEngine> {
  if (!polymarketEngine) {
    polymarketEngine = createPolymarketEngine();
    await polymarketEngine.initialize();
  }
  return polymarketEngine;
}

async function getAlpacaEngine(): Promise<AlpacaEngine> {
  if (!alpacaEngine) {
    alpacaEngine = createAlpacaEngine();
    await alpacaEngine.initialize();
  }
  return alpacaEngine;
}

// ---------------------------------------------------------------------------
// Exchange resolution
// ---------------------------------------------------------------------------

function resolveExchange(instrument: string): 'coinbase' | 'alpaca' | 'polymarket' {
  const cryptoPatterns = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'DOGE', 'LINK', 'UNI', 'AAVE'];
  if (cryptoPatterns.some((p) => instrument.toUpperCase().includes(p))) return 'coinbase';
  if (instrument.startsWith('0x') || instrument.includes('polymarket')) return 'polymarket';
  return 'alpaca';
}

// ---------------------------------------------------------------------------
// Paper trading simulation
// ---------------------------------------------------------------------------

function simulatePaperFill(
  order: EngineTradeOrder,
  referencePrice: number,
): EngineExecutionResult {
  const basePrice = order.price ?? referencePrice;

  // Simulate slippage: 1-10 basis points
  const slippageBps = Math.random() * 10 + 1;
  const slippageMultiplier = order.side === 'buy'
    ? 1 + slippageBps / 10_000
    : 1 - slippageBps / 10_000;
  const simulatedPrice = basePrice * slippageMultiplier;
  const slippage = Math.abs(simulatedPrice - basePrice);

  // Simulate fees: 0.1% taker fee (typical for crypto)
  const fees = order.quantity * simulatedPrice * 0.001;

  return {
    orderId: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instrument: order.instrument,
    status: 'simulated',
    side: order.side,
    quantity: order.quantity,
    price: simulatedPrice,
    timestamp: new Date(),
    slippage,
    fees,
  };
}

// ---------------------------------------------------------------------------
// Exported standalone functions (consumed by the orchestrator directly)
// ---------------------------------------------------------------------------

/**
 * Execute a trade on the appropriate exchange.
 * In paper mode the fill is simulated locally with realistic slippage / fees.
 */
export async function executeTrade(order: EngineTradeOrder): Promise<EngineExecutionResult> {
  const exchange = order.exchange ?? resolveExchange(order.instrument);
  console.log(
    `[TradingTools] Routing trade to ${exchange}: ${order.side} ${order.quantity} ${order.instrument}`,
  );

  switch (exchange) {
    case 'coinbase': {
      const engine = await getCoinbaseEngine();
      return engine.executeTrade(order);
    }
    case 'polymarket': {
      const engine = await getPolymarketEngine();
      return engine.placeOrder({ ...order, outcome: order.outcome ?? 'YES' });
    }
    case 'alpaca': {
      const engine = await getAlpacaEngine();
      return engine.placeOrder(order);
    }
    default:
      return {
        orderId: '',
        instrument: order.instrument,
        status: 'failed',
        side: order.side,
        quantity: order.quantity,
        price: 0,
        timestamp: new Date(),
        error: `Unknown exchange: ${exchange}`,
      };
  }
}

/**
 * Cancel a pending order on the appropriate exchange.
 */
export async function cancelOrder(params: {
  orderId: string;
  exchange: 'coinbase' | 'alpaca' | 'polymarket';
}): Promise<boolean> {
  console.log(`[TradingTools] Cancelling order ${params.orderId} on ${params.exchange}`);

  switch (params.exchange) {
    case 'polymarket': {
      const engine = await getPolymarketEngine();
      return engine.cancelOrder(params.orderId);
    }
    case 'alpaca': {
      const engine = await getAlpacaEngine();
      return engine.cancelOrder(params.orderId);
    }
    case 'coinbase':
      console.warn('[TradingTools] Coinbase on-chain trades cannot be cancelled');
      return false;
    default:
      return false;
  }
}

/**
 * Get all open positions across all exchanges.
 */
export async function getPositions(): Promise<{
  coinbase: EnginePosition[];
  alpaca: EnginePosition[];
  polymarket: EnginePosition[];
  total: EnginePosition[];
}> {
  console.log('[TradingTools] Fetching positions across all exchanges...');

  const [cbResult, alResult, pmResult] = await Promise.allSettled([
    getCoinbaseEngine().then((e) => e.getPositions()),
    getAlpacaEngine().then((e) => e.getPositions()),
    getPolymarketEngine().then((e) => e.getPositions()),
  ]);

  const cb = cbResult.status === 'fulfilled' ? cbResult.value : [];
  const al = alResult.status === 'fulfilled' ? alResult.value : [];
  const pm = pmResult.status === 'fulfilled' ? pmResult.value : [];

  return {
    coinbase: cb,
    alpaca: al,
    polymarket: pm,
    total: [...cb, ...al, ...pm],
  };
}

/**
 * Close a specific position by placing an opposing market order.
 */
export async function closePosition(params: {
  instrument: string;
  exchange?: 'coinbase' | 'alpaca' | 'polymarket';
  quantity?: number;
}): Promise<EngineExecutionResult> {
  const exchange = params.exchange ?? resolveExchange(params.instrument);
  console.log(`[TradingTools] Closing position: ${params.instrument} on ${exchange}`);

  const allPositions = await getPositions();
  const position = allPositions.total.find((p) => p.instrument === params.instrument);

  if (!position) {
    return {
      orderId: '',
      instrument: params.instrument,
      status: 'failed',
      side: 'sell',
      quantity: 0,
      price: 0,
      timestamp: new Date(),
      error: `No open position found for ${params.instrument}`,
    };
  }

  const closeQuantity = params.quantity ?? position.quantity;
  const closeSide: 'buy' | 'sell' = position.side === 'buy' ? 'sell' : 'buy';

  return executeTrade({
    instrument: params.instrument,
    side: closeSide,
    quantity: closeQuantity,
    type: 'market',
    exchange,
  });
}

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

/** Detect whether the engine is running in paper mode from env */
const isPaperMode = (): boolean => process.env.PAPER_TRADING !== 'false';

export const tradingTools: MCPTool[] = [
  {
    name: 'execute_trade',
    description:
      'Place an order (market or limit). In paper mode the fill is simulated locally with realistic slippage (1-10 bps) and fees (0.1%). In live mode the order is routed to the appropriate exchange engine (Coinbase for crypto, Alpaca for equities, Polymarket for prediction markets).',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Trading instrument symbol (e.g. BTC_USDT, AAPL, ETH_USDT)',
        },
        side: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'Order side',
        },
        quantity: {
          type: 'number',
          description: 'Order quantity (in base units)',
        },
        order_type: {
          type: 'string',
          enum: ['market', 'limit', 'stop', 'stop_limit'],
          description: 'Order type (default: market)',
        },
        price: {
          type: 'number',
          description: 'Limit price. Required for limit and stop_limit orders.',
        },
        stop_price: {
          type: 'number',
          description: 'Stop trigger price. Required for stop and stop_limit orders.',
        },
        exchange: {
          type: 'string',
          enum: ['coinbase', 'alpaca', 'polymarket'],
          description: 'Target exchange. Auto-resolved from instrument if omitted.',
        },
      },
      required: ['instrument', 'side', 'quantity'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const order: EngineTradeOrder = {
        instrument: p.instrument as string,
        side: p.side as 'buy' | 'sell',
        quantity: p.quantity as number,
        type: (p.order_type as string) ?? 'market',
        price: p.price as number | undefined,
        stopPrice: p.stop_price as number | undefined,
        exchange: p.exchange as string | undefined,
      };

      // Paper mode: simulate fill locally
      if (isPaperMode()) {
        const refPrice = order.price ?? 0;
        if (refPrice <= 0) {
          // No reference price available -- the orchestrator typically supplies
          // market state, but when called directly we need a fallback.
          return {
            ...simulatePaperFill(order, 1),
            error: 'Paper fill used fallback price. Provide a limit price for more accurate simulation.',
          };
        }
        return simulatePaperFill(order, refPrice);
      }

      // Live mode: route to exchange engine
      return executeTrade(order);
    },
  },

  {
    name: 'cancel_order',
    description:
      'Cancel a pending order. Requires the order ID and the exchange it was placed on. Note: Coinbase on-chain trades cannot be cancelled after submission.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'The order ID to cancel' },
        exchange: {
          type: 'string',
          enum: ['coinbase', 'alpaca', 'polymarket'],
          description: 'The exchange the order was placed on',
        },
      },
      required: ['order_id', 'exchange'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      if (isPaperMode()) {
        console.log(`[TradingTools] Paper mode: simulating cancel of order ${p.order_id}`);
        return { cancelled: true, orderId: p.order_id, mode: 'paper' };
      }

      const success = await cancelOrder({
        orderId: p.order_id as string,
        exchange: p.exchange as 'coinbase' | 'alpaca' | 'polymarket',
      });

      return { cancelled: success, orderId: p.order_id };
    },
  },

  {
    name: 'get_positions',
    description:
      'List all open positions across all connected exchanges (Coinbase, Alpaca, Polymarket). Returns per-exchange breakdowns and a combined total array.',
    inputSchema: {
      type: 'object',
      properties: {
        exchange: {
          type: 'string',
          enum: ['coinbase', 'alpaca', 'polymarket', 'all'],
          description: 'Filter by exchange. Default: all.',
        },
      },
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const allPositions = await getPositions();
      const filter = (p.exchange as string) ?? 'all';

      if (filter === 'all') return allPositions;
      if (filter === 'coinbase') return { positions: allPositions.coinbase, exchange: 'coinbase' };
      if (filter === 'alpaca') return { positions: allPositions.alpaca, exchange: 'alpaca' };
      if (filter === 'polymarket') return { positions: allPositions.polymarket, exchange: 'polymarket' };

      return allPositions;
    },
  },

  {
    name: 'close_position',
    description:
      'Close an open position by placing an opposing market order. Automatically determines the correct side (buy-to-close for shorts, sell-to-close for longs). Optionally close a partial quantity.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'The instrument whose position to close',
        },
        exchange: {
          type: 'string',
          enum: ['coinbase', 'alpaca', 'polymarket'],
          description: 'Exchange. Auto-resolved from instrument if omitted.',
        },
        quantity: {
          type: 'number',
          description: 'Quantity to close. Defaults to full position size.',
        },
      },
      required: ['instrument'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      if (isPaperMode()) {
        // In paper mode, look up the simulated position and generate a close fill
        const allPositions = await getPositions();
        const position = allPositions.total.find(
          (pos) => pos.instrument === (p.instrument as string),
        );

        if (!position) {
          return {
            orderId: '',
            instrument: p.instrument,
            status: 'failed',
            side: 'sell',
            quantity: 0,
            price: 0,
            timestamp: new Date(),
            error: `No open position found for ${p.instrument}`,
          };
        }

        const closeQty = (p.quantity as number) ?? position.quantity;
        const closeSide: 'buy' | 'sell' = position.side === 'buy' ? 'sell' : 'buy';

        return simulatePaperFill(
          {
            instrument: p.instrument as string,
            side: closeSide,
            quantity: closeQty,
            type: 'market',
          },
          position.currentPrice,
        );
      }

      return closePosition({
        instrument: p.instrument as string,
        exchange: p.exchange as 'coinbase' | 'alpaca' | 'polymarket' | undefined,
        quantity: p.quantity as number | undefined,
      });
    },
  },
];
