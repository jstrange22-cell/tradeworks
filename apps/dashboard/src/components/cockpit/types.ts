/**
 * Type definitions for the P&L cockpit.
 *
 * These mirror the gateway response shapes from Phase A-D (heat, regime,
 * bandit, kill-switches, exits, tradevisor-agent decisions). Anything the
 * cockpit consumes lives here so component files stay narrow.
 */

// ── Regime ───────────────────────────────────────────────────────────────
export type RegimeTag = 'calm' | 'trending' | 'volatile' | 'crisis';

export interface RegimeSignals {
  spyClose: number;
  spy200ma: number;
  spy50ma: number;
  vix: number;
  btcDominance: number | null;
  dxy: number | null;
  spy20dReturn: number;
  spy20dRealizedVol: number;
}

export interface MarketRegime {
  tag: RegimeTag;
  confidence: number;
  asOf: string;
  signals: RegimeSignals;
  rationale: string;
}

export interface RegimeResponse {
  data: MarketRegime;
}

// ── Heat ─────────────────────────────────────────────────────────────────
export interface PortfolioHeat {
  totalEquityUsd: number;
  totalOpenRiskUsd: number;
  totalOpenRiskPct: number;
  bySector: Record<string, { riskUsd: number; pct: number }>;
  byFactor: Record<string, { riskUsd: number; pct: number }>;
  budgets: {
    totalOpenRiskMaxPct: number;
    perSectorMaxPct: number;
    perFactorMaxPct: number;
  };
  utilization: {
    total: number;
    worstSector: { sector: string; utilization: number };
    worstFactor: { factor: string; utilization: number };
  };
}

export interface HeatResponse {
  data: PortfolioHeat;
}

// ── Bandit ───────────────────────────────────────────────────────────────
export interface StrategyWeightEntry {
  weight: number;
  prevWeight: number;
  voteShare: number;
  sampleSize90d: number;
  winRate: number;
  expectancy: number;
  sharpeProxy: number;
  source: 'cold_start' | 'normal' | 'override';
}

export interface BanditWeightsFile {
  updatedAt: string;
  schemaVersion: 1;
  strategies: Record<string, StrategyWeightEntry>;
  regime?: { tag: RegimeTag; confidence: number; rationale: string };
  byRegime?: Record<RegimeTag, number>;
}

export interface BanditWeightsResponse {
  data: BanditWeightsFile;
  canRecomputeNow: boolean;
}

// ── Kill switches ────────────────────────────────────────────────────────
export type KillSwitchLevel = 'strategy' | 'portfolio' | 'master';

export type KillSwitchState =
  | { active: false }
  | {
      active: true;
      level: KillSwitchLevel;
      reason: string;
      activatedAt: string;
      expiresAt?: string;
    };

export interface KillSwitchStatus {
  master: KillSwitchState;
  portfolio: KillSwitchState;
  strategies: Record<string, KillSwitchState>;
  metrics: {
    dailyPnlPct: number;
    weeklyPnlPct: number;
    monthlyPnlPct: number;
    consecutiveLossesByStrategy: Record<string, number>;
  };
}

export interface KillSwitchStatusResponse {
  data: KillSwitchStatus;
}

// ── Exit monitor ─────────────────────────────────────────────────────────
export interface ExitMonitorStatus {
  running: boolean;
  lastTickAt: string | null;
  lastTickDurationMs: number;
  lastTickError: string | null;
  ticksTotal: number;
  exitsTotal: number;
  intervalMs: number;
  openPositionsCap: number;
  rulesEnabled: number;
}

export interface ExitMonitorStatusResponse {
  data: ExitMonitorStatus;
}

export interface ExitPositionEvaluation {
  trackerId: string;
  symbol: string;
  assetClass: string;
  strategy: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  stopPrice: number;
  bar: { close: number; high: number; low: number; ts: string } | null;
  highSinceEntry: number;
  lowSinceEntry: number;
  ladderPartialDone: boolean;
  triggered: string | null;
  decision: { shouldExit: boolean; reason?: string; exitPrice?: number; notes?: string };
  fired: boolean;
}

export interface ExitPositionsResponse {
  data: ExitPositionEvaluation[];
  summary: { total: number; firedThisTick: number; wouldExit: number };
}

// ── TradeVisor decisions ─────────────────────────────────────────────────
export type AgentVerdict = 'approve' | 'veto' | 'escalate';

export interface TradevisorDecision {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  verdict: AgentVerdict;
  confidence: number;
  reasoning: string;
  adjustedSize: number | null;
  adjustedStopPct: number | null;
  modelUsed: string;
  latencyMs: number;
  createdAt: string;
  resolvedAt: string | null;
  resolution: 'approved' | 'vetoed' | null;
}

export interface TradevisorDecisionsResponse {
  data: TradevisorDecision[];
}

// ── Portfolio (existing /api/v1/portfolio) ───────────────────────────────
export interface PortfolioPosition {
  id: string;
  instrument: string;
  market: string;
  side: string;
  quantity: number;
  averageEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  strategyId: string | null;
  openedAt: string;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface PortfolioSummary {
  equity: number;
  initialCapital: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  weeklyPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: PortfolioPosition[];
  equityCurve: EquityPoint[];
  paperTrading: boolean;
  circuitBreaker: boolean;
  noData?: boolean;
}
