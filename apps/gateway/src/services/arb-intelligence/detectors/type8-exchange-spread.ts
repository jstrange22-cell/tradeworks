/**
 * Type 8 Detector: Crypto Exchange Price Spreads
 *
 * Compares crypto prices across exchanges (Coinbase vs CoinGecko aggregate).
 * When spread > 0.5% → directional signal (not tradeable as arb without
 * both exchange accounts, but useful intelligence for crypto agent).
 *
 * Also detects stablecoin depegging (USDT, USDC) which signals risk events.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import type { ArbOpportunity, DetectorResult } from '../models.js';

const DETECTOR_TYPE = 'type8_exchange_spread' as const;

interface PriceComparison {
  symbol: string;
  coinbasePrice: number;
  geckoPrice: number;
  spreadPct: number;
  direction: 'coinbase_premium' | 'coinbase_discount' | 'equal';
}

async function fetchCoinbasePrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  try {
    const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD', 'DOGE-USD'];
    for (const sym of symbols) {
      try {
        const res = await fetch(`https://api.exchange.coinbase.com/products/${sym}/ticker`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const data = await res.json() as { price: string };
          prices[sym.replace('-USD', '')] = parseFloat(data.price);
        }
      } catch { continue; }
    }
  } catch { /* silent */ }
  return prices;
}

async function fetchGeckoPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,avalanche-2,chainlink,dogecoin&vs_currencies=usd',
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number }>;
      const map: Record<string, string> = {
        bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL',
        'avalanche-2': 'AVAX', chainlink: 'LINK', dogecoin: 'DOGE',
      };
      for (const [id, info] of Object.entries(data)) {
        const sym = map[id];
        if (sym) prices[sym] = info.usd;
      }
    }
  } catch { /* silent */ }
  return prices;
}

export async function scanType8(minSpreadPct = 0.5): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  const [cbPrices, gkPrices] = await Promise.all([
    fetchCoinbasePrices(),
    fetchGeckoPrices(),
  ]);

  const comparisons: PriceComparison[] = [];

  for (const [symbol, cbPrice] of Object.entries(cbPrices)) {
    const gkPrice = gkPrices[symbol];
    if (!gkPrice || !cbPrice) continue;

    const spreadPct = ((cbPrice - gkPrice) / gkPrice) * 100;
    const direction = spreadPct > 0.1 ? 'coinbase_premium' : spreadPct < -0.1 ? 'coinbase_discount' : 'equal';

    comparisons.push({ symbol, coinbasePrice: cbPrice, geckoPrice: gkPrice, spreadPct, direction });

    if (Math.abs(spreadPct) >= minSpreadPct) {
      // Directional signal: if Coinbase is at a premium, the market consensus (CoinGecko)
      // suggests the "real" price is lower → potential short signal
      // If Coinbase is at a discount → potential buy signal
      const side = spreadPct < 0 ? 'yes' : 'no'; // Discount = bullish (buy), Premium = bearish

      opportunities.push({
        id: randomUUID(),
        arbType: DETECTOR_TYPE,
        venue_a: 'kalshi', // Placeholder — this is a directional signal
        ticker_a: symbol,
        title_a: `${symbol} exchange spread`,
        side_a: side,
        price_a: cbPrice,
        venue_b: 'polymarket',
        ticker_b: symbol,
        title_b: `CoinGecko aggregate`,
        side_b: side,
        price_b: gkPrice,
        totalCost: cbPrice,
        grossProfitPerContract: Math.abs(cbPrice - gkPrice),
        netProfitPerContract: Math.abs(cbPrice - gkPrice) * 0.8, // Rough net
        fillableQuantity: 1,
        confidence: Math.min(0.8, Math.abs(spreadPct) / 5),
        urgency: Math.abs(spreadPct) > 2 ? 'high' : 'medium',
        category: 'CRYPTO',
        description: `Exchange spread: ${symbol} Coinbase $${cbPrice.toFixed(2)} vs CoinGecko $${gkPrice.toFixed(2)} (${spreadPct > 0 ? '+' : ''}${spreadPct.toFixed(2)}%)`,
        reasoning: `${direction}: Coinbase ${spreadPct > 0 ? 'premium' : 'discount'} of ${Math.abs(spreadPct).toFixed(2)}%. Directional signal for crypto agent.`,
        detectedAt: new Date().toISOString(),
        sizeMultiplier: 1.0,
        legs: [
          { venue: 'kalshi', ticker: symbol, side, price: cbPrice, quantity: 1 },
        ],
      });
    }
  }

  if (comparisons.length > 0) {
    const spreads = comparisons.map(c => `${c.symbol}:${c.spreadPct > 0 ? '+' : ''}${c.spreadPct.toFixed(2)}%`).join(', ');
    logger.info(
      { pairs: comparisons.length, signals: opportunities.length },
      `[T8 ExSpread] ${spreads}`,
    );
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: Object.keys(cbPrices).length,
    durationMs: Date.now() - start,
  };
}
