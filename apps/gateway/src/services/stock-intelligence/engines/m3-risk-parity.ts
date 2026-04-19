/**
 * M3: Risk Parity Rebalancer — Dynamic Stock/Bond/Gold Allocation
 *
 * Inverse-volatility weighting: SPY / TLT / GLD.
 * Monthly rebalance when any position drifts > 5% from target.
 * Lower-vol assets get higher weight (risk parity principle).
 * Targets: approximately 1/vol_i / sum(1/vol_j) for each asset.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars, getSnapshots } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

const PARITY_ASSETS = [
  { symbol: 'SPY', name: 'US Equities', assetClass: 'equity' },
  { symbol: 'TLT', name: 'Long-Term Bonds', assetClass: 'bond' },
  { symbol: 'GLD', name: 'Gold', assetClass: 'commodity' },
] as const;

const DRIFT_THRESHOLD = 0.05; // 5% drift triggers rebalance
const VOLATILITY_LOOKBACK = 60; // Trading days for vol calculation
const MAX_PORTFOLIO_USD = 10_000;

function calculateAnnualizedVol(closes: number[], lookbackDays: number): number {
  if (closes.length < lookbackDays + 1) return 0;

  const returns: number[] = [];
  const start = closes.length - lookbackDays;
  for (let i = start; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);

  // Annualize: daily vol * sqrt(252)
  return dailyVol * Math.sqrt(252);
}

interface AssetData {
  symbol: string;
  name: string;
  assetClass: string;
  currentPrice: number;
  annualizedVol: number;
  inverseVol: number;
  targetWeight: number;
}

export async function scanRiskParity(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  // Only run first 5 days of each month (monthly rebalance window)
  const today = new Date();
  if (today.getDate() > 5) return opps;

  try {
    const assetData: AssetData[] = [];

    // Fetch price data for all parity assets
    for (const asset of PARITY_ASSETS) {
      try {
        const barsResp = await getBars({ symbols: [asset.symbol], timeframe: '1Day', limit: 100 });
        const symbolBars = barsResp.bars[asset.symbol];
        if (!symbolBars || symbolBars.length < VOLATILITY_LOOKBACK + 1) continue;

        const closes = symbolBars.map(b => b.c);
        const currentPrice = closes[closes.length - 1];
        const annualizedVol = calculateAnnualizedVol(closes, VOLATILITY_LOOKBACK);

        if (annualizedVol <= 0) continue;

        assetData.push({
          symbol: asset.symbol,
          name: asset.name,
          assetClass: asset.assetClass,
          currentPrice,
          annualizedVol,
          inverseVol: 1 / annualizedVol,
          targetWeight: 0, // Calculated below
        });
      } catch { continue; }
    }

    if (assetData.length < 2) {
      logger.warn('[M3] Insufficient asset data for risk parity — need at least 2 assets');
      return opps;
    }

    // Calculate inverse-vol target weights
    const totalInverseVol = assetData.reduce((s, a) => s + a.inverseVol, 0);
    for (const asset of assetData) {
      asset.targetWeight = asset.inverseVol / totalInverseVol;
    }

    // Attempt to get current positions from snapshots for drift detection
    let currentPrices: Record<string, number> = {};
    try {
      const snapshots = await getSnapshots(assetData.map(a => a.symbol));
      for (const [sym, snap] of Object.entries(snapshots)) {
        if (snap?.latestTrade?.p) {
          currentPrices[sym] = snap.latestTrade.p;
        }
      }
    } catch {
      // Fall back to bar close prices
      for (const asset of assetData) {
        currentPrices[asset.symbol] = asset.currentPrice;
      }
    }

    // Without actual portfolio positions, we generate target allocation signals.
    // In practice the orchestrator compares to actual holdings.
    // Here we simulate: assume equal-weight current allocation and detect drift.
    const equalWeight = 1 / assetData.length;

    for (const asset of assetData) {
      const drift = asset.targetWeight - equalWeight;
      const absDrift = Math.abs(drift);

      if (absDrift > DRIFT_THRESHOLD) {
        const price = currentPrices[asset.symbol] ?? asset.currentPrice;
        const targetUsd = asset.targetWeight * MAX_PORTFOLIO_USD;
        const currentUsd = equalWeight * MAX_PORTFOLIO_USD;
        const deltaUsd = targetUsd - currentUsd;

        if (deltaUsd > 0) {
          // Need to BUY more of this asset (lower vol = higher target)
          opps.push({
            id: randomUUID(),
            engine: 'M3',
            domain: 'macro',
            ticker: asset.symbol,
            action: 'buy',
            price,
            suggestedSize: Math.abs(deltaUsd),
            maxSize: MAX_PORTFOLIO_USD * 0.5,
            confidence: Math.min(75, 50 + absDrift * 200),
            reasoning: `Risk Parity Rebalance: ${asset.name} (${asset.symbol}) target weight ${(asset.targetWeight * 100).toFixed(1)}% vs current ~${(equalWeight * 100).toFixed(1)}%. Vol: ${(asset.annualizedVol * 100).toFixed(1)}%. Buy $${Math.abs(deltaUsd).toFixed(0)} to rebalance.`,
            sector: asset.assetClass === 'bond' ? 'Bonds' : asset.assetClass === 'commodity' ? 'Commodities' : 'Equities',
            detectedAt: new Date().toISOString(),
          });
        } else {
          // Need to SELL some of this asset (higher vol = lower target)
          opps.push({
            id: randomUUID(),
            engine: 'M3',
            domain: 'macro',
            ticker: asset.symbol,
            action: 'sell',
            price,
            suggestedSize: Math.abs(deltaUsd),
            maxSize: MAX_PORTFOLIO_USD * 0.5,
            confidence: Math.min(70, 48 + absDrift * 180),
            reasoning: `Risk Parity Rebalance: ${asset.name} (${asset.symbol}) target weight ${(asset.targetWeight * 100).toFixed(1)}% vs current ~${(equalWeight * 100).toFixed(1)}%. Vol: ${(asset.annualizedVol * 100).toFixed(1)}%. Sell $${Math.abs(deltaUsd).toFixed(0)} to rebalance.`,
            sector: asset.assetClass === 'bond' ? 'Bonds' : asset.assetClass === 'commodity' ? 'Commodities' : 'Equities',
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Log the target allocation
    const allocLog = assetData.map(a =>
      `${a.symbol}: ${(a.targetWeight * 100).toFixed(1)}% (vol: ${(a.annualizedVol * 100).toFixed(1)}%)`
    ).join(', ');
    logger.info({ signals: opps.length, allocation: allocLog }, '[M3] Risk parity scan complete');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[M3] Risk parity scan failed');
  }

  return opps;
}
