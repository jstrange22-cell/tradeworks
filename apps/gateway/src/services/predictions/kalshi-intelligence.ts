/**
 * Kalshi Intelligence Service — APEX Predator Engine
 *
 * Integrates 5 prediction market intelligence engines into APEX:
 *   1. Arbitrage Scanner (Kalshi ↔ Polymarket price discrepancies)
 *   2. Crypto 15-Min Sniper (exchange momentum → prediction market edge)
 *   3. Sports/Events AI Scorer (category-weighted event analysis)
 *   4. Weather Forecaster (GFS 31-member ensemble vs market prices)
 *   5. New Listing Monitor (first-mover on fresh markets)
 *
 * All engines produce KalshiSignal objects that feed into APEX intelligence
 * and the Predictions dashboard page.
 */

import { logger } from '../../lib/logger.js';
import { kalshiPaperBuy, kalshiPaperSell, getKalshiPaperPortfolio, updateKalshiPositionPrice, purgeGhostPositions } from './kalshi-client.js';

// ── Ticker Validation ───────────────────────────────────────────────────
// These prefixes are fabricated tickers that don't exist on Kalshi's API.
// Trading them creates ghost positions that can never settle or get real prices.
const INVALID_TICKER_PREFIXES = ['TWITTER_', 'KXBTC15M', 'KXETH15M', 'KXSOL15M'];

function isValidKalshiTicker(ticker: string): boolean {
  return !INVALID_TICKER_PREFIXES.some(prefix => ticker.startsWith(prefix));
}

// ── Types ────────────────────────────────────────────────────────────────

export interface KalshiMarket {
  ticker: string;
  title: string;
  category: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  openInterest: number;
  expiresAt: string;
  status: 'active' | 'closed' | 'settled';
}

export interface KalshiSignal {
  engine: 'arb' | 'crypto_sniper' | 'ai_ensemble' | 'weather' | 'new_listing' | 'apex_quant' | 'apex_sports' | 'twitter' | 'arb_macro';
  market: string;
  title: string;
  category: string;
  side: 'yes' | 'no';
  confidence: number;       // 0-100
  edge: number;             // % edge over market price
  modelProbability: number; // our estimated probability (0-1)
  marketPrice: number;      // current market price (0-1)
  reasoning: string;
  suggestedSize: number;    // USD
  timestamp: string;
}

export interface WeatherForecast {
  city: string;
  date: string;
  threshold: number;
  membersAbove: number;
  totalMembers: number;
  probability: number;
  confidence: number;
  currentMarketPrice: number;
  edge: number;
}

export interface CategoryScore {
  category: string;
  score: number;
  status: 'GOOD' | 'WEAK' | 'BLOCKED';
  winRate: number;
  trades: number;
}

// ── Category Scoring (Engine 3 core) ─────────────────────────────────────

const CATEGORY_BASE_SCORES: Record<string, number> = {
  NCAAB: 72,
  NBA: 55,         // Upgraded: paper mode needs more signals
  NFL: 60,
  MLB: 50,         // Upgraded
  POLITICS: 45,    // Upgraded from 31 → WEAK but tradeable
  CPI: 8,          // BLOCKED — efficient market
  FED: 12,         // BLOCKED — efficient market
  ECON_MACRO: 10,  // BLOCKED — efficient market
  WEATHER: 65,
  CRYPTO_15M: 70,
  CRYPTO: 65,      // General crypto markets
  SPORTS: 55,      // Upgraded
  ENTERTAINMENT: 45,
  TECH: 50,
  OTHER: 40,       // Upgraded from 35
};

const categoryPerformance = new Map<string, { wins: number; losses: number; totalPnl: number }>();

