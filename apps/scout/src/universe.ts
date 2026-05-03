/**
 * Static candidate universe for the AI scout.
 *
 * STOCKS: S&P 100 — high liquidity (avg vol > 5M), broad sector coverage,
 * mid-large cap. Scout picks the top 30 from this pool each refresh.
 *
 * CRYPTO: 20 CEX blue chips that the gateway's webhook handler routes to
 * Coinbase paper. These are ALWAYS included in the watchlist (no AI ranking)
 * because the universe is small enough to monitor in full.
 *
 * To change the watchlist size:
 *   - Adjust STOCK_TARGET_COUNT (currently 30) and CRYPTO list (20 fixed)
 *   - Total = STOCK_TARGET_COUNT + CRYPTO.length
 *   - Stay ≤ 50 to fit in TradingView Pro+'s 100-alert quota
 *     (100 alerts ÷ 2 directions per ticker = 50 tickers)
 */

export const SP100: readonly string[] = [
  // Tech (15)
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'META', 'AMZN', 'TSLA',
  'AVGO', 'ORCL', 'CRM', 'ADBE', 'INTC', 'CSCO', 'AMD',
  // Finance (12)
  'BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS',
  'AXP', 'BLK', 'C', 'SCHW',
  // Healthcare (12)
  'UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT',
  'BMY', 'AMGN', 'GILD', 'CVS',
  // Consumer (15)
  'WMT', 'COST', 'HD', 'NKE', 'MCD', 'SBUX', 'TGT', 'LOW',
  'KO', 'PEP', 'PG', 'PM', 'MO', 'DIS', 'NFLX',
  // Industrial / Energy (15)
  'BA', 'CAT', 'GE', 'UPS', 'RTX', 'LMT', 'HON', 'DE',
  'XOM', 'CVX', 'COP', 'SLB', 'OXY', 'EOG', 'F',
  // Comms / Materials / Other (15)
  'T', 'VZ', 'CMCSA', 'CHTR', 'LIN', 'APD', 'NEM',
  'SPGI', 'BKNG', 'IBM', 'INTU', 'NOW', 'PYPL', 'SNAP', 'UBER',
  // ETFs / index proxies (5) — valuable benchmarks for sector rotation
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLK',
];

/**
 * Crypto blue chips matching the gateway's CEX_BLUE_CHIPS whitelist in
 * apps/gateway/src/routes/webhooks-tradingview.ts.
 *
 * TradingView format: COINBASE:<symbol>USD (the bridge will format these for
 * chart_set_symbol). The gateway strips USD/USDT during routing.
 */
export const CRYPTO_BLUE_CHIPS: readonly string[] = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD',
  'DOTUSD', 'LINKUSD', 'AVAXUSD', 'MATICUSD', 'ATOMUSD',
  'UNIUSD', 'AAVEUSD', 'LTCUSD', 'DOGEUSD', 'SHIBUSD',
  'NEARUSD', 'SUIUSD', 'ARBUSD', 'OPUSD', 'FILUSD',
];

export const STOCK_TARGET_COUNT = 30;
export const CRYPTO_FIXED_COUNT = CRYPTO_BLUE_CHIPS.length; // 20

/**
 * TradingView symbol format helper. The bridge needs `EXCHANGE:SYMBOL` form
 * for chart_set_symbol. Yahoo lookups use bare ticker (with `.` → `-`).
 */
export function tvFormat(ticker: string, kind: 'stock' | 'crypto'): string {
  if (kind === 'crypto') return `COINBASE:${ticker}`;
  // Most US stocks resolve cleanly without exchange prefix in TV's set-symbol
  // call. Indices/ETFs work too. TV will resolve based on its symbol search.
  return ticker;
}

export function yahooFormat(ticker: string): string {
  // BRK.B → BRK-B for Yahoo Finance compatibility
  return ticker.replace('.', '-');
}
