/**
 * Crypto Agent Routes — General Crypto Trading (All Blockchains)
 *
 * Wraps the cycle-service engine with a clean API for trading BTC, ETH, SOL,
 * AVAX, and all other crypto on Coinbase. Separate from the Solana meme sniper.
 *
 * GET  /api/v1/crypto/status     — Agent state + Coinbase connection
 * GET  /api/v1/crypto/positions  — Current holdings with live prices
 * GET  /api/v1/crypto/universe   — Tradeable pairs
 * PUT  /api/v1/crypto/universe   — Add/remove pairs
 * GET  /api/v1/crypto/signals    — Latest TA signals per asset
 * GET  /api/v1/crypto/prices     — Live prices for all tracked assets
 * POST /api/v1/crypto/start      — Start the engine
 * POST /api/v1/crypto/stop       — Stop it
 * GET  /api/v1/crypto/history    — Cycle history with decisions
 */

import { Router, type Router as RouterType } from 'express';
import {
  engineState,
  getCircuitBreakerStatus,
  startCycleLoop,
  stopCycleLoop,
  getCycleHistory,
  testCoinbaseAndUpdateState,
  setPaperTradeRecorder,
  getCycleInstruments,
  updateCycleInstruments,
} from '../services/cycle-service.js';
import {
  discoverNewCoins,
  getDiscoveredCoins,
  getDiscoveryStats,
  injectTradingViewDiscovery,
  getDiscoveredCoinbasePairs,
} from '../services/coin-discovery-service.js';
import { getMacroRegime } from '../services/ai/macro-regime.js';
import { logger } from '../lib/logger.js';

export const cryptoAgentRouter: RouterType = Router();

// ── Paper Capital Tracking ───────────────────────────────────────────────

const PAPER_STARTING_CAPITAL = 1000; // $1000 USD

interface PaperPortfolio {
  cashUsd: number;
  positions: Map<string, { symbol: string; qty: number; avgEntry: number; currentPrice: number }>;
  trades: Array<{ symbol: string; side: string; qty: number; price: number; pnlUsd: number; timestamp: string }>;
  totalPnlUsd: number;
  wins: number;
  losses: number;
}

const paperPortfolio: PaperPortfolio = {
  cashUsd: PAPER_STARTING_CAPITAL,
  positions: new Map(),
  trades: [],
  totalPnlUsd: 0,
  wins: 0,
  losses: 0,
};

// DEX Paper Portfolio Persistence
import { existsSync as dexExistsSync, readFileSync as dexReadFileSync, writeFileSync as dexWriteFileSync, mkdirSync as dexMkdirSync } from 'node:fs';
import { resolve as dexResolve, join as dexJoin } from 'node:path';
const DEX_DATA_DIR = dexResolve('data/dex');
try { dexMkdirSync(DEX_DATA_DIR, { recursive: true }); } catch { /* exists */ }

function persistDEXState(): void {
  try {
    dexWriteFileSync(dexJoin(DEX_DATA_DIR, 'paper-state.json'), JSON.stringify({
      cashUsd: paperPortfolio.cashUsd,
      positions: [...paperPortfolio.positions.entries()],
      trades: paperPortfolio.trades.slice(-100),
      totalPnlUsd: paperPortfolio.totalPnlUsd,
      wins: paperPortfolio.wins,
      losses: paperPortfolio.losses,
    }, null, 2));
  } catch { /* fire-and-forget */ }
}

function loadDEXState(): void {
  try {
    const file = dexJoin(DEX_DATA_DIR, 'paper-state.json');
    if (!dexExistsSync(file)) return;
    const raw = JSON.parse(dexReadFileSync(file, 'utf-8'));
    if (raw.cashUsd != null) paperPortfolio.cashUsd = raw.cashUsd;
    if (raw.totalPnlUsd != null) paperPortfolio.totalPnlUsd = raw.totalPnlUsd;
    if (raw.wins != null) paperPortfolio.wins = raw.wins;
    if (raw.losses != null) paperPortfolio.losses = raw.losses;
    if (Array.isArray(raw.positions)) {
      paperPortfolio.positions.clear();
      for (const [k, v] of raw.positions) paperPortfolio.positions.set(k, v);
    }
    if (Array.isArray(raw.trades)) paperPortfolio.trades = raw.trades;
    logger.info({ cash: paperPortfolio.cashUsd, positions: paperPortfolio.positions.size }, '[CryptoAgent] DEX state restored from disk');
  } catch { /* start fresh */ }
}

// Load on module init
loadDEXState();

// ── TradingView Signal Storage ───────────────────────────────────────────

export interface TradingViewSignal {
  symbol: string;
  action: string;
  price: number;
  confidence?: number;
  grade?: string;
  timeframe?: string;
  receivedAt: string;
}

const tradingViewSignals: TradingViewSignal[] = [];
const MAX_TV_SIGNALS = 100;

export function injectTradingViewSignal(signal: TradingViewSignal): void {
  tradingViewSignals.unshift(signal);
  if (tradingViewSignals.length > MAX_TV_SIGNALS) tradingViewSignals.pop();
  logger.info({ symbol: signal.symbol, action: signal.action, price: signal.price }, '[CryptoAgent] TradingView signal received');

  // Route blue chip signals (BTC, ETH, SOL, etc.) to CEX engine
  const cexCoins = new Set(['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOGE', 'ADA', 'DOT', 'NEAR', 'SUI', 'XRP', 'MATIC', 'ATOM', 'UNI', 'AAVE', 'LTC', 'ARB', 'OP', 'SHIB', 'FIL']);
  if (cexCoins.has(signal.symbol.toUpperCase()) && (signal.action === 'buy' || signal.action === 'sell')) {
    const execPrice = signal.price > 0 ? signal.price : (cexPriceCache.get(signal.symbol.toUpperCase())?.price ?? 0);
    if (execPrice > 0) {
      executeCEXTradeFromTV(signal.symbol.toUpperCase(), signal.action, execPrice, `TradingView ${signal.action} signal`);
    }
  }

  // Also inject into discovery service — any TradingView signal adds the coin to universe
  if (signal.action === 'buy' && signal.price > 0) {
    injectTradingViewDiscovery(signal.symbol, signal.price);
  }
}

// ── APEX Regime Cache ────────────────────────────────────────────────────

let regimeCache: { regime: string; multiplier: number; cachedAt: number } = { regime: 'unknown', multiplier: 1, cachedAt: 0 };

async function getRegime(): Promise<{ regime: string; multiplier: number }> {
  // Paper mode: override regime to "paper-active" with full multiplier
  // so the dashboard doesn't show "crisis" and scare the user.
  // Paper trading should measure bot performance regardless of macro conditions.
  const isPaperMode = paperPortfolio.cashUsd >= 0; // always true for paper
  if (isPaperMode) {
    return { regime: 'paper-active', multiplier: 1.0 };
  }

  if (Date.now() - regimeCache.cachedAt < 300_000) return regimeCache;
  try {
    const r = await getMacroRegime();
    regimeCache = { regime: r.regime, multiplier: r.positionSizeMultiplier, cachedAt: Date.now() };
  } catch { /* keep stale */ }
  return regimeCache;
}

// ── Trading Universe ─────────────────────────────────────────────────────
// NO DEFAULT BLUE CHIPS — user holds those in personal wallets
// Only agent-discovered coins enter the universe via Tradevisor watchlist

// Blue chips to NEVER trade (user's long-term holds)
const BLOCKED_COINS = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'LINK', 'AVAX',
  'MATIC', 'ATOM', 'UNI', 'AAVE', 'LTC', 'BCH', 'FIL',
  'NEAR', 'SUI', 'ARB', 'OP', 'DOGE',
]);

const DEFAULT_UNIVERSE: string[] = []; // EMPTY — only discovered coins trade

let tradingUniverse = [...DEFAULT_UNIVERSE];

// ── Live Price Cache ─────────────────────────────────────────────────────

interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
}

let priceCache: PriceData[] = [];
let priceCacheAt = 0;

