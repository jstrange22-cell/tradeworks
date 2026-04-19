/**
 * M4: Sector Rotation — Economic Cycle Phase Detection + Sector ETF Rotation
 *
 * Detects economic cycle phase using Kalshi recession data + yield curve + momentum:
 *   Expansion  → XLK, XLY, XLI, XLC (growth sectors)
 *   Peak       → XLE, XLB, XLI (commodities/industrials)
 *   Recession  → XLU, XLP, XLV (defensive sectors)
 *   Recovery   → XLF, XLRE, XLI (rate-sensitive, cyclicals)
 *
 * Ranks sectors by 3-month momentum within the preferred group.
 * Buys top 3 from the cycle-appropriate basket.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

type CyclePhase = 'expansion' | 'peak' | 'recession' | 'recovery';

interface SectorDef {
  symbol: string;
  sector: string;
  phases: CyclePhase[];
}

// Sector ETFs mapped to which cycle phases they outperform
const SECTOR_MAP: SectorDef[] = [
  { symbol: 'XLK', sector: 'Technology', phases: ['expansion', 'recovery'] },
  { symbol: 'XLY', sector: 'Consumer Discretionary', phases: ['expansion', 'recovery'] },
  { symbol: 'XLI', sector: 'Industrials', phases: ['expansion', 'peak', 'recovery'] },
  { symbol: 'XLE', sector: 'Energy', phases: ['peak'] },
  { symbol: 'XLB', sector: 'Materials', phases: ['peak'] },
  { symbol: 'XLF', sector: 'Financials', phases: ['recovery'] },
  { symbol: 'XLRE', sector: 'Real Estate', phases: ['recovery'] },
  { symbol: 'XLV', sector: 'Healthcare', phases: ['recession'] },
  { symbol: 'XLP', sector: 'Consumer Staples', phases: ['recession'] },
  { symbol: 'XLU', sector: 'Utilities', phases: ['recession'] },
  { symbol: 'XLC', sector: 'Communications', phases: ['expansion'] },
];

interface CycleDetection {
  phase: CyclePhase;
  confidence: number;
  reasoning: string;
  recessionProb: number;
}

async function fetchKalshiRecessionSignals(): Promise<{ recessionProb: number; fedCutProb: number; events: string[] }> {
  try {
    const res = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/events/?limit=30&status=open',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return { recessionProb: 0, fedCutProb: 0, events: [] };

    const data = await res.json() as { events: Array<{ title: string; event_ticker: string }> };
    const allEvents = data.events ?? [];
    const eventTitles: string[] = [];

    let recessionCount = 0;
    let fedCutCount = 0;

    for (const event of allEvents) {
      const title = event.title.toLowerCase();
      if (title.match(/recession|gdp.*contract|economic.*downturn|unemployment.*rise/)) {
        recessionCount++;
        eventTitles.push(event.title);
      }
      if (title.match(/fed.*cut|rate.*lower|fomc.*decrease|rate.*reduction/)) {
        fedCutCount++;
        eventTitles.push(event.title);
      }
    }

    // Heuristic: each recession event contributes ~15% probability signal
    const recessionProb = Math.min(recessionCount * 0.15, 0.75);
    const fedCutProb = Math.min(fedCutCount * 0.20, 0.80);

    return { recessionProb, fedCutProb, events: eventTitles };
  } catch {
    return { recessionProb: 0, fedCutProb: 0, events: [] };
  }
}

async function fetchMomentumData(symbol: string, limit: number): Promise<{
  momentum3m: number;
  momentum6m: number;
  above200MA: boolean;
  currentPrice: number;
} | null> {
  try {
    const barsResp = await getBars({ symbols: [symbol], timeframe: '1Day', limit });
    const symbolBars = barsResp.bars[symbol];
    if (!symbolBars || symbolBars.length < 130) return null;

    const current = symbolBars[symbolBars.length - 1].c;
    const price3mAgo = symbolBars[Math.max(0, symbolBars.length - 63)].c;
    const price6mAgo = symbolBars[Math.max(0, symbolBars.length - 126)].c;

    let above200MA = false;
    if (symbolBars.length >= 200) {
      const ma200 = symbolBars.slice(-200).reduce((s, b) => s + b.c, 0) / 200;
      above200MA = current > ma200;
    }

    return {
      momentum3m: (current - price3mAgo) / price3mAgo,
      momentum6m: (current - price6mAgo) / price6mAgo,
      above200MA,
      currentPrice: current,
    };
  } catch {
    return null;
  }
}

async function detectCyclePhase(): Promise<CycleDetection> {
  // 1. Get Kalshi prediction market signals
  const kalshi = await fetchKalshiRecessionSignals();

  // 2. Get SPY momentum for market regime
  const spy = await fetchMomentumData('SPY', 250);

  // 3. Get TLT momentum for bond market signal
  const tlt = await fetchMomentumData('TLT', 100);

  const spyMom3m = spy?.momentum3m ?? 0;
  const spyMom6m = spy?.momentum6m ?? 0;
  const spyAbove200 = spy?.above200MA ?? true;
  const tltMom3m = tlt?.momentum3m ?? 0;

  // ── Phase Detection Logic ───────────────────────────────────────────
  //
  // Recession: High Kalshi recession prob OR (SPY below 200MA + negative 6m)
  // Peak: SPY above 200MA but 3m decelerating while 6m still positive, bonds rallying
  // Recovery: SPY 3m turning positive from negative 6m base (early rebound)
  // Expansion: SPY above 200MA with positive 3m and 6m momentum, low recession risk

  if (kalshi.recessionProb > 0.40 || (!spyAbove200 && spyMom6m < -0.05)) {
    return {
      phase: 'recession',
      confidence: Math.min(80, 50 + kalshi.recessionProb * 40),
      reasoning: `Kalshi recession ${(kalshi.recessionProb * 100).toFixed(0)}%, SPY ${spyAbove200 ? 'above' : 'below'} 200MA, 6m ${(spyMom6m * 100).toFixed(1)}%`,
      recessionProb: kalshi.recessionProb,
    };
  }

  if (spyAbove200 && spyMom6m > 0 && spyMom3m < spyMom6m * 0.3 && tltMom3m > 0.02) {
    return {
      phase: 'peak',
      confidence: 55,
      reasoning: `SPY momentum decelerating (3m: ${(spyMom3m * 100).toFixed(1)}% vs 6m: ${(spyMom6m * 100).toFixed(1)}%), bonds rising ${(tltMom3m * 100).toFixed(1)}%`,
      recessionProb: kalshi.recessionProb,
    };
  }

  if (spyMom3m > 0.03 && spyMom6m < 0) {
    return {
      phase: 'recovery',
      confidence: 60,
      reasoning: `SPY 3m positive ${(spyMom3m * 100).toFixed(1)}% from negative 6m base ${(spyMom6m * 100).toFixed(1)}% — early rebound`,
      recessionProb: kalshi.recessionProb,
    };
  }

  return {
    phase: 'expansion',
    confidence: 65,
    reasoning: `SPY ${spyAbove200 ? 'above' : 'near'} 200MA, 3m: ${(spyMom3m * 100).toFixed(1)}%, 6m: ${(spyMom6m * 100).toFixed(1)}%, recession risk low`,
    recessionProb: kalshi.recessionProb,
  };
}

export async function scanSectorRotation(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  // Only run in monthly rebalance window (first 5 days of month)
  if (new Date().getDate() > 5) return opps;

  try {
    // Step 1: Detect economic cycle phase
    const cycle = await detectCyclePhase();
    logger.info({ phase: cycle.phase, confidence: cycle.confidence }, '[M4] Cycle phase detected');

    // Step 2: Filter sectors appropriate for this cycle phase
    const phaseSectors = SECTOR_MAP.filter(s => s.phases.includes(cycle.phase));

    // Step 3: Rank by 3-month momentum within the cycle-appropriate basket
    const rankings: Array<{
      symbol: string;
      sector: string;
      momentum3m: number;
      momentum6m: number;
      currentPrice: number;
    }> = [];

    for (const sectorDef of phaseSectors) {
      const data = await fetchMomentumData(sectorDef.symbol, 150);
      if (!data) continue;

      rankings.push({
        symbol: sectorDef.symbol,
        sector: sectorDef.sector,
        momentum3m: data.momentum3m,
        momentum6m: data.momentum6m,
        currentPrice: data.currentPrice,
      });
    }

    // Sort by combined 3m + 6m momentum
    rankings.sort((a, b) => (b.momentum3m + b.momentum6m) - (a.momentum3m + a.momentum6m));

    // Step 4: Top 3 sectors get buy signals (only if positive absolute momentum)
    const topSectors = rankings.slice(0, 3);

    for (const r of topSectors) {
      // Absolute momentum gate: skip if 3m return is negative
      if (r.momentum3m <= 0) continue;

      const baseConfidence = cycle.confidence * 0.70;
      const momentumBoost = Math.min(15, r.momentum3m * 100);
      const confidence = Math.min(82, baseConfidence + momentumBoost);

      opps.push({
        id: randomUUID(),
        engine: 'M4',
        domain: 'macro',
        ticker: r.symbol,
        action: 'buy',
        price: r.currentPrice,
        suggestedSize: 0,
        maxSize: 6000,
        confidence,
        reasoning: `Sector Rotation [${cycle.phase.toUpperCase()}]: ${r.sector} (${r.symbol}) — 3m: ${(r.momentum3m * 100).toFixed(1)}%, 6m: ${(r.momentum6m * 100).toFixed(1)}%. Cycle: ${cycle.reasoning}`,
        sector: r.sector,
        regime: cycle.phase,
        detectedAt: new Date().toISOString(),
      });
    }

    // Step 5: If in recession, also generate sell signals for growth sectors
    if (cycle.phase === 'recession' && cycle.confidence > 60) {
      const growthSectors = ['XLK', 'XLY', 'XLC'];
      for (const sym of growthSectors) {
        const data = await fetchMomentumData(sym, 80);
        if (!data || data.momentum3m > 0) continue; // Only sell if already declining

        opps.push({
          id: randomUUID(),
          engine: 'M4',
          domain: 'macro',
          ticker: sym,
          action: 'sell',
          price: data.currentPrice,
          suggestedSize: 0,
          maxSize: 6000,
          confidence: Math.min(70, cycle.confidence * 0.60 + 10),
          reasoning: `Sector Rotation [RECESSION]: Exit ${sym} — growth sector vulnerable. 3m: ${(data.momentum3m * 100).toFixed(1)}%. ${cycle.reasoning}`,
          sector: SECTOR_MAP.find(s => s.symbol === sym)?.sector,
          regime: cycle.phase,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    logger.info(
      { phase: cycle.phase, recessionProb: cycle.recessionProb, ranked: rankings.length, signals: opps.length },
      '[M4] Sector rotation scan complete',
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[M4] Sector rotation scan failed');
  }

  return opps;
}
