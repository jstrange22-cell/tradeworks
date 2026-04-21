/**
 * Type 9: Stock-Crypto Spread Detector
 *
 * Compares crypto ETF prices (GBTC, ETHE, BITO, MSTR) from Alpaca
 * vs spot crypto prices from Coinbase/CoinGecko.
 *
 * Opportunities:
 *   - GBTC trading at premium/discount to BTC NAV
 *   - ETHE trading at premium/discount to ETH NAV
 *   - MSTR implied BTC per share vs actual holdings
 *   - BITO futures premium vs BTC spot
 *
 * Also detects Coinbase vs CoinGecko spot price divergence for
 * BTC/ETH/SOL as a cross-exchange spread signal.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import type { ArbOpportunity, DetectorResult } from '../models.js';

const DETECTOR_TYPE = 'type9_stock_crypto_spread' as const;

// Crypto ETFs and their underlying mapping
// sharesPerCoin = how much of the underlying coin 1 share represents
// Updated 2026-04-05 based on current NAV / spot price
const ETF_MAPPING: Array<{
  ticker: string;
  underlying: string;
  sharesPerCoin: number;
  description: string;
}> = [
  { ticker: 'GBTC', underlying: 'BTC', sharesPerCoin: 0.000771, description: 'Grayscale Bitcoin Trust' },
  { ticker: 'ETHE', underlying: 'ETH', sharesPerCoin: 0.00833, description: 'Grayscale Ethereum Trust' },
  // BITO excluded — holds BTC futures, not spot. NAV doesn't map to BTC spot price.
  { ticker: 'IBIT', underlying: 'BTC', sharesPerCoin: 0.000566, description: 'iShares Bitcoin Trust ETF' },
  { ticker: 'FBTC', underlying: 'BTC', sharesPerCoin: 0.000867, description: 'Fidelity Wise Origin Bitcoin Fund' },
];

// Fetch Alpaca stock prices
async function getAlpacaPrices(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  try {
    const { getSnapshots } = await import('../../stocks/alpaca-client.js');
    const snapshots = await getSnapshots(tickers);
    for (const [symbol, snap] of Object.entries(snapshots)) {
      if (snap?.latestTrade?.p) {
        prices[symbol] = snap.latestTrade.p;
      }
    }
  } catch {
    // Alpaca unavailable — market might be closed
  }
  return prices;
}

// Fetch crypto spot prices from CoinGecko
async function getCoinGeckoPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd',
      { signal: AbortSignal.timeout(5_000) },
    );
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number }>;
      if (data.bitcoin?.usd) prices['BTC'] = data.bitcoin.usd;
      if (data.ethereum?.usd) prices['ETH'] = data.ethereum.usd;
      if (data.solana?.usd) prices['SOL'] = data.solana.usd;
    }
  } catch { /* CoinGecko unavailable */ }
  return prices;
}

// Fetch crypto spot prices from Coinbase
async function getCoinbasePrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  try {
    const { getCoinbaseKeys, coinbaseSignedRequest } = await import('../../coinbase-auth-service.js');
    const keys = getCoinbaseKeys();
    if (keys) {
      const cbRes = await coinbaseSignedRequest('GET', '/api/v3/brokerage/market/products?limit=50', keys.apiKey, keys.apiSecret);
      if (cbRes.ok) {
        const cbData = await cbRes.json() as { products?: Array<{ product_id: string; price: string }> };
        for (const p of cbData.products ?? []) {
          if (p.product_id === 'BTC-USD') prices['BTC'] = parseFloat(p.price);
          if (p.product_id === 'ETH-USD') prices['ETH'] = parseFloat(p.price);
          if (p.product_id === 'SOL-USD') prices['SOL'] = parseFloat(p.price);
        }
      }
    }
  } catch { /* Coinbase unavailable */ }
  return prices;
}

