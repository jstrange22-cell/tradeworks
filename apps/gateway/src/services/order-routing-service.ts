import {
  getApiKeysByService,
  getDefaultPortfolio,
  insertTrade,
  decryptApiKey,
} from '@tradeworks/db';

export interface OrderRequest {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  price?: number;
  stopPrice?: number;
  /** When provided by the frontend, skip pattern-matching and use this market directly. */
  market?: 'crypto' | 'equities' | 'prediction';
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
  const slippageBps = market === 'crypto' ? 3 : 1; // Fixed slippage estimate — no random
  const slippageMultiplier = order.side === 'buy' ? (1 + slippageBps / 10000) : (1 - slippageBps / 10000);
  return {
    fillPrice: Math.round(basePrice * slippageMultiplier * 100) / 100,
    slippage: slippageBps,
  };
}

// ── Live Exchange Execution ──────────────────────────────────────────

async function executeCoinbaseOrder(
  order: OrderRequest,
  apiKey: string,
  apiSecret: string,
): Promise<OrderResult> {
  const { createHmac, randomUUID } = await import('node:crypto');

  const orderId = randomUUID();
  const body = JSON.stringify({
    client_order_id: orderId,
    product_id: order.instrument,
    side: order.side.toUpperCase(),
    order_configuration: order.orderType === 'limit' && order.price
      ? { limit_limit_gtc: { base_size: String(order.quantity), limit_price: String(order.price) } }
      : { market_market_ioc: { base_size: String(order.quantity) } },
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'POST';
  const path = '/api/v3/brokerage/orders';
  const message = timestamp + method + path + body;
  const signature = createHmac('sha256', apiSecret).update(message).digest('hex');

  const response = await fetch(`https://api.coinbase.com${path}`, {
    method: 'POST',
    headers: {
      'CB-ACCESS-KEY': apiKey,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[OrderRouting] Coinbase order failed:', errText);
    return {
      orderId: '',
      status: 'rejected',
      fillPrice: 0,
      fillQuantity: 0,
      market: 'crypto',
      message: `Coinbase order rejected: ${response.status}`,
    };
  }

  const result = (await response.json()) as {
    success: boolean;
    order_id: string;
    success_response?: { order_id: string };
    error_response?: { error: string; message: string };
  };

  if (!result.success) {
    return {
      orderId: '',
      status: 'rejected',
      fillPrice: 0,
      fillQuantity: 0,
      market: 'crypto',
      message: `Coinbase: ${result.error_response?.message ?? 'Order rejected'}`,
    };
  }

  // For market orders, fill is immediate but price comes async
  return {
    orderId: result.success_response?.order_id ?? result.order_id ?? orderId,
    status: 'filled',
    fillPrice: order.price ?? 0,
    fillQuantity: order.quantity,
    market: 'crypto',
    message: `Live ${order.side} ${order.quantity} ${order.instrument} via Coinbase`,
  };
}

async function executeAlpacaOrder(
  order: OrderRequest,
  apiKey: string,
  apiSecret: string,
  paper: boolean,
): Promise<OrderResult> {
  const baseUrl = paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

  const alpacaOrder: Record<string, unknown> = {
    symbol: order.instrument,
    qty: order.quantity.toString(),
    side: order.side,
    type: order.orderType === 'stop_limit' ? 'stop_limit' : order.orderType,
    time_in_force: 'day',
  };

  if ((order.orderType === 'limit' || order.orderType === 'stop_limit') && order.price) {
    alpacaOrder.limit_price = order.price.toString();
  }
  if ((order.orderType === 'stop' || order.orderType === 'stop_limit') && order.stopPrice) {
    alpacaOrder.stop_price = order.stopPrice.toString();
  }

  const response = await fetch(`${baseUrl}/v2/orders`, {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(alpacaOrder),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[OrderRouting] Alpaca order failed:', errText);
    return {
      orderId: '',
      status: 'rejected',
      fillPrice: 0,
      fillQuantity: 0,
      market: 'equities',
      message: `Alpaca order rejected: ${response.status} - ${errText}`,
    };
  }

  const result = (await response.json()) as {
    id: string;
    status: string;
    filled_avg_price: string | null;
    filled_qty: string;
  };

  const status = result.status === 'filled' ? 'filled' as const
    : result.status === 'rejected' ? 'rejected' as const
    : 'pending' as const;

  return {
    orderId: result.id,
    status,
    fillPrice: parseFloat(result.filled_avg_price ?? '0') || order.price || 0,
    fillQuantity: parseFloat(result.filled_qty) || order.quantity,
    market: 'equities',
    message: `Live ${order.side} ${order.quantity} ${order.instrument} via Alpaca (${status})`,
  };
}

async function executePolymarketOrder(
  order: OrderRequest,
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
  funderAddress: string,
): Promise<OrderResult> {
  const { createHmac } = await import('node:crypto');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = '/order';
  const body = JSON.stringify({
    tokenID: order.instrument,
    side: order.side === 'buy' ? 'BUY' : 'SELL',
    size: order.quantity.toString(),
    price: order.price?.toString() ?? '0.5',
    funder: funderAddress,
    orderType: 'GTC',
  });

  const message = timestamp + 'POST' + path + body;
  const signature = createHmac('sha256', apiSecret).update(message).digest('hex');

  const response = await fetch(`https://clob.polymarket.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'POLY-ADDRESS': funderAddress,
      'POLY-API-KEY': apiKey,
      'POLY-PASSPHRASE': apiPassphrase,
      'POLY-SIGNATURE': signature,
      'POLY-TIMESTAMP': timestamp,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[OrderRouting] Polymarket order failed:', errText);
    return {
      orderId: '',
      status: 'rejected',
      fillPrice: 0,
      fillQuantity: 0,
      market: 'prediction',
      message: `Polymarket order rejected: ${response.status}`,
    };
  }

  const result = (await response.json()) as { orderID: string; status: string };

  return {
    orderId: result.orderID,
    status: result.status === 'matched' ? 'filled' : 'pending',
    fillPrice: order.price ?? 0,
    fillQuantity: order.quantity,
    market: 'prediction',
    message: `Live ${order.side} ${order.quantity} ${order.instrument} via Polymarket`,
  };
}

// ── Main Router ──────────────────────────────────────────────────────

/**
 * Route an order to the correct exchange and execute it.
 * Supports both paper trading (simulation) and live exchange execution.
 */
export async function routeOrder(order: OrderRequest): Promise<OrderResult> {
  const market = order.market ?? detectMarket(order.instrument);
  const serviceMap: Record<string, string> = {
    crypto: 'coinbase',
    equities: 'alpaca',
    prediction: 'polymarket',
  };
  const service = serviceMap[market] ?? 'coinbase';

  // Check if we have API keys for this exchange
  let hasKeys = false;
  let keyRecords: Awaited<ReturnType<typeof getApiKeysByService>> = [];
  try {
    keyRecords = await getApiKeysByService(service);
    hasKeys = keyRecords.length > 0;
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

  // Determine if sandbox
  const isSandbox = keyRecords.length > 0 && keyRecords[0].environment === 'sandbox';

  if (!hasKeys || isPaper || isSandbox) {
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

  // ── Live Exchange Execution ──────────────────────────────────────────

  console.log(`[OrderRouting] Live execution: ${order.side} ${order.quantity} ${order.instrument} via ${service}`);

  try {
    const keyRecord = keyRecords[0];
    const decryptedKey = decryptApiKey(keyRecord.encryptedKey as Buffer);
    const decryptedSecret = keyRecord.encryptedSecret
      ? decryptApiKey(keyRecord.encryptedSecret as Buffer)
      : '';

    let result: OrderResult;

    switch (service) {
      case 'coinbase':
        result = await executeCoinbaseOrder(order, decryptedKey, decryptedSecret);
        break;

      case 'alpaca':
        result = await executeAlpacaOrder(order, decryptedKey, decryptedSecret, false);
        break;

      case 'polymarket':
        // Polymarket needs passphrase + funder address — stored as extra fields
        // For now, use key as passphrase fallback
        result = await executePolymarketOrder(
          order,
          decryptedKey,
          decryptedSecret,
          decryptedKey, // passphrase fallback
          '', // funder address — would need to be stored per user
        );
        break;

      default:
        return {
          orderId: '',
          status: 'rejected',
          fillPrice: 0,
          fillQuantity: 0,
          market,
          message: `Unsupported exchange: ${service}`,
        };
    }

    // Record live trade in DB
    if (portfolioId && result.status === 'filled') {
      try {
        await insertTrade({
          portfolioId,
          instrument: order.instrument,
          market: market === 'prediction' ? 'crypto' : market as 'crypto' | 'equities',
          side: order.side,
          orderType: order.orderType,
          quantity: String(result.fillQuantity),
          price: String(result.fillPrice),
          status: 'filled',
          exchangeRef: result.orderId,
          slippage: '0',
          fees: '0',
        });
      } catch (dbError) {
        console.warn('[OrderRouting] Failed to record live trade in DB:', dbError);
      }
    }

    return result;
  } catch (error) {
    console.error(`[OrderRouting] Live execution failed for ${service}:`, error);
    return {
      orderId: '',
      status: 'rejected',
      fillPrice: 0,
      fillQuantity: 0,
      market,
      message: `Live execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export const OrderRoutingService = { routeOrder, detectMarket };
