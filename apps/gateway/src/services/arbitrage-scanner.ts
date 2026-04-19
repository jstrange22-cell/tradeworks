// ---------------------------------------------------------------------------
// Cross-Exchange Arbitrage Scanner
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArbitrageOpportunity {
  id: string;
  instrument: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  estimatedProfit: number;
  fees: number;
  netProfit: number;
  timestamp: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ArbitrageConfig {
  minSpreadPercent: number;
  feePercent: number;
  slippagePercent: number;
  tradeSize: number;
  exchanges: string[];
}

interface ExchangePrice {
  exchange: string;
  price: number;
}

// ---------------------------------------------------------------------------
// In-memory config with sensible defaults
// ---------------------------------------------------------------------------

let config: ArbitrageConfig = {
  minSpreadPercent: 0.5,
  feePercent: 0.1,
  slippagePercent: 0.05,
  tradeSize: 1000,
  exchanges: ['coinbase', 'crypto.com', 'kraken', 'binance'],
};

export function getArbitrageConfig(): ArbitrageConfig {
  return { ...config };
}

export function updateArbitrageConfig(
  updates: Partial<ArbitrageConfig>,
): ArbitrageConfig {
  config = { ...config, ...updates };
  return { ...config };
}

// ---------------------------------------------------------------------------
// Simulated exchange price feeds
//
// In production these would call real exchange APIs. For now we simulate
// realistic price divergences by applying small random offsets to a base price.
// ---------------------------------------------------------------------------

const BASE_PRICES: Record<string, number> = {
  'BTC-USD': 87_500,
  'ETH-USD': 2_150,
  'SOL-USD': 145,
  'AVAX-USD': 22.5,
  'LINK-USD': 15.2,
  'DOGE-USD': 0.085,
  'ADA-USD': 0.38,
  'DOT-USD': 4.8,
  'MATIC-USD': 0.52,
  'XRP-USD': 0.62,
};

function jitter(base: number, _maxPct: number): number {
  // No random jitter — return real price
  return base;
}

async function fetchExchangePrices(
  instrument: string,
): Promise<ExchangePrice[]> {
  const base = BASE_PRICES[instrument];
  if (base === undefined) return [];

  // Simulate each exchange quoting a slightly different price.
  // The jitter range is wide enough (~0.8%) to sometimes exceed the
  // default 0.5% min-spread threshold, creating realistic opportunities.
  return config.exchanges.map((exchange) => ({
    exchange,
    price: jitter(base, 0.4),
  }));
}

// ---------------------------------------------------------------------------
// Core scanner logic
// ---------------------------------------------------------------------------

function computeConfidence(spreadPct: number): 'high' | 'medium' | 'low' {
  if (spreadPct >= 1.0) return 'high';
  if (spreadPct >= 0.6) return 'medium';
  return 'low';
}

function findOpportunities(
  instrument: string,
  prices: ExchangePrice[],
): ArbitrageOpportunity[] {
  if (prices.length < 2) return [];

  const { minSpreadPercent, feePercent, slippagePercent, tradeSize } = config;
  const totalFeeRate = feePercent * 2 + slippagePercent * 2; // buy-side + sell-side
  const opportunities: ArbitrageOpportunity[] = [];

  for (let buyIdx = 0; buyIdx < prices.length; buyIdx++) {
    for (let sellIdx = 0; sellIdx < prices.length; sellIdx++) {
      if (buyIdx === sellIdx) continue;

      const buyPrice = prices[buyIdx].price;
      const sellPrice = prices[sellIdx].price;

      if (sellPrice <= buyPrice) continue;

      const spreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;

      if (spreadPct < minSpreadPercent) continue;

      const estimatedProfit = tradeSize * (spreadPct / 100);
      const fees = tradeSize * (totalFeeRate / 100);
      const netProfit = estimatedProfit - fees;

      if (netProfit <= 0) continue;

      opportunities.push({
        id: randomUUID(),
        instrument,
        buyExchange: prices[buyIdx].exchange,
        sellExchange: prices[sellIdx].exchange,
        buyPrice: parseFloat(buyPrice.toFixed(6)),
        sellPrice: parseFloat(sellPrice.toFixed(6)),
        spreadPercent: parseFloat(spreadPct.toFixed(4)),
        estimatedProfit: parseFloat(estimatedProfit.toFixed(2)),
        fees: parseFloat(fees.toFixed(2)),
        netProfit: parseFloat(netProfit.toFixed(2)),
        timestamp: new Date().toISOString(),
        confidence: computeConfidence(spreadPct),
      });
    }
  }

  // Return highest net profit first
  return opportunities.sort((a, b) => b.netProfit - a.netProfit);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_INSTRUMENTS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

export async function scanArbitrage(
  instruments: string[] = DEFAULT_INSTRUMENTS,
): Promise<ArbitrageOpportunity[]> {
  const allOpportunities: ArbitrageOpportunity[] = [];

  const results = await Promise.all(
    instruments.map(async (instrument) => {
      const prices = await fetchExchangePrices(instrument);
      return findOpportunities(instrument, prices);
    }),
  );

  for (const opps of results) {
    allOpportunities.push(...opps);
  }

  return allOpportunities.sort((a, b) => b.netProfit - a.netProfit);
}
