/**
 * Arb Intelligence Orchestrator — Main 30s Scan Loop
 *
 * Flow: Fetch data → Run 9 detectors in parallel → Rank by EV →
 *       Route top 5 through APEX brain → Paper execute → Rotate capital →
 *       Share signals with crypto-agent + stock-intelligence
 */

import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger.js';
import type {
  ArbConfig, ArbEngineStatus, ArbPaperPortfolio, ArbPaperPosition,
  ArbOpportunity, ArbDecision, DetectorResult,
} from './models.js';
import { DEFAULT_ARB_CONFIG as defaultConfig } from './models.js';
import { fetchAllMarkets } from './market-matcher.js';
import { scanType1 } from './detectors/type1-rebalance.js';
import { scanType2 } from './detectors/type2-dutch-book.js';
import { scanType3 } from './detectors/type3-cross-platform.js';
import { scanType4 } from './detectors/type4-combinatorial.js';
import { scanType5 } from './detectors/type5-settlement.js';
import { scanType6 } from './detectors/type6-latency.js';
import { scanType7 } from './detectors/type7-options-implied.js';
import { scanType8 } from './detectors/type8-exchange-spread.js';
import { scanType9, extractT9Signals } from './detectors/type9-stock-crypto-spread.js';
import { evaluate } from './brain.js';
import { checkRotation } from './capital-rotator.js';
import { recordTradeResult, updateThresholds } from './learner.js';

// ── Paper Portfolio ─────────────────────────────────────────────────────

const config: ArbConfig = { ...defaultConfig };
let paperCash = config.startingCapital;
const openPositions: ArbPaperPosition[] = [];
const closedPositions: ArbPaperPosition[] = [];
let totalWins = 0;
let totalLosses = 0;

// ── Engine State ────────────────────────────────────────────────────────

let scanInterval: ReturnType<typeof setInterval> | null = null;
let scanCycles = 0;
let lastScanAt: string | null = null;
let lastScanDurationMs = 0;
let totalOppsFound = 0;
let totalTradesExecuted = 0;
let startedAt = 0;

// ── Recent Opportunities (for cross-bot intelligence sharing) ───────────

let recentOpportunities: ArbOpportunity[] = [];
let arbDislocationsActive = false; // True when extreme spreads detected (crisis indicator)
let lastSignalShareAt = 0;
const SIGNAL_SHARE_COOLDOWN_MS = 60_000; // Don't spam crypto-agent more than once per minute

// ── Paper Trade Execution ───────────────────────────────────────────────

function executePaperTrade(decision: ArbDecision): boolean {
  const opp = decision.opportunity;

  // For T9 (ETF vs crypto), totalCost represents virtual arb cost
  // Use a reasonable dollar-denominated size instead of contract math
  const isType9 = opp.arbType === 'type9_stock_crypto_spread';
  const cost = isType9
    ? Math.min(config.maxPerTradeUsd, 500) // Fixed $500 paper size for T9
    : opp.totalCost * opp.fillableQuantity;

  if (paperCash < cost) {
    logger.warn({ cost, cash: paperCash }, '[ArbIntel] Insufficient paper cash');
    return false;
  }

  if (openPositions.length >= config.maxSimultaneous) {
    logger.warn({ open: openPositions.length, max: config.maxSimultaneous }, '[ArbIntel] Max simultaneous positions reached');
    return false;
  }

  paperCash -= cost;

  const position: ArbPaperPosition = {
    id: randomUUID(),
    opportunity: opp,
    entryTime: new Date().toISOString(),
    entryValue: cost,
    currentValue: cost, // Initially same as entry
    pnl: 0,
    status: 'open',
  };

  openPositions.push(position);
  totalTradesExecuted++;

  logger.info({
    arbType: opp.arbType,
    ticker: opp.ticker_a,
    qty: opp.fillableQuantity,
    cost: cost.toFixed(2),
    cashLeft: paperCash.toFixed(2),
  }, `[ArbIntel] PAPER TRADE: ${opp.arbType} — ${opp.ticker_a} $${cost.toFixed(2)}`);

  return true;
}

