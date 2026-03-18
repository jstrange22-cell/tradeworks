// ---------------------------------------------------------------------------
// Coinbase Execution Service — Order placement via Coinbase Advanced Trade API
// ---------------------------------------------------------------------------

import { coinbaseSignedRequest } from './coinbase-auth-service.js';

/** Map our instrument names to Coinbase product IDs */
export const COINBASE_PRODUCT_MAP: Record<string, string> = {
  'BTC-USD': 'BTC-USD',
  'ETH-USD': 'ETH-USD',
  'SOL-USD': 'SOL-USD',
  'AVAX-USD': 'AVAX-USD',
  'LINK-USD': 'LINK-USD',
  'DOGE-USD': 'DOGE-USD',
  'SHIB-USD': 'SHIB-USD',
  'MATIC-USD': 'MATIC-USD',
  'ADA-USD': 'ADA-USD',
  'DOT-USD': 'DOT-USD',
  'NEAR-USD': 'NEAR-USD',
  'SUI-USD': 'SUI-USD',
};

export async function placeCoinbaseOrder(
  productId: string,
  side: 'BUY' | 'SELL',
  quoteSize: string,   // USD amount — used for BUY orders (quote_size)
  apiKey: string,
  apiSecret: string,
  baseSize?: string,   // Asset units — required for SELL orders (base_size)
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const clientOrderId = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Coinbase Advanced Trade API requires:
  //   BUY  → market_market_ioc.quote_size  (USD amount to spend)
  //   SELL → market_market_ioc.base_size   (asset units to sell)
  // Using quote_size on a SELL returns: "Market sells must be parameterized in base currency"
  const orderConfig = side === 'SELL'
    ? { base_size: baseSize ?? quoteSize }
    : { quote_size: quoteSize };

  const orderBody = JSON.stringify({
    client_order_id: clientOrderId,
    product_id: productId,
    side,
    order_configuration: {
      market_market_ioc: orderConfig,
    },
  });

  try {
    const res = await coinbaseSignedRequest(
      'POST',
      '/api/v3/brokerage/orders',
      apiKey,
      apiSecret,
      orderBody,
    );

    const data = (await res.json()) as {
      success?: boolean;
      order_id?: string;
      error_response?: { error?: string; message?: string };
    };

    if (res.ok && data.success !== false) {
      const sizeLabel = side === 'SELL'
        ? `${baseSize ?? quoteSize} units`
        : `$${quoteSize}`;
      console.log(`[Engine] Coinbase order placed: ${side} ${productId} ${sizeLabel} — orderId: ${data.order_id ?? clientOrderId}`);
      return { success: true, orderId: data.order_id ?? clientOrderId };
    } else {
      const errMsg = data.error_response?.message ?? data.error_response?.error ?? `HTTP ${res.status}`;
      console.error(`[Engine] Coinbase order FAILED: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Engine] Coinbase order error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}
