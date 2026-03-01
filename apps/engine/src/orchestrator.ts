import { runPreTradeValidation } from './hooks/pre-trade.js';
import { runPostTradeHook } from './hooks/post-trade.js';
import {
  isCircuitBreakerTripped,
  updateCircuitBreaker,
  getCircuitBreakerState,
} from './hooks/circuit-breaker.js';
import { AGENT_DEFINITIONS } from './agents/definitions.js';
import { QUANT_ANALYST_PROMPT } from './agents/quant-analyst.js';
import { SENTIMENT_ANALYST_PROMPT } from './agents/sentiment-analyst.js';
import { MACRO_ANALYST_PROMPT } from './agents/macro-analyst.js';
import { RISK_GUARDIAN_PROMPT } from './agents/risk-guardian.js';
import { EXECUTION_SPECIALIST_PROMPT } from './agents/execution-specialist.js';
import {
  runClaudeQuantAnalyst,
  runClaudeSentimentAnalyst,
  runClaudeMacroAnalyst,
} from './lib/claude-agents.js';
import {
  getCandles,
  getOrderBook,
  getSentiment,
  getMacroData,
} from './mcp-servers/data-tools.js';
import {
  computeIndicators,
  detectPatterns,
  getSignalScore,
} from './mcp-servers/analysis-tools.js';
import {
  checkRisk,
  getPortfolioHeat,
  calculatePositionSize,
  getVaR,
} from './mcp-servers/risk-tools.js';
import {
  executeTrade,
  getPositions,
} from './mcp-servers/trading-tools.js';
import type { EnginePosition, EngineTradeOrder } from './engines/crypto/coinbase-engine.js';
import type { OHLCV, Timeframe } from '@tradeworks/shared';

// ---------------------------------------------------------------------------
// Engine-local types
// ---------------------------------------------------------------------------

export interface EngineMarketState {
  timestamp: Date;
  instruments: InstrumentSnapshot[];
  portfolioValue: number;
  openPositions: EnginePosition[];
  dailyPnl: number;
  drawdownFromPeak: number;
}

export interface InstrumentSnapshot {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  candles: Partial<Record<Timeframe, OHLCV[]>>;
  orderBook: {
    bestBid: number;
    bestAsk: number;
    spread: number;
    spreadPercent: number;
    bidDepth: number;
    askDepth: number;
  } | null;
}

export interface EngineTradeDecision {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  reason: string;
  confidence: number;
  timestamp: Date;
  stopLoss?: number;
  entryPrice?: number;
  takeProfit?: number;
  riskRewardRatio?: number;
  signalSources: string[];
}

export interface EngineRiskAssessment {
  timestamp: Date;
  approved: boolean;
  reason: string;
  portfolioHeat: number;
  maxDrawdownPercent: number;
  approvedDecisions: EngineTradeDecision[];
  rejectedDecisions: Array<EngineTradeDecision & { rejectionReason: string }>;
  varOneDay: number;
  varFiveDay: number;
}

export interface EngineExecutionResult {
  orderId: string;
  instrument: string;
  status: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  slippage?: number;
  fees?: number;
  error?: string;
}

export interface EngineQuantAnalysis {
  timestamp: Date;
  signals: QuantSignal[];
  patterns: PatternDetection[];
  overallBias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  summary: string;
}

export interface QuantSignal {
  instrument: string;
  direction: 'long' | 'short';
  indicator: string;
  confidence: number;
  entryPrice?: number;
  stopLoss?: number;
  target?: number;
  riskReward?: number;
  timeframe: string;
}

export interface PatternDetection {
  name: string;
  type: 'bullish' | 'bearish';
  reliability: number;
  instrument: string;
  timeframe: string;
}

export interface EngineSentimentAnalysis {
  timestamp: Date;
  overallSentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  score: number;
  fearGreedIndex: number;
  sources: Array<{
    name: string;
    score: number;
    articles: number;
  }>;
  keyEvents: Array<{
    event: string;
    impact: 'high' | 'medium' | 'low';
    expectedEffect: string;
  }>;
  summary: string;
}

export interface EngineMacroAnalysis {
  timestamp: Date;
  regime: 'risk-on' | 'risk-off' | 'transition' | 'neutral';
  riskEnvironment: 'low' | 'normal' | 'elevated' | 'extreme';
  keyFactors: Array<{
    name: string;
    value: number;
    impact: 'positive' | 'negative' | 'neutral';
    importance: 'high' | 'medium' | 'low';
  }>;
  outlook: string;
}

export interface CycleResult {
  cycleId: string;
  cycleNumber: number;
  timestamp: Date;
  status: 'completed' | 'error' | 'circuit_breaker' | 'no_signals';
  marketState: EngineMarketState | null;
  quantAnalysis: EngineQuantAnalysis | null;
  sentimentAnalysis: EngineSentimentAnalysis | null;
  macroAnalysis: EngineMacroAnalysis | null;
  decisions: EngineTradeDecision[];
  riskAssessment: EngineRiskAssessment | null;
  executions: EngineExecutionResult[];
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent interface -- drop-in replacement point for Claude Agent SDK
// ---------------------------------------------------------------------------

/**
 * Minimal agent interface. Each agent receives a system prompt, context,
 * and a set of tool functions it can call. The `run` method produces a
 * structured output of type T.
 *
 * When the Claude Agent SDK is integrated, each of these agents will be
 * replaced by a Claude session that receives the system prompt, context
 * as a user message, and MCP tool definitions for the tool functions.
 */
interface Agent<TContext, TOutput> {
  name: string;
  definition: (typeof AGENT_DEFINITIONS)[keyof typeof AGENT_DEFINITIONS];
  systemPrompt: string;
  run: (context: TContext) => Promise<TOutput>;
}

// ---------------------------------------------------------------------------
// Orchestrator configuration
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  /** Cycle interval in milliseconds (default: 300_000 = 5 min) */
  cycleIntervalMs: number;
  /** Paper trading mode - no real orders (default: true) */
  paperTrading: boolean;
  /** Instruments to trade per market */
  instruments: {
    crypto: string[];
    equity: string[];
    prediction: string[];
  };
  /** Markets that are enabled */
  enabledMarkets: Array<'crypto' | 'equity' | 'prediction'>;
  /** Maximum cycles to run (0 = unlimited) */
  maxCycles: number;
  /** Minimum confidence threshold for trade decisions */
  minConfidence: number;
  /** Require all three analysts (quant + sentiment + macro) to agree */
  requireUnanimity: boolean;
  /** Maximum number of simultaneous trades per cycle */
  maxTradesPerCycle: number;
  /** Portfolio equity for risk calculations (will come from DB in production) */
  initialEquity: number;
  /** Use Claude AI for analysis agents (quant, sentiment, macro). Default: false */
  useClaudeAgents: boolean;
}

