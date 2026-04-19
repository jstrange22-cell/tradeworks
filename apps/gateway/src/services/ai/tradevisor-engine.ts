/**
 * Tradevisor Engine — Internal Multi-Indicator Confluence Technical Analysis
 *
 * Replicates the Tradevisor TradingView indicator's buy/sell logic:
 * 6 indicators must confirm before a trade is taken.
 *
 * Indicators:
 *   1. EMA Crossover (9/21) — Trend direction
 *   2. RSI(14) — Momentum filter (30-70 range)
 *   3. MACD(12,26,9) — Momentum confirmation
 *   4. SuperTrend(10,3) — Primary trend filter
 *   5. Bollinger Bands(20,2) — Volatility context
 *   6. Volume — Above 20-day average = confirmation
 *
 * Scoring:
 *   6/6 = "Prime" (90% confidence)
 *   5/6 = "Strong" (75% confidence)
 *   4/6 = "Standard" (60% confidence)
 *   3/6 or less = REJECT
 *
 * Workflow:
 *   Agents discover tickers → Watchlist → Tradevisor analyzes → Only confirmed signals trade
 */

import { logger } from '../../lib/logger.js';
import {
  calcRSI, calcMACD, calcEMA, calcBollingerBands,
  calcSupertrend, calcATR,
} from './indicators.js';
import type { OHLCV, IndicatorSignal } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TradevisorResult {
  ticker: string;
  chain: 'crypto' | 'stock' | 'solana';
  action: 'buy' | 'sell' | 'hold';
  confluenceScore: number;     // 0-6
  confidence: number;          // 0-100
  grade: 'prime' | 'strong' | 'standard' | 'reject';
  indicators: {
    ema: IndicatorSignal;
    rsi: IndicatorSignal;
    macd: IndicatorSignal;
    supertrend: IndicatorSignal;
    bollinger: IndicatorSignal;
    volume: IndicatorSignal;
  };
  currentPrice: number;
  suggestedEntry: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  analyzedAt: string;
  /** Optional human-readable reasoning (populated by multi-TF analyzer) */
  reasoning?: string;
  /** Optional multi-TF alignment strength (populated by multi-TF analyzer) */
  signalStrength?: 'strong' | 'standard' | 'weak';
}

// ── Confluence Scoring ──────────────────────────────────────────────────

function scoreConfluence(indicators: TradevisorResult['indicators']): {
  buyScore: number;
  sellScore: number;
} {
  let buyScore = 0;
  let sellScore = 0;

  // 1. EMA Crossover
  if (indicators.ema.signal === 'bullish') buyScore++;
  else if (indicators.ema.signal === 'bearish') sellScore++;

  // 2. RSI
  if (indicators.rsi.signal === 'bullish') buyScore++;
  else if (indicators.rsi.signal === 'bearish') sellScore++;

  // 3. MACD
  if (indicators.macd.signal === 'bullish') buyScore++;
  else if (indicators.macd.signal === 'bearish') sellScore++;

  // 4. SuperTrend
  if (indicators.supertrend.signal === 'bullish') buyScore++;
  else if (indicators.supertrend.signal === 'bearish') sellScore++;

  // 5. Bollinger Bands
  if (indicators.bollinger.signal === 'bullish') buyScore++;
  else if (indicators.bollinger.signal === 'bearish') sellScore++;

  // 6. Volume
  if (indicators.volume.signal === 'bullish') buyScore++;
  else if (indicators.volume.signal === 'bearish') sellScore++;

  return { buyScore, sellScore };
}

function getGrade(score: number): TradevisorResult['grade'] {
  if (score >= 6) return 'prime';
  if (score >= 5) return 'strong';
  if (score >= 4) return 'standard';
  return 'reject';
}

function getConfidence(score: number): number {
  if (score >= 6) return 90;
  if (score >= 5) return 75;
  if (score >= 4) return 60;
  if (score >= 3) return 40;
  return 20;
}

// ── Volume Indicator (custom — not in indicators.ts) ────────────────────

