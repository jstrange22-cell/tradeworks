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

// ── TradeVisor-Driven Paper Ledger (stock-agent) ────────────────────────
// These types describe the paper-trading ledger used by the stock-agent
// module that responds to TradeVisor signals. It is SEPARATE from the
// orchestrator's 14-engine paper state above. The ledger tracks equity
// and options positions under independent caps (MAX_EQUITY_POSITIONS and
// MAX_OPTION_POSITIONS) so the two ledgers can evolve independently.

export const MAX_EQUITY_POSITIONS = 10;
export const MAX_OPTION_POSITIONS = 10;

export interface EquityPosition {
  id: string;
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  entryAt: string;              // ISO timestamp
  signalSource: string;         // e.g. 'tradevisor_prime'
  signalScore: number;          // confluence score 0-6
}

export interface OptionPosition {
  id: string;
  symbol: string;               // underlying ticker (e.g. 'AAPL')
  occSymbol: string;            // OCC-formatted option symbol
  type: 'call' | 'put';
  strike: number;
  expiry: string;               // YYYY-MM-DD
  contracts: number;
  entryMid: number;             // per-contract mid price at entry (quote × 100 = cost per contract)
  currentMid: number;
  entryIV: number;              // implied volatility at entry (0-1)
  entryAt: string;              // ISO timestamp
  signalSource: string;
  signalScore: number;
}

export interface EquityClosedTrade extends EquityPosition {
  exitPrice: number;
  exitAt: string;
  pnlUsd: number;
  pnlPct: number;
}

export interface OptionClosedTrade extends OptionPosition {
  exitMid: number;
  exitAt: string;
  pnlUsd: number;
  pnlPct: number;
}

export interface PaperLedgerStats {
  totalTrades: number;
  wins: number;
  losses: number;
}

export interface PaperLedgerState {
  paperCashUsd: number;
  equityPositions: EquityPosition[];
  optionPositions: OptionPosition[];
  equityClosed: EquityClosedTrade[];
  optionClosed: OptionClosedTrade[];
  stats: PaperLedgerStats;
  /**
   * @deprecated Legacy single-array position list from the pre-split schema.
   * Retained so the migration path in the orchestrator can detect and upgrade
   * older `paper-state.json` files that still carry this field. New writes
   * must populate `equityPositions` / `optionPositions` instead.
   */
  positions?: EquityPosition[];
}

export const DEFAULT_PAPER_LEDGER: PaperLedgerState = {
  paperCashUsd: 10_000,
  equityPositions: [],
  optionPositions: [],
  equityClosed: [],
  optionClosed: [],
  stats: { totalTrades: 0, wins: 0, losses: 0 },
};