function closePosition(position: ArbPaperPosition, reason: string): void {
  const isType9 = position.opportunity.arbType === 'type9_stock_crypto_spread';

  let pnl: number;
  if (isType9) {
    // T9: Estimate P&L based on the spread pct — if spread was 3%, expect ~2% net return
    const spreadPct = position.opportunity.grossProfitPerContract;
    const netReturnPct = Math.max(-0.02, spreadPct * 0.6); // 60% of spread captured, floor at -2%
    pnl = position.entryValue * netReturnPct;
  } else {
    // Standard prediction market arb: payout at $1.00/contract (one leg wins)
    const payout = position.opportunity.fillableQuantity * 1.0;
    const fees = position.opportunity.netProfitPerContract < position.opportunity.grossProfitPerContract
      ? (position.opportunity.grossProfitPerContract - position.opportunity.netProfitPerContract) * position.opportunity.fillableQuantity
      : 0;
    pnl = payout - position.entryValue - fees;
  }

  position.pnl = Math.round(pnl * 100) / 100;
  position.currentValue = position.entryValue + pnl;
  position.status = 'closed';
  position.exitTime = new Date().toISOString();
  position.exitReason = reason;

  paperCash += position.currentValue;

  if (pnl > 0) totalWins++;
  else totalLosses++;

  // Record for learner
  recordTradeResult(position.opportunity.arbType, pnl);

  // Move from open to closed
  const idx = openPositions.findIndex(p => p.id === position.id);
  if (idx >= 0) openPositions.splice(idx, 1);
  closedPositions.push(position);

  // Keep only last 100 closed
  if (closedPositions.length > 100) closedPositions.shift();

  logger.info({
    arbType: position.opportunity.arbType,
    pnl: pnl.toFixed(2),
    reason,
    cashAfter: paperCash.toFixed(2),
  }, `[ArbIntel] CLOSED: ${position.opportunity.arbType} P&L $${pnl.toFixed(2)} — ${reason}`);
}

// ── Cross-System Signal Sharing ─────────────────────────────────────────

/**
 * Share T9 ETF-crypto spread signals with the crypto-agent.
 * When ETF trades at discount → crypto is overpriced → sell signal.
 * When ETF trades at premium → crypto is underpriced vs ETF → buy signal.
 */
async function shareWithCryptoAgent(opportunities: ArbOpportunity[]): Promise<void> {
  // Cooldown check: don't spam signals
  if (Date.now() - lastSignalShareAt < SIGNAL_SHARE_COOLDOWN_MS) return;

  const t9Signals = extractT9Signals(opportunities);
  if (t9Signals.length === 0) return;

  try {
    const { executeSignalTrade } = await import('../../routes/crypto-agent.js');

    for (const sig of t9Signals) {
      // Only share signals for assets the crypto-agent can trade (BTC, ETH, SOL)
      const cryptoSymbol = sig.underlying;
      if (!['BTC', 'ETH', 'SOL'].includes(cryptoSymbol)) continue;
      if (sig.spotPrice <= 0) continue;

      // Map direction: if ETF at premium → crypto is "cheap" relative → buy crypto
      // if ETF at discount → crypto is "expensive" relative → sell crypto
      const action = sig.direction; // extractT9Signals already maps premium→sell, discount→buy

      const success = await executeSignalTrade({
        symbol: `${cryptoSymbol}-USD`,
        action,
        price: sig.spotPrice,
        confidence: Math.min(75, 50 + sig.spreadPct * 8),
        reason: `Arb T9: ${sig.etfTicker} spread ${sig.spreadPct.toFixed(2)}%. ${sig.reasoning}`,
        source: 'arb',
      });

      if (success) {
        logger.info({ symbol: cryptoSymbol, action, spread: sig.spreadPct }, '[ArbIntel→CEX] Shared T9 signal with crypto-agent');
      }
    }

    lastSignalShareAt = Date.now();
  } catch (err) {
    // Crypto-agent not available — non-fatal
    logger.debug({ err: err instanceof Error ? err.message : err }, '[ArbIntel→CEX] Could not share signal (crypto-agent unavailable)');
  }
}

/**
 * Inject arb signals into the stock orchestrator as StockOpportunity signals.
 * When T9 detects ETF mispricing, create a stock trade opportunity.
 */
async function shareWithStockEngine(opportunities: ArbOpportunity[]): Promise<void> {
  const t9Signals = extractT9Signals(opportunities);
  if (t9Signals.length === 0) return;

  try {
    // Use dynamic import — the stock orchestrator may add an injectSignal function
    const stockMod = await import('../stock-intelligence/stock-orchestrator.js');
    const injectFn = (stockMod as Record<string, unknown>).injectArbSignal;
    if (typeof injectFn !== 'function') return;

    for (const sig of t9Signals) {
      // Only ETF tickers are tradeable via stocks (not cross-exchange crypto)
      if (sig.etfTicker.includes('-CB') || sig.etfTicker.includes('-CG')) continue;

      injectFn({
        source: 'arb_t9',
        ticker: sig.etfTicker,
        action: sig.direction === 'buy' ? 'buy' : 'sell',
        confidence: Math.min(70, 50 + sig.spreadPct * 8),
        reasoning: `Arb T9: ${sig.etfTicker} ${sig.spreadPct.toFixed(2)}% spread vs ${sig.underlying} spot. ${sig.reasoning}`,
      });
    }
  } catch {
    // Stock engine doesn't have injectArbSignal yet — that's fine
  }
}