function calcVolumeConfirmation(candles: OHLCV[]): IndicatorSignal {
  if (candles.length < 21) {
    return { name: 'Volume', value: 0, signal: 'neutral', strength: 50 };
  }

  const avgVolume = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
  const currentVolume = candles[candles.length - 1].volume;
  const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  return {
    name: 'Volume',
    value: ratio,
    signal: ratio > 1.2 ? 'bullish' : ratio < 0.7 ? 'bearish' : 'neutral',
    strength: Math.min(100, Math.round(ratio * 50)),
  };
}

// ── Main Analysis Function ──────────────────────────────────────────────

export function analyzeCandles(ticker: string, candles: OHLCV[], chain: 'crypto' | 'stock' | 'solana'): TradevisorResult {
  if (candles.length < 30) {
    return {
      ticker, chain, action: 'hold', confluenceScore: 0, confidence: 0, grade: 'reject',
      indicators: {
        ema: { name: 'EMA', value: 0, signal: 'neutral', strength: 0 },
        rsi: { name: 'RSI', value: 50, signal: 'neutral', strength: 0 },
        macd: { name: 'MACD', value: 0, signal: 'neutral', strength: 0 },
        supertrend: { name: 'SuperTrend', value: 0, signal: 'neutral', strength: 0 },
        bollinger: { name: 'Bollinger', value: 0, signal: 'neutral', strength: 0 },
        volume: { name: 'Volume', value: 0, signal: 'neutral', strength: 0 },
      },
      currentPrice: candles.length > 0 ? candles[candles.length - 1].close : 0,
      suggestedEntry: 0, suggestedStopLoss: 0, suggestedTakeProfit: 0,
      analyzedAt: new Date().toISOString(),
    };
  }

  // Run all 6 indicators
  const ema9 = calcEMA(candles, 9);
  const ema21 = calcEMA(candles, 21);
  const rsi = calcRSI(candles);
  const macd = calcMACD(candles);
  const supertrend = calcSupertrend(candles, 10, 3);
  const bollinger = calcBollingerBands(candles);
  const volume = calcVolumeConfirmation(candles);

  // EMA crossover: bullish if EMA9 > EMA21
  const emaSignal: IndicatorSignal = {
    name: 'EMA Cross (9/21)',
    value: ema9.value - ema21.value,
    signal: ema9.value > ema21.value ? 'bullish' : ema9.value < ema21.value ? 'bearish' : 'neutral',
    strength: Math.min(100, Math.abs(ema9.value - ema21.value) / (ema21.value || 1) * 1000),
  };

  const indicators = {
    ema: emaSignal,
    rsi,
    macd,
    supertrend,
    bollinger,
    volume,
  };

  // Score confluence
  const { buyScore, sellScore } = scoreConfluence(indicators);
  const dominantScore = Math.max(buyScore, sellScore);
  const action = buyScore >= 4 ? 'buy' : sellScore >= 4 ? 'sell' : 'hold';
  const grade = getGrade(dominantScore);
  const confidence = getConfidence(dominantScore);

  // Calculate entry/stop/target
  const currentPrice = candles[candles.length - 1].close;
  const atr = calcATR(candles);
  const atrValue = atr.value || currentPrice * 0.02; // Fallback 2%

  const suggestedEntry = currentPrice;
  const suggestedStopLoss = action === 'buy'
    ? currentPrice - (atrValue * 2)
    : currentPrice + (atrValue * 2);
  const suggestedTakeProfit = action === 'buy'
    ? currentPrice + (atrValue * 3) // 1.5:1 R/R
    : currentPrice - (atrValue * 3);

  return {
    ticker,
    chain,
    action,
    confluenceScore: dominantScore,
    confidence,
    grade,
    indicators,
    currentPrice,
    suggestedEntry,
    suggestedStopLoss: Math.round(suggestedStopLoss * 100) / 100,
    suggestedTakeProfit: Math.round(suggestedTakeProfit * 100) / 100,
    analyzedAt: new Date().toISOString(),
  };
}

