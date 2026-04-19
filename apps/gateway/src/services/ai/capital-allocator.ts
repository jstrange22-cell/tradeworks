/**
 * Cross-Market Capital Allocator
 *
 * Unified intelligence layer that allocates capital across all 4 markets
 * based on macro regime, opportunity quality, and risk limits.
 *
 * Markets:
 *   1. Crypto (Solana meme coins + Coinbase spot)
 *   2. Stocks (Alpaca swing trading)
 *   3. Prediction Markets (Polymarket)
 *   4. Sports Betting (The Odds API)
 *
 * The allocator answers: "Given $X total capital and the current macro
 * environment, how much should be in each market, and what are the
 * top opportunities across ALL markets?"
 */

import { getMacroRegime, type MacroRegimeReport } from './macro-regime.js';
// logger available for future use when full scan integration is added

// ── Types ────────────────────────────────────────────────────────────────

export interface MarketAllocation {
  market: 'crypto' | 'stocks' | 'predictions' | 'sports';
  allocationPercent: number;
  allocationUsd: number;
  reasoning: string;
  topOpportunities: OpportunitySummary[];
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  status: 'active' | 'paused' | 'not_configured';
}

export interface OpportunitySummary {
  id: string;
  market: 'crypto' | 'stocks' | 'predictions' | 'sports';
  name: string;
  expectedReturn: number;     // percent
  confidence: number;         // 0-100
  riskReward: number;
  timeHorizon: string;        // "minutes", "hours", "days", "weeks"
  suggestedSize: number;      // USD
}

export interface PortfolioAllocation {
  totalCapital: number;
  regime: MacroRegimeReport;
  allocations: MarketAllocation[];
  topOpportunities: OpportunitySummary[];
  cashReserve: number;
  cashReservePercent: number;
  rebalanceNeeded: boolean;
  generatedAt: string;
}

export interface AllocationConfig {
  totalCapital: number;
  maxPerMarket: number;        // max % in any single market
  minCashReserve: number;      // min % held as cash
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  enabledMarkets: {
    crypto: boolean;
    stocks: boolean;
    predictions: boolean;
    sports: boolean;
  };
}

// ── Default Config ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: AllocationConfig = {
  totalCapital: 1000,
  maxPerMarket: 40,
  minCashReserve: 15,
  riskTolerance: 'moderate',
  enabledMarkets: {
    crypto: true,
    stocks: true,
    predictions: true,
    sports: true,
  },
};

let allocConfig = { ...DEFAULT_CONFIG };

export function getAllocationConfig(): AllocationConfig {
  return { ...allocConfig };
}

export function updateAllocationConfig(updates: Partial<AllocationConfig>): AllocationConfig {
  allocConfig = { ...allocConfig, ...updates };
  return { ...allocConfig };
}

// ── Regime-Based Base Allocations ────────────────────────────────────────

interface BaseAllocation {
  crypto: number;
  stocks: number;
  predictions: number;
  sports: number;
  cash: number;
}

function getBaseAllocations(regime: string, tolerance: string): BaseAllocation {
  // Each row sums to 100
  const allocationMatrix: Record<string, Record<string, BaseAllocation>> = {
    risk_on: {
      conservative: { crypto: 15, stocks: 35, predictions: 10, sports: 10, cash: 30 },
      moderate:     { crypto: 25, stocks: 30, predictions: 15, sports: 10, cash: 20 },
      aggressive:   { crypto: 35, stocks: 25, predictions: 20, sports: 10, cash: 10 },
    },
    risk_off: {
      conservative: { crypto: 5,  stocks: 20, predictions: 10, sports: 5,  cash: 60 },
      moderate:     { crypto: 10, stocks: 25, predictions: 10, sports: 5,  cash: 50 },
      aggressive:   { crypto: 15, stocks: 30, predictions: 15, sports: 5,  cash: 35 },
    },
    transitioning: {
      conservative: { crypto: 10, stocks: 25, predictions: 10, sports: 5,  cash: 50 },
      moderate:     { crypto: 15, stocks: 25, predictions: 15, sports: 10, cash: 35 },
      aggressive:   { crypto: 25, stocks: 25, predictions: 15, sports: 10, cash: 25 },
    },
    crisis: {
      conservative: { crypto: 0,  stocks: 5,  predictions: 5,  sports: 0,  cash: 90 },
      moderate:     { crypto: 5,  stocks: 10, predictions: 5,  sports: 0,  cash: 80 },
      aggressive:   { crypto: 10, stocks: 15, predictions: 10, sports: 0,  cash: 65 },
    },
  };

  return allocationMatrix[regime]?.[tolerance] ??
    allocationMatrix['transitioning']?.['moderate'] ??
    { crypto: 15, stocks: 25, predictions: 15, sports: 10, cash: 35 };
}

