/**
 * E2: Momentum Rotator — Monthly Sector/Factor Rotation
 *
 * Monthly: rank sectors by 3/6 month momentum.
 * Buy top 3 sectors. If negative absolute momentum → cash (AGG).
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

const SECTOR_ETFS = [
  { symbol: 'XLK', sector: 'Technology' },
  { symbol: 'XLV', sector: 'Healthcare' },
  { symbol: 'XLF', sector: 'Financials' },
  { symbol: 'XLE', sector: 'Energy' },
  { symbol: 'XLI', sector: 'Industrials' },
  { symbol: 'XLY', sector: 'Consumer Discretionary' },
  { symbol: 'XLP', sector: 'Consumer Staples' },
  { symbol: 'XLU', sector: 'Utilities' },
  { symbol: 'XLRE', sector: 'Real Estate' },
  { symbol: 'XLC', sector: 'Communications' },
  { symbol: 'XLB', sector: 'Materials' },
];

export async function scanMomentumRotation(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  // Only run on first trading day of month (approximately)
  const today = new Date();
  if (today.getDate() > 5) return opps; // Only first 5 days of month

  try {
    const rankings: Array<{ symbol: string; sector: string; momentum3m: number; momentum6m: number }> = [];

    for (const etf of SECTOR_ETFS) {
      try {
        const barsResp = await getBars({ symbols: [etf.symbol], timeframe: '1Day', limit: 150 });
        const symbolBars = barsResp.bars[etf.symbol];
        if (!symbolBars || symbolBars.length < 130) continue;

        const current = symbolBars[symbolBars.length - 1].c;
        const price3mAgo = symbolBars[Math.max(0, symbolBars.length - 63)].c;
        const price6mAgo = symbolBars[Math.max(0, symbolBars.length - 126)].c;

        const momentum3m = (current - price3mAgo) / price3mAgo;
        const momentum6m = (current - price6mAgo) / price6mAgo;

        rankings.push({ symbol: etf.symbol, sector: etf.sector, momentum3m, momentum6m });
      } catch { continue; }
    }

    // Rank by combined 3m + 6m momentum
    rankings.sort((a, b) => (b.momentum3m + b.momentum6m) - (a.momentum3m + a.momentum6m));

    // Top 3 sectors get buy signals
    const top3 = rankings.slice(0, 3);
    for (const r of top3) {
      // Absolute momentum check: only buy if 6m return is positive
      if (r.momentum6m < 0) continue;

      opps.push({
        id: randomUUID(),
        engine: 'E2',
        domain: 'equity',
        ticker: r.symbol,
        action: 'buy',
        price: 0, // Will be filled at execution
        suggestedSize: 0,
        maxSize: 8000,
        confidence: Math.min(80, 50 + r.momentum3m * 100),
        reasoning: `Momentum Rotation: ${r.sector} (${r.symbol}) — 3m: ${(r.momentum3m * 100).toFixed(1)}%, 6m: ${(r.momentum6m * 100).toFixed(1)}%`,
        sector: r.sector,
        detectedAt: new Date().toISOString(),
      });
    }

    logger.info({ ranked: rankings.length, signals: opps.length }, '[E2] Momentum rotation scan complete');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[E2] Momentum rotation failed');
  }

  return opps;
}
