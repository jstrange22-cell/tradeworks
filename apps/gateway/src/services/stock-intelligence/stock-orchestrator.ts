/**
 * Stock Intelligence Orchestrator — Runs All 14 Engines
 *
 * Scans every 60 seconds during market hours.
 * Each engine's opportunities go through sizing + risk checks.
 * Paper trades with $10,000 starting capital.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../../lib/logger.js';
import type {
  StockOpportunity, StockPaperTrade, StockPaperPortfolio,
  StockEngineStatus, StockConfig, StockRegime,
  PaperLedgerState, EquityPosition,
} from './stock-models.js';
import {
  DEFAULT_STOCK_CONFIG as defaultConfig,
  DEFAULT_PAPER_LEDGER,
} from './stock-models.js';
import { scanMeanReversion } from './engines/e1-mean-reversion.js';
import { scanMomentumRotation } from './engines/e2-momentum-rotator.js';
import { scanPairsTrading } from './engines/e3-pairs-trader.js';
import { scanSwingTrades } from './engines/e4-swing-trader.js';
// Kelly sizer available from sports-intelligence but not needed for paper mode

// ── Persistence ─────────────────────────────────────────────────────────

const DATA_DIR = path.resolve('data/stocks');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* exists */ }

interface StockPaperState {
  paperCash: number;
  totalWins: number;
  totalLosses: number;
  totalTradesExecuted: number;
  openPositions: StockPaperTrade[];
  closedPositions: StockPaperTrade[];
}

function persistStockState(): void {
  try {
    const state: StockPaperState = {
      paperCash,
      totalWins,
      totalLosses,
      totalTradesExecuted,
      openPositions: [...openPositions],
      closedPositions: closedPositions.slice(-200),
    };
    fs.writeFileSync(
      path.join(DATA_DIR, 'paper-state.json'),
      JSON.stringify(state, null, 2),
    );
  } catch { /* fire-and-forget */ }
}

function loadStockState(): void {
  try {
    const file = path.join(DATA_DIR, 'paper-state.json');
    if (!fs.existsSync(file)) return;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as StockPaperState;
    if (raw.paperCash != null) paperCash = raw.paperCash;
    if (raw.totalWins != null) totalWins = raw.totalWins;
    if (raw.totalLosses != null) totalLosses = raw.totalLosses;
    if (raw.totalTradesExecuted != null) totalTradesExecuted = raw.totalTradesExecuted;
    if (Array.isArray(raw.openPositions)) {
      openPositions.length = 0;
      openPositions.push(...raw.openPositions);
    }
    if (Array.isArray(raw.closedPositions)) {
      closedPositions.length = 0;
      closedPositions.push(...raw.closedPositions);
    }
    logger.info({ paperCash, open: openPositions.length, closed: closedPositions.length }, '[StocksIntel] Restored paper state from disk');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[StocksIntel] Failed to load paper state, starting fresh');
  }
}

// ── TradeVisor Stock-Agent Paper Ledger (split equity + option books) ──
// The stock-agent (signal-driven paper trader) has its own ledger file
// so it stays isolated from the 14-engine orchestrator persistence above.
// Consumers call loadPaperLedger() / savePaperLedger() from stock-agent.ts.

const PAPER_LEDGER_FILE = path.join(DATA_DIR, 'paper-ledger.json');
const LEGACY_PAPER_STATE_FILE = path.join(DATA_DIR, 'paper-state.json');

function normalizeLedger(raw: Partial<PaperLedgerState> & { positions?: EquityPosition[] }): PaperLedgerState {
  const equityPositions = Array.isArray(raw.equityPositions) ? raw.equityPositions : [];
  const optionPositions = Array.isArray(raw.optionPositions) ? raw.optionPositions : [];
  const equityClosed = Array.isArray(raw.equityClosed) ? raw.equityClosed : [];
  const optionClosed = Array.isArray(raw.optionClosed) ? raw.optionClosed : [];

  // Legacy migration: if a file had a single `positions[]` but no
  // `equityPositions[]`, move it across.
  if (Array.isArray(raw.positions) && equityPositions.length === 0) {
    equityPositions.push(...raw.positions);
  }

  return {
    paperCashUsd: typeof raw.paperCashUsd === 'number' ? raw.paperCashUsd : DEFAULT_PAPER_LEDGER.paperCashUsd,
    equityPositions,
    optionPositions,
    equityClosed,
    optionClosed,
    stats: raw.stats ?? { ...DEFAULT_PAPER_LEDGER.stats },
  };
}