// ── Allocation Engine ────────────────────────────────────────────────────

export async function generateAllocation(
  config?: Partial<AllocationConfig>,
): Promise<PortfolioAllocation> {
  const cfg = config ? { ...allocConfig, ...config } : allocConfig;
  const regime = await getMacroRegime();
  const base = getBaseAllocations(regime.regime, cfg.riskTolerance);

  // Apply enabled markets and redistribute disabled allocations to cash
  let cashPct = base.cash;
  const markets: Array<{ key: keyof typeof cfg.enabledMarkets; pct: number }> = [
    { key: 'crypto', pct: base.crypto },
    { key: 'stocks', pct: base.stocks },
    { key: 'predictions', pct: base.predictions },
    { key: 'sports', pct: base.sports },
  ];

  for (const m of markets) {
    if (!cfg.enabledMarkets[m.key]) {
      cashPct += m.pct;
      m.pct = 0;
    }
  }

  // Enforce max per market
  for (const m of markets) {
    if (m.pct > cfg.maxPerMarket) {
      cashPct += m.pct - cfg.maxPerMarket;
      m.pct = cfg.maxPerMarket;
    }
  }

  // Enforce min cash reserve
  if (cashPct < cfg.minCashReserve) {
    const deficit = cfg.minCashReserve - cashPct;
    // Proportionally reduce allocations
    const totalAlloc = markets.reduce((s, m) => s + m.pct, 0);
    if (totalAlloc > 0) {
      for (const m of markets) {
        m.pct -= (m.pct / totalAlloc) * deficit;
        m.pct = Math.max(0, m.pct);
      }
    }
    cashPct = cfg.minCashReserve;
  }

  // Build allocation objects
  const riskMap: Record<string, 'low' | 'medium' | 'high' | 'extreme'> = {
    crypto: 'extreme',
    stocks: 'medium',
    predictions: 'high',
    sports: 'high',
  };

  const reasoningMap: Record<string, Record<string, string>> = {
    risk_on: {
      crypto: 'Favorable macro — full crypto allocation with momentum strategies',
      stocks: 'Risk-on environment supports swing trades and growth stocks',
      predictions: 'Active prediction markets with normal spreads',
      sports: 'Standard sports betting allocation',
    },
    risk_off: {
      crypto: 'Reduced crypto in risk-off — focus on BTC/ETH only',
      stocks: 'Defensive positioning — value stocks and dividend plays',
      predictions: 'Maintain prediction exposure — uncorrelated to equities',
      sports: 'Minimal sports allocation in risk-off',
    },
    transitioning: {
      crypto: 'Mixed signals — moderate crypto with tighter stops',
      stocks: 'Half position sizes — wait for regime clarity',
      predictions: 'Prediction markets unaffected by transition',
      sports: 'Standard sports allocation',
    },
    crisis: {
      crypto: 'Crisis mode — minimal crypto, cash preservation priority',
      stocks: 'Cash heavy — only highest conviction stock plays',
      predictions: 'Small prediction bets on crisis resolution events',
      sports: 'No sports betting in crisis',
    },
  };

  const allocations: MarketAllocation[] = markets.map(m => ({
    market: m.key as MarketAllocation['market'],
    allocationPercent: Math.round(m.pct * 10) / 10,
    allocationUsd: Math.round(cfg.totalCapital * (m.pct / 100) * 100) / 100,
    reasoning: reasoningMap[regime.regime]?.[m.key] ?? 'Standard allocation',
    topOpportunities: [], // Populated when full scan is run
    riskLevel: riskMap[m.key] ?? 'medium',
    status: cfg.enabledMarkets[m.key] ? 'active' : 'not_configured',
  }));

  return {
    totalCapital: cfg.totalCapital,
    regime,
    allocations,
    topOpportunities: [],
    cashReserve: Math.round(cfg.totalCapital * (cashPct / 100) * 100) / 100,
    cashReservePercent: Math.round(cashPct * 10) / 10,
    rebalanceNeeded: false,
    generatedAt: new Date().toISOString(),
  };
}

// ── Cache ────────────────────────────────────────────────────────────────

let cachedAllocation: PortfolioAllocation | null = null;
let cachedAt = 0;
const CACHE_TTL = 300_000; // 5 minutes

export async function getAllocation(): Promise<PortfolioAllocation> {
  if (cachedAllocation && Date.now() - cachedAt < CACHE_TTL) {
    return cachedAllocation;
  }
  cachedAllocation = await generateAllocation();
  cachedAt = Date.now();
  return cachedAllocation;
}
