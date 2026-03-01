import type { EngineExecutionResult } from '../orchestrator.js';
import type { EngineTradeOrder, EnginePosition } from '../engines/crypto/coinbase-engine.js';
import { CoinbaseEngine, createCoinbaseEngine } from '../engines/crypto/coinbase-engine.js';
import { PolymarketEngine, createPolymarketEngine } from '../engines/prediction/polymarket-engine.js';
import { AlpacaEngine, createAlpacaEngine } from '../engines/equity/alpaca-engine.js';

/**
 * MCP tool definitions for trade execution.
 * These tools are exposed to the Execution Specialist agent.
 */

// Engine instances (lazily initialized)
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

/**
 * Determine which engine to use based on instrument type.
 */
function resolveExchange(instrument: string): 'coinbase' | 'alpaca' | 'polymarket' {
  // Crypto instruments
  const cryptoPatterns = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'DOGE', 'LINK', 'UNI', 'AAVE'];
  if (cryptoPatterns.some((p) => instrument.toUpperCase().includes(p))) {
    return 'coinbase';
  }

  // Prediction market instruments (typically start with condition IDs or contain specific markers)
  if (instrument.startsWith('0x') || instrument.includes('polymarket')) {
    return 'polymarket';
  }

  // Default to equities
  return 'alpaca';
}

/**
 * Execute a trade on the appropriate exchange.
 */
export async function executeTrade(order: EngineTradeOrder): Promise<EngineExecutionResult> {
  const exchange = order.exchange ?? resolveExchange(order.instrument);

  console.log(`[TradingTools] Routing trade to ${exchange}: ${order.side} ${order.quantity} ${order.instrument}`);

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
 * Cancel an order on the appropriate exchange.
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
      // Coinbase on-chain trades are not cancellable after submission
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

  const [coinbasePositions, alpacaPositions, polymarketPositions] = await Promise.allSettled([
    getCoinbaseEngine().then((e) => e.getPositions()),
    getAlpacaEngine().then((e) => e.getPositions()),
    getPolymarketEngine().then((e) => e.getPositions()),
  ]);

  const cb = coinbasePositions.status === 'fulfilled' ? coinbasePositions.value : [];
  const al = alpacaPositions.status === 'fulfilled' ? alpacaPositions.value : [];
  const pm = polymarketPositions.status === 'fulfilled' ? polymarketPositions.value : [];

  return {
    coinbase: cb,
    alpaca: al,
    polymarket: pm,
    total: [...cb, ...al, ...pm],
  };
}

/**
 * Close a specific position.
 */
export async function closePosition(params: {
  instrument: string;
  exchange?: 'coinbase' | 'alpaca' | 'polymarket';
  quantity?: number;
}): Promise<EngineExecutionResult> {
  const exchange = params.exchange ?? resolveExchange(params.instrument);

  console.log(`[TradingTools] Closing position: ${params.instrument} on ${exchange}`);

  // To close a position, we place a sell order for the current quantity
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

/**
 * MCP tool schema definitions for agent consumption.
 */
export const TRADING_TOOL_SCHEMAS = {
  executeTrade: {
    name: 'executeTrade',
    description: 'Execute a trade on the appropriate exchange (Coinbase, Alpaca, or Polymarket)',
    parameters: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'The trading instrument symbol' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'Buy or sell' },
        quantity: { type: 'number', description: 'Order quantity' },
        type: { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'], description: 'Order type' },
        price: { type: 'number', description: 'Limit price (for limit/stop_limit orders)' },
        stopPrice: { type: 'number', description: 'Stop price (for stop/stop_limit orders)' },
        exchange: { type: 'string', enum: ['coinbase', 'alpaca', 'polymarket'], description: 'Target exchange' },
      },
      required: ['instrument', 'side', 'quantity'],
    },
  },
  cancelOrder: {
    name: 'cancelOrder',
    description: 'Cancel an open order on an exchange',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order ID to cancel' },
        exchange: { type: 'string', enum: ['coinbase', 'alpaca', 'polymarket'], description: 'The exchange' },
      },
      required: ['orderId', 'exchange'],
    },
  },
  getPositions: {
    name: 'getPositions',
    description: 'Get all open positions across all exchanges',
    parameters: { type: 'object', properties: {} },
  },
  closePosition: {
    name: 'closePosition',
    description: 'Close a specific position',
    parameters: {
      type: 'object',
      properties: {
        instrument: { type: 'string', description: 'The instrument to close' },
        exchange: { type: 'string', enum: ['coinbase', 'alpaca', 'polymarket'] },
        quantity: { type: 'number', description: 'Quantity to close (defaults to full position)' },
      },
      required: ['instrument'],
    },
  },
};