// Helper to build a proper ArbOpportunity from T9 data
function buildT9Opportunity(params: {
  ticker_a: string;
  ticker_b: string;
  price_a: number;
  price_b: number;
  spreadPct: number;
  confidence: number;
  reasoning: string;
  category: string;
  underlyingSpot?: number; // Real crypto spot (ETH/BTC USD), not NAV-per-ETF-share
}): ArbOpportunity {
  // Normalize prices to 0-1 scale for the arb system
  // For T9, we model the spread as a virtual arb:
  //   totalCost = 1 - (spreadPct / 100) = how much of $1 we pay (inverted spread)
  //   grossProfit = spreadPct / 100 per contract
  const spreadFrac = params.spreadPct / 100;
  const virtualCost = Math.max(0.01, 1 - spreadFrac); // e.g., 3% spread → cost 0.97

  return {
    id: `type9_${params.ticker_a}_${Date.now()}_${randomUUID().slice(0, 8)}`,
    arbType: DETECTOR_TYPE,
    venue_a: 'alpaca',
    ticker_a: params.ticker_a,
    title_a: `${params.ticker_a} ETF/Spot`,
    side_a: 'yes',
    price_a: virtualCost / 2,
    venue_b: 'alpaca',
    ticker_b: params.ticker_b,
    title_b: `${params.ticker_b} Spot`,
    side_b: 'no',
    price_b: virtualCost / 2,
    totalCost: virtualCost,
    grossProfitPerContract: spreadFrac,
    netProfitPerContract: spreadFrac * 0.8, // 20% fee/slippage estimate
    fillableQuantity: 100, // Virtual contracts representing $100 exposure
    confidence: params.confidence / 100, // Normalize to 0-1
    urgency: params.spreadPct > 5 ? 'high' : params.spreadPct > 3 ? 'medium' : 'low',
    category: params.category,
    description: params.reasoning,
    reasoning: params.reasoning,
    detectedAt: new Date().toISOString(),
    sizeMultiplier: 1.0,
    legs: [
      { venue: 'alpaca', ticker: params.ticker_a, side: 'yes', price: params.price_a, quantity: 1 },
      { venue: 'alpaca', ticker: params.ticker_b, side: 'no', price: params.price_b, quantity: 1 },
    ],
    // Expose raw prices for cross-system signal sharing
    _rawPriceA: params.price_a,
    _rawPriceB: params.price_b,
    _spreadPct: params.spreadPct,
    _underlying: params.ticker_b.replace('-USD', ''),
    _underlyingSpot: params.underlyingSpot ?? params.price_b, // Real crypto spot for cross-system trade dispatch
  } as ArbOpportunity & { _rawPriceA: number; _rawPriceB: number; _spreadPct: number; _underlying: string; _underlyingSpot: number };
}