/**
 * Load the stock-agent paper ledger from disk.
 *
 * Migration path:
 *   - If `paper-ledger.json` exists → load it directly.
 *   - Else if `paper-state.json` carries a legacy `positions[]` field → copy
 *     that file to `paper-state.pre-migration.json`, upgrade the shape to
 *     the new ledger schema, and write it out as `paper-ledger.json`.
 *   - Else → return a fresh DEFAULT_PAPER_LEDGER.
 *
 * Returns a fully-populated PaperLedgerState. Never throws.
 */
export function loadPaperLedger(): PaperLedgerState {
  try {
    if (fs.existsSync(PAPER_LEDGER_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PAPER_LEDGER_FILE, 'utf-8')) as Partial<PaperLedgerState>;
      const ledger = normalizeLedger(raw);
      logger.info(
        {
          cash: ledger.paperCashUsd,
          equity: ledger.equityPositions.length,
          options: ledger.optionPositions.length,
        },
        '[StockAgent] Restored paper ledger from disk',
      );
      return ledger;
    }

    // One-time migration from legacy `paper-state.json` iff it has `positions[]`.
    if (fs.existsSync(LEGACY_PAPER_STATE_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_PAPER_STATE_FILE, 'utf-8')) as Partial<PaperLedgerState> & { positions?: EquityPosition[] };
      if (Array.isArray(legacy.positions) && legacy.positions.length > 0) {
        const archivePath = path.join(DATA_DIR, 'paper-state.pre-migration.json');
        try { fs.copyFileSync(LEGACY_PAPER_STATE_FILE, archivePath); } catch { /* best-effort archive */ }
        const migrated = normalizeLedger(legacy);
        fs.writeFileSync(PAPER_LEDGER_FILE, JSON.stringify(migrated, null, 2));
        logger.info(
          { archived: archivePath, equity: migrated.equityPositions.length },
          '[StockAgent] Migrated legacy positions[] → equityPositions[]',
        );
        return migrated;
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[StockAgent] Failed to load paper ledger, starting fresh');
  }

  return {
    ...DEFAULT_PAPER_LEDGER,
    equityPositions: [],
    optionPositions: [],
    equityClosed: [],
    optionClosed: [],
    stats: { ...DEFAULT_PAPER_LEDGER.stats },
  };
}

