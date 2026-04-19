/**
 * Stock Intelligence — Data Models
 * Types for all 14 stock/options/macro engines.
 */

// ── Engine Types ────────────────────────────────────────────────────────

export type StockEngine =
  | 'E1' | 'E2' | 'E3' | 'E4'          // Equities
  | 'O1' | 'O2' | 'O3' | 'O4'          // Options
  | 'M1' | 'M2' | 'M3' | 'M4'          // Macro
  | 'X1' | 'X2';                        // Cross-asset

export type StockDomain = 'equity' | 'option' | 'macro' | 'cross';

export interface StockOpportunity {
  id: string;
  engine: StockEngine;
  domain: StockDomain;
  ticker: string;
  action: 'buy' | 'sell' | 'short' | 'cover';
  price: number;
  stopLoss?: number;
  takeProfit?: number;
  riskRewardRatio?: number;
  // Options-specific
  optionType?: 'call' | 'put' | 'spread' | 'condor';
  strike?: number;
  expiry?: string;
  delta?: number;
  ivRank?: number;
  maxLoss?: number;
  // Sizing
  suggestedSize: number;         // USD
  maxSize: number;
  // Meta
  confidence: number;            // 0-100
  reasoning: string;
  sector?: string;
  regime?: string;
  detectedAt: string;
}

export interface StockPaperTrade {
  id: string;
  opportunity: StockOpportunity;
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  status: 'open' | 'closed_win' | 'closed_loss' | 'stopped_out';
  openedAt: string;
  closedAt?: string;
  closeReason?: string;
}

export interface StockPaperPortfolio {
  startingCapital: number;
  cashUsd: number;
  positionsValue: number;
  totalValue: number;
  totalPnlUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: StockPaperTrade[];
  recentTrades: StockPaperTrade[];
  byEngine: Record<string, { trades: number; pnl: number; winRate: number }>;
  marketNote?: string;
}

export interface StockEngineStatus {
  running: boolean;
  mode: 'paper' | 'live';
  scanCycles: number;
  lastScanAt: string | null;
  lastScanDurationMs: number;
  enginesActive: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  regime: string;
  config: StockConfig;
}

export interface StockConfig {
  mode: 'paper' | 'live';
  scanIntervalMs: number;
  startingCapital: number;
  maxSingleStock: number;      // 10% of portfolio
  maxSector: number;           // 25%
  maxOptions: number;          // 30%
  maxMargin: number;           // 50%
  maxMetals: number;           // 15%
  engineCaps: Record<StockEngine, number>;
}

export const DEFAULT_STOCK_CONFIG: StockConfig = {
  mode: 'paper',
  scanIntervalMs: 60_000,      // 1 min scan
  startingCapital: 10_000,
  maxSingleStock: 0.10,
  maxSector: 0.25,
  maxOptions: 0.30,
  maxMargin: 0.50,
  maxMetals: 0.15,
  engineCaps: {
    E1: 5000, E2: 8000, E3: 5000, E4: 5000,
    O1: 3000, O2: 5000, O3: 2000, O4: 2000,
    M1: 8000, M2: 4000, M3: 10000, M4: 6000,
    X1: 5000, X2: 3000,
  },
};

// ── Regime for Stocks ───────────────────────────────────────────────────

export type StockRegime = 'risk_on' | 'neutral' | 'risk_off' | 'crisis';

export interface StockRegimeState {
  regime: StockRegime;
  vix: number;
  spyAbove200MA: boolean;
  confidence: number;
  engineBlocks: StockEngine[];   // Engines blocked in this regime
  sizeMultiplier: number;        // 1.0 normal, 0.5 risk_off, 0.25 crisis
}