export async function scanType9(): Promise<DetectorResult> {
  const opportunities: ArbOpportunity[] = [];
  const start = Date.now();

  try {
    // Fetch all prices in parallel
    const etfTickers = ETF_MAPPING.map(e => e.ticker);
    const [stockPrices, coinGeckoPrices, coinbasePrices] = await Promise.all([
      getAlpacaPrices(etfTickers),
      getCoinGeckoPrices(),
      getCoinbasePrices(),
    ]);

    // Merge crypto prices: Coinbase takes priority over CoinGecko
    const cryptoPrices: Record<string, number> = { ...coinGeckoPrices };
    for (const [sym, price] of Object.entries(coinbasePrices)) {
      if (price > 0) cryptoPrices[sym] = price;
    }

    const btcSpot = cryptoPrices['BTC'];
    const ethSpot = cryptoPrices['ETH'];

    // ── ETF vs Spot Spread Detection ──────────────────────────────────
    if (btcSpot || ethSpot) {
      for (const etf of ETF_MAPPING) {
        const etfPrice = stockPrices[etf.ticker];
        const spotPrice = cryptoPrices[etf.underlying];
        if (!etfPrice || !spotPrice) continue;

        // Calculate NAV per share
        const navPerShare = spotPrice * etf.sharesPerCoin;
        const premiumPct = ((etfPrice - navPerShare) / navPerShare) * 100;

        // Lower threshold: 0.5% for paper mode (was 1%)
        // Real ETF premiums for GBTC can be 2-5%, IBIT/FBTC usually tighter 0.5-2%
        if (Math.abs(premiumPct) > 0.5) {
          const direction = premiumPct > 0 ? 'PREMIUM' : 'DISCOUNT';
          const action = premiumPct > 0 ? 'Short ETF / Long Spot' : 'Long ETF / Short Spot';

          opportunities.push(buildT9Opportunity({
            ticker_a: etf.ticker,
            ticker_b: `${etf.underlying}-USD`,
            price_a: etfPrice,
            price_b: navPerShare,
            spreadPct: Math.abs(premiumPct),
            confidence: Math.min(90, 50 + Math.abs(premiumPct) * 10),
            reasoning: `${etf.ticker} ${direction} ${Math.abs(premiumPct).toFixed(2)}% vs ${etf.underlying} spot. ${action}. ETF=$${etfPrice.toFixed(2)}, NAV=$${navPerShare.toFixed(2)}`,
            category: 'crypto_etf_spread',
            underlyingSpot: spotPrice, // Real ETH/BTC spot for cross-system signal dispatch
          }));

          logger.info({
            etf: etf.ticker, underlying: etf.underlying,
            etfPrice, navPerShare: navPerShare.toFixed(4),
            premium: premiumPct.toFixed(2),
          }, `[ArbT9] ${etf.ticker} ${direction} ${Math.abs(premiumPct).toFixed(2)}% vs ${etf.underlying} spot`);
        }
      }
    }

    // ── Coinbase vs CoinGecko Cross-Exchange Spread ────────────────────
    // If both sources have prices, check for divergence
    for (const sym of ['BTC', 'ETH', 'SOL'] as const) {
      const cbPrice = coinbasePrices[sym];
      const cgPrice = coinGeckoPrices[sym];
      if (!cbPrice || !cgPrice || cbPrice <= 0 || cgPrice <= 0) continue;

      const spreadPct = Math.abs(((cbPrice - cgPrice) / cgPrice) * 100);

      // >0.3% divergence is a signal (normally they track within 0.1%)
      if (spreadPct > 0.3) {
        const cheapSide = cbPrice < cgPrice ? 'Coinbase' : 'CoinGecko';
        const expensiveSide = cbPrice > cgPrice ? 'Coinbase' : 'CoinGecko';

        opportunities.push(buildT9Opportunity({
          ticker_a: `${sym}-CB`,
          ticker_b: `${sym}-CG`,
          price_a: cbPrice,
          price_b: cgPrice,
          spreadPct,
          confidence: Math.min(85, 55 + spreadPct * 20),
          reasoning: `${sym} cross-exchange spread: ${cheapSide} $${Math.min(cbPrice, cgPrice).toFixed(2)} vs ${expensiveSide} $${Math.max(cbPrice, cgPrice).toFixed(2)} (${spreadPct.toFixed(3)}% divergence). Buy ${cheapSide}, signal sell on ${expensiveSide}.`,
          category: 'crypto_cross_exchange',
        }));

        logger.info({
          sym, cbPrice, cgPrice, spreadPct: spreadPct.toFixed(3),
        }, `[ArbT9] ${sym} cross-exchange spread: ${spreadPct.toFixed(3)}%`);
      }
    }

  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ArbT9] Stock-crypto spread scan failed');
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: ETF_MAPPING.length + 3, // ETFs + 3 cross-exchange pairs
    durationMs: Date.now() - start,
  };
}

/**
 * Extract cross-system trading signals from T9 opportunities.
 * Used by the orchestrator to share insights with crypto-agent and stock engine.
 */
export function extractT9Signals(opps: ArbOpportunity[]): Array<{
  underlying: string;
  direction: 'buy' | 'sell';
  spreadPct: number;
  spotPrice: number;
  etfTicker: string;
  reasoning: string;
}> {
  return opps
    .filter(o => o.arbType === DETECTOR_TYPE)
    .map(o => {
      const raw = o as ArbOpportunity & { _rawPriceA?: number; _rawPriceB?: number; _spreadPct?: number; _underlying?: string; _underlyingSpot?: number };
      const isPremium = o.reasoning.includes('PREMIUM');
      return {
        underlying: raw._underlying ?? o.ticker_a,
        direction: isPremium ? 'sell' as const : 'buy' as const,
        spreadPct: raw._spreadPct ?? 0,
        // Use the real crypto spot price (not the NAV-per-ETF-share, which
        // was the pre-fix bug that priced ETH at $19 instead of $2300).
        spotPrice: raw._underlyingSpot ?? raw._rawPriceB ?? 0,
        etfTicker: o.ticker_a,
        reasoning: o.reasoning,
      };
    });
}