function loadConfig(): OrchestratorConfig {
  const instrumentsCrypto = (process.env.INSTRUMENTS_CRYPTO ?? 'BTC_USDT,ETH_USDT').split(',').map(s => s.trim());
  const instrumentsEquity = (process.env.INSTRUMENTS_EQUITY ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const instrumentsPrediction = (process.env.INSTRUMENTS_PREDICTION ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const enabledMarkets = (process.env.ENABLED_MARKETS ?? 'crypto').split(',').map(s => s.trim()) as OrchestratorConfig['enabledMarkets'];

  return {
    cycleIntervalMs: parseInt(process.env.CYCLE_INTERVAL_MS ?? '300000', 10),
    paperTrading: process.env.PAPER_TRADING !== 'false',
    instruments: {
      crypto: instrumentsCrypto,
      equity: instrumentsEquity,
      prediction: instrumentsPrediction,
    },
    enabledMarkets,
    maxCycles: parseInt(process.env.MAX_CYCLES ?? '0', 10),
    minConfidence: parseFloat(process.env.MIN_CONFIDENCE ?? '0.6'),
    requireUnanimity: process.env.REQUIRE_UNANIMITY === 'true',
    maxTradesPerCycle: parseInt(process.env.MAX_TRADES_PER_CYCLE ?? '5', 10),
    initialEquity: parseFloat(process.env.INITIAL_EQUITY ?? '10000'),
    useClaudeAgents: process.env.USE_CLAUDE_AGENTS === 'true',
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycleInProgress = false;
  private cycleCount = 0;
  private readonly config: OrchestratorConfig;
  private cycleHistory: CycleResult[] = [];
  private equityPeak: number;
  private dailyPnl = 0;
  private dailyResetDate: string = new Date().toISOString().slice(0, 10);

  // Agent instances
  private quantAgent: Agent<QuantAgentContext, EngineQuantAnalysis>;
  private sentimentAgent: Agent<SentimentAgentContext, EngineSentimentAnalysis>;
  private macroAgent: Agent<MacroAgentContext, EngineMacroAnalysis>;
  private riskAgent: Agent<RiskAgentContext, EngineRiskAssessment>;
  private executionAgent: Agent<ExecutionAgentContext, EngineExecutionResult>;

  constructor(config?: Partial<OrchestratorConfig>) {
    const defaults = loadConfig();
    this.config = { ...defaults, ...config };
    this.equityPeak = this.config.initialEquity;

    // Initialize agents.
    // When USE_CLAUDE_AGENTS=true, analysis agents use Claude for interpretation.
    // Risk and execution agents always use deterministic logic (safety-critical).
    if (this.config.useClaudeAgents) {
      console.log('[Orchestrator] Claude AI agents ENABLED for analysis');
      this.quantAgent = this.createClaudeQuantAgent();
      this.sentimentAgent = this.createClaudeSentimentAgent();
      this.macroAgent = this.createClaudeMacroAgent();
    } else {
      this.quantAgent = this.createQuantAgent();
      this.sentimentAgent = this.createSentimentAgent();
      this.macroAgent = this.createMacroAgent();
    }
    // Risk and execution are ALWAYS deterministic (non-negotiable safety rules)
    this.riskAgent = this.createRiskAgent();
    this.executionAgent = this.createExecutionAgent();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Orchestrator] Already running.');
      return;
    }

    this.running = true;

    console.log('[Orchestrator] ====================================================');
    console.log('[Orchestrator] TradeWorks Trading Engine Starting');
    console.log('[Orchestrator] ====================================================');
    console.log(`[Orchestrator] Paper trading:    ${this.config.paperTrading}`);
    console.log(`[Orchestrator] Claude agents:    ${this.config.useClaudeAgents}`);
    console.log(`[Orchestrator] Cycle interval:   ${this.config.cycleIntervalMs}ms (${(this.config.cycleIntervalMs / 60_000).toFixed(1)} min)`);
    console.log(`[Orchestrator] Enabled markets:  ${this.config.enabledMarkets.join(', ')}`);
    console.log(`[Orchestrator] Crypto symbols:   ${this.config.instruments.crypto.join(', ') || '(none)'}`);
    console.log(`[Orchestrator] Equity symbols:   ${this.config.instruments.equity.join(', ') || '(none)'}`);
    console.log(`[Orchestrator] Prediction syms:  ${this.config.instruments.prediction.join(', ') || '(none)'}`);
    console.log(`[Orchestrator] Min confidence:   ${this.config.minConfidence}`);
    console.log(`[Orchestrator] Max trades/cycle: ${this.config.maxTradesPerCycle}`);
    console.log(`[Orchestrator] Initial equity:   $${this.config.initialEquity.toLocaleString()}`);
    console.log(`[Orchestrator] Max cycles:       ${this.config.maxCycles || 'unlimited'}`);
    console.log('[Orchestrator] ====================================================');

    // Run the first cycle immediately
    await this.runCycle();

    // Schedule subsequent cycles
    if (this.running) {
      this.intervalId = setInterval(async () => {
        if (!this.running) return;
        if (this.cycleInProgress) {
          console.warn('[Orchestrator] Previous cycle still in progress, skipping this tick.');
          return;
        }

        try {
          await this.runCycle();
        } catch (error) {
          console.error('[Orchestrator] Unhandled cycle error:', error);
        }
      }, this.config.cycleIntervalMs);

      console.log(`[Orchestrator] Scheduled cycles every ${this.config.cycleIntervalMs}ms`);
    }
  }

  async stop(): Promise<void> {
    console.log('[Orchestrator] Stopping...');
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Wait for in-flight cycle to complete (up to 30 seconds)
    if (this.cycleInProgress) {
      console.log('[Orchestrator] Waiting for in-flight cycle to complete...');
      const deadline = Date.now() + 30_000;
      while (this.cycleInProgress && Date.now() < deadline) {
        await sleep(500);
      }
      if (this.cycleInProgress) {
        console.warn('[Orchestrator] In-flight cycle did not complete within 30s timeout.');
      }
    }

    // Print session summary
    this.printSessionSummary();

    console.log('[Orchestrator] Stopped.');
  }

  /** Returns true if the orchestrator loop is active. */
  isRunning(): boolean {
    return this.running;
  }

  /** Returns a copy of the cycle history (most recent first). */
  getCycleHistory(): CycleResult[] {
    return [...this.cycleHistory].reverse();
  }

  /** Returns the current configuration (read-only). */
  getConfig(): Readonly<OrchestratorConfig> {
    return Object.freeze({ ...this.config });
  }

  // -----------------------------------------------------------------------
  // Main cycle
  // -----------------------------------------------------------------------

  async runCycle(): Promise<CycleResult> {
    // Check max cycles limit
    if (this.config.maxCycles > 0 && this.cycleCount >= this.config.maxCycles) {
      console.log(`[Orchestrator] Reached max cycles (${this.config.maxCycles}). Stopping.`);
      this.running = false;
      return this.errorResult('Max cycles reached');
    }

    this.cycleInProgress = true;
    this.cycleCount++;
    const cycleId = `cycle-${this.cycleCount}-${Date.now()}`;
    const startTime = Date.now();

    console.log('');
    console.log(`${'='.repeat(72)}`);
    console.log(`  CYCLE ${this.cycleCount}  |  ${new Date().toISOString()}  |  ${cycleId}`);
    console.log(`${'='.repeat(72)}`);

    const result: CycleResult = {
      cycleId,
      cycleNumber: this.cycleCount,
      timestamp: new Date(),
      status: 'completed',
      marketState: null,
      quantAnalysis: null,
      sentimentAnalysis: null,
      macroAnalysis: null,
      decisions: [],
      riskAssessment: null,
      executions: [],
      durationMs: 0,
    };

    try {
      // Reset daily P&L if the date has changed
      this.checkDailyReset();

      // ------------------------------------------------------------------
      // Step 0: Circuit breaker check
      // ------------------------------------------------------------------
      const circuitBroken = await isCircuitBreakerTripped();
      if (circuitBroken) {
        const cbState = getCircuitBreakerState();
        console.warn(`[Orchestrator] CIRCUIT BREAKER TRIPPED: ${cbState.reason}`);
        console.warn(`[Orchestrator] Resume at: ${cbState.canResumeAt?.toISOString() ?? 'manual reset required'}`);
        result.status = 'circuit_breaker';
        result.error = `Circuit breaker: ${cbState.reason}`;
        result.durationMs = Date.now() - startTime;
        this.cycleHistory.push(result);
        this.cycleInProgress = false;
        return result;
      }

      // ------------------------------------------------------------------
      // Step 1: Gather market state
      // ------------------------------------------------------------------
      console.log('[Orchestrator] Step 1/6: Gathering market state...');
      result.marketState = await this.gatherMarketState();
      const instrCount = result.marketState.instruments.length;
      const posCount = result.marketState.openPositions.length;
      console.log(
        `[Orchestrator]   ${instrCount} instrument(s), ${posCount} open position(s), ` +
        `portfolio: $${result.marketState.portfolioValue.toFixed(2)}, ` +
        `daily P&L: $${result.marketState.dailyPnl.toFixed(2)}`
      );

      // ------------------------------------------------------------------
      // Step 2: Spawn analyst agents in parallel
      // ------------------------------------------------------------------
      console.log('[Orchestrator] Step 2/6: Running analyst agents in parallel...');
      const analysisStart = Date.now();

      const [quantResult, sentimentResult, macroResult] = await Promise.allSettled([
        this.quantAgent.run({
          marketState: result.marketState,
          instruments: this.getActiveInstruments(),
          config: this.config,
        }),
        this.sentimentAgent.run({
          marketState: result.marketState,
          instruments: this.getActiveInstruments(),
        }),
        this.macroAgent.run({
          marketState: result.marketState,
        }),
      ]);

      const analysisDuration = Date.now() - analysisStart;

      result.quantAnalysis = quantResult.status === 'fulfilled' ? quantResult.value : null;
      result.sentimentAnalysis = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null;
      result.macroAnalysis = macroResult.status === 'fulfilled' ? macroResult.value : null;

      if (quantResult.status === 'rejected') {
        console.error('[Orchestrator]   [FAIL] Quant analyst:', (quantResult.reason as Error).message ?? quantResult.reason);
      } else {
        console.log(
          `[Orchestrator]   [OK]   Quant analyst: bias=${result.quantAnalysis!.overallBias}, ` +
          `confidence=${result.quantAnalysis!.confidence.toFixed(2)}, ` +
          `signals=${result.quantAnalysis!.signals.length}`
        );
      }

      if (sentimentResult.status === 'rejected') {
        console.error('[Orchestrator]   [FAIL] Sentiment analyst:', (sentimentResult.reason as Error).message ?? sentimentResult.reason);
      } else {
        console.log(
          `[Orchestrator]   [OK]   Sentiment analyst: sentiment=${result.sentimentAnalysis!.overallSentiment}, ` +
          `score=${result.sentimentAnalysis!.score.toFixed(2)}, ` +
          `F&G=${result.sentimentAnalysis!.fearGreedIndex}`
        );
      }

      if (macroResult.status === 'rejected') {
        console.error('[Orchestrator]   [FAIL] Macro analyst:', (macroResult.reason as Error).message ?? macroResult.reason);
      } else {
        console.log(
          `[Orchestrator]   [OK]   Macro analyst: regime=${result.macroAnalysis!.regime}, ` +
          `risk=${result.macroAnalysis!.riskEnvironment}`
        );
      }

      console.log(`[Orchestrator]   Analysis completed in ${analysisDuration}ms`);

      // ------------------------------------------------------------------
      // Step 3: Aggregate analysis into trade decisions
      // ------------------------------------------------------------------
      console.log('[Orchestrator] Step 3/6: Aggregating into trade decisions...');
      result.decisions = this.aggregateDecisions(
        result.quantAnalysis,
        result.sentimentAnalysis,
        result.macroAnalysis,
        result.marketState,
      );

      if (result.decisions.length === 0) {
        console.log('[Orchestrator]   No trade decisions generated this cycle.');
        result.status = 'no_signals';
        result.durationMs = Date.now() - startTime;
        this.logCycleSummary(result);
        this.cycleHistory.push(result);
        this.cycleInProgress = false;
        return result;
      }

      console.log(`[Orchestrator]   Generated ${result.decisions.length} trade decision(s):`);
      for (const d of result.decisions) {
        console.log(
          `[Orchestrator]     - ${d.side.toUpperCase()} ${d.instrument} ` +
          `(confidence: ${d.confidence.toFixed(2)}, sources: ${d.signalSources.join('+')})`
        );
      }

      // ------------------------------------------------------------------
      // Step 4: Risk Guardian evaluation
      // ------------------------------------------------------------------
      console.log('[Orchestrator] Step 4/6: Risk Guardian evaluation...');
      result.riskAssessment = await this.riskAgent.run({
        decisions: result.decisions,
        marketState: result.marketState,
        config: this.config,
      });

      const approved = result.riskAssessment.approvedDecisions.length;
      const rejected = result.riskAssessment.rejectedDecisions.length;
      console.log(
        `[Orchestrator]   Risk verdict: ${approved} approved, ${rejected} rejected | ` +
        `heat=${result.riskAssessment.portfolioHeat.toFixed(2)}%, ` +
        `drawdown=${result.riskAssessment.maxDrawdownPercent.toFixed(2)}%`
      );

      if (approved === 0) {
        console.log(`[Orchestrator]   All trades rejected by Risk Guardian: ${result.riskAssessment.reason}`);
        result.durationMs = Date.now() - startTime;
        this.logCycleSummary(result);
        this.cycleHistory.push(result);
        this.cycleInProgress = false;
        return result;
      }

      // ------------------------------------------------------------------
      // Step 5: Pre-trade validation
      // ------------------------------------------------------------------
      console.log('[Orchestrator] Step 5/6: Pre-trade validation...');
      const approvedDecisions = result.riskAssessment.approvedDecisions;
      const validatedDecisions: EngineTradeDecision[] = [];

      for (const decision of approvedDecisions) {
        const validation = await runPreTradeValidation(decision);
        if (validation.passed) {
          validatedDecisions.push(decision);
          console.log(`[Orchestrator]   [PASS] ${decision.instrument} ${decision.side}`);
        } else {
          console.warn(
            `[Orchestrator]   [FAIL] ${decision.instrument} ${decision.side}: ` +
            `${validation.reason} (layer: ${validation.layer})`
          );
        }
      }

      if (validatedDecisions.length === 0) {
        console.log('[Orchestrator]   No trades passed pre-trade validation.');
        result.durationMs = Date.now() - startTime;
        this.logCycleSummary(result);
        this.cycleHistory.push(result);
        this.cycleInProgress = false;
        return result;
      }

      // ------------------------------------------------------------------
      // Step 6: Execute trades
      // ------------------------------------------------------------------
      console.log(`[Orchestrator] Step 6/6: Executing ${validatedDecisions.length} trade(s)...`);

      // Limit to max trades per cycle
      const tradesToExecute = validatedDecisions.slice(0, this.config.maxTradesPerCycle);
      if (tradesToExecute.length < validatedDecisions.length) {
        console.log(
          `[Orchestrator]   Capped at ${this.config.maxTradesPerCycle} trades per cycle ` +
          `(${validatedDecisions.length - tradesToExecute.length} deferred)`
        );
      }

      for (const decision of tradesToExecute) {
        try {
          const executionResult = await this.executionAgent.run({
            decision,
            marketState: result.marketState,
            paperTrading: this.config.paperTrading,
          });

          result.executions.push(executionResult);

          // Post-trade hook (logging, position updates, event publishing)
          await runPostTradeHook(executionResult);

          // Update circuit breaker
          const isLoss = executionResult.status === 'filled' && executionResult.price < (decision.entryPrice ?? 0);
          await updateCircuitBreaker({
            lastTradeResult: executionResult.status === 'failed' ? 'loss' : (isLoss ? 'loss' : 'win'),
            errorOccurred: executionResult.status === 'failed',
          });

          const statusIcon = executionResult.status === 'filled' ? 'OK' :
                             executionResult.status === 'simulated' ? 'SIM' :
                             executionResult.status === 'failed' ? 'FAIL' : 'PEND';

          console.log(
            `[Orchestrator]   [${statusIcon}] ${decision.side.toUpperCase()} ${decision.instrument}: ` +
            `qty=${executionResult.quantity}, price=${executionResult.price}, ` +
            `orderId=${executionResult.orderId}`
          );
        } catch (execError) {
          const errorMsg = execError instanceof Error ? execError.message : String(execError);
          console.error(`[Orchestrator]   [ERR]  ${decision.instrument}: ${errorMsg}`);

          result.executions.push({
            orderId: '',
            instrument: decision.instrument,
            status: 'failed',
            side: decision.side,
            quantity: decision.quantity,
            price: 0,
            timestamp: new Date(),
            error: errorMsg,
          });

          await updateCircuitBreaker({ errorOccurred: true });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.error = errorMsg;
      result.status = 'error';
      console.error(`[Orchestrator] CYCLE ERROR: ${errorMsg}`);

      await updateCircuitBreaker({ errorOccurred: true });
    }

    result.durationMs = Date.now() - startTime;
    this.logCycleSummary(result);
    this.cycleHistory.push(result);

    // Keep only last 100 cycles in memory
    if (this.cycleHistory.length > 100) {
      this.cycleHistory = this.cycleHistory.slice(-100);
    }

    this.cycleInProgress = false;
    return result;
  }

  // -----------------------------------------------------------------------
  // Step 1: Market State Gathering
  // -----------------------------------------------------------------------

  private async gatherMarketState(): Promise<EngineMarketState> {
    const instruments = this.getActiveInstruments();
    const instrumentSnapshots: InstrumentSnapshot[] = [];

    // Fetch candle data and order books for all instruments in parallel
    const snapshotPromises = instruments.map(async (symbol) => {
      try {
        // Fetch multiple timeframes in parallel for each instrument
        const [candles1h, candles4h, candles1d, orderBookData] = await Promise.allSettled([
          getCandles({ instrument: symbol, timeframe: '1h', limit: 100 }),
          getCandles({ instrument: symbol, timeframe: '4h', limit: 50 }),
          getCandles({ instrument: symbol, timeframe: '1d', limit: 30 }),
          getOrderBook({ instrument: symbol, depth: 20 }),
        ]);

        const c1h = candles1h.status === 'fulfilled' ? candles1h.value : [];
        const c4h = candles4h.status === 'fulfilled' ? candles4h.value : [];
        const c1d = candles1d.status === 'fulfilled' ? candles1d.value : [];
        const ob = orderBookData.status === 'fulfilled' ? orderBookData.value : null;

        // Derive current price from latest candle
        const latestCandle = c1h.length > 0 ? c1h[c1h.length - 1] : null;
        const prevDayClose = c1d.length >= 2 ? c1d[c1d.length - 2]?.close ?? 0 : 0;
        const currentPrice = latestCandle?.close ?? 0;
        const change24h = prevDayClose > 0 ? currentPrice - prevDayClose : 0;

        // Calculate 24h volume from hourly candles (last 24)
        const last24hCandles = c1h.slice(-24);
        const volume24h = last24hCandles.reduce((sum, c) => sum + (c?.volume ?? 0), 0);

        // 24h high/low
        const high24h = last24hCandles.reduce((max, c) => Math.max(max, c?.high ?? 0), 0);
        const low24h = last24hCandles.reduce((min, c) => Math.min(min, c?.low ?? Infinity), Infinity);

        // Order book summary
        let orderBookSummary: InstrumentSnapshot['orderBook'] = null;
        if (ob && ob.bids.length > 0 && ob.asks.length > 0) {
          const bestBid = ob.bids[0]?.price ?? 0;
          const bestAsk = ob.asks[0]?.price ?? 0;
          const spread = bestAsk - bestBid;
          orderBookSummary = {
            bestBid,
            bestAsk,
            spread,
            spreadPercent: bestBid > 0 ? (spread / bestBid) * 100 : 0,
            bidDepth: ob.bids.reduce((sum, b) => sum + b.size, 0),
            askDepth: ob.asks.reduce((sum, a) => sum + a.size, 0),
          };
        }

        const snapshot: InstrumentSnapshot = {
          symbol,
          price: currentPrice,
          change24h,
          volume24h,
          high24h,
          low24h: low24h === Infinity ? 0 : low24h,
          candles: {
            '1h': c1h,
            '4h': c4h,
            '1d': c1d,
          },
          orderBook: orderBookSummary,
        };

        return snapshot;
      } catch (err) {
        console.warn(`[Orchestrator] Failed to fetch data for ${symbol}:`, err);
        return {
          symbol,
          price: 0,
          change24h: 0,
          volume24h: 0,
          high24h: 0,
          low24h: 0,
          candles: {},
          orderBook: null,
        } as InstrumentSnapshot;
      }
    });

    const results = await Promise.allSettled(snapshotPromises);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        instrumentSnapshots.push(r.value);
      }
    }

    // Fetch open positions across all exchanges
    let openPositions: EnginePosition[] = [];
    try {
      const positionsData = await getPositions();
      openPositions = positionsData.total;
    } catch (err) {
      console.warn('[Orchestrator] Failed to fetch positions:', err);
    }

    // Calculate portfolio value
    const positionValue = openPositions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0,
    );
    const portfolioValue = this.config.initialEquity + positionValue;

    // Update equity peak for drawdown calculation
    if (portfolioValue > this.equityPeak) {
      this.equityPeak = portfolioValue;
    }
    const drawdownFromPeak = this.equityPeak > 0
      ? ((this.equityPeak - portfolioValue) / this.equityPeak) * 100
      : 0;

    return {
      timestamp: new Date(),
      instruments: instrumentSnapshots,
      portfolioValue,
      openPositions,
      dailyPnl: this.dailyPnl,
      drawdownFromPeak,
    };
  }

  // -----------------------------------------------------------------------
  // Step 2: Agent Implementations
  // -----------------------------------------------------------------------

  private createQuantAgent(): Agent<QuantAgentContext, EngineQuantAnalysis> {
    return {
      name: AGENT_DEFINITIONS.quantAnalyst.name,
      definition: AGENT_DEFINITIONS.quantAnalyst,
      systemPrompt: QUANT_ANALYST_PROMPT,
      run: async (ctx) => {
        console.log('[Agent:QuantAnalyst] Starting multi-timeframe analysis...');
        const allSignals: QuantSignal[] = [];
        const allPatterns: PatternDetection[] = [];

        for (const instr of ctx.instruments) {
          const snapshot = ctx.marketState.instruments.find(i => i.symbol === instr);
          if (!snapshot) continue;

          const candles1h = snapshot.candles['1h'] ?? [];
          const candles4h = snapshot.candles['4h'] ?? [];
          const candles1d = snapshot.candles['1d'] ?? [];

          if (candles1h.length < 20) {
            console.log(`[Agent:QuantAnalyst] Insufficient data for ${instr} (${candles1h.length} 1h candles)`);
            continue;
          }

          // Compute indicators across timeframes using the analysis-tools MCP server
          const [indicators1h, indicators4h, indicators1d, patterns1h, signalScore] = await Promise.allSettled([
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

          // Process indicator results across all timeframes
          const ind1h = indicators1h.status === 'fulfilled' ? indicators1h.value : [];
          const ind4h = indicators4h.status === 'fulfilled' ? indicators4h.value : [];
          const ind1d = indicators1d.status === 'fulfilled' ? indicators1d.value : [];
          const patt = patterns1h.status === 'fulfilled' ? patterns1h.value : [];
          const sigScore = signalScore.status === 'fulfilled' ? signalScore.value : null;

          // Determine bias from indicators across all timeframes
          // Higher timeframes (1d) carry more weight in trend determination
          let bullishCount = 0;
          let bearishCount = 0;
          let totalConfidence = 0;

          for (const ind of ind1h) {
            if (ind.signal === 'bullish') bullishCount += 1;
            if (ind.signal === 'bearish') bearishCount += 1;
            totalConfidence += ind.strength;
          }
          for (const ind of ind4h) {
            if (ind.signal === 'bullish') bullishCount += 1.5; // Higher TF = more weight
            if (ind.signal === 'bearish') bearishCount += 1.5;
            totalConfidence += ind.strength;
          }
          for (const ind of ind1d) {
            if (ind.signal === 'bullish') bullishCount += 2.0; // Daily TF = highest weight
            if (ind.signal === 'bearish') bearishCount += 2.0;
            totalConfidence += ind.strength;
          }

          const totalIndicators = ind1h.length + ind4h.length + ind1d.length;
          const avgConfidence = totalIndicators > 0 ? totalConfidence / totalIndicators : 0;

          // Use signal score if available, otherwise calculate from indicator consensus
          const effectiveScore = sigScore?.score ?? (
            totalIndicators > 0 ? (bullishCount - bearishCount) / totalIndicators : 0
          );
          const effectiveConfidence = sigScore?.confidence ?? avgConfidence;

          // Determine direction with minimum threshold
          if (Math.abs(effectiveScore) > 0.15 && effectiveConfidence >= ctx.config.minConfidence) {
            const direction: 'long' | 'short' = effectiveScore > 0 ? 'long' : 'short';

            // Calculate stop loss from ATR if available
            const atrIndicator = ind1h.find(i => i.name === 'atr');
            const atrValue = atrIndicator?.values?.[atrIndicator.values.length - 1] ?? 0;
            const currentPrice = snapshot.price;
            const stopDistance = atrValue > 0 ? atrValue * 2.0 : currentPrice * 0.02;
            const stopLoss = direction === 'long'
              ? currentPrice - stopDistance
              : currentPrice + stopDistance;
            const target = direction === 'long'
              ? currentPrice + stopDistance * 2.0
              : currentPrice - stopDistance * 2.0;

            const sources = [
              ...ind1h.filter(i => i.signal !== 'neutral').map(i => i.name),
              ...ind4h.filter(i => i.signal !== 'neutral').map(i => `${i.name}(4h)`),
              ...ind1d.filter(i => i.signal !== 'neutral').map(i => `${i.name}(1d)`),
            ];

            allSignals.push({
              instrument: instr,
              direction,
              indicator: sources.join('+') || 'composite',
              confidence: Math.min(effectiveConfidence, 1.0),
              entryPrice: currentPrice,
              stopLoss,
              target,
              riskReward: stopDistance > 0 ? (Math.abs(target - currentPrice) / stopDistance) : 0,
              timeframe: '1h',
            });
          }

          // Process detected patterns
          for (const p of patt) {
            allPatterns.push({
              name: p.name,
              type: p.direction,
              reliability: p.reliability,
              instrument: instr,
              timeframe: '1h',
            });
          }
        }

        // Determine overall bias
        const longSignals = allSignals.filter(s => s.direction === 'long').length;
        const shortSignals = allSignals.filter(s => s.direction === 'short').length;
        const overallBias: 'bullish' | 'bearish' | 'neutral' =
          longSignals > shortSignals ? 'bullish' :
          shortSignals > longSignals ? 'bearish' : 'neutral';

        const avgSignalConfidence = allSignals.length > 0
          ? allSignals.reduce((sum, s) => sum + s.confidence, 0) / allSignals.length
          : 0;

        const analysis: EngineQuantAnalysis = {
          timestamp: new Date(),
          signals: allSignals,
          patterns: allPatterns,
          overallBias,
          confidence: avgSignalConfidence,
          summary: allSignals.length > 0
            ? `${allSignals.length} signal(s) detected: ${longSignals} long, ${shortSignals} short. ` +
              `${allPatterns.length} pattern(s) found. Overall bias: ${overallBias} (${(avgSignalConfidence * 100).toFixed(0)}% confidence).`
            : 'No actionable signals detected across monitored instruments.',
        };

        console.log(`[Agent:QuantAnalyst] Complete: ${analysis.summary}`);
        return analysis;
      },
    };
  }

  private createSentimentAgent(): Agent<SentimentAgentContext, EngineSentimentAnalysis> {
    return {
      name: AGENT_DEFINITIONS.sentimentAnalyst.name,
      definition: AGENT_DEFINITIONS.sentimentAnalyst,
      systemPrompt: SENTIMENT_ANALYST_PROMPT,
      run: async (ctx) => {
        console.log('[Agent:SentimentAnalyst] Fetching sentiment data...');

        // Fetch sentiment for all active instruments in parallel
        const sentimentPromises = ctx.instruments.map(instr =>
          getSentiment({ instrument: instr, sources: ['news', 'social', 'onchain'] })
            .catch(() => null)
        );

        const sentimentResults = await Promise.all(sentimentPromises);
        const validResults = sentimentResults.filter(
          (r): r is NonNullable<typeof r> => r !== null
        );

        // Aggregate across instruments
        let totalScore = 0;
        let totalFearGreed = 50;
        const allSources: EngineSentimentAnalysis['sources'] = [];

        for (const data of validResults) {
          totalScore += data.overallScore;
          totalFearGreed = data.fearGreedIndex; // Use the latest

          for (const src of data.sources) {
            allSources.push({
              name: `${data.instrument}:${src.name}`,
              score: src.score,
              articles: src.articles,
            });
          }
        }

        const avgScore = validResults.length > 0 ? totalScore / validResults.length : 0;

        // Classify overall sentiment
        let overallSentiment: EngineSentimentAnalysis['overallSentiment'];
        if (avgScore > 0.3) overallSentiment = 'bullish';
        else if (avgScore < -0.3) overallSentiment = 'bearish';
        else if (Math.abs(avgScore) < 0.1) overallSentiment = 'neutral';
        else overallSentiment = 'mixed';

        // Contrarian check: extreme readings suggest reversal risk
        const keyEvents: EngineSentimentAnalysis['keyEvents'] = [];
        if (avgScore > 0.8) {
          keyEvents.push({
            event: 'Extreme bullish sentiment - potential contrarian sell signal',
            impact: 'high',
            expectedEffect: 'Increased reversal risk due to euphoria',
          });
        } else if (avgScore < -0.8) {
          keyEvents.push({
            event: 'Extreme bearish sentiment - potential contrarian buy signal',
            impact: 'high',
            expectedEffect: 'Possible capitulation bottom forming',
          });
        }

        const analysis: EngineSentimentAnalysis = {
          timestamp: new Date(),
          overallSentiment,
          score: avgScore,
          fearGreedIndex: totalFearGreed,
          sources: allSources,
          keyEvents,
          summary: `Sentiment: ${overallSentiment} (score: ${avgScore.toFixed(2)}). ` +
            `Fear & Greed: ${totalFearGreed}. ` +
            `${allSources.length} source(s) analyzed across ${validResults.length} instrument(s).`,
        };

        console.log(`[Agent:SentimentAnalyst] Complete: ${analysis.summary}`);
        return analysis;
      },
    };
  }

  private createMacroAgent(): Agent<MacroAgentContext, EngineMacroAnalysis> {
    return {
      name: AGENT_DEFINITIONS.macroAnalyst.name,
      definition: AGENT_DEFINITIONS.macroAnalyst,
      systemPrompt: MACRO_ANALYST_PROMPT,
      run: async (_ctx) => {
        console.log('[Agent:MacroAnalyst] Fetching macro data...');

        const macroData = await getMacroData();

        // Classify regime based on macro indicators
        let regime: EngineMacroAnalysis['regime'] = 'neutral';
        let riskEnvironment: EngineMacroAnalysis['riskEnvironment'] = 'normal';
        const keyFactors: EngineMacroAnalysis['keyFactors'] = [];

        // Fed rate analysis
        if (macroData.fedFundsRate > 0) {
          keyFactors.push({
            name: 'Fed Funds Rate',
            value: macroData.fedFundsRate,
            impact: macroData.fedFundsRate > 5.0 ? 'negative' : macroData.fedFundsRate < 2.0 ? 'positive' : 'neutral',
            importance: 'high',
          });
        }

        // VIX analysis
        if (macroData.vix > 0) {
          keyFactors.push({
            name: 'VIX',
            value: macroData.vix,
            impact: macroData.vix > 25 ? 'negative' : macroData.vix < 15 ? 'positive' : 'neutral',
            importance: 'high',
          });

          if (macroData.vix > 35) {
            riskEnvironment = 'extreme';
            regime = 'risk-off';
          } else if (macroData.vix > 25) {
            riskEnvironment = 'elevated';
            regime = 'risk-off';
          } else if (macroData.vix < 15) {
            riskEnvironment = 'low';
            regime = 'risk-on';
          }
        }

        // CPI (inflation) analysis
        if (macroData.cpiYoY > 0) {
          keyFactors.push({
            name: 'CPI YoY',
            value: macroData.cpiYoY,
            impact: macroData.cpiYoY > 4.0 ? 'negative' : macroData.cpiYoY < 2.5 ? 'positive' : 'neutral',
            importance: 'high',
          });
        }

        // Yield curve analysis
        if (macroData.yieldCurveSpread !== 0) {
          keyFactors.push({
            name: 'Yield Curve (10Y-2Y)',
            value: macroData.yieldCurveSpread,
            impact: macroData.yieldCurveSpread < 0 ? 'negative' : 'neutral',
            importance: 'medium',
          });

          if (macroData.yieldCurveSpread < -0.5) {
            regime = 'risk-off';
          }
        }

        // DXY (dollar strength) analysis
        if (macroData.dxyIndex > 0) {
          keyFactors.push({
            name: 'DXY Index',
            value: macroData.dxyIndex,
            impact: macroData.dxyIndex > 105 ? 'negative' : macroData.dxyIndex < 95 ? 'positive' : 'neutral',
            importance: 'medium',
          });
        }

        // PMI analysis
        if (macroData.pmiManufacturing > 0) {
          keyFactors.push({
            name: 'PMI Manufacturing',
            value: macroData.pmiManufacturing,
            impact: macroData.pmiManufacturing > 50 ? 'positive' : 'negative',
            importance: 'medium',
          });
        }

        // Determine final regime from factor consensus
        const positiveFactors = keyFactors.filter(f => f.impact === 'positive').length;
        const negativeFactors = keyFactors.filter(f => f.impact === 'negative').length;

        if (keyFactors.length > 0 && riskEnvironment === 'normal') {
          if (positiveFactors > negativeFactors * 2) regime = 'risk-on';
          else if (negativeFactors > positiveFactors * 2) regime = 'risk-off';
          else if (positiveFactors !== negativeFactors) regime = 'transition';
        }

        const outlook = keyFactors.length > 0
          ? `Macro regime: ${regime}, risk environment: ${riskEnvironment}. ` +
            `${positiveFactors} positive, ${negativeFactors} negative factors out of ${keyFactors.length} analyzed.`
          : 'Macro data unavailable. Defaulting to neutral regime with normal risk environment.';

        const analysis: EngineMacroAnalysis = {
          timestamp: new Date(),
          regime,
          riskEnvironment,
          keyFactors,
          outlook,
        };

        console.log(`[Agent:MacroAnalyst] Complete: ${outlook}`);
        return analysis;
      },
    };
  }

  private createRiskAgent(): Agent<RiskAgentContext, EngineRiskAssessment> {
    return {
      name: AGENT_DEFINITIONS.riskGuardian.name,
      definition: AGENT_DEFINITIONS.riskGuardian,
      systemPrompt: RISK_GUARDIAN_PROMPT,
      run: async (ctx) => {
        console.log(`[Agent:RiskGuardian] Evaluating ${ctx.decisions.length} decision(s)...`);

        const portfolioEquity = ctx.marketState.portfolioValue;
        const openPositions = ctx.marketState.openPositions;
        const dailyPnl = ctx.marketState.dailyPnl;
        const drawdown = ctx.marketState.drawdownFromPeak;

        // Get portfolio heat
        const heat = await getPortfolioHeat({
          positions: openPositions,
          portfolioEquity,
        });

        // Get current VaR
        const varResult = await getVaR({
          positions: openPositions,
          portfolioEquity,
          confidenceLevel: 0.95,
        });

        const approved: EngineTradeDecision[] = [];
        const rejected: Array<EngineTradeDecision & { rejectionReason: string }> = [];

        // Daily loss halt check (3% rule)
        const dailyLossPercent = portfolioEquity > 0
          ? (Math.abs(Math.min(dailyPnl, 0)) / portfolioEquity) * 100
          : 0;

        if (dailyLossPercent >= 3.0) {
          console.warn('[Agent:RiskGuardian] Daily loss limit (3%) reached. ALL trades rejected.');
          for (const d of ctx.decisions) {
            rejected.push({ ...d, rejectionReason: `Daily loss limit reached: ${dailyLossPercent.toFixed(2)}%` });
          }
        } else if (drawdown >= 10.0) {
          console.warn('[Agent:RiskGuardian] Max drawdown (10%) reached. ALL trades rejected.');
          for (const d of ctx.decisions) {
            rejected.push({ ...d, rejectionReason: `Max drawdown reached: ${drawdown.toFixed(2)}%` });
          }
        } else {
          // Evaluate each decision individually
          for (const decision of ctx.decisions) {
            // Run the full risk check
            const riskResult = await checkRisk({
              decision,
              portfolioEquity,
              openPositions,
              dailyPnl,
              maxDrawdownFromPeak: drawdown,
            });

            if (!riskResult.passed) {
              rejected.push({ ...decision, rejectionReason: riskResult.reason });
              continue;
            }

            // Calculate proper position size if quantity is 0
            if (decision.quantity <= 0 && decision.entryPrice && decision.stopLoss) {
              const sizing = await calculatePositionSize({
                instrument: decision.instrument,
                entryPrice: decision.entryPrice,
                stopLoss: decision.stopLoss,
                portfolioEquity,
                riskPercent: decision.confidence > 0.85 ? 1.5 : 1.0,
              });

              decision.quantity = sizing.recommendedSize;
              console.log(
                `[Agent:RiskGuardian] Position sized: ${decision.instrument} = ` +
                `${sizing.recommendedSize.toFixed(6)} units (${sizing.riskPercent.toFixed(2)}% risk, ${sizing.method})`
              );
            }

            // Validate quantity is positive after sizing
            if (decision.quantity <= 0) {
              rejected.push({ ...decision, rejectionReason: 'Position size calculated as zero or negative' });
              continue;
            }

            // Apply volatility adjustments from macro regime
            // If portfolio heat is elevated, reduce sizes
            if (heat.totalHeat > 4.0 && heat.totalHeat <= 6.0) {
              decision.quantity *= 0.5;
              console.log(`[Agent:RiskGuardian] Reduced position by 50% due to elevated heat (${heat.totalHeat.toFixed(2)}%)`);
            }

            // Daily loss approaching 2% - reduce sizes by 50%
            if (dailyLossPercent >= 2.0 && dailyLossPercent < 3.0) {
              decision.quantity *= 0.5;
              console.log(`[Agent:RiskGuardian] Reduced position by 50% (daily loss at ${dailyLossPercent.toFixed(2)}%)`);
            }

            // Drawdown adjustments
            if (drawdown >= 5.0 && drawdown < 7.5) {
              decision.quantity *= 0.75;
              console.log(`[Agent:RiskGuardian] Reduced position by 25% (drawdown at ${drawdown.toFixed(2)}%)`);
            } else if (drawdown >= 7.5 && drawdown < 10.0) {
              decision.quantity *= 0.5;
              console.log(`[Agent:RiskGuardian] Reduced position by 50% (drawdown at ${drawdown.toFixed(2)}%)`);
            }

            approved.push(decision);
          }
        }

        const assessment: EngineRiskAssessment = {
          timestamp: new Date(),
          approved: approved.length > 0,
          reason: approved.length > 0
            ? `${approved.length} trade(s) approved, ${rejected.length} rejected`
            : rejected.length > 0
              ? `All ${rejected.length} trade(s) rejected: ${rejected.map(r => r.rejectionReason).join('; ')}`
              : 'No decisions to evaluate',
          portfolioHeat: heat.totalHeat,
          maxDrawdownPercent: drawdown,
          approvedDecisions: approved,
          rejectedDecisions: rejected,
          varOneDay: varResult.oneDay,
          varFiveDay: varResult.fiveDay,
        };

        console.log(
          `[Agent:RiskGuardian] Complete: ${approved.length} approved, ${rejected.length} rejected. ` +
          `Heat: ${heat.totalHeat.toFixed(2)}%, VaR(1d): $${varResult.oneDay.toFixed(2)}`
        );

        return assessment;
      },
    };
  }

  private createExecutionAgent(): Agent<ExecutionAgentContext, EngineExecutionResult> {
    return {
      name: AGENT_DEFINITIONS.executionSpecialist.name,
      definition: AGENT_DEFINITIONS.executionSpecialist,
      systemPrompt: EXECUTION_SPECIALIST_PROMPT,
      run: async (ctx) => {
        const { decision, paperTrading } = ctx;

        console.log(
          `[Agent:ExecutionSpecialist] ${paperTrading ? '(PAPER) ' : ''}` +
          `${decision.side.toUpperCase()} ${decision.quantity.toFixed(6)} ${decision.instrument} ` +
          `@ ${decision.entryPrice?.toFixed(2) ?? 'market'}`
        );

        // Paper trading mode - simulate execution
        if (paperTrading) {
          const snapshot = ctx.marketState.instruments.find(i => i.symbol === decision.instrument);
          const fillPrice = decision.entryPrice ?? snapshot?.price ?? 0;

          // Simulate small slippage (0.01-0.1%)
          const slippageBps = Math.random() * 10 + 1; // 1-10 bps
          const slippageMultiplier = decision.side === 'buy'
            ? 1 + slippageBps / 10000
            : 1 - slippageBps / 10000;
          const simulatedPrice = fillPrice * slippageMultiplier;
          const slippage = Math.abs(simulatedPrice - fillPrice);

          // Simulate fees (0.1% taker fee typical for crypto)
          const fees = decision.quantity * simulatedPrice * 0.001;

          return {
            orderId: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            instrument: decision.instrument,
            status: 'simulated',
            side: decision.side,
            quantity: decision.quantity,
            price: simulatedPrice,
            timestamp: new Date(),
            slippage,
            fees,
          };
        }

        // Live execution via trading tools
        const order: EngineTradeOrder = {
          instrument: decision.instrument,
          side: decision.side,
          quantity: decision.quantity,
          type: 'market',
          price: decision.entryPrice,
        };

        // Check order book for liquidity before executing
        const snapshot = ctx.marketState.instruments.find(i => i.symbol === decision.instrument);
        if (snapshot?.orderBook) {
          const { spreadPercent, bidDepth, askDepth } = snapshot.orderBook;

          // Use limit order if spread is wide
          if (spreadPercent > 0.1) {
            order.type = 'limit';
            order.price = decision.side === 'buy'
              ? snapshot.orderBook.bestAsk
              : snapshot.orderBook.bestBid;
            console.log(
              `[Agent:ExecutionSpecialist] Wide spread (${spreadPercent.toFixed(3)}%), using limit order @ ${order.price}`
            );
          }

          // Check if our order size is reasonable vs liquidity
          const relevantDepth = decision.side === 'buy' ? askDepth : bidDepth;
          if (decision.quantity > relevantDepth * 0.2) {
            console.warn(
              `[Agent:ExecutionSpecialist] Order size (${decision.quantity}) is >${20}% of book depth ` +
              `(${relevantDepth.toFixed(2)}). Consider splitting.`
            );
          }
        }

        return executeTrade(order);
      },
    };
  }

  // -----------------------------------------------------------------------
  // Claude-backed agent factories (used when useClaudeAgents=true)
  // -----------------------------------------------------------------------

  private createClaudeQuantAgent(): Agent<QuantAgentContext, EngineQuantAnalysis> {
    return {
      name: AGENT_DEFINITIONS.quantAnalyst.name,
      definition: AGENT_DEFINITIONS.quantAnalyst,
      systemPrompt: QUANT_ANALYST_PROMPT,
      run: (ctx) => runClaudeQuantAnalyst(ctx),
    };
  }

  private createClaudeSentimentAgent(): Agent<SentimentAgentContext, EngineSentimentAnalysis> {
    return {
      name: AGENT_DEFINITIONS.sentimentAnalyst.name,
      definition: AGENT_DEFINITIONS.sentimentAnalyst,
      systemPrompt: SENTIMENT_ANALYST_PROMPT,
      run: (ctx) => runClaudeSentimentAnalyst(ctx),
    };
  }

  private createClaudeMacroAgent(): Agent<MacroAgentContext, EngineMacroAnalysis> {
    return {
      name: AGENT_DEFINITIONS.macroAnalyst.name,
      definition: AGENT_DEFINITIONS.macroAnalyst,
      systemPrompt: MACRO_ANALYST_PROMPT,
      run: (ctx) => runClaudeMacroAnalyst(ctx),
    };
  }

  // -----------------------------------------------------------------------
  // Step 3: Decision Aggregation
  // -----------------------------------------------------------------------

  private aggregateDecisions(
    quant: EngineQuantAnalysis | null,
    sentiment: EngineSentimentAnalysis | null,
    macro: EngineMacroAnalysis | null,
    marketState: EngineMarketState,
  ): EngineTradeDecision[] {
    const decisions: EngineTradeDecision[] = [];

    // If unanimity is required, all three analysts must have produced output
    if (this.config.requireUnanimity && (!quant || !sentiment || !macro)) {
      console.log('[Orchestrator]   Unanimity required but incomplete analysis. No decisions.');
      return decisions;
    }

    // Must have quant analysis at minimum (it produces the actual signals)
    if (!quant || quant.signals.length === 0) {
      console.log('[Orchestrator]   No quant signals available. No decisions.');
      return decisions;
    }

    // Overall confidence gate
    if (quant.confidence < this.config.minConfidence) {
      console.log(
        `[Orchestrator]   Quant confidence (${quant.confidence.toFixed(2)}) below threshold ` +
        `(${this.config.minConfidence}). No decisions.`
      );
      return decisions;
    }

    // Macro regime gate
    if (macro?.riskEnvironment === 'extreme') {
      console.log('[Orchestrator]   Macro risk environment is EXTREME. All signals blocked.');
      return decisions;
    }

    // Determine sentiment modifier and macro modifier
    const sentimentScore = sentiment?.score ?? 0;
    const sentimentModifier = this.computeSentimentModifier(sentimentScore, sentiment?.overallSentiment);
    const macroModifier = this.computeMacroModifier(macro);

    for (const signal of quant.signals) {
      // Check sentiment alignment
      const sentimentAligned = this.isSentimentAligned(signal.direction, sentimentScore, sentiment?.overallSentiment);

      // Check macro alignment
      const macroAligned = this.isMacroAligned(signal.direction, macro);

      // Require at least sentiment OR macro alignment (not necessarily both)
      if (!sentimentAligned && !macroAligned && this.config.requireUnanimity) {
        console.log(
          `[Orchestrator]   Signal ${signal.instrument} ${signal.direction} skipped: ` +
          `no alignment (sentiment: ${sentimentScore.toFixed(2)}, macro: ${macro?.regime ?? 'n/a'})`
        );
        continue;
      }

      // Compute composite confidence
      let compositeConfidence = signal.confidence;

      // Boost or penalize based on alignment
      const signalSources: string[] = [signal.indicator];

      if (sentimentAligned) {
        compositeConfidence += 0.1 * sentimentModifier;
        signalSources.push(`sentiment(${sentimentScore.toFixed(2)})`);
      } else if (sentimentScore !== 0) {
        // Penalty for misalignment
        compositeConfidence -= 0.05;
      }

      if (macroAligned) {
        compositeConfidence += 0.05 * macroModifier;
        signalSources.push(`macro(${macro?.regime ?? 'neutral'})`);
      }

      // Pattern confirmation bonus
      const confirmingPatterns = quant.patterns.filter(
        p => p.instrument === signal.instrument &&
          ((signal.direction === 'long' && p.type === 'bullish') ||
           (signal.direction === 'short' && p.type === 'bearish'))
      );
      if (confirmingPatterns.length > 0) {
        compositeConfidence += 0.05 * Math.min(confirmingPatterns.length, 3);
        signalSources.push(`pattern(${confirmingPatterns.map(p => p.name).join(',')})`);
      }

      // Clamp confidence to [0, 1]
      compositeConfidence = Math.max(0, Math.min(1, compositeConfidence));

      // Final confidence gate
      if (compositeConfidence < this.config.minConfidence) {
        console.log(
          `[Orchestrator]   Signal ${signal.instrument} ${signal.direction} filtered: ` +
          `composite confidence ${compositeConfidence.toFixed(2)} < ${this.config.minConfidence}`
        );
        continue;
      }

      // Construct trade decision
      const side: 'buy' | 'sell' = signal.direction === 'long' ? 'buy' : 'sell';
      const entryPrice = signal.entryPrice ?? marketState.instruments.find(i => i.symbol === signal.instrument)?.price ?? 0;
      const stopLoss = signal.stopLoss;
      const takeProfit = signal.target;

      const riskRewardRatio = stopLoss && takeProfit && entryPrice
        ? Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)
        : undefined;

      // Require minimum 1.5:1 risk/reward
      if (riskRewardRatio !== undefined && riskRewardRatio < 1.5) {
        console.log(
          `[Orchestrator]   Signal ${signal.instrument} ${signal.direction} filtered: ` +
          `R:R ${riskRewardRatio.toFixed(2)} < 1.5 minimum`
        );
        continue;
      }

      decisions.push({
        instrument: signal.instrument,
        side,
        quantity: 0, // Position sizing handled by Risk Guardian
        reason:
          `Quant: ${signal.indicator} (${signal.timeframe}, conf: ${signal.confidence.toFixed(2)}). ` +
          `Sentiment: ${sentiment?.overallSentiment ?? 'n/a'} (${sentimentScore.toFixed(2)}). ` +
          `Macro: ${macro?.regime ?? 'n/a'} (risk: ${macro?.riskEnvironment ?? 'n/a'}). ` +
          `Composite confidence: ${compositeConfidence.toFixed(2)}.`,
        confidence: compositeConfidence,
        timestamp: new Date(),
        stopLoss,
        entryPrice,
        takeProfit,
        riskRewardRatio,
        signalSources,
      });
    }

    // Sort by confidence descending
    decisions.sort((a, b) => b.confidence - a.confidence);

    return decisions;
  }

  // -----------------------------------------------------------------------
  // Aggregation Helpers
  // -----------------------------------------------------------------------

  private isSentimentAligned(
    direction: 'long' | 'short',
    sentimentScore: number,
    overallSentiment?: string,
  ): boolean {
    // Strong alignment
    if (direction === 'long' && sentimentScore > 0.2) return true;
    if (direction === 'short' && sentimentScore < -0.2) return true;

    // Neutral sentiment doesn't block
    if (overallSentiment === 'neutral' || overallSentiment === 'mixed') return true;

    // Contrarian: extreme opposite sentiment is actually aligned (mean reversion)
    if (direction === 'long' && sentimentScore < -0.8) return true; // Capitulation buy
    if (direction === 'short' && sentimentScore > 0.8) return true; // Euphoria sell

    return false;
  }

  private isMacroAligned(
    direction: 'long' | 'short',
    macro: EngineMacroAnalysis | null,
  ): boolean {
    if (!macro) return true; // No data = don't block

    // Risk-on regime aligns with longs
    if (direction === 'long' && macro.regime === 'risk-on') return true;

    // Risk-off regime aligns with shorts
    if (direction === 'short' && macro.regime === 'risk-off') return true;

    // Neutral/transition doesn't block either direction
    if (macro.regime === 'neutral' || macro.regime === 'transition') return true;

    return false;
  }

  private computeSentimentModifier(score: number, _overallSentiment?: string): number {
    // Score ranges from -1 to +1.
    // Modifier is highest when sentiment strongly confirms direction.
    return Math.min(Math.abs(score), 1.0);
  }

  private computeMacroModifier(macro: EngineMacroAnalysis | null): number {
    if (!macro) return 0.5; // Neutral modifier when no data

    switch (macro.riskEnvironment) {
      case 'low': return 1.0;     // Full confidence boost
      case 'normal': return 0.7;
      case 'elevated': return 0.3;
      case 'extreme': return 0.0; // No boost (signals blocked upstream anyway)
      default: return 0.5;
    }
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  private getActiveInstruments(): string[] {
    const instruments: string[] = [];

    if (this.config.enabledMarkets.includes('crypto')) {
      instruments.push(...this.config.instruments.crypto);
    }
    if (this.config.enabledMarkets.includes('equity')) {
      instruments.push(...this.config.instruments.equity);
    }
    if (this.config.enabledMarkets.includes('prediction')) {
      instruments.push(...this.config.instruments.prediction);
    }

    return instruments.filter(Boolean);
  }

  private checkDailyReset(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyResetDate) {
      console.log(`[Orchestrator] New trading day: ${today}. Resetting daily P&L.`);
      this.dailyPnl = 0;
      this.dailyResetDate = today;
    }
  }

  private errorResult(message: string): CycleResult {
    return {
      cycleId: `error-${Date.now()}`,
      cycleNumber: this.cycleCount,
      timestamp: new Date(),
      status: 'error',
      marketState: null,
      quantAnalysis: null,
      sentimentAnalysis: null,
      macroAnalysis: null,
      decisions: [],
      riskAssessment: null,
      executions: [],
      durationMs: 0,
      error: message,
    };
  }

  private logCycleSummary(result: CycleResult): void {
    const border = '-'.repeat(72);
    console.log(border);
    console.log(`  CYCLE ${result.cycleNumber} SUMMARY  |  ${result.status.toUpperCase()}  |  ${result.durationMs}ms`);
    console.log(border);
    console.log(`  Instruments analyzed:  ${result.marketState?.instruments.length ?? 0}`);
    console.log(`  Quant signals:        ${result.quantAnalysis?.signals.length ?? 0}`);
    console.log(`  Patterns detected:    ${result.quantAnalysis?.patterns.length ?? 0}`);
    console.log(`  Decisions generated:  ${result.decisions.length}`);
    console.log(`  Risk approved:        ${result.riskAssessment?.approvedDecisions.length ?? 0}`);
    console.log(`  Risk rejected:        ${result.riskAssessment?.rejectedDecisions.length ?? 0}`);
    console.log(`  Trades executed:      ${result.executions.length}`);

    const filled = result.executions.filter(e => e.status === 'filled' || e.status === 'simulated');
    const failed = result.executions.filter(e => e.status === 'failed');
    if (result.executions.length > 0) {
      console.log(`    Filled/Simulated:   ${filled.length}`);
      console.log(`    Failed:             ${failed.length}`);
    }

    if (result.riskAssessment) {
      console.log(`  Portfolio heat:       ${result.riskAssessment.portfolioHeat.toFixed(2)}%`);
      console.log(`  Max drawdown:         ${result.riskAssessment.maxDrawdownPercent.toFixed(2)}%`);
      console.log(`  VaR (1-day):          $${result.riskAssessment.varOneDay.toFixed(2)}`);
    }

    if (result.error) {
      console.log(`  Error:                ${result.error}`);
    }

    console.log(border);
  }

  private printSessionSummary(): void {
    const totalCycles = this.cycleHistory.length;
    if (totalCycles === 0) {
      console.log('[Orchestrator] No cycles completed in this session.');
      return;
    }

    const completed = this.cycleHistory.filter(c => c.status === 'completed').length;
    const errors = this.cycleHistory.filter(c => c.status === 'error').length;
    const noSignals = this.cycleHistory.filter(c => c.status === 'no_signals').length;
    const cbTrips = this.cycleHistory.filter(c => c.status === 'circuit_breaker').length;
    const totalExecutions = this.cycleHistory.reduce((sum, c) => sum + c.executions.length, 0);
    const totalDecisions = this.cycleHistory.reduce((sum, c) => sum + c.decisions.length, 0);
    const avgDuration = this.cycleHistory.reduce((sum, c) => sum + c.durationMs, 0) / totalCycles;

    console.log('');
    console.log('='.repeat(72));
    console.log('  SESSION SUMMARY');
    console.log('='.repeat(72));
    console.log(`  Total cycles:         ${totalCycles}`);
    console.log(`  Completed:            ${completed}`);
    console.log(`  No signals:           ${noSignals}`);
    console.log(`  Errors:               ${errors}`);
    console.log(`  Circuit breaker:      ${cbTrips}`);
    console.log(`  Total decisions:      ${totalDecisions}`);
    console.log(`  Total executions:     ${totalExecutions}`);
    console.log(`  Avg cycle duration:   ${avgDuration.toFixed(0)}ms`);
    console.log('='.repeat(72));
  }
}

// ---------------------------------------------------------------------------
// Agent context types
// ---------------------------------------------------------------------------

interface QuantAgentContext {
  marketState: EngineMarketState;
  instruments: string[];
  config: OrchestratorConfig;
}

interface SentimentAgentContext {
  marketState: EngineMarketState;
  instruments: string[];
}

interface MacroAgentContext {
  marketState: EngineMarketState;
}

interface RiskAgentContext {
  decisions: EngineTradeDecision[];
  marketState: EngineMarketState;
  config: OrchestratorConfig;
}

interface ExecutionAgentContext {
  decision: EngineTradeDecision;
  marketState: EngineMarketState;
  paperTrading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
