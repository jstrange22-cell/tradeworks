import type { Position, MarketType } from '@tradeworks/shared';

export interface ExposureMetrics {
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  byMarket: Record<MarketType, { long: number; short: number; net: number }>;
  portfolioHeat: number; // Total % of capital at risk
  concentrationRisk: Array<{ instrument: string; percentOfPortfolio: number }>;
}

/**
 * Calculate portfolio exposure metrics from open positions.
 */
export function calculateExposure(
  positions: Position[],
  totalCapital: number
): ExposureMetrics {
  let longExposure = 0;
  let shortExposure = 0;

  const byMarket: ExposureMetrics['byMarket'] = {
    crypto: { long: 0, short: 0, net: 0 },
    prediction: { long: 0, short: 0, net: 0 },
    equity: { long: 0, short: 0, net: 0 },
  };

  const instrumentExposure: Map<string, number> = new Map();

  for (const pos of positions) {
    if (pos.status !== 'open') continue;

    const exposure = pos.quantity * pos.currentPrice;

    if (pos.side === 'long') {
      longExposure += exposure;
      byMarket[pos.market].long += exposure;
    } else {
      shortExposure += exposure;
      byMarket[pos.market].short += exposure;
    }

    instrumentExposure.set(
      pos.instrument,
      (instrumentExposure.get(pos.instrument) ?? 0) + exposure
    );
  }

  // Calculate net exposure per market
  for (const market of ['crypto', 'prediction', 'equity'] as MarketType[]) {
    byMarket[market].net = byMarket[market].long - byMarket[market].short;
  }

  // Calculate concentration risk
  const concentrationRisk = Array.from(instrumentExposure.entries())
    .map(([instrument, exposure]) => ({
      instrument,
      percentOfPortfolio: totalCapital > 0 ? (exposure / totalCapital) * 100 : 0,
    }))
    .sort((a, b) => b.percentOfPortfolio - a.percentOfPortfolio);

  // Portfolio heat: sum of all risk amounts (distance to stop loss * quantity)
  let portfolioHeat = 0;
  for (const pos of positions) {
    if (pos.status !== 'open' || pos.stopLoss === null) continue;
    const riskPerUnit = Math.abs(pos.averageEntry - pos.stopLoss);
    const totalRisk = riskPerUnit * pos.quantity;
    portfolioHeat += totalRisk;
  }

  return {
    grossExposure: longExposure + shortExposure,
    netExposure: longExposure - shortExposure,
    longExposure,
    shortExposure,
    byMarket,
    portfolioHeat: totalCapital > 0 ? portfolioHeat / totalCapital : 0,
    concentrationRisk,
  };
}

/**
 * Check if adding a position would exceed per-market allocation limits.
 */
export function checkMarketAllocation(
  positions: Position[],
  newMarket: MarketType,
  newExposure: number,
  totalCapital: number,
  limits: Record<string, number>
): { allowed: boolean; currentAllocation: number; limit: number } {
  const currentExposure = positions
    .filter(p => p.status === 'open' && p.market === newMarket)
    .reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);

  const totalExposure = currentExposure + newExposure;
  const allocation = totalCapital > 0 ? totalExposure / totalCapital : 0;
  const limit = limits[newMarket] ?? 1.0;

  return {
    allowed: allocation <= limit,
    currentAllocation: allocation,
    limit,
  };
}