async function fetchCryptoPrices(): Promise<PriceData[]> {
  if (Date.now() - priceCacheAt < 60_000 && priceCache.length > 0) return priceCache;

  const freshPrices: PriceData[] = [];

  const symbolMap: Record<string, string> = {
    // Blue chips
    bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', 'avalanche-2': 'AVAX',
    chainlink: 'LINK', dogecoin: 'DOGE', cardano: 'ADA', polkadot: 'DOT',
    near: 'NEAR', sui: 'SUI', ripple: 'XRP', 'matic-network': 'MATIC',
    cosmos: 'ATOM', uniswap: 'UNI', aave: 'AAVE', litecoin: 'LTC',
    'bitcoin-cash': 'BCH', filecoin: 'FIL', arbitrum: 'ARB', optimism: 'OP',
    // Additional CEX-traded tickers the cycle-service touches. Without these,
    // the position monitor falls through to DexScreener ticker search which
    // returns scam Solana tokens sharing the ticker and poisons the ledger
    // with nano-dollar "current" prices (e.g., SHIB at $3e-9 instead of $1e-5).
    'shiba-inu': 'SHIB', 'pepe': 'PEPE', 'dogwifcoin': 'WIF', 'bonk': 'BONK',
    'jasmycoin': 'JASMY', 'chiliz': 'CHZ', 'bittensor': 'TAO',
    'render-token': 'RENDER', 'fetch-ai': 'FET', 'lido-dao': 'LDO',
    'celestia': 'TIA', 'sei-network': 'SEI', 'aptos': 'APT',
    'injective-protocol': 'INJ', 'maker': 'MKR',
  };

  // Fetch in 3 batches to avoid CoinGecko rate limits (was 2 batches of 10;
  // we now have 35 IDs and CoinGecko's free tier limits are tight).
  const allIds = Object.keys(symbolMap);
  const chunkSize = 12;
  const batches: string[] = [];
  for (let i = 0; i < allIds.length; i += chunkSize) {
    batches.push(allIds.slice(i, i + chunkSize).join(','));
  }

  try {
    for (let bi = 0; bi < batches.length; bi++) {
      const ids = batches[bi];
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) continue;

      const data = await res.json() as Record<string, { usd: number; usd_24h_change?: number }>;
      for (const [id, info] of Object.entries(data)) {
        const symbol = symbolMap[id] ?? id.toUpperCase();
        freshPrices.push({
          symbol,
          price: info.usd,
          change24h: info.usd_24h_change ?? 0,
          volume24h: 0,
          marketCap: 0,
        });
      }

      // Small delay between batches
      if (bi < batches.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    // Sort by price descending (rough proxy for market cap)
    freshPrices.sort((a, b) => b.price - a.price);
    priceCache = freshPrices;
    priceCacheAt = Date.now();
  } catch (err) {
    logger.warn({ err }, '[CryptoAgent] Price fetch failed');
  }

  return priceCache;
}

// ── Routes ───────────────────────────────────────────────────────────────

// GET /status — Full agent status with paper portfolio, regime, TradingView
cryptoAgentRouter.get('/status', async (_req, res) => {
  const cb = getCircuitBreakerStatus();
  const prices = await fetchCryptoPrices();
  const regime = await getRegime();

  // Calculate paper portfolio value
  let positionsValue = 0;
  const priceMap = new Map(prices.map(p => [p.symbol, p.price]));
  for (const [, pos] of paperPortfolio.positions) {
    const price = priceMap.get(pos.symbol) ?? pos.currentPrice;
    pos.currentPrice = price;
    positionsValue += pos.qty * price;
  }
  const totalValue = paperPortfolio.cashUsd + positionsValue;
  const paperPnl = totalValue - PAPER_STARTING_CAPITAL;

  res.json({
    data: {
      running: engineState.status === 'running',
      paperMode: engineState.config.paperMode,
      startedAt: engineState.startedAt,
      cycleIntervalMs: engineState.config.cycleIntervalMs,
      coinbaseConnected: engineState.coinbaseConnected,
      coinbaseAccounts: engineState.coinbaseAccounts,
      circuitBreaker: { tripped: cb.tripped, reason: cb.reason },
      universe: tradingUniverse.length,
      totalCycles: engineState.cycleCount,
      lastCycleAt: engineState.lastCycleAt,
      priceCount: prices.length,
      // Paper portfolio
      paperCapital: PAPER_STARTING_CAPITAL,
      paperCashUsd: Math.round(paperPortfolio.cashUsd * 100) / 100,
      paperPositionsValue: Math.round(positionsValue * 100) / 100,
      paperTotalValue: Math.round(totalValue * 100) / 100,
      paperPnlUsd: Math.round(paperPnl * 100) / 100,
      paperTrades: paperPortfolio.trades.length,
      paperWins: paperPortfolio.wins,
      paperLosses: paperPortfolio.losses,
      paperWinRate: paperPortfolio.trades.length > 0 ? Math.round((paperPortfolio.wins / paperPortfolio.trades.length) * 100) : 0,
      // Intelligence
      regime: regime.regime,
      regimeMultiplier: regime.multiplier,
      tradingViewSignals: tradingViewSignals.slice(0, 10),
      tradingViewConnected: tradingViewSignals.length > 0,
    },
  });
});

// GET /positions — Coinbase holdings with live prices
cryptoAgentRouter.get('/positions', async (_req, res) => {
  const prices = await fetchCryptoPrices();
  const priceMap = new Map(prices.map(p => [p.symbol, p]));

  // Get Coinbase accounts if connected
  let positions: Array<{
    symbol: string;
    balance: number;
    price: number;
    value: number;
    change24h: number;
  }> = [];

  // Show tracked assets with current prices (positions come from Coinbase balances API)
  // For now, show the universe with live prices
  for (const pair of tradingUniverse) {
    const symbol = pair.replace('-USD', '');
    const priceData = priceMap.get(symbol);
    if (priceData) {
      positions.push({
        symbol,
        balance: 0, // Will be populated from Coinbase balance API when connected
        price: priceData.price,
        value: 0,
        change24h: priceData.change24h,
      });
    }
  }
  positions.sort((a, b) => b.price - a.price);

  res.json({ data: positions, count: positions.length });
});

// GET /universe — Current trading pairs
cryptoAgentRouter.get('/universe', (_req, res) => {
  res.json({ data: tradingUniverse, count: tradingUniverse.length });
});

// PUT /universe — Update trading pairs
cryptoAgentRouter.put('/universe', (req, res) => {
  const { pairs } = req.body as { pairs?: string[] };
  if (!pairs || !Array.isArray(pairs)) {
    res.status(400).json({ error: 'pairs array required' });
    return;
  }
  tradingUniverse = pairs.map(p => p.toUpperCase().includes('-USD') ? p.toUpperCase() : `${p.toUpperCase()}-USD`);
  res.json({ data: tradingUniverse, count: tradingUniverse.length });
});

// GET /prices — Live prices for all tracked assets
cryptoAgentRouter.get('/prices', async (_req, res) => {
  const prices = await fetchCryptoPrices();
  res.json({ data: prices, count: prices.length, cachedAt: new Date(priceCacheAt).toISOString() });
});

// GET /signals — Latest signals per instrument (from cycle engine)
cryptoAgentRouter.get('/signals', (_req, res) => {
  const history = getCycleHistory(1);
  const lastCycle = history.data?.[0];

  if (!lastCycle) {
    res.json({ data: [], message: 'No cycle data yet — start the engine' });
    return;
  }

  res.json({
    data: {
      cycleNumber: lastCycle.cycleNumber,
      timestamp: lastCycle.timestamp,
      status: lastCycle.status,
      summary: lastCycle.summary,
      agents: lastCycle.agents,
      decisions: lastCycle.decisions,
      riskAssessment: lastCycle.riskAssessment,
    },
  });
});

// POST /start — Start crypto engine
cryptoAgentRouter.post('/start', (_req, res) => {
  if (engineState.status === 'running') {
    res.json({ message: 'Crypto agent already running', running: true });
    return;
  }
  engineState.status = 'running';
  engineState.startedAt = new Date().toISOString();
  startCycleLoop();
  res.json({ message: 'Crypto agent started', running: true, paperMode: engineState.config.paperMode });
});

// POST /stop — Stop crypto engine
cryptoAgentRouter.post('/stop', (_req, res) => {
  if (engineState.status === 'stopped') {
    res.json({ message: 'Crypto agent already stopped', running: false });
    return;
  }
  engineState.status = 'stopped';
  engineState.startedAt = null;
  stopCycleLoop();
  res.json({ message: 'Crypto agent stopped', running: false });
});

// GET /history — Cycle history
cryptoAgentRouter.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
  res.json(getCycleHistory(limit));
});

// POST /test-connection — Test Coinbase connection
cryptoAgentRouter.post('/test-connection', async (_req, res) => {
  const result = await testCoinbaseAndUpdateState();
  res.json({ data: result });
});

// ── Paper Portfolio Endpoints ────────────────────────────────────────────

