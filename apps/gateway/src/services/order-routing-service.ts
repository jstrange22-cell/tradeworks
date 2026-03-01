import {
  getApiKeysByService,
  getDefaultPortfolio,
  insertTrade,
} from '@tradeworks/db';

export interface OrderRequest {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  price?: number;
  stopPrice?: number;
}

export interface OrderResult {
  orderId: string;
  status: 'filled' | 'pending' | 'rejected';
  fillPrice: number;
  fillQuantity: number;
  market: string;
  message: string;
}

/**
 * Detect market type from instrument name.
 */
function detectMarket(instrument: string): 'crypto' | 'equities' | 'prediction' {
  const upper = instrument.toUpperCase();
  // Crypto pairs typically have -USD, -USDT, _USD, _USDT suffixes or known crypto tickers
  const cryptoPatterns = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOGE', 'ADA', 'DOT', 'CRO', 'MATIC', 'XRP'];
  if (cryptoPatterns.some(p => upper.includes(p)) || upper.includes('_USD') || upper.includes('-USD')) {
    return 'crypto';
  }
  // Prediction market IDs are typically long hex strings or have specific format
  if (instrument.startsWith('0x') || instrument.includes('condition')) {
    return 'prediction';
  }
  // Default to equities (SPY, AAPL, MSFT, etc.)
  return 'equities';
}

/**
 * Simulate a paper trade with realistic slippage.
 */
function simulatePaperFill(order: OrderRequest, market: string): { fillPrice: number; slippage: number } {
  const basePrice = order.price ?? 100; // Will be replaced with real market price
  const slippageBps = market === 'crypto' ? Math.random() * 5 : Math.random() * 3;
  const slippageMultiplier = order.side === 'buy' ? (1 + slippageBps / 10000) : (1 - slippageBps / 10000);
  return {
    fillPrice: Math.round(basePrice * slippageMultiplier * 100) / 100,
    slippage: slippageBps,
  };
}

/**
 * Route an order to the correct exchange and execute it.
 * For MVP: executes paper trades directly, records in DB.
 */
export async function routeOrder(order: OrderRequest): Promise<OrderResult> {
  const market = detectMarket(order.instrument);
  const serviceMap: Record<string, string> = {
    crypto: 'coinbase',
    equities: 'alpaca',
    prediction: 'polymarket',
  };
  const service = serviceMap[market] ?? 'coinbase';

  // Check if we have API keys for this exchange
  let hasKeys = false;
  try {
    const keys = await getApiKeysByService(service);
    hasKeys = keys.length > 0;
  } catch {
    // DB unavailable, proceed with paper mode
  }

  // Get portfolio to check paper trading mode
  let isPaper = true;
  let portfolioId: string | undefined;
  try {
    const portfolio = await getDefaultPortfolio();
    if (portfolio) {
      isPaper = portfolio.paperTrading;
      portfolioId = portfolio.id;
    }
  } catch {
    // DB unavailable
  }

  if (!hasKeys || isPaper) {
    // Paper trading simulation
    const { fillPrice, slippage } = simulatePaperFill(order, market);
    const orderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Record in DB if possible
    if (portfolioId) {
      try {
        await insertTrade({
          portfolioId,
          instrument: order.instrument,
          market: market === 'prediction' ? 'crypto' : market as 'crypto' | 'equities',
          side: order.side,
          orderType: order.orderType,
          quantity: String(order.quantity),
          price: String(fillPrice),
          status: 'filled',
          exchangeRef: orderId,
          slippage: String(slippage),
          fees: String(fillPrice * order.quantity * 0.001), // 0.1% fee simulation
        });
      } catch (dbError) {
        console.warn('[OrderRouting] Failed to record paper trade in DB:', dbError);
      }
    }

    return {
      orderId,
      status: 'filled',
      fillPrice,
      fillQuantity: order.quantity,
      market,
      message: `Paper ${order.side} ${order.quantity} ${order.instrument} @ $${fillPrice.toFixed(2)}`,
    };
  }

  // TODO: Real exchange execution will be wired here via engine RPC
  return {
    orderId: `pending-${Date.now()}`,
    status: 'pending',
    fillPrice: 0,
    fillQuantity: 0,
    market,
    message: 'Live trading not yet wired. Please use paper mode.',
  };
}

export const OrderRoutingService = { routeOrder, detectMarket };