// ── DexScreener OHLCV for New/Discovered Tokens ─────────────────────────

async function analyzeViaDexScreener(symbol: string): Promise<TradevisorResult | null> {
  try {
    // Search DexScreener for this token
    const searchRes = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${symbol}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json() as {
      pairs?: Array<{
        chainId: string;
        baseToken: { symbol: string; address: string };
        priceUsd: string;
        volume: { h24: number };
        liquidity: { usd: number };
        priceChange: { h24: number; h6: number; h1: number; m5: number };
        txns: { h24: { buys: number; sells: number } };
      }>;
    };

    const pairs = searchData.pairs ?? [];
    if (pairs.length === 0) return null;

    // Find the best pair (highest liquidity on Solana or ETH)
    const bestPair = pairs
      .filter(p => p.baseToken.symbol.toUpperCase() === symbol.toUpperCase())
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!bestPair) return null;

    const price = parseFloat(bestPair.priceUsd ?? '0');
    if (price <= 0) return null;

    // Build synthetic candles from DexScreener price changes
    // (DexScreener doesn't provide OHLCV candles, but we can derive signals from price changes)
    const h24Change = bestPair.priceChange?.h24 ?? 0;
    const h6Change = bestPair.priceChange?.h6 ?? 0;
    const h1Change = bestPair.priceChange?.h1 ?? 0;
    const m5Change = bestPair.priceChange?.m5 ?? 0;
    const buys = bestPair.txns?.h24?.buys ?? 0;
    const sells = bestPair.txns?.h24?.sells ?? 0;
    const volume = bestPair.volume?.h24 ?? 0;
    const liquidity = bestPair.liquidity?.usd ?? 0;

    // Synthetic indicator analysis from price changes
    // RSI proxy: recent momentum (loosened thresholds for memecoins)
    const rsiProxy = 50 + (h1Change ?? 0) * 1.5; // Less exaggerated mapping
    const rsiSignal: IndicatorSignal = {
      name: 'RSI(proxy)', value: rsiProxy,
      signal: rsiProxy < 35 ? 'bullish' : rsiProxy > 65 ? 'bearish' : 'neutral',
      strength: Math.abs(rsiProxy - 50) * 2,
    };

    // EMA proxy: 1h vs 24h momentum (loosened from 0.5 to 0.2)
    const emaDiff = h1Change - (h24Change / 24);
    const emaSignal: IndicatorSignal = {
      name: 'EMA(proxy)', value: emaDiff,
      signal: emaDiff > 0.2 ? 'bullish' : emaDiff < -0.2 ? 'bearish' : 'neutral',
      strength: Math.min(100, Math.abs(emaDiff) * 20),
    };

    // MACD proxy: 6h trend vs 24h trend
    const macdProxy = h6Change - (h24Change / 4);
    const macdSignal: IndicatorSignal = {
      name: 'MACD(proxy)', value: macdProxy,
      signal: macdProxy > 0 ? 'bullish' : macdProxy < 0 ? 'bearish' : 'neutral',
      strength: Math.min(100, Math.abs(macdProxy) * 10),
    };

    // SuperTrend proxy: overall trend direction
    const trendScore = (h24Change > 0 ? 1 : 0) + (h6Change > 0 ? 1 : 0) + (h1Change > 0 ? 1 : 0);
    const supertrendSignal: IndicatorSignal = {
      name: 'SuperTrend(proxy)', value: trendScore,
      signal: trendScore >= 2 ? 'bullish' : trendScore <= 1 ? 'bearish' : 'neutral',
      strength: trendScore * 33,
    };

    // Bollinger proxy: 5m change magnitude (loosened from 2% to 1%)
    const bbSignal: IndicatorSignal = {
      name: 'BB(proxy)', value: m5Change,
      signal: m5Change > 1 ? 'bullish' : m5Change < -1 ? 'bearish' : 'neutral',
      strength: Math.min(100, Math.abs(m5Change) * 20),
    };

    // Volume: buy/sell ratio (loosened from 1.3 to 1.2)
    const bsRatio = sells > 0 ? buys / sells : buys > 0 ? 2 : 1;
    const volSignal: IndicatorSignal = {
      name: 'Volume', value: bsRatio,
      signal: bsRatio > 1.2 ? 'bullish' : bsRatio < 0.8 ? 'bearish' : 'neutral',
      strength: Math.min(100, Math.abs(bsRatio - 1) * 100),
    };

    const indicators = { ema: emaSignal, rsi: rsiSignal, macd: macdSignal, supertrend: supertrendSignal, bollinger: bbSignal, volume: volSignal };
    const { buyScore, sellScore } = scoreConfluence(indicators);
    const dominantScore = Math.max(buyScore, sellScore);
    const action = buyScore >= 4 ? 'buy' : sellScore >= 4 ? 'sell' : 'hold';

    const atrProxy = price * 0.03; // 3% of price as ATR proxy

    if (action !== 'hold') {
      logger.info(
        { symbol, action, score: dominantScore, price, volume, liquidity },
        `[Tradevisor-DexScreener] ${action.toUpperCase()} ${symbol} — ${dominantScore}/6 confluence`,
      );
    }

    // Return ALL results (including hold) so watchlist can display monitoring status
    return {
      ticker: symbol,
      chain: 'solana' as const,
      action,
      confluenceScore: dominantScore,
      confidence: getConfidence(dominantScore),
      grade: getGrade(dominantScore),
      indicators,
      currentPrice: price,
      suggestedEntry: price,
      suggestedStopLoss: action === 'buy' ? price - atrProxy * 2 : price + atrProxy * 2,
      suggestedTakeProfit: action === 'buy' ? price + atrProxy * 3 : price - atrProxy * 3,
      analyzedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ symbol, err: err instanceof Error ? err.message : err }, '[Tradevisor-DexScreener] Analysis failed');
    return null;
  }
}