// GET /paper — Full paper portfolio report
cryptoAgentRouter.get('/paper', async (_req, res) => {
  const prices = await fetchCryptoPrices();
  const priceMap = new Map(prices.map(p => [p.symbol, p.price]));
  const regime = await getRegime();

  let positionsValue = 0;
  const openPositions = [];
  for (const [symbol, pos] of paperPortfolio.positions) {
    const price = priceMap.get(symbol) ?? pos.currentPrice;
    pos.currentPrice = price;
    const value = pos.qty * price;
    const pnl = (price - pos.avgEntry) * pos.qty;
    const pnlPct = pos.avgEntry > 0 ? ((price - pos.avgEntry) / pos.avgEntry) * 100 : 0;
    positionsValue += value;
    openPositions.push({ symbol, qty: pos.qty, avgEntry: pos.avgEntry, currentPrice: price, value, pnlUsd: pnl, pnlPct });
  }

  const totalValue = paperPortfolio.cashUsd + positionsValue;
  const totalPnl = totalValue - PAPER_STARTING_CAPITAL;

  res.json({
    data: {
      startingCapital: PAPER_STARTING_CAPITAL,
      cashUsd: Math.round(paperPortfolio.cashUsd * 100) / 100,
      positionsValue: Math.round(positionsValue * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      totalPnlUsd: Math.round(totalPnl * 100) / 100,
      totalPnlPct: Math.round((totalPnl / PAPER_STARTING_CAPITAL) * 10000) / 100,
      trades: paperPortfolio.trades.length,
      wins: paperPortfolio.wins,
      losses: paperPortfolio.losses,
      winRate: paperPortfolio.trades.length > 0 ? Math.round((paperPortfolio.wins / paperPortfolio.trades.length) * 100) : 0,
      openPositions,
      recentTrades: paperPortfolio.trades.slice(0, 20),
      regime: regime.regime,
      regimeMultiplier: regime.multiplier,
      tradingViewSignalCount: tradingViewSignals.length,
      derivedPnlMatch: Math.abs(totalPnl - paperPortfolio.totalPnlUsd) < 1.0,
    },
  });
});

// POST /paper/reset — Reset paper portfolio to starting capital
cryptoAgentRouter.post('/paper/reset', (req, res) => {
  const capital = parseFloat(req.body?.capital ?? PAPER_STARTING_CAPITAL);
  paperPortfolio.cashUsd = capital;
  paperPortfolio.positions.clear();
  paperPortfolio.trades = [];
  paperPortfolio.totalPnlUsd = 0;
  paperPortfolio.wins = 0;
  paperPortfolio.losses = 0;
  res.json({ message: `Paper portfolio reset to $${capital}`, cashUsd: capital });
});

// GET /paper/verify — Verify P&L accuracy
cryptoAgentRouter.get('/paper/verify', async (_req, res) => {
  const prices = await fetchCryptoPrices();
  const priceMap = new Map(prices.map(p => [p.symbol, p.price]));

  let positionsValue = 0;
  for (const [, pos] of paperPortfolio.positions) {
    pos.currentPrice = priceMap.get(pos.symbol) ?? pos.currentPrice;
    positionsValue += pos.qty * pos.currentPrice;
  }

  const totalValue = paperPortfolio.cashUsd + positionsValue;
  const derivedPnl = totalValue - PAPER_STARTING_CAPITAL;
  const reportedPnl = paperPortfolio.totalPnlUsd;
  const match = Math.abs(derivedPnl - reportedPnl) < 1.0;

  res.json({
    data: {
      startingCapital: PAPER_STARTING_CAPITAL,
      currentCash: paperPortfolio.cashUsd,
      positionsValue,
      totalValue,
      derivedPnl: Math.round(derivedPnl * 100) / 100,
      reportedPnl: Math.round(reportedPnl * 100) / 100,
      match,
      verdict: match ? 'P&L ACCURATE' : 'P&L MISMATCH — investigate',
    },
  });
});

// GET /tradingview-signals — Recent TradingView signals
cryptoAgentRouter.get('/tradingview-signals', (_req, res) => {
  res.json({ data: tradingViewSignals, count: tradingViewSignals.length });
});

// ── Paper Trade Recorder (wired to cycle engine) ─────────────────────────

// Defense-in-depth dedup: cycle-service dispatches trades directly through
// this recorder (bypassing executeSignalTrade), so the 1s idempotency map
// there doesn't catch ms-level duplicates. Guard at recordPaperTrade level
// instead — catches ALL callers (cycle-service, executeSignalTrade, position
// monitor, webhooks, etc.).
const recentRecords = new Map<string, number>();
const RECORD_DEDUP_MS = 500;

function recordPaperTrade(exec: { instrument: string; side: string; quantity: number; price: number }): void {
  const symbol = exec.instrument.replace('-USD', '');

  // Guard 1: reject qty=0 / dust (positionSizeUsd / $75k BTC rounds to 0)
  if (!Number.isFinite(exec.quantity) || exec.quantity <= 0) {
    logger.info({ symbol, side: exec.side, qty: exec.quantity, price: exec.price }, '[CryptoAgent] Recorder: qty=0 or invalid — skip');
    return;
  }
  const notional = exec.quantity * exec.price;
  if (notional < 1) {
    logger.info({ symbol, side: exec.side, qty: exec.quantity, price: exec.price, notional }, '[CryptoAgent] Recorder: notional <$1 — skip dust');
    return;
  }

  // Guard 2: dedup at ms-level — same symbol+side+price within 500ms = duplicate dispatch
  const dedupKey = `${symbol}|${exec.side}|${exec.quantity.toFixed(6)}|${exec.price.toFixed(6)}`;
  const lastTs = recentRecords.get(dedupKey);
  const now = Date.now();
  if (lastTs && now - lastTs < RECORD_DEDUP_MS) {
    logger.info({ symbol, side: exec.side, qty: exec.quantity, price: exec.price }, '[CryptoAgent] Recorder: duplicate dispatch within 500ms — skip');
    return;
  }
  recentRecords.set(dedupKey, now);
  if (recentRecords.size > 1000) {
    for (const [k, ts] of recentRecords) if (now - ts > 5_000) recentRecords.delete(k);
  }

  // BLOCK blue-chip coins in LIVE mode — user holds these in personal wallets
  // Paper mode skips this check since no real trades are executed
  if (!engineState.config.paperMode && exec.side === 'buy' && BLOCKED_COINS.has(symbol.toUpperCase())) {
    logger.info({ symbol }, `[CryptoAgent] BLOCKED BUY ${symbol} — user holds in personal wallet (live mode)`);
    return;
  }

  if (exec.side === 'buy') {
    const cost = exec.quantity * exec.price;
    if (paperPortfolio.cashUsd < cost) return; // Not enough paper cash

    const existing = paperPortfolio.positions.get(symbol);
    if (existing) {
      // Average into existing position
      const totalQty = existing.qty + exec.quantity;
      existing.avgEntry = ((existing.avgEntry * existing.qty) + (exec.price * exec.quantity)) / totalQty;
      existing.qty = totalQty;
      existing.currentPrice = exec.price;
    } else {
      paperPortfolio.positions.set(symbol, {
        symbol, qty: exec.quantity, avgEntry: exec.price, currentPrice: exec.price,
      });
    }
    paperPortfolio.cashUsd -= cost;
    paperPortfolio.trades.push({
      symbol, side: 'buy', qty: exec.quantity, price: exec.price, pnlUsd: 0,
      timestamp: new Date().toISOString(),
    });
    logger.info({ symbol, qty: exec.quantity, price: exec.price, cash: paperPortfolio.cashUsd.toFixed(2) },
      `[CryptoAgent] PAPER BUY ${symbol} x${exec.quantity} @ $${exec.price}`);

  } else if (exec.side === 'sell') {
    const pos = paperPortfolio.positions.get(symbol);
    if (!pos) return; // No position to sell

    const rawPnl = (exec.price - pos.avgEntry) * Math.min(exec.quantity, pos.qty);
    // Cap P&L per trade at 10x the position cost (no memecoin returns 10000%+ realistically)
    const positionCost = pos.avgEntry * pos.qty;
    const maxPnl = positionCost * 10; // Max 1000% gain
    const pnl = Math.max(-positionCost, Math.min(rawPnl, maxPnl));
    paperPortfolio.totalPnlUsd += pnl;
    paperPortfolio.cashUsd += Math.min(exec.quantity * exec.price, positionCost + maxPnl);

    if (pnl > 0) paperPortfolio.wins++;
    else paperPortfolio.losses++;

    paperPortfolio.trades.push({
      symbol, side: 'sell', qty: exec.quantity, price: exec.price, pnlUsd: pnl,
      timestamp: new Date().toISOString(),
    });

    // Remove or reduce position
    if (exec.quantity >= pos.qty) {
      paperPortfolio.positions.delete(symbol);
    } else {
      pos.qty -= exec.quantity;
    }

    logger.info({ symbol, pnl: pnl.toFixed(2), cash: paperPortfolio.cashUsd.toFixed(2) },
      `[CryptoAgent] PAPER SELL ${symbol} P&L: $${pnl.toFixed(2)}`);
  }

  // Persist after every trade
  persistDEXState();
}

// Wire the recorder to the cycle engine (legacy — cycle engine still handles blue chips)
setPaperTradeRecorder(recordPaperTrade);

// ══════════════════════════════════════════════════════════════════════════
// SIGNAL-DRIVEN TRADE ENGINE — The New Core
// ANY intelligence source can trigger a trade by calling executeSignalTrade()
// Sources: APEX agents, Twitter, TradingView, DexScreener, Manual contract input
// ══════════════════════════════════════════════════════════════════════════

export interface TradeSignal {
  symbol: string;
  action: 'buy' | 'sell';
  price: number;
  source: string;          // 'apex_scout' | 'twitter' | 'tradingview' | 'dexscreener' | 'moonshot_hunter' | 'manual'
  confidence: number;      // 0-100
  reason: string;
  contractAddress?: string;
  chain?: string;          // 'coinbase' | 'solana' | 'ethereum'
}

const signalTradeLog: Array<TradeSignal & { executedAt: string; success: boolean }> = [];
const MAX_SIGNAL_LOG = 200;

/**
 * SINGLE ENTRY POINT for all signal-driven trades.
 * When APEX, Twitter, TradingView, DexScreener, or manual input flags a coin → this executes.
 */
// Cooldown map: prevent the same symbol from triggering repeatedly (1-hour cooldown)
const signalCooldown = new Map<string, number>();
const SIGNAL_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes (was 1 hour — too slow for memecoins)

// Idempotency dedup: reject the same signal identity fired within 1s. Catches
// parallel dispatches from TradingView webhook + APEX + cycle-service + manual
// routes — the 15-min cooldown below is set AFTER gates pass, so race windows
// let concurrent callers slip through before the mark lands. This closes that.
const recentSignals = new Map<string, number>();
const DEDUP_WINDOW_MS = 1_000;

function isDuplicateDispatch(symbol: string, action: string, source: string, price: number): boolean {
  const key = `${symbol}|${action}|${source}|${price.toFixed(4)}`;
  const last = recentSignals.get(key);
  const now = Date.now();
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentSignals.set(key, now);
  // Prune entries older than 5s so the map doesn't grow unbounded
  if (recentSignals.size > 500) {
    for (const [k, ts] of recentSignals) if (now - ts > 5_000) recentSignals.delete(k);
  }
  return false;
}

// Qty viability: reject no-op and dust trades that would pollute the ledger.
const MIN_NOTIONAL_USD = 1;

function isViableQty(qty: number, price: number, symbol: string, side: string): boolean {
  if (!Number.isFinite(qty) || qty <= 0) {
    logger.info({ symbol, side, qty, price }, '[CryptoAgent] Qty rounded to 0 — skip no-op trade');
    return false;
  }
  if (qty * price < MIN_NOTIONAL_USD) {
    logger.info({ symbol, side, qty, price, notional: qty * price }, '[CryptoAgent] Notional below $1 — skip dust trade');
    return false;
  }
  return true;
}

export async function executeSignalTrade(signal: TradeSignal): Promise<boolean> {
  // Validate
  if (!signal.symbol || !signal.price || signal.price <= 0) {
    logger.warn({ signal }, '[CryptoAgent] Signal rejected — missing symbol or price');
    return false;
  }

  // BLOCK blue-chip coins in LIVE mode — user holds these in personal wallets
  // Paper mode skips this check since no real trades are executed
  const cleanSymbol = signal.symbol.toUpperCase().replace('-USD', '').replace('USDT', '');
  if (!engineState.config.paperMode && BLOCKED_COINS.has(cleanSymbol) && signal.action === 'buy') {
    return false;
  }

  // DEDUP: Idempotency — reject same signal identity within 1s (parallel dispatchers)
  if (isDuplicateDispatch(cleanSymbol, signal.action, signal.source, signal.price)) {
    logger.info({ symbol: cleanSymbol, action: signal.action, source: signal.source }, '[CryptoAgent] Dedup — same signal within 1s, skipped');
    return false;
  }

  // PRICE SANITY: reject signals whose price diverges >5x from the cached
  // CoinGecko price for this symbol. Catches cross-contamination bugs (e.g.,
  // an arb signal passing NAV-per-ETF-share $19 as the "ETH spot price" when
  // real ETH is $2,300). Applies to known CEX-tradeable symbols only.
  const cached = priceCache.find(p => p.symbol === cleanSymbol);
  if (cached && cached.price > 0 && signal.price > 0) {
    const ratio = Math.max(signal.price / cached.price, cached.price / signal.price);
    if (ratio > 5) {
      logger.warn(
        { symbol: cleanSymbol, signalPrice: signal.price, cachedPrice: cached.price, ratio: ratio.toFixed(1), source: signal.source },
        '[CryptoAgent] Price sanity reject — signal price >5x divergent from CoinGecko cache',
      );
      return false;
    }
  }

  // DEDUP: Check cooldown — don't re-trade the same symbol within 1 hour
  const cooldownKey = `${cleanSymbol}_${signal.action}`;
  const lastTraded = signalCooldown.get(cooldownKey);
  if (lastTraded && Date.now() - lastTraded < SIGNAL_COOLDOWN_MS) {
    return false; // Silently skip — already traded recently
  }

  if (signal.confidence < 30) {
    logger.info({ symbol: signal.symbol, conf: signal.confidence, source: signal.source }, '[CryptoAgent] Signal below 30% confidence — skipped');
    return false;
  }

  // Position size: $15-50 based on confidence
  const baseSize = 15 + (signal.confidence / 100) * 35; // $15 at 30% conf, $50 at 100%
  const positionSizeUsd = Math.round(baseSize / 5) * 5; // Round to $5

  if (signal.action === 'buy') {
    if (paperPortfolio.cashUsd < positionSizeUsd) {
      logger.warn({ cash: paperPortfolio.cashUsd, needed: positionSizeUsd }, '[CryptoAgent] Insufficient cash for signal trade');
      return false;
    }

    // Don't buy if we already hold this coin
    if (paperPortfolio.positions.has(cleanSymbol)) {
      logger.info({ symbol: cleanSymbol }, '[CryptoAgent] Already holding — skip duplicate buy');
      return false;
    }

    // Max 15 open positions
    if (paperPortfolio.positions.size >= 15) {
      logger.info({ open: paperPortfolio.positions.size }, '[CryptoAgent] Max positions (15) — skip');
      return false;
    }

    // ── CHAIN-AWARE EXECUTION ──
    // Signals carry an explicit `chain` hint. TradeVisor majors → 'coinbase' (CEX).
    // Pump.fun / moonshot / whale copy → 'solana'. Twitter / manual may omit chain
    // and require a DexScreener lookup with sanity guards against ghost pairs.
    let chain = signal.chain ?? (signal.contractAddress && signal.contractAddress.length >= 32 ? 'solana' : 'coinbase');
    let contractAddress = signal.contractAddress;

    // TradeVisor / CEX-bound signals: skip DexScreener entirely.
    // AAVE/TIA/SEI/WIF/etc. live on Coinbase — do NOT resolve to Solana ghost mints.
    const isCexBound = chain === 'coinbase' || signal.source.startsWith('tradevisor_');

    if (!isCexBound && chain !== 'solana' && !contractAddress) {
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${cleanSymbol}`, { signal: AbortSignal.timeout(5_000) });
        if (dexRes.ok) {
          const dexData = await dexRes.json() as { pairs?: Array<{ chainId: string; baseToken: { symbol: string; address: string }; liquidity?: { usd: number }; volume?: { h24?: number }; marketCap?: number }> };
          // Liquidity/volume sanity guard: reject ghost pairs with fake liquidity metrics.
          // Spoofed pairs commonly show liquidity > marketCap and h24 volume under $10k.
          const isLegitPair = (p: { liquidity?: { usd: number }; volume?: { h24?: number }; marketCap?: number }) => {
            const liq = p.liquidity?.usd ?? 0;
            const vol24 = p.volume?.h24 ?? 0;
            const mcap = p.marketCap ?? 0;
            if (vol24 < 10_000) return false;
            if (mcap > 0 && liq > mcap) return false; // liquidity shouldn't exceed full market cap
            return true;
          };
          const matchingPairs = (dexData.pairs ?? [])
            .filter(p => p.baseToken.symbol.toUpperCase() === cleanSymbol)
            .filter(isLegitPair)
            .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

          // Try Solana first (cheapest gas)
          const solanaPair = matchingPairs.find(p => p.chainId === 'solana');
          if (solanaPair) {
            chain = 'solana';
            contractAddress = solanaPair.baseToken.address;
            logger.info({ symbol: cleanSymbol, mint: contractAddress.slice(0, 8), liq: solanaPair.liquidity?.usd, vol24: solanaPair.volume?.h24 }, `[CryptoAgent] Found Solana pair for ${cleanSymbol}`);
          } else {
            // Try EVM chains (ethereum, base, bsc, polygon, arbitrum)
            const evmChainMap: Record<string, string> = { ethereum: 'ethereum', base: 'base', bsc: 'bsc', polygon: 'polygon', arbitrum: 'arbitrum' };
            const evmPair = matchingPairs.find(p => evmChainMap[p.chainId]);
            if (evmPair) {
              chain = evmChainMap[evmPair.chainId];
              contractAddress = evmPair.baseToken.address;
              logger.info({ symbol: cleanSymbol, chain, addr: contractAddress.slice(0, 10), liq: evmPair.liquidity?.usd, vol24: evmPair.volume?.h24 }, `[CryptoAgent] Found EVM pair for ${cleanSymbol} on ${chain}`);
            } else {
              logger.info({ symbol: cleanSymbol, candidates: (dexData.pairs ?? []).length }, `[CryptoAgent] No legit DEX pair for ${cleanSymbol} — falling back to CEX`);
            }
          }
        }
      } catch { /* DexScreener unavailable, fall through to CEX paper trade */ }
    }

    if (chain === 'solana' && contractAddress) {
      // Route 1: Solana → Jupiter execution
      void (async () => {
        try {
          const { executeBuySnipe } = await import('./solana-sniper/execution.js');
          await executeBuySnipe({
            mint: contractAddress!,
            symbol: cleanSymbol,
            name: signal.reason.slice(0, 50),
            trigger: 'trending',
            priceUsd: signal.price > 0 ? signal.price : undefined,
            templateId: 'copy-trade',
          });
          logger.info({ symbol: cleanSymbol, chain: 'solana', mint: contractAddress!.slice(0, 8) },
            `[CryptoAgent] SOLANA DEX BUY via Jupiter: ${cleanSymbol}`);
          // Also record in crypto agent's paper portfolio so dashboard reflects the trade
          const qty = positionSizeUsd / Math.max(signal.price, 0.000001);
          if (isViableQty(qty, signal.price, cleanSymbol, 'buy')) {
            recordPaperTrade({ instrument: `${cleanSymbol}-USD`, side: 'buy', quantity: qty, price: signal.price });
          }
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err }, '[CryptoAgent] Jupiter execution failed, falling back to paper trade');
          const qty = positionSizeUsd / Math.max(signal.price, 0.000001);
          if (isViableQty(qty, signal.price, cleanSymbol, 'buy')) {
            recordPaperTrade({ instrument: `${cleanSymbol}-USD`, side: 'buy', quantity: qty, price: signal.price });
          }
        }
      })();
    } else if (['ethereum', 'base', 'bsc', 'polygon', 'arbitrum'].includes(chain) && contractAddress) {
      // Route 2: EVM → SafePal wallet via Uniswap/PancakeSwap (paper mode for now)
      void (async () => {
        try {
          const { executeEVMSwap } = await import('../services/evm-execution-service.js');
          const trade = await executeEVMSwap({
            symbol: cleanSymbol,
            tokenAddress: contractAddress!,
            chain,
            action: 'buy',
            amountUsd: positionSizeUsd,
            priceUsd: signal.price,
            paperMode: true, // Paper mode until explicitly enabled for live
          });
          if (trade) {
            logger.info({ symbol: cleanSymbol, chain, status: trade.status },
              `[CryptoAgent] EVM DEX BUY: ${cleanSymbol} $${positionSizeUsd} on ${chain}`);
          }
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err }, '[CryptoAgent] EVM execution failed, falling back to paper trade');
        }
        // Always record paper trade for portfolio tracking
        const qty = positionSizeUsd / Math.max(signal.price, 0.000001);
        if (isViableQty(qty, signal.price, cleanSymbol, 'buy')) {
          recordPaperTrade({ instrument: `${cleanSymbol}-USD`, side: 'buy', quantity: qty, price: signal.price });
        }
      })();
    } else {
      // Route 3: Coinbase paper trade (fallback for unknown chains)
      const qty = positionSizeUsd / Math.max(signal.price, 0.000001);
      if (!isViableQty(qty, signal.price, cleanSymbol, 'buy')) return false;
      recordPaperTrade({
        instrument: `${cleanSymbol}-USD`,
        side: 'buy',
        quantity: qty,
        price: signal.price,
      });
    }

    logger.info(
      { symbol: cleanSymbol, source: signal.source, size: positionSizeUsd, conf: signal.confidence, chain },
      `[CryptoAgent] 🚀 SIGNAL BUY: ${cleanSymbol} $${positionSizeUsd} from ${signal.source} (conf:${signal.confidence}%, chain:${chain})`,
    );
  } else {
    // Sell: close position if we hold it
    const pos = paperPortfolio.positions.get(signal.symbol);
    if (!pos) return false;

    recordPaperTrade({
      instrument: `${signal.symbol}-USD`,
      side: 'sell',
      quantity: pos.qty,
      price: signal.price,
    });

    logger.info(
      { symbol: signal.symbol, source: signal.source },
      `[CryptoAgent] 📉 SIGNAL SELL: ${signal.symbol} from ${signal.source}`,
    );
  }

  // Log the signal trade
  // Set cooldown to prevent re-triggering for 1 hour
  signalCooldown.set(`${cleanSymbol}_${signal.action}`, Date.now());
  signalTradeLog.push({ ...signal, executedAt: new Date().toISOString(), success: true });
  if (signalTradeLog.length > MAX_SIGNAL_LOG) signalTradeLog.shift();

  return true;
}

/** Get signal trade history */
export function getSignalTradeLog() {
  return signalTradeLog.slice(-50);
}

// ── Manual Contract Trade Endpoint ──────────────────────────────────────
// POST /trade-signal — Manually submit a trade signal (or from any external source)

cryptoAgentRouter.post('/trade-signal', async (req, res) => {
  const { symbol, action, price, source, confidence, reason, contractAddress } = req.body as {
    symbol?: string; action?: string; price?: number; source?: string;
    confidence?: number; reason?: string; contractAddress?: string;
  };

  if (!symbol || !action) {
    res.status(400).json({ error: 'symbol and action required' });
    return;
  }

  // If contract address provided, verify it first
  if (contractAddress) {
    try {
      const { verifyContract } = await import('../services/contract-verifier.js');
      const verification = await verifyContract(contractAddress);
      if (verification.status === 'SCAM') {
        res.status(400).json({ error: `Contract REJECTED: ${verification.reasons.join(', ')}`, verification });
        return;
      }
      // Use DexScreener price if not provided
      if (!price && verification.dexData?.priceUsd) {
        (req.body as Record<string, unknown>).price = verification.dexData.priceUsd;
      }
    } catch { /* verifier not available */ }
  }

  // Get price from CoinGecko if not provided
  let tradePrice = price ?? 0;
  if (tradePrice <= 0) {
    const prices = await fetchCryptoPrices();
    const found = prices.find(p => p.symbol === symbol.toUpperCase());
    if (found) tradePrice = found.price;
  }

  if (tradePrice <= 0) {
    res.status(400).json({ error: `Cannot determine price for ${symbol}` });
    return;
  }

  const signal: TradeSignal = {
    symbol: symbol.toUpperCase().replace('-USD', ''),
    action: action as 'buy' | 'sell',
    price: tradePrice,
    source: source ?? 'manual',
    confidence: confidence ?? 70,
    reason: reason ?? `Manual ${action} signal`,
    contractAddress,
  };

  const success = executeSignalTrade(signal);
  res.json({ success, signal, portfolio: { cash: paperPortfolio.cashUsd, positions: paperPortfolio.positions.size } });
});

// GET /signal-log — Recent signal trades
cryptoAgentRouter.get('/signal-log', (_req, res) => {
  res.json({ data: getSignalTradeLog(), count: signalTradeLog.length });
});

// ── Position Monitor (generates sells) ───────────────────────────────────
// Checks open positions every 60 seconds and sells when TP/SL hit

setInterval(async () => {
  if (paperPortfolio.positions.size === 0) return;

  const prices = await fetchCryptoPrices();
  const priceMap = new Map(prices.map(p => [p.symbol, p]));

  // For positions not in CoinGecko (DEX tokens), try DexScreener — with
  // liquidity/volume sanity guard mirroring the entry path. A ghost pair with
  // $4/day volume and spoofed liquidity metrics can swing 10x on a single $1
  // trade and fake a take-profit exit. Reject those here.
  for (const [symbol] of paperPortfolio.positions) {
    if (!priceMap.has(symbol)) {
      try {
        const dsRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${symbol}`, { signal: AbortSignal.timeout(5_000) });
        if (dsRes.ok) {
          const dsData = await dsRes.json() as { pairs?: Array<{ baseToken: { symbol: string }; priceUsd: string; liquidity?: { usd: number }; volume?: { h24?: number }; marketCap?: number }> };
          const matches = (dsData.pairs ?? []).filter(p => p.baseToken.symbol.toUpperCase() === symbol.toUpperCase());
          const legit = matches.find(p => {
            const liq = p.liquidity?.usd ?? 0;
            const vol24 = p.volume?.h24 ?? 0;
            const mcap = p.marketCap ?? 0;
            if (vol24 < 10_000) return false;
            if (mcap > 0 && liq > mcap) return false;
            return true;
          });
          if (legit?.priceUsd) {
            priceMap.set(symbol, { symbol, price: parseFloat(legit.priceUsd), change24h: 0, volume24h: legit.volume?.h24 ?? 0, marketCap: legit.marketCap ?? 0 });
          } else if (matches.length > 0) {
            logger.info({ symbol, candidates: matches.length }, '[CryptoAgent] Exit price rejected — ghost pair (all matches failed liquidity guard)');
          }
        }
      } catch { /* DexScreener unavailable */ }
    }
  }

  for (const [symbol, pos] of paperPortfolio.positions) {
    const priceData = priceMap.get(symbol);
    if (!priceData) continue;

    pos.currentPrice = priceData.price;
    const pnlPct = pos.avgEntry > 0 ? ((priceData.price - pos.avgEntry) / pos.avgEntry) * 100 : 0;

    // Track high water mark for trailing stop
    const hwm = (pos as Record<string, unknown>).highWaterPct as number | undefined;
    const currentHwm = Math.max(hwm ?? 0, pnlPct);
    (pos as Record<string, unknown>).highWaterPct = currentHwm;

    // Take Profit: sell if up >3% (tightened from 5%)
    if (pnlPct >= 3) {
      recordPaperTrade({
        instrument: `${symbol}-USD`,
        side: 'sell',
        quantity: pos.qty,
        price: priceData.price,
      });
      logger.info({ symbol, pnlPct: pnlPct.toFixed(1) }, `[CryptoAgent] TAKE PROFIT ${symbol} +${pnlPct.toFixed(1)}%`);
      continue;
    }

    // Trailing Stop: if was up >2% but dropped back to <0.5%, lock in small gain
    if (currentHwm >= 2 && pnlPct < 0.5) {
      recordPaperTrade({
        instrument: `${symbol}-USD`,
        side: 'sell',
        quantity: pos.qty,
        price: priceData.price,
      });
      logger.info({ symbol, pnlPct: pnlPct.toFixed(1), hwm: currentHwm.toFixed(1) },
        `[CryptoAgent] TRAILING STOP ${symbol} — was +${currentHwm.toFixed(1)}%, now +${pnlPct.toFixed(1)}%`);
      continue;
    }

    // Stop Loss: sell if down >2% (tightened from 3%)
    if (pnlPct <= -2) {
      recordPaperTrade({
        instrument: `${symbol}-USD`,
        side: 'sell',
        quantity: pos.qty,
        price: priceData.price,
      });
      logger.info({ symbol, pnlPct: pnlPct.toFixed(1) }, `[CryptoAgent] STOP LOSS ${symbol} ${pnlPct.toFixed(1)}%`);
      continue;
    }

    // Stale position: sell if held >2 hours (tightened from 4h — free capital faster)
    const trades = paperPortfolio.trades.filter(t => t.symbol === symbol && t.side === 'buy');
    if (trades.length > 0) {
      const oldestBuy = trades[trades.length - 1]; // most recent buy
      const holdMs = Date.now() - new Date(oldestBuy.timestamp).getTime();
      if (holdMs > 2 * 60 * 60 * 1000) { // 2 hours — free capital faster
        recordPaperTrade({
          instrument: `${symbol}-USD`,
          side: 'sell',
          quantity: pos.qty,
          price: priceData.price,
        });
        logger.info({ symbol, holdHours: (holdMs / 3600000).toFixed(1), pnlPct: pnlPct.toFixed(1) },
          `[CryptoAgent] MAX HOLD EXIT ${symbol} after ${(holdMs / 3600000).toFixed(1)}h`);
        continue;
      }
    }
  }
}, 60_000); // check every 60 seconds

