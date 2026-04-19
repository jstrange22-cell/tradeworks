/**
 * M2: Precious Metals Momentum — GLD/SLV/GDX Trend Following
 *
 * GLD: 50/200 MA golden/death cross system.
 * SLV: activate when gold/silver ratio > 80 (silver undervalued).
 * GDX: miners follow gold with leverage, use when GLD trending.
 * Max metals allocation: 15%. Trailing stop: 8%.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

const MAX_METALS_ALLOCATION_USD = 4000;
const TRAILING_STOP_PCT = 0.08;
const GOLD_SILVER_RATIO_THRESHOLD = 80;

function calculateMA(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  return slice.reduce((sum, c) => sum + c, 0) / period;
}

function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number {
  if (highs.length < period + 1) return 0;
  let atrSum = 0;
  for (let i = highs.length - period; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    atrSum += tr;
  }
  return atrSum / period;
}

interface MetalsBarData {
  closes: number[];
  highs: number[];
  lows: number[];
  currentPrice: number;
}

async function fetchBarData(symbol: string, limit: number): Promise<MetalsBarData | null> {
  try {
    const barsResp = await getBars({ symbols: [symbol], timeframe: '1Day', limit });
    const symbolBars = barsResp.bars[symbol];
    if (!symbolBars || symbolBars.length < 200) return null;

    return {
      closes: symbolBars.map(b => b.c),
      highs: symbolBars.map(b => b.h),
      lows: symbolBars.map(b => b.l),
      currentPrice: symbolBars[symbolBars.length - 1].c,
    };
  } catch {
    return null;
  }
}

function detectCrossover(
  shortMA: number[],
  longMA: number[],
  lookback: number,
): 'golden' | 'death' | 'none' {
  if (shortMA.length < lookback + 1 || longMA.length < lookback + 1) return 'none';

  const prevShort = shortMA[shortMA.length - 2];
  const prevLong = longMA[longMA.length - 2];
  const currShort = shortMA[shortMA.length - 1];
  const currLong = longMA[longMA.length - 1];

  // Golden cross: 50 MA crosses above 200 MA
  if (prevShort <= prevLong && currShort > currLong) return 'golden';
  // Death cross: 50 MA crosses below 200 MA
  if (prevShort >= prevLong && currShort < currLong) return 'death';

  return 'none';
}

function buildMASeries(closes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    result.push(slice.reduce((s, c) => s + c, 0) / period);
  }
  return result;
}

export async function scanMetalsMomentum(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  try {
    // Fetch all metals data in parallel
    const [gldData, slvData, gdxData] = await Promise.all([
      fetchBarData('GLD', 250),
      fetchBarData('SLV', 250),
      fetchBarData('GDX', 250),
    ]);

    if (!gldData) {
      logger.warn('[M2] Could not fetch GLD data — skipping metals momentum');
      return opps;
    }

    // ── GLD: 50/200 MA Cross System ──────────────────────────────────────

    const gldMA50Series = buildMASeries(gldData.closes, 50);
    const gldMA200Series = buildMASeries(gldData.closes, 200);
    const gldMA50 = calculateMA(gldData.closes, 50);
    const gldMA200 = calculateMA(gldData.closes, 200);
    const gldCross = detectCrossover(gldMA50Series, gldMA200Series, 5);
    const gldATR = calculateATR(gldData.highs, gldData.lows, gldData.closes, 14);
    const gldTrending = gldMA50 > gldMA200;

    if (gldCross === 'golden') {
      // Fresh golden cross — strong buy signal
      const stopLoss = gldData.currentPrice * (1 - TRAILING_STOP_PCT);
      const takeProfit = gldData.currentPrice + gldATR * 4;

      opps.push({
        id: randomUUID(),
        engine: 'M2',
        domain: 'macro',
        ticker: 'GLD',
        action: 'buy',
        price: gldData.currentPrice,
        stopLoss,
        takeProfit,
        riskRewardRatio: (takeProfit - gldData.currentPrice) / (gldData.currentPrice - stopLoss),
        suggestedSize: 0,
        maxSize: MAX_METALS_ALLOCATION_USD * 0.50,
        confidence: 72,
        reasoning: `Metals Momentum: GLD golden cross (50MA ${gldMA50.toFixed(2)} > 200MA ${gldMA200.toFixed(2)}). ATR(14): ${gldATR.toFixed(2)}. 8% trailing stop.`,
        sector: 'Commodities',
        detectedAt: new Date().toISOString(),
      });
    } else if (gldCross === 'death') {
      // Death cross — sell/short signal
      opps.push({
        id: randomUUID(),
        engine: 'M2',
        domain: 'macro',
        ticker: 'GLD',
        action: 'sell',
        price: gldData.currentPrice,
        suggestedSize: 0,
        maxSize: MAX_METALS_ALLOCATION_USD * 0.50,
        confidence: 65,
        reasoning: `Metals Momentum: GLD death cross (50MA ${gldMA50.toFixed(2)} < 200MA ${gldMA200.toFixed(2)}). Exit gold positions.`,
        sector: 'Commodities',
        detectedAt: new Date().toISOString(),
      });
    } else if (gldTrending && gldData.currentPrice > gldMA50) {
      // Already trending up — continuation buy with lower confidence
      const stopLoss = gldData.currentPrice * (1 - TRAILING_STOP_PCT);
      opps.push({
        id: randomUUID(),
        engine: 'M2',
        domain: 'macro',
        ticker: 'GLD',
        action: 'buy',
        price: gldData.currentPrice,
        stopLoss,
        suggestedSize: 0,
        maxSize: MAX_METALS_ALLOCATION_USD * 0.30,
        confidence: 55,
        reasoning: `Metals Momentum: GLD uptrend continuation. Price ${gldData.currentPrice.toFixed(2)} above 50MA(${gldMA50.toFixed(2)}) and 200MA(${gldMA200.toFixed(2)}).`,
        sector: 'Commodities',
        detectedAt: new Date().toISOString(),
      });
    }

    // ── SLV: Gold/Silver Ratio Signal ────────────────────────────────────

    if (slvData && gldData) {
      const goldSilverRatio = gldData.currentPrice / slvData.currentPrice;

      if (goldSilverRatio > GOLD_SILVER_RATIO_THRESHOLD) {
        // Silver is historically undervalued relative to gold
        const slvMA50 = calculateMA(slvData.closes, 50);
        const slvStopLoss = slvData.currentPrice * (1 - TRAILING_STOP_PCT);
        const slvATR = calculateATR(slvData.highs, slvData.lows, slvData.closes, 14);

        // Higher confidence when ratio is extremely elevated
        const ratioExcess = goldSilverRatio - GOLD_SILVER_RATIO_THRESHOLD;
        const conf = Math.min(78, 55 + ratioExcess * 2);

        opps.push({
          id: randomUUID(),
          engine: 'M2',
          domain: 'macro',
          ticker: 'SLV',
          action: 'buy',
          price: slvData.currentPrice,
          stopLoss: slvStopLoss,
          takeProfit: slvData.currentPrice + slvATR * 5,
          suggestedSize: 0,
          maxSize: MAX_METALS_ALLOCATION_USD * 0.25,
          confidence: conf,
          reasoning: `Metals Momentum: Gold/Silver ratio ${goldSilverRatio.toFixed(1)} > ${GOLD_SILVER_RATIO_THRESHOLD} — silver undervalued. SLV price ${slvData.currentPrice.toFixed(2)}, 50MA(${slvMA50.toFixed(2)}).`,
          sector: 'Commodities',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── GDX: Miners Follow Gold with Leverage ────────────────────────────

    if (gdxData && gldTrending) {
      const gdxMA50 = calculateMA(gdxData.closes, 50);
      const gdxMA200 = calculateMA(gdxData.closes, 200);

      // Miners when gold is trending AND miners are above their own 50MA
      if (gdxData.currentPrice > gdxMA50 && gdxMA50 > gdxMA200) {
        const gdxStopLoss = gdxData.currentPrice * (1 - TRAILING_STOP_PCT);
        const gdxATR = calculateATR(gdxData.highs, gdxData.lows, gdxData.closes, 14);

        opps.push({
          id: randomUUID(),
          engine: 'M2',
          domain: 'macro',
          ticker: 'GDX',
          action: 'buy',
          price: gdxData.currentPrice,
          stopLoss: gdxStopLoss,
          takeProfit: gdxData.currentPrice + gdxATR * 3,
          suggestedSize: 0,
          maxSize: MAX_METALS_ALLOCATION_USD * 0.25,
          confidence: 60,
          reasoning: `Metals Momentum: GDX miners bullish — gold trending up, GDX ${gdxData.currentPrice.toFixed(2)} above 50MA(${gdxMA50.toFixed(2)}). Leveraged gold play.`,
          sector: 'Commodities',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    logger.info({ signals: opps.length }, '[M2] Metals momentum scan complete');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[M2] Metals momentum scan failed');
  }

  return opps;
}