// ── Fetch + Analyze Crypto Ticker ───────────────────────────────────────

export async function analyzeTickerCrypto(symbol: string): Promise<TradevisorResult | null> {
  logger.info({ symbol }, `[Tradevisor] Analyzing crypto ticker: ${symbol}`);
  try {
    // ── PRIMARY PATH: Coinbase multi-timeframe (1h/4h/1D) ──
    // This is the TradingView-quality data source. Real intraday candles with real volume.
    const multiTF = await analyzeMultiTimeframeCoinbase(symbol);
    if (multiTF) {
      logger.info(
        { symbol, action: multiTF.action, score: multiTF.confluenceScore, strength: multiTF.signalStrength },
        `[Tradevisor] Multi-TF Coinbase result for ${symbol}`,
      );
      return multiTF;
    }

    // ── FALLBACK 1: DexScreener for new/discovered tokens ──
    const dexResult = await analyzeViaDexScreener(symbol);
    if (dexResult) {
      logger.info({ symbol, action: dexResult.action, score: dexResult.confluenceScore }, `[Tradevisor] DexScreener fallback for ${symbol}`);
      return dexResult;
    }

    // ── FALLBACK 2: CoinGecko daily OHLC (legacy) ──
    logger.info({ symbol }, `[Tradevisor] Falling back to CoinGecko for ${symbol}`);
    const idMap: Record<string, string> = {
      BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', AVAX: 'avalanche-2',
      LINK: 'chainlink', DOGE: 'dogecoin', ADA: 'cardano', DOT: 'polkadot',
      NEAR: 'near', SUI: 'sui', XRP: 'ripple', MATIC: 'matic-network',
      ATOM: 'cosmos', UNI: 'uniswap', AAVE: 'aave', LTC: 'litecoin',
      ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', SHIB: 'shiba-inu',
      SIREN: 'siren', MON: 'monad', EDGE: 'edgex', ALGO: 'algorand',
      TAO: 'bittensor', RENDER: 'render-token', HYPE: 'hyperliquid',
    };

    const geckoId = idMap[symbol.toUpperCase()] ?? symbol.toLowerCase();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/ohlc?vs_currency=usd&days=30`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;

    const data = await res.json() as Array<[number, number, number, number, number]>;
    if (!Array.isArray(data) || data.length < 30) return null;

    const candles: OHLCV[] = data.map(d => ({
      timestamp: d[0],
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
      volume: 0, // CoinGecko OHLC doesn't include volume
    }));

    // Fetch volume separately
    try {
      const volRes = await fetch(
        `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=30&interval=daily`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (volRes.ok) {
        const volData = await volRes.json() as { total_volumes: Array<[number, number]> };
        const volumes = volData.total_volumes ?? [];
        for (let i = 0; i < Math.min(candles.length, volumes.length); i++) {
          candles[i].volume = volumes[i]?.[1] ?? 0;
        }
      }
    } catch { /* volume optional */ }

    return analyzeCandles(symbol, candles, 'crypto');
  } catch (err) {
    logger.warn({ symbol, err: err instanceof Error ? err.message : err }, '[Tradevisor] Crypto analysis failed');
    return null;
  }
}

// ── Multi-Timeframe Coinbase Analyzer ───────────────────────────────────
//
// Fetches 1h/4h/1D candles from Coinbase, runs the existing analyzeCandles
// logic on each timeframe, and aggregates using:
//   1h  = primary trigger (the action we actually take)
//   4h  = trend filter    (can veto contradicting 1h signal)
//   1D  = regime gate     (bearish daily can override buy to hold)
//
// When all 3 timeframes agree on direction, signal strength is "strong" and
// the confluence score gets a +1 boost. When 2 of 3 agree, strength is "standard".
// Otherwise the signal gets downgraded to hold.

async function analyzeMultiTimeframeCoinbase(symbol: string): Promise<TradevisorResult | null> {
  try {
    const { fetchMultiTimeframe } = await import('./coinbase-candles.js');
    const multi = await fetchMultiTimeframe(symbol);
    if (!multi) return null;

    // Run the EXISTING analyzeCandles on each timeframe independently
    const h1 = analyzeCandles(symbol, multi.h1, 'crypto');
    const h4 = analyzeCandles(symbol, multi.h4, 'crypto');
    const d1 = analyzeCandles(symbol, multi.d1, 'crypto');

    // Start from 1h as primary
    let action: 'buy' | 'sell' | 'hold' = h1.action;
    let score = h1.confluenceScore;
    let strength: 'strong' | 'standard' | 'weak' = 'weak';

    // Trend filter: 1h/4h conflict → downgrade to hold
    if (action === 'buy' && h4.action === 'sell') {
      logger.info({ symbol, h1: 'buy', h4: 'sell' }, '[Tradevisor] 1h/4h conflict — HOLD');
      action = 'hold';
    }
    if (action === 'sell' && h4.action === 'buy') {
      logger.info({ symbol, h1: 'sell', h4: 'buy' }, '[Tradevisor] 1h/4h conflict — HOLD');
      action = 'hold';
    }

    // Regime gate: strong bearish 1D overrides buy
    if (action === 'buy' && d1.action === 'sell' && d1.confluenceScore >= 4) {
      logger.info({ symbol, d1Score: d1.confluenceScore }, '[Tradevisor] 1D regime bearish — HOLD');
      action = 'hold';
    }
    // Regime gate: strong bullish 1D overrides sell
    if (action === 'sell' && d1.action === 'buy' && d1.confluenceScore >= 4) {
      logger.info({ symbol, d1Score: d1.confluenceScore }, '[Tradevisor] 1D regime bullish — HOLD');
      action = 'hold';
    }

    // Alignment detection
    const allAgree = h1.action === h4.action && h4.action === d1.action && h1.action !== 'hold';
    const twoAgree = (
      (h1.action === h4.action && h1.action !== 'hold') ||
      (h1.action === d1.action && h1.action !== 'hold') ||
      (h4.action === d1.action && h4.action !== 'hold')
    );

    // Boost score when all 3 timeframes align (lets valid 3/6 signals become tradeable 4/6)
    if (allAgree && action !== 'hold') {
      strength = 'strong';
      score = Math.min(6, score + 1);
    } else if (twoAgree && action !== 'hold') {
      strength = 'standard';
    }

    // Recompute grade/confidence based on boosted score
    const grade = getGrade(score);
    const confidence = getConfidence(score);

    return {
      ticker: symbol,
      chain: 'crypto',
      action,
      confluenceScore: score,
      confidence,
      grade,
      indicators: h1.indicators, // Primary timeframe indicators
      currentPrice: h1.currentPrice,
      suggestedEntry: h1.suggestedEntry,
      suggestedStopLoss: h1.suggestedStopLoss,
      suggestedTakeProfit: h1.suggestedTakeProfit,
      analyzedAt: new Date().toISOString(),
      signalStrength: strength,
      reasoning: `Multi-TF: 1h=${h1.action}(${h1.confluenceScore}/6) | 4h=${h4.action}(${h4.confluenceScore}/6) | 1D=${d1.action}(${d1.confluenceScore}/6) | strength=${strength}`,
    };
  } catch (err) {
    logger.warn(
      { symbol, err: err instanceof Error ? err.message : err },
      '[Tradevisor] Multi-TF Coinbase analysis failed',
    );
    return null;
  }
}

// ── Fetch + Analyze Stock Ticker ────────────────────────────────────────

export async function analyzeTickerStock(symbol: string): Promise<TradevisorResult | null> {
  try {
    const { getBars } = await import('../stocks/alpaca-client.js');
    const barsResp = await getBars({ symbols: [symbol], timeframe: '1Day', limit: 60 });
    const bars = barsResp.bars[symbol];
    if (!bars || bars.length < 30) return null;

    const candles: OHLCV[] = bars.map(b => ({
      timestamp: new Date(b.t).getTime(),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
    }));

    return analyzeCandles(symbol, candles, 'stock');
  } catch (err) {
    logger.warn({ symbol, err: err instanceof Error ? err.message : err }, '[Tradevisor] Stock analysis failed');
    return null;
  }
}

// ── Scan Watchlist ──────────────────────────────────────────────────────

export async function runTradevisorScan(watchlist: Array<{ ticker: string; chain: 'crypto' | 'stock' | 'solana' }>): Promise<TradevisorResult[]> {
  const results: TradevisorResult[] = [];
  logger.info({ count: watchlist.length, items: watchlist.map(w => `${w.ticker}(${w.chain})`) }, `[Tradevisor] Starting scan of ${watchlist.length} items`);

  for (const item of watchlist) {
    let result: TradevisorResult | null = null;

    if (item.chain === 'crypto' || item.chain === 'solana') {
      result = await analyzeTickerCrypto(item.ticker);
    } else if (item.chain === 'stock') {
      result = await analyzeTickerStock(item.ticker);
    }
    logger.info({ ticker: item.ticker, chain: item.chain, hasResult: result !== null }, `[Tradevisor] ${item.ticker}: ${result ? result.action + ' ' + result.confluenceScore + '/6' : 'no data'}`);

    if (result) {
      results.push(result);

      if (result.action !== 'hold') {
        logger.info(
          { ticker: result.ticker, action: result.action, score: result.confluenceScore, grade: result.grade, confidence: result.confidence },
          `[Tradevisor] ${result.action.toUpperCase()} ${result.ticker} — ${result.confluenceScore}/6 confluence (${result.grade})`,
        );
      }
    }

    // Rate limit: 1.5s between CoinGecko calls
    if (item.chain === 'crypto') {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return results;
}

// ── Stats ───────────────────────────────────────────────────────────────

let totalScans = 0;
let totalSignals = 0;
let lastScanAt: string | null = null;

export function getTradevisorStats() {
  return { totalScans, totalSignals, lastScanAt };
}

export function recordScanStats(signalCount: number) {
  totalScans++;
  totalSignals += signalCount;
  lastScanAt = new Date().toISOString();
}