/** Persist the stock-agent paper ledger. Never throws (fire-and-forget). */
export function savePaperLedger(state: PaperLedgerState): void {
  try {
    fs.writeFileSync(PAPER_LEDGER_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[StockAgent] Failed to persist paper ledger');
  }
}

// ── State ────────────────────────────────────────────────────────────────

const config: StockConfig = { ...defaultConfig };
let paperCash = 10_000;
const openPositions: StockPaperTrade[] = [];
const closedPositions: StockPaperTrade[] = [];
let totalWins = 0;
let totalLosses = 0;
let scanCycles = 0;
let lastScanAt: string | null = null;
let lastScanDurationMs = 0;
let totalOppsFound = 0;
let totalTradesExecuted = 0;
let currentRegime: StockRegime = 'neutral';
let currentVix = 20;
let scanInterval: ReturnType<typeof setInterval> | null = null;

// ── Paper Trade Execution ───────────────────────────────────────────────

function executePaperTrade(opp: StockOpportunity): boolean {
  const size = Math.min(opp.maxSize, paperCash * 0.10); // Max 10% per trade in paper
  if (size < 50 || paperCash < size) return false;
  if (openPositions.length >= 20) return false;

  paperCash -= size;

  const trade: StockPaperTrade = {
    id: randomUUID(),
    opportunity: opp,
    size,
    entryPrice: opp.price || 0,
    currentPrice: opp.price || 0,
    pnl: 0,
    pnlPct: 0,
    status: 'open',
    openedAt: new Date().toISOString(),
  };

  openPositions.push(trade);
  totalTradesExecuted++;
  persistStockState();

  logger.info(
    { engine: opp.engine, ticker: opp.ticker, size: size.toFixed(0), conf: opp.confidence },
    `[StocksIntel] PAPER TRADE: ${opp.engine} ${opp.action} ${opp.ticker} $${size.toFixed(0)}`,
  );

  return true;
}

// ── Position Monitor ────────────────────────────────────────────────────

async function monitorPositions(): Promise<void> {
  if (openPositions.length === 0) return;

  // Fetch REAL prices from Alpaca for all open position tickers
  const tickers = [...new Set(openPositions.map(p => p.opportunity.ticker))];
  let livePrices: Record<string, number> = {};

  try {
    const { getSnapshots } = await import('../stocks/alpaca-client.js');
    const snapshots = await getSnapshots(tickers);
    for (const [symbol, snap] of Object.entries(snapshots)) {
      if (snap?.latestTrade?.p) {
        livePrices[symbol] = snap.latestTrade.p;
      }
    }
  } catch {
    // Alpaca unavailable — don't update prices, don't fake them
    return;
  }

  for (let i = openPositions.length - 1; i >= 0; i--) {
    const pos = openPositions[i];
    const opp = pos.opportunity;
    const holdMs = Date.now() - new Date(pos.openedAt).getTime();

    // Update with REAL Alpaca price — ONLY for equity/macro positions (not options)
    // Options (condors, wheels, spreads) don't have a simple stock price P&L
    // Their value comes from options premium decay, not underlying price movement
    if (opp.domain !== 'option') {
      const livePrice = livePrices[opp.ticker];
      if (livePrice && livePrice > 0 && pos.entryPrice > 0) {
        pos.currentPrice = livePrice;
        const returnPct = (livePrice - pos.entryPrice) / pos.entryPrice;
        pos.pnl = Math.round(returnPct * pos.size * 100) / 100;
        pos.pnlPct = returnPct * 100;
      }
    }
    // Options positions: P&L stays at 0 until we have real options chain data
    // This is accurate — we genuinely don't know options P&L without Greeks

    // Time stop: 10 days equities, 45 days options, 30 days macro
    const maxHold = opp.domain === 'option' ? 45 * 24 * 3600_000
      : opp.domain === 'macro' ? 30 * 24 * 3600_000
      : 10 * 24 * 3600_000;

    if (holdMs > maxHold) {
      closePosition(pos, 'time_stop');
      continue;
    }

    // TP/SL: Close equity/macro positions that moved significantly
    if (opp.domain !== 'option' && pos.entryPrice > 0) {
      if (pos.pnlPct >= 8) { closePosition(pos, 'take_profit'); continue; }
      if (pos.pnlPct <= -5) { closePosition(pos, 'stop_loss'); continue; }
    }
  }
}

function closePosition(pos: StockPaperTrade, reason: string): void {
  // Use REAL P&L from live price updates (not simulated)
  // pos.pnl was already set by monitorPositions() from real Alpaca data
  const won = pos.pnl >= 0;
  pos.status = won ? 'closed_win' : 'closed_loss';
  pos.closedAt = new Date().toISOString();
  pos.closeReason = reason;

  paperCash += pos.size + pos.pnl;
  if (won) totalWins++;
  else totalLosses++;

  const idx = openPositions.indexOf(pos);
  if (idx >= 0) openPositions.splice(idx, 1);
  closedPositions.push(pos);
  if (closedPositions.length > 200) closedPositions.shift();

  persistStockState();

  logger.info(
    { engine: pos.opportunity.engine, ticker: pos.opportunity.ticker, pnl: pos.pnl, reason },
    `[StocksIntel] CLOSED: ${pos.opportunity.engine} ${pos.opportunity.ticker} $${pos.pnl.toFixed(2)} (${reason})`,
  );
}

// ── Regime Detection ────────────────────────────────────────────────────

async function updateRegime(): Promise<void> {
  try {
    // Use VIX from CoinGecko fear & greed as proxy (will upgrade with Alpaca data)
    const { getMacroRegime } = await import('../ai/macro-regime.js');
    const regime = await getMacroRegime();

    // Map to stock regime
    let vixProxy = 40 - (regime.confidence * 0.3); // Rough VIX proxy
    currentVix = vixProxy;

    // Arb intelligence regime overlay: extreme dislocations signal crisis
    try {
      const { getArbRegime } = await import('../arb-intelligence/orchestrator.js');
      const arbRegime = getArbRegime();
      if (arbRegime.dislocationsActive) {
        // Arb seeing extreme spreads — boost VIX proxy to push toward risk_off/crisis
        vixProxy = Math.max(vixProxy, 30);
        currentVix = vixProxy;
        logger.info(
          { arbOpps: arbRegime.activeOpportunityCount, t9Spread: arbRegime.t9SpreadAvgPct },
          '[StocksIntel] Arb dislocations active — regime shifted toward risk_off',
        );
      }
    } catch { /* Arb engine not available — non-fatal */ }

    if (vixProxy > 35) currentRegime = 'crisis';
    else if (vixProxy > 25) currentRegime = 'risk_off';
    else if (vixProxy < 15) currentRegime = 'risk_on';
    else currentRegime = 'neutral';
  } catch { /* keep current */ }
}

// ── Main Scan Cycle ─────────────────────────────────────────────────────

async function runScanCycle(): Promise<void> {
  const start = Date.now();
  scanCycles++;

  try {
    await updateRegime();

    // Check TradingView signals for stock-specific BUY/SELL
    let tvStockOpps: StockOpportunity[] = [];
    try {
      const { getActiveBuySignals, getActiveSellSignals } = await import('../ai/tradingview-agent.js');
      const buys = getActiveBuySignals().filter(s => {
        const sym = s.symbol.replace('-USD', '');
        return /^[A-Z]{1,5}$/.test(sym) && !sym.match(/^(BTC|ETH|SOL|AVAX|LINK|DOGE|ADA|DOT|XRP|MATIC)$/);
      });
      const sells = getActiveSellSignals().filter(s => {
        const sym = s.symbol.replace('-USD', '');
        return /^[A-Z]{1,5}$/.test(sym);
      });

      for (const sig of buys) {
        tvStockOpps.push({
          id: randomUUID(),
          engine: 'E4' as const, // Tradevisor signals go through swing trader
          domain: 'equity',
          ticker: sig.symbol.replace('-USD', ''),
          action: 'buy',
          price: sig.price,
          suggestedSize: 0,
          maxSize: 5000,
          confidence: sig.confidence,
          reasoning: `Tradevisor BUY: ${sig.symbol} @ $${sig.price} (TF:${sig.timeframe})`,
          detectedAt: sig.receivedAt,
        });
      }
      for (const sig of sells) {
        tvStockOpps.push({
          id: randomUUID(),
          engine: 'E4' as const,
          domain: 'equity',
          ticker: sig.symbol.replace('-USD', ''),
          action: 'sell',
          price: sig.price,
          suggestedSize: 0,
          maxSize: 5000,
          confidence: sig.confidence,
          reasoning: `Tradevisor SELL: ${sig.symbol} @ $${sig.price}`,
          detectedAt: sig.receivedAt,
        });
      }
      if (tvStockOpps.length > 0) {
        logger.info({ count: tvStockOpps.length }, `[StocksIntel] ${tvStockOpps.length} TradingView stock signals`);
      }
    } catch { /* TV agent not available */ }

    // Run equity engines
    const [e1, e2, e3, e4] = await Promise.all([
      scanMeanReversion(currentRegime, currentVix).catch(() => [] as StockOpportunity[]),
      scanMomentumRotation().catch(() => [] as StockOpportunity[]),
      scanPairsTrading().catch(() => [] as StockOpportunity[]),
      scanSwingTrades().catch(() => [] as StockOpportunity[]),
    ]);

    // Run options engines
    let o1: StockOpportunity[] = [], o2: StockOpportunity[] = [];
    let o3: StockOpportunity[] = [], o4: StockOpportunity[] = [];
    try {
      const { scanThetaHarvest } = await import('./engines/o1-theta-harvester.js');
      o1 = await scanThetaHarvest(currentRegime, currentVix);
    } catch { /* engine not available */ }
    try {
      const { scanWheelOpportunities } = await import('./engines/o2-wheel-strategy.js');
      o2 = await scanWheelOpportunities(currentRegime);
    } catch { /* engine not available */ }
    try {
      const { scanZeroDTE } = await import('./engines/o3-zero-dte.js');
      o3 = await scanZeroDTE(currentVix);
    } catch { /* engine not available */ }
    try {
      const { scanVolArb } = await import('./engines/o4-vol-arb.js');
      o4 = await scanVolArb(currentVix);
    } catch { /* engine not available */ }

    // Run macro engines
    let m1: StockOpportunity[] = [], m2: StockOpportunity[] = [];
    let m3: StockOpportunity[] = [], m4: StockOpportunity[] = [];
    try { const mod = await import('./engines/m1-bond-rotation.js'); m1 = await mod.scanBondRotation(); } catch { /* */ }
    try { const mod = await import('./engines/m2-metals-momentum.js'); m2 = await mod.scanMetalsMomentum(); } catch { /* */ }
    try { const mod = await import('./engines/m3-risk-parity.js'); m3 = await mod.scanRiskParity(); } catch { /* */ }
    try { const mod = await import('./engines/m4-sector-rotation.js'); m4 = await mod.scanSectorRotation(); } catch { /* */ }

    // Run cross-asset engines
    let x1: StockOpportunity[] = [], x2: StockOpportunity[] = [];
    try { const mod = await import('./engines/x1-prediction-bridge.js'); x1 = await mod.scanPredictionBridge(); } catch { /* */ }
    try { const mod = await import('./engines/x2-news-alpha.js'); x2 = await mod.scanNewsAlpha(); } catch { /* */ }

    // Drain arb intelligence signals into this cycle
    const arbSignals = pendingArbSignals.splice(0, pendingArbSignals.length);
    if (arbSignals.length > 0) {
      logger.info({ count: arbSignals.length }, `[StocksIntel] Processing ${arbSignals.length} arb intelligence signals`);
    }

    const allOpps = [...tvStockOpps, ...e1, ...e2, ...e3, ...e4, ...o1, ...o2, ...o3, ...o4, ...m1, ...m2, ...m3, ...m4, ...x1, ...x2, ...arbSignals];
    totalOppsFound += allOpps.length;

    // Sort by confidence, take top opportunities
    allOpps.sort((a, b) => b.confidence - a.confidence);

    // Routing logic:
    // - Options (O1-O4) + Macro (M1-M4) → TRADE DIRECTLY (their own TA is sufficient)
    // - Equities (E1-E4) + Cross (X1-X2) → Tradevisor watchlist for extra TA confirmation
    // - TV signals → TRADE DIRECTLY (user's chart already confirmed)
    let placed = 0;
    for (const opp of allOpps.slice(0, 10)) {
      if (opp.confidence < 50) continue;

      const domain = opp.domain;
      const isTvSignal = opp.reasoning.includes('Tradevisor');

      if (domain === 'option' || domain === 'macro' || isTvSignal) {
        // Options/Macro/TV → trade directly (already validated by engine-specific checks)
        const success = executePaperTrade(opp);
        if (success) placed++;
      } else {
        // Equities/Cross → Tradevisor watchlist for chart TA confirmation
        try {
          const { addToWatchlist } = await import('../ai/tradevisor-watchlist.js');
          addToWatchlist(opp.ticker, `stock_${opp.engine}`, 'stock');
        } catch {
          // Fallback: trade directly if watchlist unavailable
          const success = executePaperTrade(opp);
          if (success) placed++;
        }
      }
    }

    // Monitor existing positions (updates P&L from real Alpaca prices)
    await monitorPositions();
    persistStockState();

    lastScanAt = new Date().toISOString();
    lastScanDurationMs = Date.now() - start;

    const summary = [
      `E:${e1.length}+${e2.length}+${e3.length}+${e4.length}`,
      `O:${o1.length}+${o2.length}+${o3.length}+${o4.length}`,
      `M:${m1.length}+${m2.length}+${m3.length}+${m4.length}`,
      `X:${x1.length}+${x2.length}`,
    ].join(' ');

    logger.info(
      { cycle: scanCycles, opps: allOpps.length, placed, open: openPositions.length, regime: currentRegime, durationMs: lastScanDurationMs },
      `[StocksIntel] Cycle #${scanCycles} — ${allOpps.length} opps [${summary}] — ${placed} trades — ${currentRegime} — ${lastScanDurationMs}ms`,
    );
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, '[StocksIntel] Scan cycle failed');
    lastScanDurationMs = Date.now() - start;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export function startStockEngine(): void {
  if (scanInterval) return;
  loadStockState(); // Restore paper balances from disk
  logger.info({ mode: config.mode, interval: config.scanIntervalMs, paperCash }, '[StocksIntel] Starting 14-engine stock intelligence');
  scanInterval = setInterval(runScanCycle, config.scanIntervalMs);
  setTimeout(runScanCycle, 25_000); // First scan after 25s
}

export function stopStockEngine(): void {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
}

export function getStockPortfolio(): StockPaperPortfolio {
  const posValue = openPositions.reduce((s, p) => s + p.size + p.pnl, 0); // size + unrealized P&L
  const totalValue = paperCash + posValue;
  const derivedPnl = totalValue - config.startingCapital;
  const total = totalWins + totalLosses;

  // P&L by engine
  const byEngine: Record<string, { trades: number; pnl: number; winRate: number }> = {};
  for (const t of [...openPositions, ...closedPositions]) {
    const eng = t.opportunity.engine;
    if (!byEngine[eng]) byEngine[eng] = { trades: 0, pnl: 0, winRate: 0 };
    byEngine[eng].trades++;
    byEngine[eng].pnl += t.pnl;
  }

  // Detect stale prices: if all open positions have pnl=0 and size > 0, prices are likely stale
  const allPnlZero = openPositions.length > 0 && openPositions.every(p => p.pnl === 0 && p.size > 0);
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
  const hour = now.getUTCHours();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isAfterHours = dayOfWeek >= 1 && dayOfWeek <= 5 && (hour < 13 || hour >= 21); // outside ~9:30-4:00 ET in UTC

  let marketNote: string | undefined;
  if (allPnlZero && isWeekend) {
    marketNote = 'Weekend — P&L updates when markets open Monday';
  } else if (allPnlZero && isAfterHours) {
    marketNote = 'After hours — P&L updates at next market open';
  } else if (allPnlZero && openPositions.length > 0) {
    marketNote = 'Waiting for live price data from Alpaca';
  }

  return {
    startingCapital: config.startingCapital,
    cashUsd: Math.round(paperCash * 100) / 100,
    positionsValue: Math.round(posValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnlUsd: Math.round(derivedPnl * 100) / 100,
    totalTrades: totalTradesExecuted,
    wins: totalWins, losses: totalLosses,
    winRate: total > 0 ? Math.round((totalWins / total) * 100) : 0,
    openPositions: [...openPositions],
    recentTrades: closedPositions.slice(-20),
    byEngine,
    ...(marketNote ? { marketNote } : {}),
  };
}

export function getStockStatus(): StockEngineStatus {
  return {
    running: scanInterval !== null,
    mode: config.mode,
    scanCycles,
    lastScanAt,
    lastScanDurationMs,
    enginesActive: 14,
    opportunitiesFound: totalOppsFound,
    tradesExecuted: totalTradesExecuted,
    regime: currentRegime,
    config,
  };
}

export function getStockRegime() {
  return { regime: currentRegime, vix: currentVix };
}

// ── Arb Intelligence Integration ───────────────────────────────────────

interface ArbSignalInput {
  source: string;
  ticker: string;
  action: 'buy' | 'sell';
  confidence: number;
  reasoning: string;
}

const pendingArbSignals: StockOpportunity[] = [];

/**
 * Receives trading signals from the arb intelligence engine.
 * Called by the arb orchestrator when T9 detects ETF mispricing.
 */
export function injectArbSignal(signal: ArbSignalInput): void {
  const opp: StockOpportunity = {
    id: randomUUID(),
    engine: 'X1' as const, // Routes through prediction bridge logic
    domain: 'cross',
    ticker: signal.ticker,
    action: signal.action,
    price: 0, // Filled at execution from Alpaca
    suggestedSize: 0,
    maxSize: 3000,
    confidence: signal.confidence,
    reasoning: `[Arb Intel] ${signal.reasoning}`,
    detectedAt: new Date().toISOString(),
  };

  pendingArbSignals.push(opp);

  // Cap at 10 pending signals
  if (pendingArbSignals.length > 10) pendingArbSignals.shift();

  logger.info(
    { ticker: signal.ticker, action: signal.action, confidence: signal.confidence },
    `[StocksIntel] Received arb signal: ${signal.action.toUpperCase()} ${signal.ticker}`,
  );
}

export async function forceStockScan(): Promise<StockOpportunity[]> {
  await updateRegime();
  const [e1, e2, e3, e4] = await Promise.all([
    scanMeanReversion(currentRegime, currentVix).catch(() => []),
    scanMomentumRotation().catch(() => []),
    scanPairsTrading().catch(() => []),
    scanSwingTrades().catch(() => []),
  ]);
  return [...e1, ...e2, ...e3, ...e4].sort((a, b) => b.confidence - a.confidence) as StockOpportunity[];
}