export function getCategoryScore(category: string): CategoryScore {
  const baseScore = CATEGORY_BASE_SCORES[category] ?? CATEGORY_BASE_SCORES['OTHER'];
  const perf = categoryPerformance.get(category);

  let score = baseScore;
  if (perf && (perf.wins + perf.losses) >= 5) {
    const winRate = perf.wins / (perf.wins + perf.losses);
    const roiNorm = Math.min(Math.max(perf.totalPnl / 100, -0.5), 0.5) + 0.5;
    const sampleConf = Math.min((perf.wins + perf.losses) / 20, 1.0);
    score = Math.round(winRate * 40 + roiNorm * 30 + sampleConf * 20 + (baseScore / 100) * 10);
  }

  return {
    category,
    score,
    status: score >= 50 ? 'GOOD' : score >= 30 ? 'WEAK' : 'BLOCKED',
    winRate: perf ? (perf.wins / Math.max(perf.wins + perf.losses, 1)) * 100 : 0,
    trades: perf ? perf.wins + perf.losses : 0,
  };
}

export function getAllCategoryScores(): CategoryScore[] {
  return Object.keys(CATEGORY_BASE_SCORES).map(getCategoryScore);
}

// ── Engine 4: Weather Forecaster (GFS Ensemble) ──────────────────────────

const WEATHER_CITIES: Record<string, { name: string; lat: number; lon: number; kalshiSeries: string }> = {
  NY: { name: 'New York', lat: 40.7128, lon: -74.006, kalshiSeries: 'KXHIGHNY' },
  CHI: { name: 'Chicago', lat: 41.8781, lon: -87.6298, kalshiSeries: 'KXHIGHCHI' },
  LA: { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, kalshiSeries: 'KXHIGHLA' },
  MIA: { name: 'Miami', lat: 25.7617, lon: -80.1918, kalshiSeries: 'KXHIGHMIA' },
  DEN: { name: 'Denver', lat: 39.7392, lon: -104.9903, kalshiSeries: 'KXHIGHDEN' },
};