// ── Main Scan Cycle ─────────────────────────────────────────────────────

async function runScanCycle(): Promise<void> {
  const start = Date.now();
  scanCycles++;

  try {
    // 1. Fetch market data from both venues
    const { kalshiMarkets, kalshiEvents, polyMarkets, polyEvents } = await fetchAllMarkets();

    const allMarkets = [...kalshiMarkets, ...polyMarkets];
    const allEvents = [...kalshiEvents, ...polyEvents];
    const cryptoMarkets = allMarkets.filter(m =>
      m.category.toLowerCase().includes('crypto') || m.title.toLowerCase().match(/bitcoin|ethereum|btc|eth|solana/),
    );

    // 2. Run all 9 detectors in parallel
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = await Promise.all([
      scanType1(allMarkets, config.thresholds.type1MinCents),
      scanType2(allEvents, config.thresholds.type2MinCents),
      scanType3(kalshiMarkets, polyMarkets, config.thresholds.type3MinCents),
      scanType4(allMarkets, config.thresholds.type4MinCents),
      scanType5(allMarkets, config.thresholds.type5MinCents),
      scanType6(kalshiMarkets, polyMarkets, config.thresholds.type6MinCents),
      scanType7(cryptoMarkets, config.thresholds.type7MinEdgePct),
      scanType8(),
      scanType9(), // Stock-crypto ETF spread (GBTC, ETHE, IBIT vs spot) + cross-exchange
    ]);

    const allResults: DetectorResult[] = [r1, r2, r3, r4, r5, r6, r7, r8, r9];
    const allOpps = allResults.flatMap(r => r.opportunities);
    totalOppsFound += allOpps.length;
    recentOpportunities = allOpps; // Store for cross-bot intelligence sharing

    // Check for extreme dislocations (crisis indicator for regime sharing)
    const extremeOpps = allOpps.filter(o =>
      o.grossProfitPerContract > 0.05 || // >5% spread
      (o.arbType === 'type9_stock_crypto_spread' && o.grossProfitPerContract > 0.03), // >3% ETF spread
    );
    arbDislocationsActive = extremeOpps.length >= 2;

    // 3. Rank by expected value (net_profit × confidence)
    allOpps.sort((a, b) =>
      (b.netProfitPerContract * b.confidence) - (a.netProfitPerContract * a.confidence),
    );

    // 4. Route top 5 through APEX brain
    const top = allOpps.slice(0, 5);
    let executed = 0;

    for (const opp of top) {
      const decision = await evaluate(opp, config);

      if (decision.action === 'execute') {
        const success = executePaperTrade(decision);
        if (success) executed++;
      } else {
        // In paper mode, be more aggressive: also execute 'investigate' decisions
        if (config.mode === 'paper' && decision.action === 'investigate' && decision.confidence > 0.4) {
          const success = executePaperTrade({
            ...decision,
            action: 'execute',
            reasoning: `[PAPER MODE AGGRESSIVE] ${decision.reasoning}`,
          });
          if (success) executed++;
        }
      }
    }

    // 5. Check open positions for rotation
    for (const pos of [...openPositions]) {
      const rotation = checkRotation(pos);
      if (rotation.action === 'exit') {
        closePosition(pos, rotation.reason);
      }
    }

    // 6. Auto-tune thresholds every 50 cycles
    if (scanCycles % 50 === 0) {
      const adjustments = updateThresholds(config);
      if (adjustments.length > 0) {
        logger.info({ adjustments }, '[ArbIntel] Auto-tuned thresholds');
      }
    }

    // 7. Share signals with other trading systems (fire-and-forget)
    shareWithCryptoAgent(allOpps).catch(() => {});
    shareWithStockEngine(allOpps).catch(() => {});

    lastScanAt = new Date().toISOString();
    lastScanDurationMs = Date.now() - start;

    // Log summary
    const detectorSummary = allResults.map(r => `${r.detector.replace('type', 'T').replace('_', '')}:${r.opportunities.length}`).join(' ');
    logger.info({
      cycle: scanCycles,
      marketsScanned: allMarkets.length,
      oppsFound: allOpps.length,
      executed,
      openPositions: openPositions.length,
      durationMs: lastScanDurationMs,
      dislocations: arbDislocationsActive,
    }, `[ArbIntel] Cycle #${scanCycles} — ${allOpps.length} opps [${detectorSummary}] — ${executed} traded — ${lastScanDurationMs}ms`);

  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, '[ArbIntel] Scan cycle failed');
    lastScanDurationMs = Date.now() - start;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export function startArbEngine(): void {
  if (scanInterval) return;
  startedAt = Date.now();

  logger.info({ intervalMs: config.scanIntervalMs, mode: config.mode }, '[ArbIntel] Starting arb intelligence engine');

  scanInterval = setInterval(runScanCycle, config.scanIntervalMs);

  // First scan after 20s (let other services initialize)
  setTimeout(runScanCycle, 20_000);
}

export function stopArbEngine(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('[ArbIntel] Engine stopped');
  }
}

