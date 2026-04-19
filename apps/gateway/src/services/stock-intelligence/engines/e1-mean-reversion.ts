/**
 * E1: Mean Reversion — Buy Oversold Stocks, Sell on Bounce
 *
 * Entry: RSI(2) < 10 + below lower Bollinger Band + above 200 MA
 * Exit: RSI > 70 or middle BB or 5 days max hold
 * Stop: -3%
 * Regime: SPY > 200MA AND VIX < 30 ONLY
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars, type AlpacaBar } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

// Watchlist: liquid S&P 500 stocks
const MEAN_REV_WATCHLIST = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'JNJ',
  'UNH', 'PG', 'HD', 'MA', 'DIS', 'BAC', 'PFE', 'NFLX', 'COST', 'AMD',
];

function calculateRSI(bars: AlpacaBar[], period = 2): number {
  if (bars.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const change = bars[i].c - bars[i - 1].c;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period || 0.001;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(bars: AlpacaBar[], period = 20): { upper: number; middle: number; lower: number } {
  if (bars.length < period) return { upper: 0, middle: 0, lower: 0 };
  const closes = bars.slice(-period).map(b => b.c);
  const mean = closes.reduce((s, c) => s + c, 0) / period;
  const variance = closes.reduce((s, c) => s + (c - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

function calculate200MA(bars: AlpacaBar[]): number {
  if (bars.length < 200) return 0;
  return bars.slice(-200).reduce((s, b) => s + b.c, 0) / 200;
}

export async function scanMeanReversion(regime: string, vix: number): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  // Regime gate: only in risk_on or neutral
  if (regime === 'crisis' || vix > 30) return opps;

  try {
    for (const symbol of MEAN_REV_WATCHLIST) {
      try {
        const barsResp = await getBars({ symbols: [symbol], timeframe: '1Day', limit: 250 });
        const symbolBars = barsResp.bars[symbol];
        if (!symbolBars || symbolBars.length < 200) continue;

        const rsi2 = calculateRSI(symbolBars, 2);
        const bb = calculateBollingerBands(symbolBars, 20);
        const ma200 = calculate200MA(symbolBars);
        const currentPrice = symbolBars[symbolBars.length - 1].c;

        // Entry: RSI(2) < 10 + below lower BB + above 200 MA
        if (rsi2 < 10 && currentPrice < bb.lower && currentPrice > ma200) {
          const stopLoss = currentPrice * 0.97; // -3%
          const takeProfit = bb.middle; // Target: middle BB

          opps.push({
            id: randomUUID(),
            engine: 'E1',
            domain: 'equity',
            ticker: symbol,
            action: 'buy',
            price: currentPrice,
            stopLoss,
            takeProfit,
            riskRewardRatio: (takeProfit - currentPrice) / (currentPrice - stopLoss),
            suggestedSize: 0, // Calculated by orchestrator
            maxSize: 5000,
            confidence: Math.min(85, 50 + (10 - rsi2) * 5),
            reasoning: `Mean Reversion: ${symbol} RSI(2)=${rsi2.toFixed(0)}, below BB(${bb.lower.toFixed(2)}), above 200MA(${ma200.toFixed(2)})`,
            sector: undefined,
            regime,
            detectedAt: new Date().toISOString(),
          });
        }
      } catch { continue; }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[E1] Mean reversion scan failed');
  }

  return opps;
}