export async function getWeatherForecasts(): Promise<WeatherForecast[]> {
  const forecasts: WeatherForecast[] = [];

  for (const [code, city] of Object.entries(WEATHER_CITIES)) {
    try {
      const res = await fetch(
        `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${city.lat}&longitude=${city.lon}&models=gfs_seamless&hourly=temperature_2m&forecast_days=3&temperature_unit=fahrenheit`,
        { signal: AbortSignal.timeout(10_000) },
      );

      if (!res.ok) continue;

      const data = await res.json() as {
        hourly?: {
          time?: string[];
          temperature_2m?: number[][];
        };
      };

      if (!data.hourly?.temperature_2m || !data.hourly?.time) continue;

      // Get daily max temperatures from each ensemble member
      const memberCount = data.hourly.temperature_2m.length;
      const times = data.hourly.time;

      // Group by date and find max temp per member per day
      const dailyMaxByMember = new Map<string, number[]>();
      for (let m = 0; m < memberCount; m++) {
        const memberTemps = data.hourly.temperature_2m[m];
        if (!memberTemps) continue;

        for (let i = 0; i < times.length; i++) {
          const date = times[i].split('T')[0];
          if (!dailyMaxByMember.has(date)) dailyMaxByMember.set(date, []);
          const maxes = dailyMaxByMember.get(date)!;
          if (!maxes[m] || memberTemps[i] > maxes[m]) {
            maxes[m] = memberTemps[i];
          }
        }
      }

      // For each forecast day, calculate probability of exceeding common thresholds
      for (const [date, maxTemps] of dailyMaxByMember) {
        const validTemps = maxTemps.filter(t => t !== undefined);
        if (validTemps.length < 20) continue;

        // Test common thresholds
        for (const threshold of [60, 70, 75, 80, 85, 90, 95]) {
          const above = validTemps.filter(t => t >= threshold).length;
          const probability = above / validTemps.length;
          const confidence = Math.abs(above - validTemps.length / 2) / (validTemps.length / 2);

          // Only report interesting forecasts (high confidence)
          if (confidence > 0.3) {
            forecasts.push({
              city: city.name,
              date,
              threshold,
              membersAbove: above,
              totalMembers: validTemps.length,
              probability: Math.round(probability * 1000) / 1000,
              confidence: Math.round(confidence * 100),
              currentMarketPrice: 0, // Will be populated from Kalshi
              edge: 0,
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ city: code, err: err instanceof Error ? err.message : err }, '[Weather] Forecast fetch failed');
    }
  }

  return forecasts;
}

// ── Engine 2: Crypto 15-Min Intelligence ─────────────────────────────────

export async function getCrypto15MinSignals(): Promise<KalshiSignal[]> {
  const signals: KalshiSignal[] = [];

  try {
    // Fetch current prices from CoinGecko for momentum analysis
    const [priceRes, marketsRes] = await Promise.all([
      fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
        { signal: AbortSignal.timeout(8_000) },
      ),
      // Fetch REAL Kalshi crypto markets to get valid tickers
      fetch(
        'https://api.elections.kalshi.com/trade-api/v2/markets/?limit=30&status=active&series_ticker=KXBTC',
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
      ).catch(() => null),
    ]);

    if (!priceRes.ok) return signals;
    const prices = await priceRes.json() as Record<string, { usd: number; usd_24h_change: number }>;

    // Build a map of REAL Kalshi crypto tickers from the API
    const realCryptoTickers = new Map<string, { ticker: string; yesPrice: number }>();
    if (marketsRes?.ok) {
      const marketsData = await marketsRes.json() as { markets: Array<{ ticker: string; last_price: number; yes_bid: number; status: string }> };
      for (const m of marketsData.markets ?? []) {
        if (m.status === 'active' || m.status === 'open') {
          // Map BTC markets to symbol for matching
          if (m.ticker.includes('BTC')) realCryptoTickers.set('BTC', { ticker: m.ticker, yesPrice: m.last_price / 100 });
          if (m.ticker.includes('ETH')) realCryptoTickers.set('ETH', { ticker: m.ticker, yesPrice: m.last_price / 100 });
          if (m.ticker.includes('SOL')) realCryptoTickers.set('SOL', { ticker: m.ticker, yesPrice: m.last_price / 100 });
        }
      }
    }

    // Generate signals ONLY for coins that have real Kalshi markets
    for (const [id, data] of Object.entries(prices)) {
      const symbol = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : 'SOL';
      const change = data.usd_24h_change;
      const momentum = Math.abs(change);

      // Must have a REAL Kalshi ticker to generate a signal
      const realMarket = realCryptoTickers.get(symbol);
      if (!realMarket) {
        logger.debug({ symbol }, '[Kalshi] No active Kalshi market found for crypto, skipping signal');
        continue;
      }

      if (momentum > 0.5) { // Raised threshold from 0.1 — need real momentum
        const side = change > 0 ? 'yes' : 'no';
        const confidence = Math.min(30 + momentum * 20 + (momentum > 1 ? 10 : 0) + (momentum > 2 ? 10 : 0), 90);
        const marketPrice = realMarket.yesPrice > 0 ? realMarket.yesPrice : 0.5;

        signals.push({
          engine: 'crypto_sniper',
          market: realMarket.ticker, // USE REAL KALSHI TICKER
          title: `${symbol} direction: ${change > 0 ? 'UP' : 'DOWN'} bias`,
          category: 'CRYPTO_15M',
          side,
          confidence,
          edge: Math.max(momentum, 1),
          modelProbability: change > 0 ? 0.5 + momentum / 100 : 0.5 - momentum / 100,
          marketPrice,
          reasoning: `${symbol} ${change > 0 ? '+' : ''}${change.toFixed(1)}% 24h momentum → ${confidence.toFixed(0)}% confidence ${side.toUpperCase()} bias. Real ticker: ${realMarket.ticker}`,
          suggestedSize: Math.min(confidence / 2, 50),
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch {
    // silent
  }

  return signals;
}

// ── Engine 5: New Listing Monitor ────────────────────────────────────────

export async function getNewListingSignals(): Promise<KalshiSignal[]> {
  const signals: KalshiSignal[] = [];
  try {
    // Fetch active Kalshi markets — look for mispriced or high-volume events
    const res = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/markets/?limit=30&status=active',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return signals;

    const data = await res.json() as { markets: Array<{
      ticker: string; event_ticker: string; subtitle: string;
      yes_bid: number; yes_ask: number; volume: number; open_interest: number;
      last_price: number; close_time: string;
    }> };

    for (const m of data.markets ?? []) {
      if (m.volume < 100) continue; // Skip very thin markets
      const yesPrice = m.last_price / 100;
      if (yesPrice <= 0.05 || yesPrice >= 0.95) continue; // Skip near-settled

      // Signal: markets where YES is near 50% (maximum uncertainty = maximum edge potential)
      const uncertainty = 1 - Math.abs(yesPrice - 0.5) * 2; // 1.0 at 50%, 0.0 at 0%/100%
      if (uncertainty < 0.3) continue; // Only trade uncertain markets

      const confidence = 30 + uncertainty * 20 + Math.min(m.volume / 1000, 15);
      const side = yesPrice < 0.5 ? 'yes' : 'no';

      // Detect category from event ticker prefix
      let category = 'OTHER';
      const ticker = m.event_ticker.toUpperCase();
      if (ticker.includes('KXBTC') || ticker.includes('KXETH') || ticker.includes('KXSOL')) category = 'CRYPTO';
      else if (ticker.includes('NBA') || ticker.includes('NFL') || ticker.includes('MLB') || ticker.includes('NCAA')) category = 'SPORTS';
      else if (ticker.includes('KXHIGH') || ticker.includes('KXLOW')) category = 'WEATHER';

      signals.push({
        engine: 'new_listing',
        market: m.ticker,
        title: m.subtitle || m.event_ticker,
        category,
        side,
        confidence,
        edge: uncertainty * 5,
        modelProbability: side === 'yes' ? 0.5 + uncertainty * 0.1 : 0.5 - uncertainty * 0.1,
        marketPrice: yesPrice,
        reasoning: `Active market: ${m.subtitle || m.ticker}. YES=${(yesPrice * 100).toFixed(0)}%, vol=${m.volume}, uncertainty=${(uncertainty * 100).toFixed(0)}%.`,
        suggestedSize: Math.min(confidence / 2, 30),
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // silent
  }
  return signals;
}

// ── Unified Intelligence Scan ────────────────────────────────────────────

// ── External Signal Injection (from APEX Bridge, Twitter, etc.) ──────────

const externalSignals: KalshiSignal[] = [];
const MAX_EXTERNAL_SIGNALS = 50;

/** Inject a signal from an external source (APEX Bridge, Twitter scraper, etc.) */
export function injectExternalSignal(signal: KalshiSignal): void {
  externalSignals.push(signal);
  if (externalSignals.length > MAX_EXTERNAL_SIGNALS) externalSignals.shift();
  logger.info({ engine: signal.engine, market: signal.market, confidence: signal.confidence }, `[Kalshi] External signal injected: ${signal.engine}`);
}

export function getExternalSignals(): KalshiSignal[] {
  // Return and clear (consumed by trading loop)
  const signals = [...externalSignals];
  externalSignals.length = 0;
  return signals;
}

export interface PredictionIntelligence {
  signals: KalshiSignal[];
  weatherForecasts: WeatherForecast[];
  categoryScores: CategoryScore[];
  timestamp: string;
}

let cachedIntel: PredictionIntelligence | null = null;
let cachedAt = 0;

export async function scanPredictionMarkets(): Promise<PredictionIntelligence> {
  if (cachedIntel && Date.now() - cachedAt < 300_000) return cachedIntel;

  const [cryptoSignals, weatherForecasts, newListings] = await Promise.all([
    getCrypto15MinSignals(),
    getWeatherForecasts(),
    getNewListingSignals(),
  ]);

  const allSignals = [...cryptoSignals, ...newListings];
  const categoryScores = getAllCategoryScores();

  // Filter signals by category score
  const filteredSignals = allSignals.filter(sig => {
    const catScore = getCategoryScore(sig.category);
    if (catScore.status === 'BLOCKED') {
      logger.info({ market: sig.market, category: sig.category }, '[Kalshi] Signal BLOCKED by category score');
      return false;
    }
    return true;
  });

  cachedIntel = {
    signals: filteredSignals,
    weatherForecasts: weatherForecasts.slice(0, 20),
    categoryScores,
    timestamp: new Date().toISOString(),
  };
  cachedAt = Date.now();

  logger.info(
    { signals: filteredSignals.length, weather: weatherForecasts.length },
    '[Kalshi] Prediction market intelligence scan complete',
  );

  return cachedIntel;
}

// ── Position Monitor (TP/SL) ────────────────────────────────────────────

const KALSHI_TP_PCT = 8;   // Take profit at +8%
const KALSHI_SL_PCT = -5;  // Stop loss at -5%
const KALSHI_MAX_HOLD_MS = 30 * 60_000; // Max hold 30 minutes

async function monitorKalshiPositions(): Promise<void> {
  // FIRST: purge ghost positions (qty=0) and positions on invalid/fake tickers
  const purged = purgeGhostPositions(INVALID_TICKER_PREFIXES);
  if (purged > 0) {
    logger.info({ purged }, `[Kalshi] Purged ${purged} ghost/invalid positions`);
  }

  const portfolio = getKalshiPaperPortfolio();
  if (portfolio.openPositions.length === 0) return;

  // Fetch REAL Kalshi market prices for open positions
  const realKalshiPrices = new Map<string, number>();
  try {
    const { getMarket } = await import('./kalshi-client.js');
    for (const pos of portfolio.openPositions) {
      // Skip positions on invalid tickers — they should have been purged above
      if (!isValidKalshiTicker(pos.ticker)) continue;
      try {
        const market = await getMarket(pos.ticker);
        if (market) {
          const price = pos.side === 'yes' ? (market.yes_bid / 100) : (market.no_bid / 100);
          if (price > 0) realKalshiPrices.set(`${pos.ticker}-${pos.side}`, price);
        }
      } catch { /* individual market fetch failed — ticker may not exist */ }
    }
  } catch { /* Kalshi API unavailable */ }

  for (const pos of portfolio.openPositions) {
    // Skip ghost positions (extra safety — purge should have caught these)
    if (pos.qty <= 0) continue;

    // Get real market price; if we can't get one, we still need to handle max-hold exits
    const realPrice = realKalshiPrices.get(`${pos.ticker}-${pos.side}`);
    const currentPrice = realPrice ?? pos.currentPrice;

    // Persist updated price so portfolio reflects live values
    if (realPrice) {
      updateKalshiPositionPrice(pos.ticker, pos.side, currentPrice);
    }

    const pnlPct = pos.avgEntry > 0 ? ((currentPrice - pos.avgEntry) / pos.avgEntry) * 100 : 0;

    // Check take-profit
    if (pnlPct >= KALSHI_TP_PCT) {
      const sold = kalshiPaperSell(pos.ticker, pos.side, pos.qty, currentPrice);
      if (sold) {
        const p = getKalshiPaperPortfolio();
        logger.info(
          { ticker: pos.ticker, side: pos.side, pnlPct: pnlPct.toFixed(1), wins: p.wins, losses: p.losses, cash: p.cashUsd },
          `[Kalshi] TAKE PROFIT WIN: ${pos.ticker} ${pos.side} +${pnlPct.toFixed(1)}%`,
        );
      }
      continue;
    }

    // Check stop-loss
    if (pnlPct <= KALSHI_SL_PCT) {
      const sold = kalshiPaperSell(pos.ticker, pos.side, pos.qty, currentPrice);
      if (sold) {
        const p = getKalshiPaperPortfolio();
        logger.info(
          { ticker: pos.ticker, side: pos.side, pnlPct: pnlPct.toFixed(1), wins: p.wins, losses: p.losses, cash: p.cashUsd },
          `[Kalshi] STOP LOSS: ${pos.ticker} ${pos.side} ${pnlPct.toFixed(1)}%`,
        );
      }
      continue;
    }

    // Check max hold time — find oldest BUY trade for this position
    const positionTrades = portfolio.recentTrades.filter(
      t => t.ticker === pos.ticker && t.side === pos.side && t.action === 'buy',
    );
    const buyTimestamp = positionTrades.length > 0
      ? new Date(positionTrades[0].timestamp).getTime()
      : Date.now() - KALSHI_MAX_HOLD_MS - 1; // Force-close if no trade history (stale)
    const holdMs = Date.now() - buyTimestamp;

    if (holdMs > KALSHI_MAX_HOLD_MS) {
      // For max-hold exit: use real price if available, otherwise use entry price
      // (results in a $0 P&L loss — correctly recorded as a loss since we failed to profit)
      const exitPrice = realPrice ?? pos.avgEntry;
      const sold = kalshiPaperSell(pos.ticker, pos.side, pos.qty, exitPrice);
      if (sold) {
        const p = getKalshiPaperPortfolio();
        const exitPnl = (exitPrice - pos.avgEntry) * pos.qty;
        logger.info(
          { ticker: pos.ticker, holdMin: (holdMs / 60000).toFixed(0), pnl: exitPnl.toFixed(2), wins: p.wins, losses: p.losses },
          `[Kalshi] MAX HOLD EXIT: ${pos.ticker} after ${(holdMs / 60000).toFixed(0)}min — ${exitPnl >= 0 ? 'WIN' : 'LOSS'} $${exitPnl.toFixed(2)}`,
        );
      }
    }
  }
}

// ── Auto-Trading Loop ────────────────────────────────────────────────────

let tradingInterval: ReturnType<typeof setInterval> | null = null;

export function startKalshiTrading(): void {
  if (tradingInterval) return;

  logger.info('[Kalshi] Starting prediction market auto-trading (paper mode, 5 min cycle)');

  tradingInterval = setInterval(async () => {
    try {
      // Fetch fresh signals from ALL sources (bypass cache for trading decisions)
      const [cryptoSignals, listingSignals] = await Promise.all([
        getCrypto15MinSignals(),
        getNewListingSignals(),
      ]);
      // Include external signals from APEX Bridge, Twitter scraper, etc.
      const externalSigs = getExternalSignals();
      const allSignals = [...cryptoSignals, ...listingSignals, ...externalSigs];
      const portfolio = getKalshiPaperPortfolio();
      logger.info(
        { signalCount: allSignals.length, trades: portfolio.trades, cash: portfolio.cashUsd },
        '[Kalshi] Trading cycle — scanning signals',
      );

      for (const signal of allSignals) {
        if (signal.confidence < 30) continue;

        // CRITICAL: Skip signals with fabricated/invalid tickers
        if (!isValidKalshiTicker(signal.market)) {
          logger.debug({ market: signal.market, engine: signal.engine }, '[Kalshi] Skipping invalid ticker');
          continue;
        }

        const catScore = getCategoryScore(signal.category);
        if (catScore.status === 'BLOCKED') continue;

        // Position size based on confidence and category
        const sizeMult = catScore.status === 'WEAK' ? 0.5 : 1.0;
        const size = Math.min(signal.suggestedSize * sizeMult, 50); // max $50 per trade
        if (size < 5) continue; // minimum $5

        // Entry price: use actual market price from signal, clamped to valid range (0.01 - 0.99)
        const entryPrice = Math.max(0.01, Math.min(0.99, signal.marketPrice > 0 ? signal.marketPrice : signal.modelProbability));
        // Qty: number of contracts at this price. Each contract is worth $1 at settlement.
        const qty = Math.max(1, Math.floor(size / entryPrice));

        const bought = kalshiPaperBuy(
          signal.market,
          signal.title,
          signal.side as 'yes' | 'no',
          qty,
          entryPrice,
          signal.category,
        );

        if (bought) {
          const postTrade = getKalshiPaperPortfolio();
          logger.info(
            { market: signal.market, side: signal.side, qty, entryPrice: entryPrice.toFixed(2), confidence: signal.confidence, totalTrades: postTrade.trades, cashLeft: postTrade.cashUsd },
            `[Kalshi] PAPER TRADE: ${signal.side.toUpperCase()} ${signal.market} ${qty}x@${entryPrice.toFixed(2)} (conf: ${signal.confidence}%)`,
          );
        } else {
          logger.warn({ market: signal.market, side: signal.side, qty, entryPrice, confidence: signal.confidence }, '[Kalshi] Paper buy REJECTED');
        }
      }
      // Monitor existing positions for TP/SL exits
      await monitorKalshiPositions();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[Kalshi] Trading cycle failed');
    }
  }, 5 * 60_000); // every 5 minutes

  // Position monitor runs every 2 minutes (faster than buy cycle)
  setInterval(async () => {
    try {
      await monitorKalshiPositions();
    } catch { /* silent */ }
  }, 2 * 60_000);

  // On startup: purge any ghost/invalid positions from previous runs
  purgeGhostPositions(INVALID_TICKER_PREFIXES);

  // First trading cycle after 15s (don't wait 5 min for first trade)
  setTimeout(async () => {
    try {
      const cryptoSignals = await getCrypto15MinSignals();
      logger.info({ signalCount: cryptoSignals.length }, '[Kalshi] Initial scan — attempting first trades');
      for (const signal of cryptoSignals) {
        if (signal.confidence < 30) continue;
        if (!isValidKalshiTicker(signal.market)) {
          logger.debug({ market: signal.market }, '[Kalshi] Skipping invalid ticker in initial scan');
          continue;
        }
        const catScore = getCategoryScore(signal.category);
        if (catScore.status === 'BLOCKED') continue;
        const sizeMult = catScore.status === 'WEAK' ? 0.5 : 1.0;
        const size = Math.min(signal.suggestedSize * sizeMult, 50);
        if (size < 5) continue;
        const entryPrice = Math.max(0.01, Math.min(0.99, signal.marketPrice > 0 ? signal.marketPrice : signal.modelProbability));
        const qty = Math.max(1, Math.floor(size / entryPrice));
        const bought = kalshiPaperBuy(signal.market, signal.title, signal.side as 'yes' | 'no', qty, entryPrice, signal.category);
        if (bought) {
          const p = getKalshiPaperPortfolio();
          logger.info({ market: signal.market, side: signal.side, qty, entryPrice: entryPrice.toFixed(2), confidence: signal.confidence, totalTrades: p.trades }, '[Kalshi] Initial trade placed');
        }
      }
      const portfolio = getKalshiPaperPortfolio();
      logger.info({ trades: portfolio.trades, cash: portfolio.cashUsd, positions: portfolio.openPositions.length, wins: portfolio.wins, losses: portfolio.losses }, '[Kalshi] Initial trading cycle complete');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, '[Kalshi] Initial scan failed');
    }
  }, 15_000);
}

export function stopKalshiTrading(): void {
  if (tradingInterval) {
    clearInterval(tradingInterval);
    tradingInterval = null;
    logger.info('[Kalshi] Trading stopped');
  }
}

// NOTE: Call startKalshiTrading() from gateway index.ts after all routes are registered
// This ensures the paper portfolio module instance is shared with the API routes.
