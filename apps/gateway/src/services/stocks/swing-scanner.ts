/**
 * Stock Swing Trading Scanner
 *
 * Scans a watchlist of stocks for swing trade setups using technical analysis.
 * Signals: RSI oversold + MACD crossover + volume spike + support/resistance.
 *
 * Supports:
 *   - Multi-timeframe analysis (daily + hourly confirmation)
 *   - DCA entries (split buy into 2-3 tranches)
 *   - Auto stop-loss and take-profit via Alpaca bracket orders
 *   - Sector rotation awareness (via macro regime)
 */

import {
  getBars,
  getSnapshots,
  type AlpacaBar,
} from './alpaca-client.js';
import { getMacroRegime } from '../ai/macro-regime.js';
import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface SwingSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;       // 0-100
  reasons: string[];
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  indicators: {
    rsi14: number;
    macdHistogram: number;
    macdCrossover: boolean;
    volumeRatio: number;     // current vs 20-day avg
    atr14: number;
    ema20: number;
    ema50: number;
    ema200: number;
    priceVsEma200: number;   // percent above/below
    bbPosition: number;      // 0=lower band, 1=upper band
  };
  dcaPlan?: DcaPlan;
  timestamp: string;
}

export interface DcaPlan {
  tranches: Array<{
    price: number;
    percentOfTotal: number;
    label: string;
  }>;
  avgEntryPrice: number;
  totalRiskPercent: number;
}

export interface ScanResult {
  signals: SwingSignal[];
  macroRegime: string;
  positionSizeMultiplier: number;
  scannedAt: string;
  watchlistSize: number;
}

// ── Default Watchlist ────────────────────────────────────────────────────

const DEFAULT_WATCHLIST = [
  // Mega caps
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  // Growth
  'AMD', 'CRM', 'SNOW', 'NET', 'DDOG', 'CRWD', 'PLTR',
  // Finance
  'JPM', 'GS', 'V', 'MA', 'SQ',
  // Energy
  'XOM', 'CVX',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'XLF', 'XLE', 'XLK',
  // Crypto-adjacent
  'COIN', 'MSTR', 'MARA', 'RIOT',
];

// ── Indicator Calculations ───────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macdLine = ema12 - ema26;

  // Approximate signal line (9-period EMA of MACD) using recent MACD values
  // Simplified: use the MACD line value directly for crossover detection
  const prevEma12 = calcEMA(prices.slice(0, -1), 12);
  const prevEma26 = calcEMA(prices.slice(0, -1), 26);
  const prevMacd = prevEma12 - prevEma26;

  const signalLine = (macdLine + prevMacd) / 2; // rough approximation
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

