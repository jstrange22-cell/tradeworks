/**
 * Claude-backed agent implementations for the orchestrator.
 *
 * When USE_CLAUDE_AGENTS=true, the orchestrator uses these instead of the
 * deterministic TypeScript closures. Each agent:
 *   1. Gathers raw data using the existing MCP tool functions
 *   2. Sends the data + system prompt to Claude
 *   3. Claude interprets the data and returns structured analysis
 *
 * This is a "hybrid" approach:
 *   - Data gathering: deterministic (fast, free)
 *   - Analysis/interpretation: Claude (reasoning, nuance)
 *   - Risk management: always deterministic (hard rules)
 *   - Execution: always deterministic (mechanical routing)
 */

import { claudeComplete } from './claude-client.js';
import { QUANT_ANALYST_PROMPT } from '../agents/quant-analyst.js';
import { SENTIMENT_ANALYST_PROMPT } from '../agents/sentiment-analyst.js';
import { MACRO_ANALYST_PROMPT } from '../agents/macro-analyst.js';
import { computeIndicators, detectPatterns, getSignalScore } from '../mcp-servers/analysis-tools.js';
import { getSentiment, getMacroData } from '../mcp-servers/data-tools.js';
import type {
  EngineQuantAnalysis,
  QuantSignal,
  PatternDetection,
  EngineSentimentAnalysis,
  EngineMacroAnalysis,
  EngineMarketState,
  OrchestratorConfig,
} from '../orchestrator.js';

// Model mapping from agent definitions
const MODELS = {
  quant: 'claude-sonnet-4-20250514',
  sentiment: 'claude-sonnet-4-20250514',
  macro: 'claude-haiku-4-5-20251001',
} as const;

// ---------------------------------------------------------------------------
// Quant Analyst (Claude-backed)
// ---------------------------------------------------------------------------

export async function runClaudeQuantAnalyst(ctx: {
  marketState: EngineMarketState;
  instruments: string[];
  config: OrchestratorConfig;
}): Promise<EngineQuantAnalysis> {
  console.log('[Claude:QuantAnalyst] Starting Claude-backed analysis...');

  // Step 1: Gather all indicator data deterministically (fast, free)
  const instrumentData: Array<{
    symbol: string;
    indicators1h: unknown[];
    indicators4h: unknown[];
    indicators1d: unknown[];
    patterns: unknown[];
    signalScore: unknown;
    price: number;
  }> = [];

  for (const instr of ctx.instruments) {
    const snapshot = ctx.marketState.instruments.find(i => i.symbol === instr);
    if (!snapshot) continue;

    const candles1h = snapshot.candles['1h'] ?? [];
    const candles4h = snapshot.candles['4h'] ?? [];
    const candles1d = snapshot.candles['1d'] ?? [];

    if (candles1h.length < 20) continue;

    const [ind1h, ind4h, ind1d, patt, sig] = await Promise.allSettled([
      computeIndicators({
        candles: candles1h,
        indicators: ['rsi', 'macd', 'ema', 'bollinger', 'atr', 'vwap', 'obv'],
        params: { rsi_period: 14, ema_period: 20, bollinger_period: 20 },
      }),
      computeIndicators({
        candles: candles4h,
        indicators: ['rsi', 'macd', 'ema', 'atr'],
        params: { rsi_period: 14, ema_period: 50 },
      }),
      computeIndicators({
        candles: candles1d,
        indicators: ['rsi', 'ema', 'atr'],
        params: { rsi_period: 14, ema_period: 200 },
      }),
      detectPatterns({
        candles: candles1h,
        patternTypes: ['candlestick', 'smc'],
        timeframe: '1h',
      }),
      getSignalScore({ instrument: instr, candles: candles1h }),
    ]);

    instrumentData.push({
      symbol: instr,
      indicators1h: ind1h.status === 'fulfilled' ? ind1h.value : [],
      indicators4h: ind4h.status === 'fulfilled' ? ind4h.value : [],
      indicators1d: ind1d.status === 'fulfilled' ? ind1d.value : [],
      patterns: patt.status === 'fulfilled' ? patt.value : [],
      signalScore: sig.status === 'fulfilled' ? sig.value : null,
      price: snapshot.price,
    });
  }

  // Step 2: Send all data to Claude for interpretation
  const userMessage = `Analyze the following market data and return a JSON object matching the QuantAnalysis schema.

## Current Portfolio State
- Portfolio value: $${ctx.marketState.portfolioValue.toFixed(2)}
- Open positions: ${ctx.marketState.openPositions.length}
- Daily P&L: $${ctx.marketState.dailyPnl.toFixed(2)}
- Drawdown from peak: ${ctx.marketState.drawdownFromPeak.toFixed(2)}%
- Min confidence threshold: ${ctx.config.minConfidence}

## Instrument Analysis Data
${instrumentData.map(d => `
### ${d.symbol} (price: $${d.price.toFixed(2)})
**1h Indicators:** ${JSON.stringify(d.indicators1h)}
**4h Indicators:** ${JSON.stringify(d.indicators4h)}
**1d Indicators:** ${JSON.stringify(d.indicators1d)}
**Patterns:** ${JSON.stringify(d.patterns)}
**Signal Score:** ${JSON.stringify(d.signalScore)}
`).join('\n')}

## Required Output Format
Return ONLY a JSON object (no markdown, no explanation) with this structure:
{
  "signals": [{ "instrument": string, "direction": "long"|"short", "indicator": string, "confidence": 0-1, "entryPrice": number, "stopLoss": number, "target": number, "riskReward": number, "timeframe": string }],
  "patterns": [{ "name": string, "type": "bullish"|"bearish", "reliability": 0-1, "instrument": string, "timeframe": string }],
  "overallBias": "bullish"|"bearish"|"neutral",
  "confidence": 0-1,
  "summary": string
}`;

  try {
    const response = await claudeComplete(QUANT_ANALYST_PROMPT, userMessage, {
      model: MODELS.quant,
      maxTokens: 4096,
      temperature: 0.2,
    });

    const parsed = parseJsonResponse<{
      signals: QuantSignal[];
      patterns: PatternDetection[];
      overallBias: 'bullish' | 'bearish' | 'neutral';
      confidence: number;
      summary: string;
    }>(response);

    if (parsed) {
      console.log(`[Claude:QuantAnalyst] Complete: ${parsed.summary}`);
      return { timestamp: new Date(), ...parsed };
    }
  } catch (err) {
    console.error('[Claude:QuantAnalyst] Claude call failed:', err);
  }

  // Fallback: return empty analysis
  return {
    timestamp: new Date(),
    signals: [],
    patterns: [],
    overallBias: 'neutral',
    confidence: 0,
    summary: 'Claude analysis unavailable, no signals generated.',
  };
}

