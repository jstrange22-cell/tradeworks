import type { OHLCV } from '@tradeworks/shared';
import {
  rsi,
  ema,
  sma,
  macd,
  bollinger,
  atr,
  vwap,
  obv,
  stochastic,
  cci,
  detectCandlestickPatterns,
  detectOrderBlocks,
  detectFairValueGaps,
  detectLiquidityZones,
  aggregateSignals,
} from '@tradeworks/indicators';
import type { CandlestickPattern } from '@tradeworks/indicators';
import { getCandles as fetchCandlesFromCH } from '@tradeworks/db';
import type { MCPTool } from './types.js';

// ---------------------------------------------------------------------------
// Result interfaces (also used by the orchestrator)
// ---------------------------------------------------------------------------

export interface IndicatorResult {
  name: string;
  values: number[];
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0-1
}

export interface PatternResult {
  name: string;
  type: 'candlestick' | 'chart' | 'harmonic' | 'smc';
  timeframe: string;
  direction: 'bullish' | 'bearish';
  reliability: number; // 0-1
  priceLevel: number;
  description: string;
}

export interface SignalScore {
  instrument: string;
  score: number; // -1.0 (strong sell) to +1.0 (strong buy)
  components: Array<{
    indicator: string;
    contribution: number;
    weight: number;
  }>;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Indicator computation helpers
// ---------------------------------------------------------------------------

function closePrices(candles: OHLCV[]): number[] {
  return candles.map((c) => c.close);
}


function computeSingleIndicator(
  name: string,
  candles: OHLCV[],
  params: Record<string, number>,
): IndicatorResult {
  const closes = closePrices(candles);

  switch (name) {
    case 'rsi': {
      const period = params.rsi_period ?? 14;
      const values = rsi(closes, period);
      const lastVal = values[values.length - 1] ?? 50;
      let signal: IndicatorResult['signal'] = 'neutral';
      let strength = 0;

      if (lastVal < 30) {
        signal = 'bullish'; // oversold
        strength = (30 - lastVal) / 30;
      } else if (lastVal > 70) {
        signal = 'bearish'; // overbought
        strength = (lastVal - 70) / 30;
      } else {
        strength = 0.1;
      }

      return { name: 'rsi', values, signal, strength: Math.min(strength, 1) };
    }

    case 'macd': {
      const result = macd(closes);
      const hist = result.histogram;
      const lastHist = hist[hist.length - 1] ?? 0;
      const prevHist = hist[hist.length - 2] ?? 0;

      let signal: IndicatorResult['signal'] = 'neutral';
      let strength = 0;

      if (lastHist > 0 && lastHist > prevHist) {
        signal = 'bullish';
        strength = Math.min(Math.abs(lastHist) / (Math.abs(closes[closes.length - 1]!) * 0.01), 1);
      } else if (lastHist < 0 && lastHist < prevHist) {
        signal = 'bearish';
        strength = Math.min(Math.abs(lastHist) / (Math.abs(closes[closes.length - 1]!) * 0.01), 1);
      } else {
        strength = 0.1;
      }

      return { name: 'macd', values: hist, signal, strength };
    }

    case 'sma': {
      const period = params.sma_period ?? 20;
      const values = sma(closes, period);
      const lastSma = values[values.length - 1] ?? 0;
      const lastClose = closes[closes.length - 1] ?? 0;

      const signal: IndicatorResult['signal'] =
        lastClose > lastSma ? 'bullish' : lastClose < lastSma ? 'bearish' : 'neutral';
      const pctDiff = lastSma > 0 ? Math.abs(lastClose - lastSma) / lastSma : 0;

      return { name: 'sma', values, signal, strength: Math.min(pctDiff * 10, 1) };
    }

    case 'ema': {
      const period = params.ema_period ?? 20;
      const values = ema(closes, period);
      const lastEma = values[values.length - 1] ?? 0;
      const lastClose = closes[closes.length - 1] ?? 0;

      const signal: IndicatorResult['signal'] =
        lastClose > lastEma ? 'bullish' : lastClose < lastEma ? 'bearish' : 'neutral';
      const pctDiff = lastEma > 0 ? Math.abs(lastClose - lastEma) / lastEma : 0;

      return { name: 'ema', values, signal, strength: Math.min(pctDiff * 10, 1) };
    }

    case 'bollinger': {
      const period = params.bollinger_period ?? 20;
      const mult = params.bollinger_stddev ?? 2;
      const result = bollinger(closes, period, mult);
      const lastClose = closes[closes.length - 1] ?? 0;
      const lastUpper = result.upper[result.upper.length - 1] ?? 0;
      const lastLower = result.lower[result.lower.length - 1] ?? 0;
      const bandwidth = lastUpper - lastLower;

      let signal: IndicatorResult['signal'] = 'neutral';
      let strength = 0;

      if (lastClose <= lastLower && bandwidth > 0) {
        signal = 'bullish';
        strength = Math.min((lastLower - lastClose) / bandwidth + 0.5, 1);
      } else if (lastClose >= lastUpper && bandwidth > 0) {
        signal = 'bearish';
        strength = Math.min((lastClose - lastUpper) / bandwidth + 0.5, 1);
      } else if (bandwidth > 0) {
        const position = (lastClose - lastLower) / bandwidth;
        strength = Math.abs(position - 0.5) * 0.5;
        signal = position < 0.3 ? 'bullish' : position > 0.7 ? 'bearish' : 'neutral';
      }

      return { name: 'bollinger', values: result.middle, signal, strength };
    }

    case 'atr': {
      const period = params.atr_period ?? 14;
      const values = atr(candles, period);
      // ATR is not directional; report as neutral with strength based on relative size
      const lastAtr = values[values.length - 1] ?? 0;
      const lastClose = closes[closes.length - 1] ?? 1;
      const relativeAtr = lastAtr / lastClose;

      return {
        name: 'atr',
        values,
        signal: 'neutral',
        strength: Math.min(relativeAtr * 20, 1), // high ATR => high strength/volatility
      };
    }

    case 'vwap': {
      const values = vwap(candles);
      const lastVwap = values[values.length - 1] ?? 0;
      const lastClose = closes[closes.length - 1] ?? 0;

      const signal: IndicatorResult['signal'] =
        lastClose > lastVwap ? 'bullish' : lastClose < lastVwap ? 'bearish' : 'neutral';
      const pctDiff = lastVwap > 0 ? Math.abs(lastClose - lastVwap) / lastVwap : 0;

      return { name: 'vwap', values, signal, strength: Math.min(pctDiff * 10, 1) };
    }

    case 'obv': {
      const values = obv(candles);
      // Determine trend direction of OBV via simple slope
      const len = Math.min(values.length, 10);
      const recent = values.slice(-len);
      const first = recent[0] ?? 0;
      const last = recent[recent.length - 1] ?? 0;

      const signal: IndicatorResult['signal'] =
        last > first ? 'bullish' : last < first ? 'bearish' : 'neutral';
      const change = first !== 0 ? Math.abs(last - first) / Math.abs(first) : 0;

      return { name: 'obv', values, signal, strength: Math.min(change, 1) };
    }

    case 'stochastic': {
      const kPeriod = params.stoch_k ?? 14;
      const dPeriod = params.stoch_d ?? 3;
      const result = stochastic(candles, kPeriod, dPeriod);
      const lastK = result.k[result.k.length - 1] ?? 50;

      let signal: IndicatorResult['signal'] = 'neutral';
      let strength = 0;

      if (lastK < 20) {
        signal = 'bullish';
        strength = (20 - lastK) / 20;
      } else if (lastK > 80) {
        signal = 'bearish';
        strength = (lastK - 80) / 20;
      } else {
        strength = 0.1;
      }

      return { name: 'stochastic', values: result.k, signal, strength: Math.min(strength, 1) };
    }

    case 'cci': {
      const period = params.cci_period ?? 20;
      const values = cci(candles, period);
      const lastVal = values[values.length - 1] ?? 0;

      let signal: IndicatorResult['signal'] = 'neutral';
      let strength = 0;

      if (lastVal < -100) {
        signal = 'bullish';
        strength = Math.min(Math.abs(lastVal + 100) / 200, 1);
      } else if (lastVal > 100) {
        signal = 'bearish';
        strength = Math.min(Math.abs(lastVal - 100) / 200, 1);
      } else {
        strength = Math.abs(lastVal) / 200;
      }

      return { name: 'cci', values, signal, strength };
    }

    default:
      console.warn(`[AnalysisTools] Unknown indicator: ${name}`);
      return { name, values: [], signal: 'neutral', strength: 0 };
  }
}

// ---------------------------------------------------------------------------
// Exported standalone functions (consumed by the orchestrator directly)
// ---------------------------------------------------------------------------

/**
 * Calculate technical indicators on candle data.
 */
export async function computeIndicators(params: {
  candles: OHLCV[];
  indicators: string[];
  params?: Record<string, number>;
}): Promise<IndicatorResult[]> {
  console.log(
    `[AnalysisTools] Computing ${params.indicators.length} indicators on ${params.candles.length} candles`,
  );

  const indicatorParams = params.params ?? {};
  return params.indicators.map((name) =>
    computeSingleIndicator(name, params.candles, indicatorParams),
  );
}

/**
 * Run pattern detection on candle data.
 */
export async function detectPatterns(params: {
  candles: OHLCV[];
  patternTypes?: ('candlestick' | 'chart' | 'harmonic' | 'smc')[];
  timeframe: string;
}): Promise<PatternResult[]> {
  const types = params.patternTypes ?? ['candlestick', 'smc'];
  console.log(`[AnalysisTools] Detecting patterns: ${types.join(', ')} on ${params.timeframe}`);

  const results: PatternResult[] = [];
  const candles = params.candles;
  const lastClose = candles.length > 0 ? candles[candles.length - 1]!.close : 0;

  if (types.includes('candlestick')) {
    const detected: CandlestickPattern[] = detectCandlestickPatterns(candles);
    // Only report patterns from the last 5 candles (actionable)
    const recent = detected.filter((p) => p.index >= candles.length - 5);
    for (const p of recent) {
      const reliabilityMap: Record<string, number> = { low: 0.3, medium: 0.6, high: 0.9 };
      results.push({
        name: p.name,
        type: 'candlestick',
        timeframe: params.timeframe,
        direction: p.type,
        reliability: reliabilityMap[p.reliability] ?? 0.5,
        priceLevel: candles[p.index]?.close ?? lastClose,
        description: `${p.name} (${p.type}) detected at index ${p.index}`,
      });
    }
  }

  if (types.includes('smc')) {
    // Smart Money Concepts: order blocks, FVGs, liquidity zones
    try {
      const orderBlocks = detectOrderBlocks(candles);
      const unmitigated = orderBlocks.filter((ob) => !ob.mitigated).slice(-3);
      for (const ob of unmitigated) {
        results.push({
          name: `OrderBlock_${ob.type}`,
          type: 'smc',
          timeframe: params.timeframe,
          direction: ob.type,
          reliability: 0.7,
          priceLevel: ob.type === 'bullish' ? ob.low : ob.high,
          description: `${ob.type} order block zone ${ob.low.toFixed(2)}-${ob.high.toFixed(2)}`,
        });
      }
    } catch {
      // Order block detection may fail on insufficient data
    }

    try {
      const fvgs = detectFairValueGaps(candles);
      const unfilled = fvgs.filter((g) => !g.filled).slice(-3);
      for (const fvg of unfilled) {
        results.push({
          name: `FVG_${fvg.type}`,
          type: 'smc',
          timeframe: params.timeframe,
          direction: fvg.type,
          reliability: 0.6,
          priceLevel: fvg.type === 'bullish' ? fvg.low : fvg.high,
          description: `${fvg.type} fair value gap ${fvg.low.toFixed(2)}-${fvg.high.toFixed(2)} (size: ${fvg.size.toFixed(2)})`,
        });
      }
    } catch {
      // FVG detection may fail on insufficient data
    }

    try {
      const zones = detectLiquidityZones(candles);
      for (const zone of zones.slice(-3)) {
        results.push({
          name: `Liquidity_${zone.side}`,
          type: 'smc',
          timeframe: params.timeframe,
          direction: zone.side === 'buy' ? 'bullish' : 'bearish',
          reliability: 0.65,
          priceLevel: zone.price,
          description: `${zone.side} liquidity zone at ${zone.price.toFixed(2)} (touches: ${zone.touches})`,
        });
      }
    } catch {
      // Liquidity zone detection may fail on insufficient data
    }
  }

  return results;
}

/**
 * Get an aggregate signal score combining multiple indicators.
 */
export async function getSignalScore(params: {
  instrument: string;
  candles: OHLCV[];
  weights?: Record<string, number>;
}): Promise<SignalScore> {
  console.log(`[AnalysisTools] Computing signal score for ${params.instrument}`);

  const defaultWeights: Record<string, number> = {
    rsi: 0.15,
    macd: 0.15,
    ema: 0.10,
    bollinger: 0.10,
    vwap: 0.10,
    obv: 0.10,
    stochastic: 0.10,
    atr: 0.05,
    cci: 0.05,
    pattern: 0.10,
  };

  const weights = params.weights ?? defaultWeights;
  const indicatorNames = Object.keys(weights).filter((k) => k !== 'pattern');
  const indicators = await computeIndicators({
    candles: params.candles,
    indicators: indicatorNames,
  });

  // Map our indicator results into the IndicatorSignal format expected by aggregateSignals
  const signals = indicators.map((ind) => ({
    indicator: ind.name,
    value: ind.values[ind.values.length - 1] ?? 0,
    signal: (ind.signal === 'bullish' ? 'buy' : ind.signal === 'bearish' ? 'sell' : 'neutral') as
      | 'buy'
      | 'sell'
      | 'neutral',
    confidence: ind.strength,
  }));

  // Include pattern detection as an additional component
  const patterns = await detectPatterns({
    candles: params.candles,
    patternTypes: ['candlestick', 'smc'],
    timeframe: 'auto',
  });

  if (patterns.length > 0) {
    const bullishPatterns = patterns.filter((p) => p.direction === 'bullish');
    const bearishPatterns = patterns.filter((p) => p.direction === 'bearish');
    const patternBias = bullishPatterns.length - bearishPatterns.length;
    const avgReliability =
      patterns.reduce((s, p) => s + p.reliability, 0) / patterns.length;

    signals.push({
      indicator: 'pattern',
      value: patternBias,
      signal: patternBias > 0 ? 'buy' : patternBias < 0 ? 'sell' : 'neutral',
      confidence: avgReliability,
    });
  }

  const aggregated = aggregateSignals(signals);

  // Build per-component breakdown
  const components = Object.entries(weights).map(([indicator, weight]) => {
    const sig = signals.find((s) => s.indicator === indicator);
    let contribution = 0;
    if (sig) {
      contribution =
        sig.signal === 'buy'
          ? sig.confidence
          : sig.signal === 'sell'
            ? -sig.confidence
            : 0;
    }
    return { indicator, contribution, weight };
  });

  // Score is -1..+1
  const totalScore = components.reduce(
    (sum, c) => sum + c.contribution * c.weight,
    0,
  );

  return {
    instrument: params.instrument,
    score: Math.max(-1, Math.min(1, totalScore)),
    components,
    confidence: aggregated.confidence,
  };
}

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

export const analysisTools: MCPTool[] = [
  {
    name: 'compute_indicators',
    description:
      'Calculate technical indicators (RSI, MACD, SMA, EMA, Bollinger Bands, ATR, VWAP, OBV, Stochastic, CCI) on OHLCV candle data. Returns each indicator\'s values, directional signal, and signal strength.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Instrument symbol (e.g. BTC_USDT). Used to fetch candles if candles array is not provided.',
        },
        timeframe: {
          type: 'string',
          enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
          description: 'Candle timeframe. Required when instrument is provided to fetch candles.',
        },
        candles: {
          type: 'array',
          description: 'Pre-fetched OHLCV candle data. If omitted, candles are fetched via instrument + timeframe.',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'number' },
              open: { type: 'number' },
              high: { type: 'number' },
              low: { type: 'number' },
              close: { type: 'number' },
              volume: { type: 'number' },
            },
            required: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
          },
        },
        indicators: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of indicator names to compute. Available: rsi, macd, ema, sma, bollinger, atr, vwap, obv, stochastic, cci',
        },
        params: {
          type: 'object',
          description:
            'Optional indicator parameters: rsi_period (default 14), ema_period (default 20), sma_period (default 20), bollinger_period (default 20), bollinger_stddev (default 2), atr_period (default 14), stoch_k (default 14), stoch_d (default 3), cci_period (default 20)',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['indicators'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      let candles = p.candles as OHLCV[] | undefined;

      // If no candles provided, fetch from ClickHouse
      if (!candles || (candles as unknown[]).length === 0) {
        const instrument = p.instrument as string | undefined;
        const timeframe = (p.timeframe as '1m' | '5m' | '15m' | '1h' | '4h' | '1d') ?? '1h';
        if (!instrument) {
          return { error: 'Either candles or instrument must be provided.' };
        }
        const rawCandles = await fetchCandlesFromCH(instrument, timeframe, 200);
        candles = rawCandles.reverse().map((c) => ({
          timestamp: new Date(c.bucket).getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
      }

      return computeIndicators({
        candles,
        indicators: p.indicators as string[],
        params: p.params as Record<string, number> | undefined,
      });
    },
  },

  {
    name: 'detect_patterns',
    description:
      'Detect candlestick patterns (doji, hammer, engulfing, morning/evening star, three white soldiers, three black crows) and Smart Money Concepts (order blocks, fair value gaps, liquidity zones) on OHLCV data.',
    inputSchema: {
      type: 'object',
      properties: {
        candles: {
          type: 'array',
          description: 'OHLCV candle data array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'number' },
              open: { type: 'number' },
              high: { type: 'number' },
              low: { type: 'number' },
              close: { type: 'number' },
              volume: { type: 'number' },
            },
            required: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
          },
        },
        pattern_types: {
          type: 'array',
          items: { type: 'string', enum: ['candlestick', 'chart', 'harmonic', 'smc'] },
          description: 'Types of patterns to detect (default: candlestick + smc)',
        },
        timeframe: {
          type: 'string',
          description: 'Candle timeframe label (e.g. 1h, 4h, 1d)',
        },
      },
      required: ['candles'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      return detectPatterns({
        candles: p.candles as OHLCV[],
        patternTypes: p.pattern_types as
          | ('candlestick' | 'chart' | 'harmonic' | 'smc')[]
          | undefined,
        timeframe: (p.timeframe as string) ?? '1h',
      });
    },
  },

  {
    name: 'get_signal_score',
    description:
      'Compute an aggregate signal score (-1.0 to +1.0) combining RSI, MACD, EMA, Bollinger, VWAP, OBV, Stochastic, CCI, and pattern detection. Returns per-component breakdown and overall confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Instrument symbol',
        },
        candles: {
          type: 'array',
          description: 'OHLCV candle data',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'number' },
              open: { type: 'number' },
              high: { type: 'number' },
              low: { type: 'number' },
              close: { type: 'number' },
              volume: { type: 'number' },
            },
            required: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
          },
        },
        weights: {
          type: 'object',
          description:
            'Custom indicator weights. Keys: rsi, macd, ema, bollinger, vwap, obv, stochastic, atr, cci, pattern. Values should sum to ~1.0.',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['instrument', 'candles'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      return getSignalScore({
        instrument: p.instrument as string,
        candles: p.candles as OHLCV[],
        weights: p.weights as Record<string, number> | undefined,
      });
    },
  },

  {
    name: 'get_candles',
    description:
      'Fetch OHLCV candle data from ClickHouse for a given instrument and timeframe. Returns up to `limit` candles in chronological order (oldest first).',
    inputSchema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          description: 'Instrument symbol (e.g. BTC_USDT, ETH_USDT)',
        },
        timeframe: {
          type: 'string',
          enum: ['1m', '5m', '15m', '1h', '4h', '1d'],
          description: 'Candle timeframe',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of candles to return (default: 200, max: 1000)',
        },
      },
      required: ['instrument', 'timeframe'],
    },
    handler: async (p: Record<string, unknown>): Promise<unknown> => {
      const instrument = p.instrument as string;
      const timeframe = p.timeframe as '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
      const limit = Math.min((p.limit as number) ?? 200, 1000);

      const rawCandles = await fetchCandlesFromCH(instrument, timeframe, limit);

      // Convert to OHLCV format and reverse to chronological order (oldest first)
      const ohlcv: OHLCV[] = rawCandles.reverse().map((c) => ({
        timestamp: new Date(c.bucket).getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      return {
        instrument,
        timeframe,
        count: ohlcv.length,
        candles: ohlcv,
      };
    },
  },
];