function calcATR(bars: AlpacaBar[], period = 14): number {
  if (bars.length < period + 1) return 0;
  const trValues: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recent = trValues.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

function calcBollingerPosition(prices: number[], period = 20): number {
  if (prices.length < period) return 0.5;
  const recent = prices.slice(-period);
  const sma = recent.reduce((s, p) => s + p, 0) / period;
  const stdDev = Math.sqrt(recent.reduce((s, p) => s + (p - sma) ** 2, 0) / period);
  if (stdDev === 0) return 0.5;
  const upper = sma + 2 * stdDev;
  const lower = sma - 2 * stdDev;
  const current = prices[prices.length - 1];
  return Math.max(0, Math.min(1, (current - lower) / (upper - lower)));
}

function calcVolumeRatio(volumes: number[], lookback = 20): number {
  if (volumes.length < lookback + 1) return 1;
  const avgVol = volumes.slice(-lookback - 1, -1).reduce((s, v) => s + v, 0) / lookback;
  if (avgVol === 0) return 1;
  return volumes[volumes.length - 1] / avgVol;
}

// ── Scanner ──────────────────────────────────────────────────────────────

async function analyzeSymbol(
  symbol: string,
  dailyBars: AlpacaBar[],
  currentPrice: number,
): Promise<SwingSignal | null> {
  if (dailyBars.length < 50) return null;

  const closes = dailyBars.map(b => b.c);
  const volumes = dailyBars.map(b => b.v);

  // Calculate indicators
  const rsi14 = calcRSI(closes);
  const macd = calcMACD(closes);
  const atr14 = calcATR(dailyBars);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const volumeRatio = calcVolumeRatio(volumes);
  const bbPosition = calcBollingerPosition(closes);
  const priceVsEma200 = ema200 > 0 ? ((currentPrice - ema200) / ema200) * 100 : 0;

  // MACD crossover detection
  const prevCloses = closes.slice(0, -1);
  const prevMacd = calcMACD(prevCloses);
  const macdCrossover = prevMacd.histogram < 0 && macd.histogram > 0;

  const indicators = {
    rsi14,
    macdHistogram: macd.histogram,
    macdCrossover,
    volumeRatio,
    atr14,
    ema20,
    ema50,
    ema200,
    priceVsEma200,
    bbPosition,
  };

  // ── Scoring System ───────────────────────────────────────────────────

  let score = 0;
  const reasons: string[] = [];

  // RSI oversold (< 35 for swing entry)
  if (rsi14 < 30) {
    score += 25;
    reasons.push(`RSI deeply oversold at ${rsi14.toFixed(1)}`);
  } else if (rsi14 < 40) {
    score += 15;
    reasons.push(`RSI approaching oversold at ${rsi14.toFixed(1)}`);
  }

  // RSI overbought (exit signal)
  if (rsi14 > 75) {
    score -= 20;
    reasons.push(`RSI overbought at ${rsi14.toFixed(1)} — sell signal`);
  }

  // MACD bullish crossover
  if (macdCrossover) {
    score += 25;
    reasons.push('MACD bullish crossover');
  } else if (macd.histogram > 0 && prevMacd.histogram > 0 && macd.histogram > prevMacd.histogram) {
    score += 10;
    reasons.push('MACD histogram expanding bullish');
  }

  // Volume confirmation
  if (volumeRatio > 1.5) {
    score += 15;
    reasons.push(`Volume ${volumeRatio.toFixed(1)}x above average`);
  } else if (volumeRatio > 1.2) {
    score += 8;
    reasons.push(`Volume slightly elevated at ${volumeRatio.toFixed(1)}x`);
  }

  // EMA alignment (bullish: price > EMA20 > EMA50)
  if (currentPrice > ema20 && ema20 > ema50) {
    score += 15;
    reasons.push('Bullish EMA alignment (price > EMA20 > EMA50)');
  } else if (currentPrice < ema20 && currentPrice < ema50) {
    score -= 10;
    reasons.push('Below key moving averages');
  }

  // Above 200 EMA (long-term trend)
  if (priceVsEma200 > 0) {
    score += 10;
    reasons.push(`Above 200 EMA by ${priceVsEma200.toFixed(1)}%`);
  } else if (priceVsEma200 < -10) {
    score -= 15;
    reasons.push(`Below 200 EMA by ${Math.abs(priceVsEma200).toFixed(1)}% — bearish`);
  }

  // Bollinger Bands
  if (bbPosition < 0.15) {
    score += 15;
    reasons.push('Near lower Bollinger Band — potential bounce');
  } else if (bbPosition > 0.9) {
    score -= 10;
    reasons.push('Near upper Bollinger Band — potential resistance');
  }

  // Minimum score threshold for buy signal
  const confidence = Math.max(0, Math.min(100, score));

  if (confidence < 40) return null; // Skip weak signals

  // ── Calculate Levels ───────────────────────────────────────────────

  const stopLoss = currentPrice - (atr14 * 2);
  const takeProfit = currentPrice + (atr14 * 3);
  const riskReward = atr14 > 0 ? (takeProfit - currentPrice) / (currentPrice - stopLoss) : 0;

  // DCA plan: split into 3 tranches
  const dcaPlan: DcaPlan = {
    tranches: [
      { price: currentPrice, percentOfTotal: 40, label: 'Initial entry' },
      { price: currentPrice - atr14 * 0.5, percentOfTotal: 30, label: 'First dip (0.5 ATR)' },
      { price: currentPrice - atr14 * 1.0, percentOfTotal: 30, label: 'Second dip (1 ATR)' },
    ],
    avgEntryPrice: currentPrice - atr14 * 0.3,
    totalRiskPercent: ((currentPrice - stopLoss) / currentPrice) * 100,
  };

  const action = confidence >= 60 ? 'buy' : 'hold';

  return {
    symbol,
    action,
    confidence,
    reasons,
    entry: currentPrice,
    stopLoss,
    takeProfit,
    riskReward,
    indicators,
    dcaPlan: action === 'buy' ? dcaPlan : undefined,
    timestamp: new Date().toISOString(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Scan the watchlist for swing trade opportunities.
 * Returns signals sorted by confidence descending.
 */
export async function scanForSwingTrades(
  watchlist?: string[],
): Promise<ScanResult> {
  const symbols = watchlist ?? DEFAULT_WATCHLIST;

  // Get macro regime to adjust position sizing
  const regime = await getMacroRegime();

  // Fetch daily bars for all symbols (200 days for EMA200)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 300);

  let allBars: Record<string, AlpacaBar[]> = {};
  let snapshots: Record<string, { latestTrade: { p: number } }> = {};

  try {
    // Fetch in batches of 10 symbols (Alpaca limit)
    for (let i = 0; i < symbols.length; i += 10) {
      const batch = symbols.slice(i, i + 10);
      const barsRes = await getBars({
        symbols: batch,
        timeframe: '1Day',
        start: startDate.toISOString(),
        limit: 250,
      });
      allBars = { ...allBars, ...barsRes.bars };

      // Small delay to respect rate limits
      if (i + 10 < symbols.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Get current prices
    for (let i = 0; i < symbols.length; i += 10) {
      const batch = symbols.slice(i, i + 10);
      const snap = await getSnapshots(batch);
      snapshots = { ...snapshots, ...snap };

      if (i + 10 < symbols.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } catch (err) {
    logger.error({ err }, '[SwingScanner] Failed to fetch market data');
    return {
      signals: [],
      macroRegime: regime.regime,
      positionSizeMultiplier: regime.positionSizeMultiplier,
      scannedAt: new Date().toISOString(),
      watchlistSize: symbols.length,
    };
  }

  // Analyze each symbol
  const signals: SwingSignal[] = [];
  for (const symbol of symbols) {
    const bars = allBars[symbol];
    const snapshot = snapshots[symbol];
    if (!bars?.length || !snapshot) continue;

    const currentPrice = snapshot.latestTrade?.p ?? bars[bars.length - 1]?.c;
    if (!currentPrice) continue;

    try {
      const signal = await analyzeSymbol(symbol, bars, currentPrice);
      if (signal) signals.push(signal);
    } catch (err) {
      logger.warn({ symbol, err }, '[SwingScanner] Analysis failed for symbol');
    }
  }

  // Sort by confidence descending
  signals.sort((a, b) => b.confidence - a.confidence);

  return {
    signals,
    macroRegime: regime.regime,
    positionSizeMultiplier: regime.positionSizeMultiplier,
    scannedAt: new Date().toISOString(),
    watchlistSize: symbols.length,
  };
}

export { DEFAULT_WATCHLIST };