// ---------------------------------------------------------------------------
// Sentiment Analyst (Claude-backed)
// ---------------------------------------------------------------------------

export async function runClaudeSentimentAnalyst(ctx: {
  marketState: EngineMarketState;
  instruments: string[];
}): Promise<EngineSentimentAnalysis> {
  console.log('[Claude:SentimentAnalyst] Starting Claude-backed sentiment analysis...');

  // Step 1: Gather real sentiment data
  const sentimentResults = await Promise.all(
    ctx.instruments.map(instr =>
      getSentiment({ instrument: instr, sources: ['news', 'social', 'onchain'] })
        .catch(() => null)
    )
  );

  const validResults = sentimentResults.filter(
    (r): r is NonNullable<typeof r> => r !== null
  );

  // Step 2: Send to Claude for interpretation
  const userMessage = `Analyze the following sentiment data and return a JSON object matching the SentimentAnalysis schema.

## Raw Sentiment Data
${validResults.map(r => `
### ${r.instrument}
- Overall Score: ${r.overallScore.toFixed(2)}
- News Score: ${r.newsScore.toFixed(2)}
- Social Score: ${r.socialScore.toFixed(2)}
- On-Chain Score: ${r.onChainScore.toFixed(2)}
- Fear & Greed Index: ${r.fearGreedIndex}
- Sources: ${JSON.stringify(r.sources)}
`).join('\n')}

## Market Context
- ${ctx.marketState.instruments.length} instruments being tracked
- ${ctx.marketState.openPositions.length} open positions
- Daily P&L: $${ctx.marketState.dailyPnl.toFixed(2)}

## Required Output Format
Return ONLY a JSON object (no markdown, no explanation):
{
  "overallSentiment": "bullish"|"bearish"|"neutral"|"mixed",
  "score": -1.0 to +1.0,
  "fearGreedIndex": 0-100,
  "sources": [{ "name": string, "score": -1 to 1, "articles": number }],
  "keyEvents": [{ "event": string, "impact": "high"|"medium"|"low", "expectedEffect": string }],
  "summary": string
}`;

  try {
    const response = await claudeComplete(SENTIMENT_ANALYST_PROMPT, userMessage, {
      model: MODELS.sentiment,
      maxTokens: 2048,
      temperature: 0.3,
    });

    const parsed = parseJsonResponse<Omit<EngineSentimentAnalysis, 'timestamp'>>(response);
    if (parsed) {
      console.log(`[Claude:SentimentAnalyst] Complete: ${parsed.summary}`);
      return { timestamp: new Date(), ...parsed };
    }
  } catch (err) {
    console.error('[Claude:SentimentAnalyst] Claude call failed:', err);
  }

  // Fallback
  const avgScore = validResults.length > 0
    ? validResults.reduce((sum, r) => sum + r.overallScore, 0) / validResults.length
    : 0;

  return {
    timestamp: new Date(),
    overallSentiment: avgScore > 0.3 ? 'bullish' : avgScore < -0.3 ? 'bearish' : 'neutral',
    score: avgScore,
    fearGreedIndex: validResults[0]?.fearGreedIndex ?? 50,
    sources: [],
    keyEvents: [],
    summary: 'Claude analysis unavailable. Using raw sentiment scores.',
  };
}