export async function forceScan(): Promise<{ opportunities: ArbOpportunity[]; decisions: ArbDecision[] }> {
  const { kalshiMarkets, kalshiEvents, polyMarkets, polyEvents } = await fetchAllMarkets();
  const allMarkets = [...kalshiMarkets, ...polyMarkets];
  const allEvents = [...kalshiEvents, ...polyEvents];
  const cryptoMarkets = allMarkets.filter(m =>
    m.category.toLowerCase().includes('crypto') || m.title.toLowerCase().match(/bitcoin|ethereum|btc|eth|solana/),
  );

  // Run ALL 9 detectors (was missing T8 and T9)
  const [r1, r2, r3, r4, r5, r6, r7, r8, r9] = await Promise.all([
    scanType1(allMarkets, config.thresholds.type1MinCents),
    scanType2(allEvents, config.thresholds.type2MinCents),
    scanType3(kalshiMarkets, polyMarkets, config.thresholds.type3MinCents),
    scanType4(allMarkets, config.thresholds.type4MinCents),
    scanType5(allMarkets, config.thresholds.type5MinCents),
    scanType6(kalshiMarkets, polyMarkets, config.thresholds.type6MinCents),
    scanType7(cryptoMarkets, config.thresholds.type7MinEdgePct),
    scanType8(),
    scanType9(),
  ]);

  const allOpps = [r1, r2, r3, r4, r5, r6, r7, r8, r9].flatMap(r => r.opportunities);
  allOpps.sort((a, b) => (b.netProfitPerContract * b.confidence) - (a.netProfitPerContract * a.confidence));

  const decisions: ArbDecision[] = [];
  for (const opp of allOpps.slice(0, 10)) {
    decisions.push(await evaluate(opp, config));
  }

  return { opportunities: allOpps, decisions };
}

export function getArbPortfolio(): ArbPaperPortfolio {
  const positionsValue = openPositions.reduce((s, p) => s + p.entryValue, 0);
  const totalValue = paperCash + positionsValue;
  const derivedPnl = totalValue - config.startingCapital;
  const totalTrades = totalWins + totalLosses;

  return {
    startingCapital: config.startingCapital,
    cashUsd: Math.round(paperCash * 100) / 100,
    positionsValue: Math.round(positionsValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnlUsd: Math.round(derivedPnl * 100) / 100,
    trades: totalTradesExecuted,
    wins: totalWins,
    losses: totalLosses,
    winRate: totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100) : 0,
    openPositions: [...openPositions],
    recentTrades: closedPositions.slice(-20),
  };
}

export function getArbStatus(): ArbEngineStatus {
  return {
    running: scanInterval !== null,
    mode: config.mode,
    scanCycles,
    lastScanAt,
    lastScanDurationMs,
    detectorsActive: 9,
    opportunitiesFound: totalOppsFound,
    tradesExecuted: totalTradesExecuted,
    uptime: startedAt > 0 ? Date.now() - startedAt : 0,
    config,
  };
}

export function getRecentOpportunities(): ArbOpportunity[] {
  return recentOpportunities;
}

/**
 * Returns arb regime data for other systems (stock orchestrator, risk engine).
 * When arb detects extreme dislocations across multiple types, it signals a
 * potential market crisis — useful for the stock engine's regime detection.
 */
export function getArbRegime(): {
  dislocationsActive: boolean;
  activeOpportunityCount: number;
  t9SpreadAvgPct: number;
  openPositionCount: number;
  lastScanAt: string | null;
} {
  const t9Opps = recentOpportunities.filter(o => o.arbType === 'type9_stock_crypto_spread');
  const t9AvgSpread = t9Opps.length > 0
    ? t9Opps.reduce((s, o) => s + o.grossProfitPerContract, 0) / t9Opps.length * 100
    : 0;

  return {
    dislocationsActive: arbDislocationsActive,
    activeOpportunityCount: recentOpportunities.length,
    t9SpreadAvgPct: Math.round(t9AvgSpread * 100) / 100,
    openPositionCount: openPositions.length,
    lastScanAt,
  };
}

export { getLearnerReport } from './learner.js';
