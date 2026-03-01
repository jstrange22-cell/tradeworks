import { runPreTradeValidation } from './hooks/pre-trade.js';
import { runPostTradeHook } from './hooks/post-trade.js';
import { isCircuitBreakerTripped } from './hooks/circuit-breaker.js';

/**
 * Engine-local types that extend shared types with fields
 * needed by the orchestrator but not yet in the shared package.
 */

export interface EngineMarketState {
  timestamp: Date;
  instruments: Array<{ symbol: string; price: number }>;
  portfolioValue: number;
  openPositions: unknown[];
  dailyPnl: number;
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
}

export interface EngineRiskAssessment {
  timestamp: Date;
  approved: boolean;
  reason: string;
  portfolioHeat: number;
  maxDrawdownPercent: number;
  approvedDecisions: EngineTradeDecision[];
  rejectedDecisions: EngineTradeDecision[];
}

export interface EngineExecutionResult {
  orderId: string;
  instrument: string;
  status: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  error?: string;
}

export interface EngineQuantAnalysis {
  timestamp: Date;
  signals: Array<{
    instrument: string;
    direction: 'long' | 'short';
    indicator: string;
    confidence: number;
  }>;
  patterns: unknown[];
  overallBias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  summary: string;
}

export interface EngineSentimentAnalysis {
  timestamp: Date;
  overallSentiment: string;
  score: number;
  sources: unknown[];
  keyEvents: unknown[];
  summary: string;
}

export interface EngineMacroAnalysis {
  timestamp: Date;
  regime: string;
  riskEnvironment: string;
  keyFactors: unknown[];
  outlook: string;
}

export interface CycleResult {
  cycleId: string;
  timestamp: Date;
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

export class Orchestrator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycleCount = 0;
  private readonly cycleIntervalMs: number;

  constructor() {
    this.cycleIntervalMs = parseInt(process.env.CYCLE_INTERVAL_MS ?? '300000', 10);
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[Orchestrator] Already running.');
      return;
    }

    this.running = true;
    console.log('[Orchestrator] Initialized. Running first cycle...');

    // Run the first cycle immediately
    await this.runCycle();

    // Schedule subsequent cycles
    this.intervalId = setInterval(async () => {
      if (!this.running) return;

      try {
        await this.runCycle();
      } catch (error) {
        console.error('[Orchestrator] Cycle error:', error);
      }
    }, this.cycleIntervalMs);

