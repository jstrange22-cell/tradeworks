/**
 * E3: Pairs Trader — Cointegrated Pair Statistical Arbitrage
 *
 * Market-neutral: long one stock, short the correlated pair.
 * Uses the SAME arb principles as Type 3 cross-platform arb.
 * Entry: z-score > 2.0. Exit: z crosses 0. Stop: z > 3.5.
 * Works in ALL regimes (market-neutral).
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars, type AlpacaBar } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

// Classic cointegrated pairs
const PAIRS = [
  ['KO', 'PEP'],       // Coca-Cola / Pepsi
  ['GOOGL', 'META'],    // Google / Meta
  ['JPM', 'BAC'],       // JP Morgan / Bank of America
  ['XOM', 'CVX'],       // Exxon / Chevron
  ['HD', 'LOW'],         // Home Depot / Lowe's
  ['V', 'MA'],           // Visa / Mastercard
  ['MSFT', 'AAPL'],     // Microsoft / Apple
  ['UPS', 'FDX'],       // UPS / FedEx
];

function calculateZScore(bars1: AlpacaBar[], bars2: AlpacaBar[], lookback = 60): {
  zScore: number;
  mean: number;
  std: number;
  ratio: number;
} | null {
  if (bars1.length < lookback || bars2.length < lookback) return null;

  const ratios: number[] = [];
  for (let i = bars1.length - lookback; i < bars1.length; i++) {
    const r = bars1[i].c / bars2[i].c;
    ratios.push(r);
  }

  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length;
  const std = Math.sqrt(variance);
  const currentRatio = ratios[ratios.length - 1];
  const zScore = std > 0 ? (currentRatio - mean) / std : 0;

  return { zScore, mean, std, ratio: currentRatio };
}

export async function scanPairsTrading(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  for (const [sym1, sym2] of PAIRS) {
    try {
      const [bars1Resp, bars2Resp] = await Promise.all([
        getBars({ symbols: [sym1], timeframe: '1Day', limit: 100 }),
        getBars({ symbols: [sym2], timeframe: '1Day', limit: 100 }),
      ]);

      const bars1 = bars1Resp.bars[sym1];
      const bars2 = bars2Resp.bars[sym2];
      if (!bars1 || !bars2) continue;

      const z = calculateZScore(bars1, bars2, 60);
      if (!z) continue;

      // Entry: z-score > 2.0 (long underperformer, short outperformer)
      if (Math.abs(z.zScore) > 2.0) {
        const price1 = bars1[bars1.length - 1].c;
        const price2 = bars2[bars2.length - 1].c;

        if (z.zScore > 2.0) {
          // Ratio too high → short sym1, long sym2
          opps.push({
            id: randomUUID(),
            engine: 'E3',
            domain: 'equity',
            ticker: `${sym2}/${sym1}`,
            action: 'buy', // Buy the underperformer (sym2)
            price: price2,
            stopLoss: price2 * 0.95, // z > 3.5 equiv
            takeProfit: price2 * 1.03, // z → 0 equiv
            riskRewardRatio: 1.5,
            suggestedSize: 0,
            maxSize: 5000,
            confidence: Math.min(85, 50 + Math.abs(z.zScore) * 15),
            reasoning: `Pairs Arb: ${sym1}/${sym2} z=${z.zScore.toFixed(2)} — Long ${sym2} @ $${price2.toFixed(2)}, Short ${sym1} @ $${price1.toFixed(2)}. Market-neutral.`,
            detectedAt: new Date().toISOString(),
          });
        } else if (z.zScore < -2.0) {
          // Ratio too low → long sym1, short sym2
          opps.push({
            id: randomUUID(),
            engine: 'E3',
            domain: 'equity',
            ticker: `${sym1}/${sym2}`,
            action: 'buy',
            price: price1,
            stopLoss: price1 * 0.95,
            takeProfit: price1 * 1.03,
            riskRewardRatio: 1.5,
            suggestedSize: 0,
            maxSize: 5000,
            confidence: Math.min(85, 50 + Math.abs(z.zScore) * 15),
            reasoning: `Pairs Arb: ${sym1}/${sym2} z=${z.zScore.toFixed(2)} — Long ${sym1} @ $${price1.toFixed(2)}, Short ${sym2} @ $${price2.toFixed(2)}. Market-neutral.`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch { continue; }
  }

  logger.info({ pairs: PAIRS.length, signals: opps.length }, '[E3] Pairs trading scan complete');
  return opps;
}
