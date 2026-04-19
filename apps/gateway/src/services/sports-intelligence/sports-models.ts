/**
 * Sports Intelligence — Data Models
 * Types for all 6 sports betting engines + shared infra.
 */

// ── Core Types ──────────────────────────────────────────────────────────

export type SportsEngine = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
export type BetSide = 'home' | 'away' | 'over' | 'under' | 'yes' | 'no';

export interface SportsOpportunity {
  id: string;
  engine: SportsEngine;
  type: 'sports_ev' | 'cross_venue' | 'live_inplay' | 'prop' | 'sgp' | 'kalshi_sports';
  sport: string;                    // 'americanfootball_nfl', 'basketball_nba', etc.
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  market: string;                   // 'h2h', 'spreads', 'totals', 'player_prop'
  side: BetSide;
  // Odds
  softBookOdds: number;             // American odds from soft book
  softBookDecimal: number;          // Decimal odds
  softBook: string;                 // 'draftkings', 'fanduel', etc.
  pinnacleOdds?: number;            // Sharp benchmark
  pinnacleDecimal?: number;
  // EV
  trueProb: number;                 // De-vigged probability
  evPct: number;                    // Expected value %
  // Sizing
  suggestedSize: number;            // Kelly-calculated size
  maxSize: number;                  // Engine cap
  // Meta
  confidence: number;               // 0-100
  reasoning: string;
  detectedAt: string;
  expiresAt: string;
}

export interface EVResult {
  profitable: boolean;
  evPct: number;
  trueProb: number;
  softBookDecimal: number;
  pinnacleDecimal: number;
  edge: number;
  reason: string;
}

export interface CLVRecord {
  id: string;
  engine: SportsEngine;
  sport: string;
  market: string;
  betOdds: number;                  // Our odds at time of bet
  closingOdds: number;              // Market odds at game time
  clv: number;                      // betOdds - closingOdds (positive = good)
  pnl: number;
  timestamp: string;
}

export interface SportsPaperBet {
  id: string;
  opportunity: SportsOpportunity;
  size: number;
  status: 'open' | 'won' | 'lost' | 'push';
  placedAt: string;
  settledAt?: string;
  pnl: number;
  clv?: number;
  matchTitle?: string;
}

export interface SportsPaperPortfolio {
  startingCapital: number;
  cashUsd: number;
  openBetsValue: number;
  totalValue: number;
  totalPnlUsd: number;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  rollingClv: number;
  openBets: SportsPaperBet[];
  recentBets: SportsPaperBet[];
}

export interface SportsEngineStatus {
  running: boolean;
  mode: 'paper' | 'live';
  scanCycles: number;
  lastScanAt: string | null;
  lastScanDurationMs: number;
  enginesActive: number;
  opportunitiesFound: number;
  betsPlaced: number;
  uptimeMs?: number;
  config: SportsConfig;
}

export interface SportsConfig {
  mode: 'paper' | 'live';
  scanIntervalMs: number;
  startingCapital: number;
  kellyFraction: number;             // 0.25 = quarter-Kelly
  minEvPct: number;                  // 3% default
  maxBetSize: number;
  engineCaps: Record<SportsEngine, number>;
  enabledSports: string[];
  pinnacleAsSharp: boolean;
}

export const DEFAULT_SPORTS_CONFIG: SportsConfig = {
  mode: 'paper',
  scanIntervalMs: 60_000,           // 1 min scan cycle
  startingCapital: 1000,
  kellyFraction: 0.25,
  minEvPct: 0.03,                   // 3%
  maxBetSize: 200,
  engineCaps: {
    S1: 200, S2: 300, S3: 200, S4: 150, S5: 100, S6: 150,
  },
  enabledSports: [
    'americanfootball_nfl', 'basketball_nba', 'baseball_mlb',
    'icehockey_nhl', 'americanfootball_ncaaf', 'basketball_ncaab',
  ],
  pinnacleAsSharp: true,
};