// ── Coin Discovery Endpoints ─────────────────────────────────────────────

// GET /discovery — Show discovered coins with scores
cryptoAgentRouter.get('/discovery', (_req, res) => {
  const coins = getDiscoveredCoins();
  const stats = getDiscoveryStats();
  res.json({
    data: coins,
    count: coins.length,
    stats,
    universe: getCycleInstruments().length,
  });
});

// POST /discovery/scan — Force a discovery scan now
cryptoAgentRouter.post('/discovery/scan', async (_req, res) => {
  try {
    const newCoins = await discoverNewCoins();
    res.json({
      data: newCoins,
      newCount: newCoins.length,
      totalDiscovered: getDiscoveredCoins().length,
      universe: getCycleInstruments().length + getDiscoveredCoinbasePairs().length,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Discovery failed' });
  }
});

// ── Auto-Discovery Loop (runs every 15 minutes) ─────────────────────────

let discoveryInterval: ReturnType<typeof setInterval> | null = null;

export function startDiscoveryLoop(): void {
  if (discoveryInterval) return;

  logger.info('[CryptoAgent] Starting auto-discovery (every 15 min)');

  discoveryInterval = setInterval(async () => {
    try {
      const newCoins = await discoverNewCoins();
      if (newCoins.length > 0) {
        // Aggressively expand trading universe with Coinbase-listed discoveries
        const newPairs = getDiscoveredCoinbasePairs();
        const currentUniverse = new Set(tradingUniverse);
        let added = 0;
        for (const pair of newPairs) {
          if (!currentUniverse.has(pair)) {
            tradingUniverse.push(pair);
            currentUniverse.add(pair);
            added++;
          }
        }
        if (added > 0) {
          updateCycleInstruments(tradingUniverse);
          logger.info({ added, total: tradingUniverse.length, symbols: newCoins.map(c => c.symbol).join(', ') },
            `[CryptoAgent] EXPANDED universe: +${added} coins (total: ${tradingUniverse.length})`);
        }
        logger.info({ new: newCoins.length, symbols: newCoins.map(c => c.symbol).join(', ') },
          '[CryptoAgent] Discovery cycle found new coins');
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[CryptoAgent] Discovery cycle failed');
    }
  }, 5 * 60_000); // every 5 minutes (was 15 — more aggressive)

  // First scan after 30s delay
  setTimeout(async () => {
    try {
      const initial = await discoverNewCoins();
      logger.info({ coins: initial.length }, '[CryptoAgent] Initial discovery scan complete');
    } catch { /* silent */ }
  }, 30_000);
}

// Auto-start discovery when module loads
startDiscoveryLoop();

// ── Cleanup: Sell any blocked blue-chip positions on startup (LIVE mode only) ──
// In live mode, user holds BTC, ETH, SOL etc. in personal wallets — bot should NOT hold them
// In paper mode, these are valid positions for testing — don't force-sell
setTimeout(async () => {
  if (engineState.config.paperMode) {
    logger.info('[CryptoAgent] Paper mode — skipping blocked-coin cleanup');
    return;
  }
  const prices = await fetchCryptoPrices();
  for (const [symbol, pos] of paperPortfolio.positions) {
    if (BLOCKED_COINS.has(symbol) && pos.qty > 0) {
      const priceData = prices.find(p => p.symbol === symbol);
      if (priceData) {
        recordPaperTrade({
          instrument: `${symbol}-USD`,
          side: 'sell',
          quantity: pos.qty,
          price: priceData.price,
        });
        logger.info({ symbol, qty: pos.qty }, `[CryptoAgent] SOLD blocked coin ${symbol} — freeing capital for discovered coins`);
      }
    }
  }
}, 15_000); // 15s after boot

// ── Live Activity Feed ──────────────────────────────────────────────────
// Returns recent trades + open positions + engine status in a unified format
// that the dashboard can display as a live activity feed

cryptoAgentRouter.get('/activity', async (_req, res) => {
  const regime = await getRegime();
  const prices = await fetchCryptoPrices();

  // Update position prices
  for (const [symbol, pos] of paperPortfolio.positions) {
    const p = prices.find(pr => pr.symbol === symbol);
    if (p) pos.currentPrice = p.price;
  }

  const openPositions = [...paperPortfolio.positions.entries()]
    .filter(([, p]) => p.qty > 0)
    .map(([symbol, p]) => ({
      symbol,
      qty: p.qty,
      avgEntry: p.avgEntry,
      currentPrice: p.currentPrice,
      value: p.qty * p.currentPrice,
      pnlUsd: p.avgEntry > 0 ? (p.currentPrice - p.avgEntry) * p.qty : 0,
      pnlPct: p.avgEntry > 0 ? ((p.currentPrice - p.avgEntry) / p.avgEntry) * 100 : 0,
    }));

  const recentActivity = paperPortfolio.trades.slice(-30).reverse().map(t => ({
    action: t.side.toUpperCase(),
    symbol: t.symbol,
    qty: t.qty,
    price: t.price,
    pnlUsd: t.pnlUsd,
    cost: t.side === 'buy' ? t.qty * t.price : undefined,
    timestamp: t.timestamp,
    timeAgo: formatTimeAgo(t.timestamp),
  }));

  res.json({
    data: {
      regime: regime.regime,
      regimeMultiplier: regime.multiplier,
      cashUsd: Math.round(paperPortfolio.cashUsd * 100) / 100,
      totalValue: Math.round((paperPortfolio.cashUsd + openPositions.reduce((s, p) => s + p.value, 0)) * 100) / 100,
      openPositions,
      recentActivity,
      universe: tradingUniverse.length,
      discoveredCoins: getDiscoveredCoinbasePairs().length,
      tradingViewSignals: tradingViewSignals.length,
    },
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ██  DEX MOMENTUM SCANNER — Finds trending tokens on DexScreener          ██
// ════════════════════════════════════════════════════════════════════════════

let dexScanInterval: ReturnType<typeof setInterval> | null = null;
let dexScanCount = 0;

async function runDEXMomentumScan(): Promise<void> {
  dexScanCount++;
  try {
    // Fetch DexScreener top boosted tokens (trending = high visibility)
    const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;

    const tokens = await res.json() as Array<{
      chainId: string;
      tokenAddress: string;
      description?: string;
      totalAmount?: number;
      links?: Array<{ url: string }>;
    }>;

    let bought = 0;

    for (const token of (tokens ?? []).slice(0, 20)) {
      if ((token.totalAmount ?? 0) < 50) continue; // Min $50 boost

      // Get pair data for this token
      try {
        const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!pairRes.ok) continue;

        const pairData = await pairRes.json() as {
          pairs?: Array<{
            baseToken: { symbol: string; name: string };
            priceUsd: string;
            volume: { h24: number };
            liquidity: { usd: number };
            priceChange: { h24: number };
            chainId: string;
          }>;
        };

        const pair = pairData.pairs?.[0];
        if (!pair) continue;

        const symbol = pair.baseToken.symbol.toUpperCase();
        const price = parseFloat(pair.priceUsd ?? '0');
        const volume = pair.volume?.h24 ?? 0;
        const liquidity = pair.liquidity?.usd ?? 0;
        const change24h = pair.priceChange?.h24 ?? 0;

        // Filters: real volume, real liquidity, positive momentum
        if (volume < 50_000) continue;
        if (liquidity < 10_000) continue;
        if (change24h < 10) continue; // At least +10% in 24h
        if (!engineState.config.paperMode && BLOCKED_COINS.has(symbol)) continue;
        if (paperPortfolio.positions.has(symbol)) continue; // Already holding

        // Execute paper trade
        const positionSizeUsd = Math.min(30, paperPortfolio.cashUsd * 0.05); // 5% of cash, max $30
        if (positionSizeUsd < 5 || paperPortfolio.cashUsd < positionSizeUsd) continue;
        if (paperPortfolio.positions.size >= 15) continue; // Max positions

        const qty = positionSizeUsd / Math.max(price, 0.000001);
        recordPaperTrade({
          instrument: `${symbol}-USD`,
          side: 'buy',
          quantity: qty,
          price,
        });

        logger.info({ symbol, price, volume: Math.round(volume), change: change24h.toFixed(1), chain: pair.chainId },
          `[DEX-Momentum] BUY $${symbol} @ $${price} (+${change24h.toFixed(1)}% 24h, $${Math.round(volume/1000)}K vol)`);
        bought++;

        if (bought >= 3) break; // Max 3 buys per scan cycle
      } catch { /* individual token failed */ }
    }

    if (bought > 0 || dexScanCount % 10 === 0) {
      logger.info({ cycle: dexScanCount, bought, cash: paperPortfolio.cashUsd.toFixed(0), positions: paperPortfolio.positions.size },
        `[DEX-Momentum] Scan #${dexScanCount} — ${bought} buys, ${paperPortfolio.positions.size} positions, $${paperPortfolio.cashUsd.toFixed(0)} cash`);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[DEX-Momentum] Scan failed');
  }
}

export function startDEXMomentumScanner(): void {
  if (dexScanInterval) return;
  dexScanInterval = setInterval(runDEXMomentumScan, 5 * 60_000); // Every 5 min
  setTimeout(runDEXMomentumScan, 30_000); // First scan after 30s
  logger.info('[DEX-Momentum] Scanner started — scanning DexScreener trending every 5 min');
}

function formatTimeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}

// ════════════════════════════════════════════════════════════════════════════
// ██  CEX ENGINE — Blue Chip & Top 100 Crypto Trading via Coinbase        ██
// ════════════════════════════════════════════════════════════════════════════
//
// Separate from the DEX meme coin engine. Trades established coins on
// Coinbase using Tradevisor intelligence (CoinGecko OHLCV → 6-indicator TA).
// Paper mode with $5,000 starting capital.

const CEX_STARTING_CAPITAL = 5_000;

// Top Coinbase-listed coins by market cap — the CEX trading universe
const CEX_UNIVERSE = [
  'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'LINK', 'AVAX',
  'MATIC', 'ATOM', 'UNI', 'AAVE', 'LTC', 'DOGE', 'SHIB',
  'NEAR', 'SUI', 'ARB', 'OP', 'FIL', 'APT', 'INJ', 'SEI',
  'RENDER', 'FET', 'TAO', 'PEPE', 'BONK', 'WIF', 'JUP',
];

interface CEXPosition {
  symbol: string;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  openedAt: string;
}

interface CEXTrade {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  pnlUsd: number;
  reason: string;
  timestamp: string;
}

const cexPortfolio = {
  cashUsd: CEX_STARTING_CAPITAL,
  positions: new Map<string, CEXPosition>(),
  trades: [] as CEXTrade[],
  totalPnlUsd: 0,
  wins: 0,
  losses: 0,
};

let cexScanInterval: ReturnType<typeof setInterval> | null = null;
let cexCycleCount = 0;
let cexLastScanAt: string | null = null;

// CEX Persistence — survives PM2 restarts
// Using node: protocol for built-in modules
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const CEX_DATA_DIR = resolve('data/cex');
try { mkdirSync(CEX_DATA_DIR, { recursive: true }); } catch { /* exists */ }

function persistCEXState(): void {
  try {
    const state = {
      cashUsd: cexPortfolio.cashUsd,
      positions: [...cexPortfolio.positions.entries()],
      trades: cexPortfolio.trades.slice(-100),
      totalPnlUsd: cexPortfolio.totalPnlUsd,
      wins: cexPortfolio.wins,
      losses: cexPortfolio.losses,
    };
    writeFileSync(join(CEX_DATA_DIR, 'paper-state.json'), JSON.stringify(state, null, 2));
  } catch { /* fire-and-forget */ }
}

function loadCEXState(): void {
  try {
    const file = join(CEX_DATA_DIR, 'paper-state.json');
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    if (raw.cashUsd != null) cexPortfolio.cashUsd = raw.cashUsd;
    if (raw.totalPnlUsd != null) cexPortfolio.totalPnlUsd = raw.totalPnlUsd;
    if (raw.wins != null) cexPortfolio.wins = raw.wins;
    if (raw.losses != null) cexPortfolio.losses = raw.losses;
    if (Array.isArray(raw.positions)) {
      cexPortfolio.positions.clear();
      for (const [key, val] of raw.positions) {
        cexPortfolio.positions.set(key, val as CEXPosition);
      }
    }
    if (Array.isArray(raw.trades)) cexPortfolio.trades = raw.trades;
    logger.info({ cash: cexPortfolio.cashUsd, positions: cexPortfolio.positions.size },
      '[CEX] Restored state from disk');
  } catch { /* start fresh */ }
}

function recordCEXTrade(symbol: string, side: 'buy' | 'sell', qty: number, price: number, reason: string): void {
  if (side === 'buy') {
    const cost = qty * price;
    if (cexPortfolio.cashUsd < cost) return;

    const existing = cexPortfolio.positions.get(symbol);
    if (existing) {
      // Average in
      const totalQty = existing.qty + qty;
      existing.avgEntry = ((existing.avgEntry * existing.qty) + (price * qty)) / totalQty;
      existing.qty = totalQty;
      existing.currentPrice = price;
    } else {
      cexPortfolio.positions.set(symbol, {
        symbol,
        qty,
        avgEntry: price,
        currentPrice: price,
        openedAt: new Date().toISOString(),
      });
    }
    cexPortfolio.cashUsd -= cost;

    cexPortfolio.trades.push({ symbol, side, qty, price, pnlUsd: 0, reason, timestamp: new Date().toISOString() });
    if (cexPortfolio.trades.length > 200) cexPortfolio.trades.shift();

    persistCEXState();
    logger.info({ symbol, qty: qty.toFixed(6), price, cost: cost.toFixed(2), reason },
      `[CEX] BUY ${symbol} $${cost.toFixed(2)} @ $${price.toLocaleString()} — ${reason}`);
  } else {
    // Sell
    const pos = cexPortfolio.positions.get(symbol);
    if (!pos) return;

    const sellQty = Math.min(qty, pos.qty);
    const proceeds = sellQty * price;
    const pnl = (price - pos.avgEntry) * sellQty;

    cexPortfolio.cashUsd += proceeds;
    cexPortfolio.totalPnlUsd += pnl;
    if (pnl >= 0) cexPortfolio.wins++;
    else cexPortfolio.losses++;

    pos.qty -= sellQty;
    if (pos.qty <= 0.000001) cexPortfolio.positions.delete(symbol);

    cexPortfolio.trades.push({ symbol, side, qty: sellQty, price, pnlUsd: pnl, reason, timestamp: new Date().toISOString() });
    if (cexPortfolio.trades.length > 200) cexPortfolio.trades.shift();

    persistCEXState();
    logger.info({ symbol, qty: sellQty.toFixed(6), price, pnl: pnl.toFixed(2), reason },
      `[CEX] SELL ${symbol} $${proceeds.toFixed(2)} P&L: $${pnl.toFixed(2)} — ${reason}`);
  }
}

// Coinbase product IDs for the CEX universe (no rate limit on our API key)
const CEX_COINBASE_PRODUCTS: Record<string, string> = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD',
  ADA: 'ADA-USD', DOT: 'DOT-USD', LINK: 'LINK-USD', AVAX: 'AVAX-USD',
  MATIC: 'MATIC-USD', ATOM: 'ATOM-USD', UNI: 'UNI-USD', AAVE: 'AAVE-USD',
  LTC: 'LTC-USD', DOGE: 'DOGE-USD', SHIB: 'SHIB-USD', NEAR: 'NEAR-USD',
  SUI: 'SUI-USD', ARB: 'ARB-USD', OP: 'OP-USD', FIL: 'FIL-USD',
  APT: 'APT-USD', INJ: 'INJ-USD', SEI: 'SEI-USD', RENDER: 'RENDER-USD',
  FET: 'FET-USD', TAO: 'TAO-USD', PEPE: 'PEPE-USD', BONK: 'BONK-USD',
  WIF: 'WIF-USD', JUP: 'JUP-USD',
};

// Cache for Coinbase prices (refreshed every cycle via batch call)
const cexPriceCache = new Map<string, { price: number; updatedAt: number }>();

/** Fetch real-time prices from Coinbase for ALL CEX coins in one call (no rate limit) */
async function refreshCoinbasePrices(): Promise<number> {
  let updated = 0;
  try {
    const { getCoinbaseKeys, coinbaseSignedRequest } = await import('../services/coinbase-auth-service.js');
    const keys = getCoinbaseKeys();
    if (!keys) {
      // Fallback to public Coinbase API (no auth needed for prices)
      for (const [symbol, productId] of Object.entries(CEX_COINBASE_PRODUCTS)) {
        try {
          const res = await fetch(`https://api.coinbase.com/api/v3/brokerage/market/products/${productId}`, {
            signal: AbortSignal.timeout(3_000),
          });
          if (res.ok) {
            const data = await res.json() as { price?: string; quote_increment?: string };
            const price = parseFloat(data.price ?? '0');
            if (price > 0) {
              cexPriceCache.set(symbol, { price, updatedAt: Date.now() });
              const pos = cexPortfolio.positions.get(symbol);
              if (pos) pos.currentPrice = price;
              updated++;
            }
          }
        } catch { /* individual fetch failure */ }
      }
      return updated;
    }

    // Authenticated batch: fetch all products at once
    const res = await coinbaseSignedRequest('GET', '/api/v3/brokerage/market/products?limit=250', keys.apiKey, keys.apiSecret);
    if (res.ok) {
      const data = await res.json() as { products?: Array<{ product_id: string; price: string }> };
      const productPrices = new Map<string, number>();
      for (const p of data.products ?? []) {
        productPrices.set(p.product_id, parseFloat(p.price ?? '0'));
      }

      for (const [symbol, productId] of Object.entries(CEX_COINBASE_PRODUCTS)) {
        const price = productPrices.get(productId);
        if (price && price > 0) {
          cexPriceCache.set(symbol, { price, updatedAt: Date.now() });
          const pos = cexPortfolio.positions.get(symbol);
          if (pos) pos.currentPrice = price;
          updated++;
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[CEX] Coinbase price refresh failed');
  }
  return updated;
}

async function runCEXScanCycle(): Promise<void> {
  cexCycleCount++;
  cexLastScanAt = new Date().toISOString();

  try {
    // 0. Global safety check
    try {
      const { canTrade } = await import('../services/risk/global-safety.js');
      const check = canTrade('crypto_cex');
      if (!check.allowed) {
        logger.info({ reason: check.reason }, `[CEX] SAFETY: Skipping cycle — ${check.reason}`);
        return;
      }
    } catch { /* safety not loaded */ }

    // 1. Refresh ALL prices via Coinbase (fast, no rate limit, one API call)
    const pricesUpdated = await refreshCoinbasePrices();

    // 2. Check TP/SL on open positions with fresh Coinbase prices
    for (const [symbol, pos] of [...cexPortfolio.positions]) {
      if (pos.avgEntry <= 0) continue;
      const pnlPct = ((pos.currentPrice - pos.avgEntry) / pos.avgEntry) * 100;
      if (pnlPct >= 8) {
        recordCEXTrade(symbol, 'sell', pos.qty, pos.currentPrice, `TP hit +${pnlPct.toFixed(1)}%`);
      } else if (pnlPct <= -5) {
        recordCEXTrade(symbol, 'sell', pos.qty, pos.currentPrice, `SL hit ${pnlPct.toFixed(1)}%`);
      }
    }

    // 3. Analyze batch via Tradevisor (CoinGecko OHLCV for TA — 10 coins per cycle)
    const batchSize = 10;
    const startIdx = ((cexCycleCount - 1) * batchSize) % CEX_UNIVERSE.length;
    const batch = CEX_UNIVERSE.slice(startIdx, startIdx + batchSize);

    const { analyzeTickerCrypto } = await import('../services/ai/tradevisor-engine.js');
    let analyzed = 0;
    let buys = 0;

    for (const symbol of batch) {
      try {
        const result = await analyzeTickerCrypto(symbol);
        if (!result) continue;
        analyzed++;

        // Sell: 4/6+ sell confluence on held positions
        if (result.action === 'sell' && result.confluenceScore >= 4 && cexPortfolio.positions.has(symbol)) {
          const pos = cexPortfolio.positions.get(symbol)!;
          recordCEXTrade(symbol, 'sell', pos.qty, cexPriceCache.get(symbol)?.price ?? pos.currentPrice,
            `Tradevisor SELL ${result.confluenceScore}/6 (conf:${result.confidence}%)`);
          logger.info({ symbol, score: result.confluenceScore }, `[CEX] SELL ${symbol} — Tradevisor ${result.confluenceScore}/6 sell signal`);
          continue;
        }

        // Buy: 4/6+ confluence on established coins
        if (result.confluenceScore >= 4 && result.action === 'buy') {
          if (cexPortfolio.positions.has(symbol)) continue; // Already holding
          if (cexPortfolio.positions.size >= 10) continue;  // Max positions

          // Position size: 5-10% of portfolio based on confidence
          const portfolioValue = cexPortfolio.cashUsd + [...cexPortfolio.positions.values()].reduce((s, p) => s + p.qty * p.currentPrice, 0);
          const sizePct = result.confidence >= 75 ? 0.10 : result.confidence >= 60 ? 0.07 : 0.05;
          const positionSizeUsd = Math.min(portfolioValue * sizePct, cexPortfolio.cashUsd * 0.5);
          if (positionSizeUsd < 10) continue;

          // Use Coinbase price if available (more accurate), fallback to Tradevisor price
          const execPrice = cexPriceCache.get(symbol)?.price ?? result.currentPrice;
          const qty = positionSizeUsd / execPrice;
          recordCEXTrade(symbol, 'buy', qty, execPrice,
            `Tradevisor ${result.grade} ${result.confluenceScore}/6 (conf:${result.confidence}%)`);
          buys++;
        }

        // Rate limit between CoinGecko OHLCV calls
        await new Promise(r => setTimeout(r, 1200));
      } catch { /* individual coin analysis failure */ }
    }

    logger.info(
      { cycle: cexCycleCount, batch: batch.join(','), analyzed, buys, pricesUpdated, positions: cexPortfolio.positions.size, cash: cexPortfolio.cashUsd.toFixed(0) },
      `[CEX] Cycle #${cexCycleCount} — ${pricesUpdated} CB prices, ${analyzed}/${batch.length} analyzed, ${buys} buys — ${cexPortfolio.positions.size} positions — $${cexPortfolio.cashUsd.toFixed(0)} cash`,
    );
    persistCEXState(); // Save state after every cycle
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, '[CEX] Scan cycle failed');
  }
}

export function startCEXEngine(): void {
  if (cexScanInterval) return;
  loadCEXState(); // Restore positions from disk
  logger.info({ universe: CEX_UNIVERSE.length, capital: CEX_STARTING_CAPITAL, cash: cexPortfolio.cashUsd, positions: cexPortfolio.positions.size },
    `[CEX] Starting CEX engine — ${CEX_UNIVERSE.length} coins, $${cexPortfolio.cashUsd.toFixed(0)} cash, ${cexPortfolio.positions.size} positions`);

  // Price refresh every 2 min (Coinbase — fast, no rate limit)
  // TA analysis every 3 min (CoinGecko OHLCV — rate limited but larger batches)
  cexScanInterval = setInterval(runCEXScanCycle, 3 * 60_000); // Full cycle every 3 min
  setTimeout(runCEXScanCycle, 40_000); // First scan after 40s

  // Extra price-only refresh between TA cycles (keeps P&L live)
  setInterval(async () => {
    const updated = await refreshCoinbasePrices();
    if (updated > 0) {
      // Check TP/SL with fresh prices
      for (const [symbol, pos] of [...cexPortfolio.positions]) {
        if (pos.avgEntry <= 0) continue;
        const pnlPct = ((pos.currentPrice - pos.avgEntry) / pos.avgEntry) * 100;
        if (pnlPct >= 8) recordCEXTrade(symbol, 'sell', pos.qty, pos.currentPrice, `TP hit +${pnlPct.toFixed(1)}%`);
        else if (pnlPct <= -5) recordCEXTrade(symbol, 'sell', pos.qty, pos.currentPrice, `SL hit ${pnlPct.toFixed(1)}%`);
      }
    }
  }, 60_000); // Price refresh every 1 min
}

export function stopCEXEngine(): void {
  if (cexScanInterval) { clearInterval(cexScanInterval); cexScanInterval = null; }
}

export function getCEXPortfolio() {
  const positionsArr = [...cexPortfolio.positions.values()].map(p => ({
    symbol: p.symbol,
    qty: p.qty,
    avgEntry: p.avgEntry,
    currentPrice: p.currentPrice,
    value: p.qty * p.currentPrice,
    pnlUsd: (p.currentPrice - p.avgEntry) * p.qty,
    pnlPct: p.avgEntry > 0 ? ((p.currentPrice - p.avgEntry) / p.avgEntry) * 100 : 0,
    openedAt: p.openedAt,
  }));

  const posValue = positionsArr.reduce((s, p) => s + p.value, 0);
  const totalValue = cexPortfolio.cashUsd + posValue;
  const total = cexPortfolio.wins + cexPortfolio.losses;

  return {
    startingCapital: CEX_STARTING_CAPITAL,
    cashUsd: Math.round(cexPortfolio.cashUsd * 100) / 100,
    positionsValue: Math.round(posValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnlUsd: Math.round((totalValue - CEX_STARTING_CAPITAL) * 100) / 100,
    totalTrades: cexPortfolio.trades.length,
    wins: cexPortfolio.wins,
    losses: cexPortfolio.losses,
    winRate: total > 0 ? Math.round((cexPortfolio.wins / total) * 100) : 0,
    openPositions: positionsArr,
    recentTrades: cexPortfolio.trades.slice(-20).reverse(),
    universe: CEX_UNIVERSE.length,
    cycleCount: cexCycleCount,
    lastScanAt: cexLastScanAt,
    running: cexScanInterval !== null,
  };
}

// ── CEX TradingView Integration ──────────────────────────────────────────
// Called by webhooks-tradingview.ts when a blue chip TV signal comes in

export function executeCEXTradeFromTV(symbol: string, action: 'buy' | 'sell', price: number, reason: string): void {
  if (price <= 0) return;

  if (action === 'buy') {
    // Don't buy if already holding
    if (cexPortfolio.positions.has(symbol)) {
      logger.info({ symbol }, `[CEX-TV] Already holding ${symbol} — skip duplicate`);
      return;
    }
    // Max positions check
    if (cexPortfolio.positions.size >= 10) {
      logger.info({ symbol, positions: cexPortfolio.positions.size }, `[CEX-TV] Max positions — skip`);
      return;
    }

    // TradingView signals get higher confidence sizing (10% of portfolio)
    const portfolioValue = cexPortfolio.cashUsd + [...cexPortfolio.positions.values()].reduce((s, p) => s + p.qty * p.currentPrice, 0);
    const positionSizeUsd = Math.min(portfolioValue * 0.10, cexPortfolio.cashUsd * 0.5);
    if (positionSizeUsd < 10) return;

    const qty = positionSizeUsd / price;
    recordCEXTrade(symbol, 'buy', qty, price, reason);
    logger.info({ symbol, size: positionSizeUsd.toFixed(0), price },
      `[CEX-TV] BUY ${symbol} $${positionSizeUsd.toFixed(0)} @ $${price} — TradingView Tradevisor signal`);
  } else {
    // Sell: close position if we hold it
    const pos = cexPortfolio.positions.get(symbol);
    if (!pos) {
      logger.info({ symbol }, `[CEX-TV] No ${symbol} position to sell`);
      return;
    }
    recordCEXTrade(symbol, 'sell', pos.qty, price, reason);
    logger.info({ symbol, price }, `[CEX-TV] SELL ${symbol} — TradingView Tradevisor signal`);
  }
}

// ── CEX Endpoints ────────────────────────────────────────────────────────

cryptoAgentRouter.get('/cex/status', (_req, res) => {
  res.json({ data: getCEXPortfolio() });
});

cryptoAgentRouter.get('/cex/portfolio', (_req, res) => {
  res.json({ data: getCEXPortfolio() });
});

cryptoAgentRouter.post('/cex/start', (_req, res) => {
  startCEXEngine();
  res.json({ message: 'CEX engine started' });
});

cryptoAgentRouter.post('/cex/stop', (_req, res) => {
  stopCEXEngine();
  res.json({ message: 'CEX engine stopped' });
});
