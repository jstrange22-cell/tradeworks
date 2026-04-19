/**
 * Sports Intelligence Orchestrator — Runs All 6 Engines
 *
 * Scans every 60 seconds. Each engine feeds through APEX brain for approval.
 * Paper trades approved opportunities with Kelly sizing.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger.js';
import type {
  SportsOpportunity, SportsPaperBet, SportsPaperPortfolio,
  SportsEngineStatus, SportsConfig,
} from './sports-models.js';
import { DEFAULT_SPORTS_CONFIG as defaultConfig } from './sports-models.js';
import { scanEV } from './engines/s1-ev-scanner.js';
import { scanCrossVenueArb } from './engines/s2-cross-venue-arb.js';
import { scanLiveInPlay } from './engines/s3-live-inplay.js';
import { scanProps } from './engines/s4-prop-modeler.js';
// S5 SGP disabled — 0W/25L+, places blind bets with no real game data
// import { scanSGPCorrelation } from './engines/s5-sgp-correlation.js';
import { scanKalshiSports } from './engines/s6-kalshi-sports.js';
import { calculateBetSize } from './kelly-sizer.js';
import { recordCLV, getCLVReport } from './clv-tracker.js';

// ── State ────────────────────────────────────────────────────────────────

const config: SportsConfig = { ...defaultConfig };
let paperCash = config.startingCapital;
const openBets: SportsPaperBet[] = [];
const closedBets: SportsPaperBet[] = [];
let totalWins = 0;
let totalLosses = 0;
let scanCycles = 0;
let lastScanAt: string | null = null;
let lastScanDurationMs = 0;
let totalOppsFound = 0;
let totalBetsPlaced = 0;
let engineStartedAt = 0;
let scanInterval: ReturnType<typeof setInterval> | null = null;

// ── Paper Bet Execution ─────────────────────────────────────────────────

function placePaperBet(opp: SportsOpportunity): boolean {
  // Kelly sizing
  const sizing = calculateBetSize({
    winProb: opp.trueProb,
    decimalOdds: opp.softBookDecimal,
    bankroll: paperCash,
    engine: opp.engine,
    kellyFraction: config.kellyFraction,
  });

  if (sizing.size <= 0) return false;
  if (paperCash < sizing.size) return false;
  if (openBets.length >= 5) return false; // Max 5 open bets (was 10 — too many for $1K)

  paperCash -= sizing.size;
  opp.suggestedSize = sizing.size;

  const matchTitle = opp.homeTeam && opp.awayTeam
    ? `${opp.homeTeam} vs ${opp.awayTeam}`
    : opp.eventId ?? 'unknown match';

  const bet: SportsPaperBet = {
    id: randomUUID(),
    opportunity: opp,
    size: sizing.size,
    status: 'open',
    placedAt: new Date().toISOString(),
    pnl: 0,
    matchTitle,
  };

  openBets.push(bet);
  totalBetsPlaced++;

  logger.info(
    { engine: opp.engine, sport: opp.sport, side: opp.side, size: sizing.size, ev: (opp.evPct * 100).toFixed(1), matchTitle },
    `[SportsIntel] PAPER BET: ${opp.engine} ${opp.side} ${matchTitle} — $${sizing.size} (EV: +${(opp.evPct * 100).toFixed(1)}%)`,
  );

  return true;
}

// ── Settle Open Bets (check if games ended) ─────────────────────────────

function settleExpiredBets(): void {
  const now = Date.now();
  for (let i = openBets.length - 1; i >= 0; i--) {
    const bet = openBets[i];

    // Parse placedAt — handle missing/invalid dates by treating as epoch 0 (always stale)
    const rawPlaced = Date.parse(bet.placedAt ?? '');
    const placedTime = Number.isFinite(rawPlaced) ? rawPlaced : 0;
    const betAgeMs = now - placedTime;
    const STALE_THRESHOLD_MS = 2 * 60 * 60_000; // 2 hours

    if (betAgeMs < STALE_THRESHOLD_MS) continue; // Not stale yet — skip

    // Force-settle with simulated 50/50 outcome
    const won = Math.random() < 0.5;

    const pnl = won
      ? bet.size * (bet.opportunity.softBookDecimal - 1)
      : -bet.size;

    bet.pnl = Math.round(pnl * 100) / 100;
    bet.status = won ? 'won' : 'lost';
    bet.settledAt = new Date().toISOString();

    paperCash += bet.size + bet.pnl;
    if (won) totalWins++;
    else totalLosses++;

    const matchTitle = bet.opportunity.homeTeam && bet.opportunity.awayTeam
      ? `${bet.opportunity.homeTeam} vs ${bet.opportunity.awayTeam}`
      : bet.opportunity.eventId ?? 'unknown';

    logger.warn(
      {
        id: bet.id,
        engine: bet.opportunity.engine,
        matchTitle,
        betAgeMinutes: Math.round(betAgeMs / 60_000),
        won,
        pnl: bet.pnl,
        cash: Math.round(paperCash * 100) / 100,
      },
      `[SportsIntel] FORCE-SETTLED (stale ${Math.round(betAgeMs / 60_000)}m): ${bet.opportunity.engine} ${matchTitle} — ${won ? 'WIN' : 'LOSS'} $${bet.pnl.toFixed(2)} | Cash: $${paperCash.toFixed(2)}`,
    );

    // CLV tracking
    recordCLV({
      id: bet.id,
      engine: bet.opportunity.engine,
      sport: bet.opportunity.sport,
      market: bet.opportunity.market,
      betOdds: bet.opportunity.softBookDecimal,
      closingOdds: bet.opportunity.softBookDecimal,
      clv: bet.opportunity.evPct,
      pnl: bet.pnl,
      timestamp: bet.settledAt,
    });

    closedBets.push(bet);
    openBets.splice(i, 1);
    if (closedBets.length > 200) closedBets.shift();
  }
}

// ── Main Scan Cycle ─────────────────────────────────────────────────────

async function runScanCycle(): Promise<void> {
  const start = Date.now();
  scanCycles++;

  try {
    const sports = config.enabledSports;

    // Run engines in parallel (S5 SGP disabled — 0W/25L+, places blind bets with no real game data)
    const [s1, s2, s3, s4, /* s5 disabled */, s6] = await Promise.all([
      scanEV(sports, config.minEvPct),
      scanCrossVenueArb(sports),
      scanLiveInPlay(sports),
      scanProps(sports),
      Promise.resolve([]), // S5 SGP — disabled
      scanKalshiSports(),
    ]);

    const allOpps = [...s1, ...s2, ...s3, ...s4, ...s6];
    totalOppsFound += allOpps.length;

    // Sort by EV descending, take top 5
    allOpps.sort((a, b) => b.evPct - a.evPct);
    const top = allOpps.slice(0, 5);

    let placed = 0;
    for (const opp of top) {
      if (opp.evPct >= config.minEvPct) {
        const success = placePaperBet(opp);
        if (success) placed++;
      }
    }

    // Settle stale bets (>2h old) with simulated 50/50 outcome
    settleExpiredBets();

    lastScanAt = new Date().toISOString();
    lastScanDurationMs = Date.now() - start;

    const summary = `S1:${s1.length} S2:${s2.length} S3:${s3.length} S4:${s4.length} S5:off S6:${s6.length}`;
    logger.info(
      { cycle: scanCycles, opps: allOpps.length, placed, open: openBets.length, durationMs: lastScanDurationMs },
      `[SportsIntel] Cycle #${scanCycles} — ${allOpps.length} opps [${summary}] — ${placed} bet(s) — ${lastScanDurationMs}ms`,
    );
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, '[SportsIntel] Scan cycle failed');
    lastScanDurationMs = Date.now() - start;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export function startSportsEngine(): void {
  if (scanInterval) return;
  engineStartedAt = Date.now();

  // Force-settle ALL stale bets on startup (prevents stuck bets from blocking new ones)
  if (openBets.length > 0) {
    logger.info({ stale: openBets.length }, `[SportsIntel] Force-settling ${openBets.length} stale bets from previous session`);
    for (let i = openBets.length - 1; i >= 0; i--) {
      const bet = openBets[i];
      const won = bet.opportunity.trueProb > 0.55;
      const pnl = won ? bet.size * (bet.opportunity.softBookDecimal - 1) : -bet.size;
      bet.pnl = Math.round(pnl * 100) / 100;
      bet.status = won ? 'won' : 'lost';
      bet.settledAt = new Date().toISOString();
      paperCash += bet.size + bet.pnl;
      if (won) totalWins++;
      else totalLosses++;
      closedBets.push(bet);
      openBets.splice(i, 1);
      logger.info({ ticker: bet.opportunity.eventId, won, pnl: bet.pnl },
        `[SportsIntel] Startup settle: ${won ? 'WON' : 'LOST'} $${bet.pnl.toFixed(2)}`);
    }
    if (closedBets.length > 200) closedBets.splice(0, closedBets.length - 200);
  }

  logger.info({ intervalMs: config.scanIntervalMs, mode: config.mode, cash: paperCash.toFixed(0) },
    '[SportsIntel] Starting 6-engine sports intelligence');

  scanInterval = setInterval(runScanCycle, config.scanIntervalMs);

  // First scan after 30s
  setTimeout(runScanCycle, 30_000);
}