    console.log(`[Orchestrator] Scheduled cycles every ${this.cycleIntervalMs}ms`);
  }

  async runCycle(): Promise<CycleResult> {
    this.cycleCount++;
    const cycleId = `cycle-${this.cycleCount}-${Date.now()}`;
    const startTime = Date.now();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Orchestrator] Cycle ${this.cycleCount} starting (${cycleId})`);
    console.log(`${'='.repeat(60)}`);

    const result: CycleResult = {
      cycleId,
      timestamp: new Date(),
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
      // Step 0: Check circuit breaker
      const circuitBroken = await isCircuitBreakerTripped();
      if (circuitBroken) {
        console.warn('[Orchestrator] Circuit breaker is TRIPPED. Skipping cycle.');
        result.durationMs = Date.now() - startTime;
        result.error = 'Circuit breaker tripped';
        return result;
      }

      // Step 1: Get current market state
      console.log('[Orchestrator] Step 1: Fetching market state...');
      result.marketState = await this.getMarketState();
      console.log(`[Orchestrator] Market state acquired for ${result.marketState?.instruments?.length ?? 0} instruments`);

      // Step 2: Spawn analysis agents in parallel
      console.log('[Orchestrator] Step 2: Running analysis agents in parallel...');
      const [quantResult, sentimentResult, macroResult] = await Promise.allSettled([
        this.runQuantAnalyst(result.marketState),
        this.runSentimentAnalyst(result.marketState),
        this.runMacroAnalyst(result.marketState),
      ]);

      result.quantAnalysis = quantResult.status === 'fulfilled' ? quantResult.value : null;
      result.sentimentAnalysis = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null;
      result.macroAnalysis = macroResult.status === 'fulfilled' ? macroResult.value : null;

      if (quantResult.status === 'rejected') {
        console.error('[Orchestrator] Quant analyst failed:', quantResult.reason);
      }
      if (sentimentResult.status === 'rejected') {
        console.error('[Orchestrator] Sentiment analyst failed:', sentimentResult.reason);
      }
      if (macroResult.status === 'rejected') {
        console.error('[Orchestrator] Macro analyst failed:', macroResult.reason);
      }

      // Step 3: Aggregate analysis into trade decisions
      console.log('[Orchestrator] Step 3: Aggregating analysis into trade decisions...');
      result.decisions = this.aggregateDecisions(
        result.quantAnalysis,
        result.sentimentAnalysis,
        result.macroAnalysis,
      );
      console.log(`[Orchestrator] Generated ${result.decisions.length} trade decision(s)`);

      if (result.decisions.length === 0) {
        console.log('[Orchestrator] No trade decisions generated. Cycle complete.');
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Step 4: Pass decisions to Risk Guardian for approval
      console.log('[Orchestrator] Step 4: Risk Guardian evaluation...');
      result.riskAssessment = await this.runRiskGuardian(result.decisions);
      console.log(`[Orchestrator] Risk assessment: ${result.riskAssessment?.approved ? 'APPROVED' : 'REJECTED'}`);

      if (!result.riskAssessment?.approved) {
        console.log(`[Orchestrator] Trades rejected by Risk Guardian: ${result.riskAssessment?.reason ?? 'unknown'}`);
        result.durationMs = Date.now() - startTime;
        return result;
      }

      // Step 5: Pre-trade validation
      console.log('[Orchestrator] Step 5: Pre-trade validation...');
      const approvedDecisions = result.riskAssessment.approvedDecisions ?? result.decisions;
      const validatedDecisions: EngineTradeDecision[] = [];

      for (const decision of approvedDecisions) {
        const validation = await runPreTradeValidation(decision);
        if (validation.passed) {
          validatedDecisions.push(decision);
        } else {
          console.warn(`[Orchestrator] Pre-trade validation failed for ${decision.instrument}: ${validation.reason}`);
        }
      }

      // Step 6: Route approved decisions to Execution Specialist
      console.log(`[Orchestrator] Step 6: Executing ${validatedDecisions.length} trade(s)...`);
      for (const decision of validatedDecisions) {
        try {
          const executionResult = await this.runExecutionSpecialist(decision);
          result.executions.push(executionResult);

          // Post-trade hook
          await runPostTradeHook(executionResult);

          console.log(
            `[Orchestrator] Executed: ${decision.instrument} ${decision.side} - ${executionResult.status}`,
          );
        } catch (execError) {
          console.error(`[Orchestrator] Execution failed for ${decision.instrument}:`, execError);
          result.executions.push({
            orderId: '',
            instrument: decision.instrument,
            status: 'failed',
            side: decision.side,
            quantity: decision.quantity,
            price: 0,
            timestamp: new Date(),
            error: String(execError),
          });
        }
      }
    } catch (error) {
      result.error = String(error);
      console.error('[Orchestrator] Cycle error:', error);
    }

    result.durationMs = Date.now() - startTime;
    console.log(`[Orchestrator] Cycle ${this.cycleCount} completed in ${result.durationMs}ms`);
    console.log(`[Orchestrator] Executions: ${result.executions.length}, Decisions: ${result.decisions.length}`);

    return result;
  }

  stop(): void {
    console.log('[Orchestrator] Stopping...');
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[Orchestrator] Stopped.');
  }

  private async getMarketState(): Promise<EngineMarketState> {
    // TODO: Integrate with data-tools MCP server and ingest service
    // For now, return a placeholder market state
    return {
      timestamp: new Date(),
      instruments: [],
      portfolioValue: 0,
      openPositions: [],
      dailyPnl: 0,
    };
  }

  private async runQuantAnalyst(_state: EngineMarketState | null): Promise<EngineQuantAnalysis> {
    console.log('[Agent:QuantAnalyst] Starting analysis...');

    // TODO: Invoke Claude with AGENT_DEFINITIONS.quantAnalyst and QUANT_ANALYST_PROMPT,
    // passing market state as context and analysis-tools as MCP tools
    const analysis: EngineQuantAnalysis = {
      timestamp: new Date(),
      signals: [],
      patterns: [],
      overallBias: 'neutral',
      confidence: 0,
      summary: 'Quant analysis pending - agent integration not yet connected',
    };

    console.log(`[Agent:QuantAnalyst] Complete. Bias: ${analysis.overallBias}, Confidence: ${analysis.confidence}`);
    return analysis;
  }

  private async runSentimentAnalyst(_state: EngineMarketState | null): Promise<EngineSentimentAnalysis> {
    console.log('[Agent:SentimentAnalyst] Starting analysis...');

    // TODO: Invoke Claude with AGENT_DEFINITIONS.sentimentAnalyst and SENTIMENT_ANALYST_PROMPT
    const analysis: EngineSentimentAnalysis = {
      timestamp: new Date(),
      overallSentiment: 'neutral',
      score: 0,
      sources: [],
      keyEvents: [],
      summary: 'Sentiment analysis pending - agent integration not yet connected',
    };

    console.log(`[Agent:SentimentAnalyst] Complete. Sentiment: ${analysis.overallSentiment}, Score: ${analysis.score}`);
    return analysis;
  }

  private async runMacroAnalyst(_state: EngineMarketState | null): Promise<EngineMacroAnalysis> {
    console.log('[Agent:MacroAnalyst] Starting analysis...');

    // TODO: Invoke Claude with AGENT_DEFINITIONS.macroAnalyst and MACRO_ANALYST_PROMPT
    const analysis: EngineMacroAnalysis = {
      timestamp: new Date(),
      regime: 'neutral',
      riskEnvironment: 'normal',
      keyFactors: [],
      outlook: 'Macro analysis pending - agent integration not yet connected',
    };

    console.log(`[Agent:MacroAnalyst] Complete. Regime: ${analysis.regime}, Risk: ${analysis.riskEnvironment}`);
    return analysis;
  }

  private async runRiskGuardian(decisions: EngineTradeDecision[]): Promise<EngineRiskAssessment> {
    console.log(`[Agent:RiskGuardian] Evaluating ${decisions.length} decision(s)...`);

    // TODO: Invoke Claude with AGENT_DEFINITIONS.riskGuardian and RISK_GUARDIAN_PROMPT,
    // passing decisions and risk-tools
    const assessment: EngineRiskAssessment = {
      timestamp: new Date(),
      approved: false,
      reason: 'Risk guardian not yet connected - all trades blocked by default',
      portfolioHeat: 0,
      maxDrawdownPercent: 0,
      approvedDecisions: [],
      rejectedDecisions: decisions,
    };

    console.log(`[Agent:RiskGuardian] Result: ${assessment.approved ? 'APPROVED' : 'REJECTED'}`);
    return assessment;
  }

  private async runExecutionSpecialist(decision: EngineTradeDecision): Promise<EngineExecutionResult> {
    console.log(`[Agent:ExecutionSpecialist] Executing ${decision.instrument} ${decision.side}...`);

    // TODO: Invoke Claude with AGENT_DEFINITIONS.executionSpecialist and EXECUTION_SPECIALIST_PROMPT,
    // passing decision and trading-tools
    const result: EngineExecutionResult = {
      orderId: `sim-${Date.now()}`,
      instrument: decision.instrument,
      status: 'simulated',
      side: decision.side,
      quantity: decision.quantity,
      price: 0,
      timestamp: new Date(),
    };

    console.log(`[Agent:ExecutionSpecialist] Order ${result.orderId}: ${result.status}`);
    return result;
  }

  private aggregateDecisions(
    quant: EngineQuantAnalysis | null,
    sentiment: EngineSentimentAnalysis | null,
    macro: EngineMacroAnalysis | null,
  ): EngineTradeDecision[] {
    const decisions: EngineTradeDecision[] = [];

    // Aggregation logic: combine signals from all analysts
    // A trade decision is generated when multiple analysts agree with sufficient confidence

    if (!quant || !sentiment || !macro) {
      console.log('[Orchestrator] Incomplete analysis data. No decisions generated.');
      return decisions;
    }

    // Only generate decisions when quant signals exist with sufficient confidence
    if (quant.confidence < 0.6) {
      console.log(`[Orchestrator] Quant confidence too low (${quant.confidence}). No decisions.`);
      return decisions;
    }

    for (const signal of quant.signals) {
      // Require sentiment alignment
      const sentimentAligned =
        (signal.direction === 'long' && sentiment.score > 0.2) ||
        (signal.direction === 'short' && sentiment.score < -0.2) ||
        sentiment.overallSentiment === 'neutral';

      // Require macro environment is not hostile
      const macroSafe = macro.riskEnvironment !== 'extreme';

      if (sentimentAligned && macroSafe) {
        decisions.push({
          instrument: signal.instrument,
          side: signal.direction === 'long' ? 'buy' : 'sell',
          quantity: 0, // Position sizing handled by risk guardian
          reason: `Quant signal (${signal.indicator}, confidence: ${signal.confidence}), Sentiment: ${sentiment.overallSentiment} (${sentiment.score}), Macro: ${macro.regime}`,
          confidence: (quant.confidence + Math.abs(sentiment.score)) / 2,
          timestamp: new Date(),
        });
      }
    }

    return decisions;
  }
}
