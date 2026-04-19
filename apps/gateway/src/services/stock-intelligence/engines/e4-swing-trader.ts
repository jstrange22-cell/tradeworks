/**
 * E4: Swing Trader — Multi-Day Technical Setups
 *
 * Reuses existing swing-scanner.ts from services/stocks/.
 * AI-identified setups. 2:1 R/R min. 1% max risk. Trailing stop after 1R. 10d time stop.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { scanForSwingTrades } from '../../stocks/swing-scanner.js';
import type { StockOpportunity } from '../stock-models.js';

export async function scanSwingTrades(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  try {
    const result = await scanForSwingTrades();

    for (const signal of result.signals) {
      if (signal.confidence < 50) continue;
      if (signal.riskReward < 2.0) continue; // Min 2:1 R/R

      opps.push({
        id: randomUUID(),
        engine: 'E4',
        domain: 'equity',
        ticker: signal.symbol,
        action: signal.action === 'sell' ? 'sell' : 'buy',
        price: signal.entry,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: signal.riskReward,
        suggestedSize: 0,
        maxSize: 5000,
        confidence: signal.confidence,
        reasoning: `Swing: ${signal.symbol} ${signal.action} — ${signal.reasons.join(', ')}. R/R: ${signal.riskReward.toFixed(1)}:1`,
        detectedAt: new Date().toISOString(),
      });
    }

    logger.info({ scanned: result.watchlistSize, signals: opps.length }, '[E4] Swing scan complete');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[E4] Swing scan failed');
  }

  return opps;
}