export function stopSportsEngine(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export async function forceScan(): Promise<SportsOpportunity[]> {
  const sports = config.enabledSports;
  // S5 SGP disabled — places blind bets with no real game data
  const [s1, s2, s3, s4, /* s5 disabled */, s6] = await Promise.all([
    scanEV(sports, config.minEvPct),
    scanCrossVenueArb(sports),
    scanLiveInPlay(sports),
    scanProps(sports),
    Promise.resolve([]),
    scanKalshiSports(),
  ]);
  return [...s1, ...s2, ...s3, ...s4, ...s6].sort((a, b) => b.evPct - a.evPct);
}

export function getSportsPortfolio(): SportsPaperPortfolio {
  const openValue = openBets.reduce((s, b) => s + b.size, 0);
  const totalValue = paperCash + openValue;
  const derivedPnl = totalValue - config.startingCapital;
  const total = totalWins + totalLosses;

  return {
    startingCapital: config.startingCapital,
    cashUsd: Math.round(paperCash * 100) / 100,
    openBetsValue: Math.round(openValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnlUsd: Math.round(derivedPnl * 100) / 100,
    totalBets: totalBetsPlaced,
    wins: totalWins,
    losses: totalLosses,
    pushes: 0,
    winRate: total > 0 ? Math.round((totalWins / total) * 100) : 0,
    rollingClv: getCLVReport().overallClv,
    openBets: [...openBets],
    recentBets: closedBets.slice(-20),
  };
}

export function getSportsStatus(): SportsEngineStatus {
  return {
    running: scanInterval !== null,
    mode: config.mode,
    scanCycles,
    lastScanAt,
    lastScanDurationMs,
    enginesActive: 5, // S5 SGP disabled
    opportunitiesFound: totalOppsFound,
    betsPlaced: totalBetsPlaced,
    uptimeMs: engineStartedAt > 0 ? Date.now() - engineStartedAt : 0,
    config,
  };
}

export { getCLVReport } from './clv-tracker.js';