// ---------------------------------------------------------------------------
// Macro Analyst (Claude-backed)
// ---------------------------------------------------------------------------

export async function runClaudeMacroAnalyst(_ctx: {
  marketState: EngineMarketState;
}): Promise<EngineMacroAnalysis> {
  console.log('[Claude:MacroAnalyst] Starting Claude-backed macro analysis...');

  // Step 1: Gather real macro data
  const macroData = await getMacroData();

  // Step 2: Send to Claude for interpretation
  const userMessage = `Analyze the following macroeconomic data and return a JSON object matching the MacroAnalysis schema.

## Macro Data
- Fed Funds Rate: ${macroData.fedFundsRate}%
- CPI YoY: ${macroData.cpiYoY}%
- Unemployment: ${macroData.unemploymentRate}%
- GDP Growth: ${macroData.gdpGrowth}%
- VIX: ${macroData.vix}
- DXY: ${macroData.dxyIndex}
- 10Y Yield: ${macroData.us10YYield}%
- 2Y Yield: ${macroData.us2YYield}%
- Yield Curve Spread: ${macroData.yieldCurveSpread.toFixed(2)}%
- M2 Money Supply: ${macroData.m2MoneySupply}
- Consumer Confidence: ${macroData.consumerConfidence}

## Required Output Format
Return ONLY a JSON object (no markdown, no explanation):
{
  "regime": "risk-on"|"risk-off"|"transition"|"neutral",
  "riskEnvironment": "low"|"normal"|"elevated"|"extreme",
  "keyFactors": [{ "name": string, "value": number, "impact": "positive"|"negative"|"neutral", "importance": "high"|"medium"|"low" }],
  "outlook": string
}`;

  try {
    const response = await claudeComplete(MACRO_ANALYST_PROMPT, userMessage, {
      model: MODELS.macro,
      maxTokens: 1024,
      temperature: 0.2,
    });

    const parsed = parseJsonResponse<Omit<EngineMacroAnalysis, 'timestamp'>>(response);
    if (parsed) {
      console.log(`[Claude:MacroAnalyst] Complete: ${parsed.outlook}`);
      return { timestamp: new Date(), ...parsed };
    }
  } catch (err) {
    console.error('[Claude:MacroAnalyst] Claude call failed:', err);
  }

  // Fallback: deterministic regime classification
  let regime: EngineMacroAnalysis['regime'] = 'neutral';
  let riskEnvironment: EngineMacroAnalysis['riskEnvironment'] = 'normal';

  if (macroData.vix > 35) { riskEnvironment = 'extreme'; regime = 'risk-off'; }
  else if (macroData.vix > 25) { riskEnvironment = 'elevated'; regime = 'risk-off'; }
  else if (macroData.vix > 0 && macroData.vix < 15) { riskEnvironment = 'low'; regime = 'risk-on'; }

  return {
    timestamp: new Date(),
    regime,
    riskEnvironment,
    keyFactors: [],
    outlook: 'Claude analysis unavailable. Using basic VIX-based regime classification.',
  };
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

function parseJsonResponse<T>(response: string): T | null {
  if (!response) return null;

  try {
    // Try extracting from markdown code block
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    }

    // Try finding a JSON object directly
    const jsonMatch = response.match(/(\{[\s\S]*\})/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }

    // Try parsing the whole thing
    return JSON.parse(response) as T;
  } catch {
    return null;
  }
}
