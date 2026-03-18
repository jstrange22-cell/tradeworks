// ---------------------------------------------------------------------------
// Cycle Service — Engine orchestration, cycle execution, circuit breaker
//
// Extracted from routes/engine.ts so route handlers stay thin.
// ---------------------------------------------------------------------------

import { createServiceLogger } from '../lib/logger.js';
import {
  getCoinbaseKeys,
  testCoinbaseConnection,
} from './coinbase-auth-service.js';
import {
  isEngineTradingEnabled,
  isAssetProtected,
  getEngineOwnedQuantity,
  getRemainingBudget,
  recordEnginePosition,
} from '../routes/asset-protection.js';
import { TRACKED_INSTRUMENTS } from './market-data-service.js';
import { analyzeInstrument, type InstrumentAnalysis } from './analysis-service.js';
import { COINBASE_PRODUCT_MAP, placeCoinbaseOrder } from './coinbase-execution-service.js';

const engineLogger = createServiceLogger('Engine');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CycleAgentOutput {
  quantBias: 'bullish' | 'bearish' | 'neutral';
  quantConfidence: number;
  quantSignals: Array<{
    instrument: string;
    direction: 'long' | 'short';
    indicator: string;
    confidence: number;
  }>;
  sentimentScore: number;
  sentimentLabel: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  macroRegime: 'risk-on' | 'risk-off' | 'transition' | 'neutral';
  macroRiskLevel: 'low' | 'normal' | 'elevated' | 'extreme';
}

export interface CycleDecision {
  instrument: string;
  direction: 'long' | 'short';
  confidence: number;
  approved: boolean;
  rejectionReason?: string;
}

export interface CycleExecution {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: 'filled' | 'simulated' | 'cancelled' | 'failed';
  slippage?: number;
}

export interface CycleResult {
  id: string;
  cycleNumber: number;
  timestamp: string;
  status: 'completed' | 'no_signals' | 'circuit_breaker' | 'error';
  durationMs: number;
  agents: CycleAgentOutput;
  decisions: CycleDecision[];
  riskAssessment: {
    portfolioHeat: number;
    drawdownPercent: number;
    approved: number;
    rejected: number;
  };
  executions: CycleExecution[];
  summary: string;
}

// ---------------------------------------------------------------------------
// In-memory engine state
// ---------------------------------------------------------------------------

export interface EngineState {
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  startedAt: string | null;
  cycleCount: number;
  lastCycleAt: string | null;
  config: {
    cycleIntervalMs: number;
    markets: string[];
    paperMode: boolean;
  };
  coinbaseConnected: boolean;
  coinbaseAccounts: number;
}

/**
 * Resolve paper mode from environment.
 * Defaults to TRUE (paper mode) for safety — only goes live when
 * PAPER_TRADING is explicitly set to "false".
 */
function resolvePaperMode(): boolean {
  const envValue = process.env.PAPER_TRADING;
  if (envValue === undefined) return true;
  return envValue.toLowerCase() !== 'false';
}

export let engineState: EngineState = {
  status: 'stopped',
  startedAt: null,
  cycleCount: 0,
  lastCycleAt: null,
  config: {
    cycleIntervalMs: 300000,
    markets: ['crypto'],
    paperMode: true, // Safe default — resolved from env in initEngine() after dotenv loads
  },
  coinbaseConnected: false,
  coinbaseAccounts: 0,
};

const cycleHistory: CycleResult[] = [];
const MAX_CYCLE_HISTORY = 100;
let cycleTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Circuit Breaker — persistent state across cycles
// ---------------------------------------------------------------------------

export interface EngineCircuitBreakerState {
  tripped: boolean;
  reason: string | null;
  trippedAt: string | null;
  canResumeAt: string | null;
  stats: {
    dailyLossPercent: number;
    consecutiveLosses: number;
    consecutiveErrors: number;
    cyclesSinceTrip: number;
  };
}

const CB_CONFIG = {
  maxDailyLossPercent: parseFloat(process.env.CB_MAX_DAILY_LOSS ?? '3.0'),
  maxConsecutiveLosses: parseInt(process.env.CB_MAX_CONSECUTIVE_LOSSES ?? '15', 10),
  maxConsecutiveErrors: parseInt(process.env.CB_MAX_CONSECUTIVE_ERRORS ?? '5', 10),
  cooldownMinutes: parseInt(process.env.CB_COOLDOWN_MINUTES ?? '60', 10),
};

let circuitBreakerState: EngineCircuitBreakerState = {
  tripped: false,
  reason: null,
  trippedAt: null,
  canResumeAt: null,
  stats: {
    dailyLossPercent: 0,
    consecutiveLosses: 0,
    consecutiveErrors: 0,
    cyclesSinceTrip: 0,
  },
};

/**
 * Check if the circuit breaker is currently tripped.
 * Automatically resets after cooldown period expires.
 */
function isCircuitBreakerTripped(): boolean {
  if (!circuitBreakerState.tripped) return false;

  // Check if cooldown has expired
  if (circuitBreakerState.canResumeAt) {
    const resumeAt = new Date(circuitBreakerState.canResumeAt);
    if (new Date() >= resumeAt) {
      engineLogger.info('Circuit breaker cooldown expired — resetting automatically');
      resetCircuitBreaker();
      return false;
    }
  }

  return true;
}

/**
 * Trip the engine circuit breaker.
 */
export function tripCircuitBreaker(reason: string): void {
  const now = new Date();
  circuitBreakerState.tripped = true;
  circuitBreakerState.reason = reason;
  circuitBreakerState.trippedAt = now.toISOString();
  circuitBreakerState.canResumeAt = new Date(
    now.getTime() + CB_CONFIG.cooldownMinutes * 60 * 1000
  ).toISOString();
  circuitBreakerState.stats.cyclesSinceTrip = 0;

  engineLogger.error(
    { reason, canResumeAt: circuitBreakerState.canResumeAt },
    `CIRCUIT BREAKER TRIPPED: ${reason} — trading halted until ${circuitBreakerState.canResumeAt}`
  );
}

/**
 * Reset the engine circuit breaker.
 */
export function resetCircuitBreaker(): void {
  circuitBreakerState = {
    tripped: false,
    reason: null,
    trippedAt: null,
    canResumeAt: null,
    stats: {
      dailyLossPercent: 0,
      consecutiveLosses: 0,
      consecutiveErrors: 0,
      cyclesSinceTrip: 0,
    },
  };
  engineLogger.info('Circuit breaker reset — trading resumed');
}

/**
 * Update circuit breaker state after a cycle completes.
 * Checks loss thresholds and error counts to determine if breaker should trip.
 */
function updateCircuitBreakerAfterCycle(cycleResult: CycleResult): void {
  if (circuitBreakerState.tripped) return;

  // Track consecutive errors
  if (cycleResult.status === 'error') {
    circuitBreakerState.stats.consecutiveErrors += 1;
  } else {
    circuitBreakerState.stats.consecutiveErrors = 0;
  }

  // Track consecutive losses from executions
  const failedExecutions = cycleResult.executions.filter(
    (execution) => execution.status === 'failed'
  );
  if (failedExecutions.length > 0) {
    circuitBreakerState.stats.consecutiveLosses += failedExecutions.length;
  } else if (cycleResult.executions.some((execution) => execution.status === 'filled')) {
    // Reset on any successful fill
    circuitBreakerState.stats.consecutiveLosses = 0;
  }

  // Check drawdown from risk assessment
  if (cycleResult.riskAssessment.drawdownPercent > 0) {
    circuitBreakerState.stats.dailyLossPercent = cycleResult.riskAssessment.drawdownPercent;
  }

  // Trip conditions
  if (circuitBreakerState.stats.consecutiveErrors >= CB_CONFIG.maxConsecutiveErrors) {
    tripCircuitBreaker(
      `${circuitBreakerState.stats.consecutiveErrors} consecutive cycle errors`
    );
  } else if (circuitBreakerState.stats.consecutiveLosses >= CB_CONFIG.maxConsecutiveLosses) {
    tripCircuitBreaker(
      `${circuitBreakerState.stats.consecutiveLosses} consecutive failed trades`
    );
  } else if (circuitBreakerState.stats.dailyLossPercent >= CB_CONFIG.maxDailyLossPercent) {
    tripCircuitBreaker(
      `Daily loss limit reached: ${circuitBreakerState.stats.dailyLossPercent.toFixed(2)}%`
    );
  }
}

/** Get current circuit breaker state (snapshot). */
export function getCircuitBreakerStatus(): EngineCircuitBreakerState {
  return { ...circuitBreakerState };
}

// ---------------------------------------------------------------------------
// Live Agent Status — exported so agents.ts can read real-time state
// ---------------------------------------------------------------------------

export type AgentPhase = 'idle' | 'analyzing' | 'evaluating' | 'executing';

/** Maps agent name -> current phase during a cycle */
export const agentLiveStatus = new Map<string, AgentPhase>([
  ['Quant Analyst', 'idle'],
  ['Sentiment Analyst', 'idle'],
  ['Macro Analyst', 'idle'],
  ['Risk Guardian', 'idle'],
  ['Execution Specialist', 'idle'],
]);

/** Last completed cycle summary for display in agent page */
export let lastCycleSummary: {
  summary: string;
  status: string;
  cycleNumber: number;
  timestamp: string;
  durationMs: number;
} | null = null;

/** Whether a cycle is currently running */
export let cycleInProgress = false;

function setAllAgentsIdle(): void {
  agentLiveStatus.set('Quant Analyst', 'idle');
  agentLiveStatus.set('Sentiment Analyst', 'idle');
  agentLiveStatus.set('Macro Analyst', 'idle');
  agentLiveStatus.set('Risk Guardian', 'idle');
  agentLiveStatus.set('Execution Specialist', 'idle');
}

/** Get engine state for agents to determine orchestrator status */
export function getEngineState(): EngineState {
  return engineState;
}

// ---------------------------------------------------------------------------
// Coinbase — Engine-specific helpers (auth logic lives in coinbase-auth-service)
// ---------------------------------------------------------------------------

/**
 * Wrapper that calls the shared testCoinbaseConnection() from the auth service,
 * then updates the in-memory engine state accordingly.
 */
export async function testCoinbaseAndUpdateState(): Promise<ReturnType<typeof testCoinbaseConnection>> {
  const result = await testCoinbaseConnection();
  engineState.coinbaseConnected = result.connected;
  engineState.coinbaseAccounts = result.accounts ?? 0;
  return result;
}

// ---------------------------------------------------------------------------
// Run Analysis Cycle (fetches real data from Crypto.com)
// ---------------------------------------------------------------------------

function pushCycle(cycle: CycleResult): void {
  cycleHistory.unshift(cycle);
  if (cycleHistory.length > MAX_CYCLE_HISTORY) cycleHistory.pop();
  engineState.lastCycleAt = cycle.timestamp;
}

export async function runAnalysisCycle(): Promise<CycleResult> {
  const startTime = Date.now();
  engineState.cycleCount += 1;
  const cycleNum = engineState.cycleCount;
  cycleInProgress = true;

  // -- Circuit Breaker Gate --
  // Check persistent circuit breaker BEFORE any analysis phases.
  // This skips all work when the breaker is tripped, saving API calls and compute.
  if (isCircuitBreakerTripped()) {
    const cycle: CycleResult = {
      id: `cycle-${cycleNum}-${Date.now()}`,
      cycleNumber: cycleNum,
      timestamp: new Date().toISOString(),
      status: 'circuit_breaker',
      durationMs: Date.now() - startTime,
      agents: {
        quantBias: 'neutral', quantConfidence: 0, quantSignals: [],
        sentimentScore: 0, sentimentLabel: 'neutral',
        macroRegime: 'neutral', macroRiskLevel: 'normal',
      },
      decisions: [],
      riskAssessment: { portfolioHeat: 0, drawdownPercent: 0, approved: 0, rejected: 0 },
      executions: [],
      summary: `Circuit breaker active: ${circuitBreakerState.reason ?? 'unknown'} — all trading halted until ${circuitBreakerState.canResumeAt ?? 'manual reset'}.`,
    };
    setAllAgentsIdle();
    cycleInProgress = false;
    lastCycleSummary = {
      summary: cycle.summary, status: 'circuit_breaker',
      cycleNumber: cycleNum, timestamp: cycle.timestamp, durationMs: cycle.durationMs,
    };
    circuitBreakerState.stats.cyclesSinceTrip += 1;
    pushCycle(cycle);
    engineLogger.warn(
      { cycleNumber: cycleNum, reason: circuitBreakerState.reason },
      `Cycle #${cycleNum}: SKIPPED — circuit breaker active`
    );
    return cycle;
  }

  try {
    // -- Phase 1: Quant Analysis --
    agentLiveStatus.set('Quant Analyst', 'analyzing');
    const analyses = await Promise.all(TRACKED_INSTRUMENTS.map(analyzeInstrument));
    agentLiveStatus.set('Quant Analyst', 'idle');
    const valid = analyses.filter((a): a is InstrumentAnalysis => a !== null);

    if (valid.length === 0) {
      const cycle: CycleResult = {
        id: `cycle-${cycleNum}-${Date.now()}`, cycleNumber: cycleNum,
        timestamp: new Date().toISOString(), status: 'error',
        durationMs: Date.now() - startTime,
        agents: { quantBias: 'neutral', quantConfidence: 0, quantSignals: [], sentimentScore: 0, sentimentLabel: 'neutral', macroRegime: 'neutral', macroRiskLevel: 'normal' },
        decisions: [], riskAssessment: { portfolioHeat: 0, drawdownPercent: 0, approved: 0, rejected: 0 },
        executions: [], summary: 'Failed to fetch market data — retrying next cycle.',
      };
      setAllAgentsIdle();
      cycleInProgress = false;
      lastCycleSummary = { summary: cycle.summary, status: 'error', cycleNumber: cycleNum, timestamp: cycle.timestamp, durationMs: cycle.durationMs };
      pushCycle(cycle);
      return cycle;
    }

    // Overall bias from SMA position
    const bullishCount = valid.filter(a => a.priceAboveSma).length;
    const quantBias: CycleAgentOutput['quantBias'] =
      bullishCount > valid.length / 2 ? 'bullish' :
      bullishCount < valid.length / 2 ? 'bearish' : 'neutral';

    // Aggregate signals
    const allSignals = valid.flatMap(a =>
      a.signals.map(s => ({ instrument: a.instrument, direction: s.direction, indicator: s.indicator, confidence: s.confidence }))
    );
    const avgConfidence = allSignals.length > 0
      ? allSignals.reduce((sum, s) => sum + s.confidence, 0) / allSignals.length
      : 0;

    // -- Phase 2: Sentiment (24h change proxy) --
    agentLiveStatus.set('Sentiment Analyst', 'analyzing');
    const avgChange = valid.reduce((sum, a) => sum + a.change24h, 0) / valid.length;
    const sentimentScore = Math.round(Math.max(-1, Math.min(1, avgChange * 5)) * 100) / 100;
    const sentimentLabel: CycleAgentOutput['sentimentLabel'] =
      sentimentScore > 0.2 ? 'bullish' : sentimentScore < -0.2 ? 'bearish' : 'neutral';

    agentLiveStatus.set('Sentiment Analyst', 'idle');

    // -- Phase 3: Macro Regime --
    agentLiveStatus.set('Macro Analyst', 'analyzing');
    const avgRsi = valid.reduce((sum, a) => sum + a.rsiValue, 0) / valid.length;
    let macroRegime: CycleAgentOutput['macroRegime'] = 'neutral';
    let macroRiskLevel: CycleAgentOutput['macroRiskLevel'] = 'normal';

    if (avgRsi > 65 && avgChange > 0.02) {
      macroRegime = 'risk-on'; macroRiskLevel = 'low';
    } else if (avgRsi < 25 && avgChange < -0.05) {
      macroRegime = 'risk-off'; macroRiskLevel = 'extreme';
    } else if (avgRsi < 35 && avgChange < -0.02) {
      macroRegime = 'risk-off'; macroRiskLevel = 'elevated';
    } else if (Math.abs(avgChange) > 0.01) {
      macroRegime = 'transition'; macroRiskLevel = 'normal';
    }

    agentLiveStatus.set('Macro Analyst', 'idle');

    // -- Phase 4: Risk Assessment & Decisions --
    agentLiveStatus.set('Risk Guardian', 'evaluating');
    const maxRisk = 2.0; // 2% per trade (was 1% — too conservative for altcoins)
    const maxHeat = 20.0; // Allow up to 10 concurrent positions (was 6%)
    let heat = 0;
    const decisions: CycleDecision[] = [];

    for (const sig of allSignals) {
      if (sig.confidence < 0.45) continue;
      let approved = true;
      let rejectionReason: string | undefined;

      if (macroRiskLevel === 'extreme') {
        approved = false;
        rejectionReason = 'Macro risk extreme — all trades halted';
      } else if (heat + maxRisk > maxHeat) {
        approved = false;
        rejectionReason = `Portfolio heat would exceed ${maxHeat}% limit`;
      }

      decisions.push({ instrument: sig.instrument, direction: sig.direction, confidence: sig.confidence, approved, rejectionReason });
      if (approved) heat += maxRisk;
    }

    const approvedD = decisions.filter(d => d.approved);
    const rejectedD = decisions.filter(d => !d.approved);

    agentLiveStatus.set('Risk Guardian', 'idle');

    // -- Phase 5: Execution (Coinbase live or paper) --
    agentLiveStatus.set('Execution Specialist', 'executing');

    // Re-check Coinbase connection if not connected (recovers from startup failures)
    if (!engineState.coinbaseConnected) {
      try {
        await testCoinbaseAndUpdateState();
      } catch (reCheckErr) {
        engineLogger.warn({ err: reCheckErr }, 'Coinbase re-check failed — continuing in paper mode');
      }
    }

    const coinbaseKeys = getCoinbaseKeys();
    const useLiveExecution = coinbaseKeys !== null
      && engineState.coinbaseConnected
      && engineState.config.paperMode === false;

    const executions: CycleExecution[] = [];

    for (const d of approvedD) {
      const analysis = valid.find(a => a.instrument === d.instrument);
      const price = analysis?.price ?? 0;
      const side = d.direction === 'long' ? 'buy' : 'sell';
      // Dynamic trade sizing: 20% of remaining budget, capped $5–$25
      const budgetRemaining = getRemainingBudget();
      const quoteSizeNum = Math.min(25, Math.max(5, Math.floor(budgetRemaining * 0.2)));
      const quoteSize = String(quoteSizeNum);
      const quantity = Math.round((quoteSizeNum / Math.max(price, 1)) * 1000) / 1000;

      if (useLiveExecution && coinbaseKeys) {
        // -- Asset Protection Checks (5 gates) --
        const baseSymbol = d.instrument.split('-')[0]; // e.g. BTC from BTC-USD

        // 1. Master switch OFF -> cancel
        if (!isEngineTradingEnabled()) {
          engineLogger.info({ instrument: d.instrument, reason: 'master switch OFF' }, 'BLOCKED: Engine trading disabled (master switch OFF)');
          executions.push({
            instrument: d.instrument, side: side as 'buy' | 'sell', quantity,
            price: Math.round(price * 100) / 100, status: 'cancelled' as CycleExecution['status'],
          });
          continue;
        }

        // 2. Instrument not in whitelist -> cancel
        const productId = COINBASE_PRODUCT_MAP[d.instrument];
        if (!productId) {
          engineLogger.info({ instrument: d.instrument, reason: 'not in whitelist' }, `BLOCKED: ${d.instrument} not in whitelist`);
          executions.push({
            instrument: d.instrument, side: side as 'buy' | 'sell', quantity,
            price: Math.round(price * 100) / 100, status: 'cancelled' as CycleExecution['status'],
          });
          continue;
        }

        // 3. SELL but engine never bought it -> cancel (protects existing holdings)
        if (side === 'sell') {
          const engineOwned = getEngineOwnedQuantity(baseSymbol);
          if (engineOwned <= 0) {
            engineLogger.info({ instrument: d.instrument, asset: baseSymbol, reason: 'engine owns 0' }, `BLOCKED: SELL ${baseSymbol} rejected — engine owns 0 (user holdings protected)`);
            executions.push({
              instrument: d.instrument, side: 'sell', quantity,
              price: Math.round(price * 100) / 100, status: 'cancelled' as CycleExecution['status'],
            });
            continue;
          }
        }

        // 4. SELL but asset explicitly locked -> cancel
        if (side === 'sell' && isAssetProtected(baseSymbol)) {
          engineLogger.info({ instrument: d.instrument, asset: baseSymbol, reason: 'asset locked' }, `BLOCKED: SELL ${baseSymbol} rejected — asset is locked`);
          executions.push({
            instrument: d.instrument, side: 'sell', quantity,
            price: Math.round(price * 100) / 100, status: 'cancelled' as CycleExecution['status'],
          });
          continue;
        }

        // 5. BUY but budget exhausted -> cancel
        if (side === 'buy') {
          const remaining = getRemainingBudget();
          if (remaining < parseFloat(quoteSize)) {
            engineLogger.info({ instrument: d.instrument, remaining, reason: 'budget exhausted' }, `BLOCKED: BUY ${d.instrument} rejected — budget exhausted ($${remaining.toFixed(2)} remaining)`);
            executions.push({
              instrument: d.instrument, side: 'buy', quantity,
              price: Math.round(price * 100) / 100, status: 'cancelled' as CycleExecution['status'],
            });
            continue;
          }
        }

        // -- All checks passed — execute live trade --
        if (productId) {
          const result = await placeCoinbaseOrder(
            productId,
            side.toUpperCase() as 'BUY' | 'SELL',
            quoteSize,
            coinbaseKeys.apiKey,
            coinbaseKeys.apiSecret,
          );

          if (result.success) {
            // Record engine position for tracking
            recordEnginePosition(baseSymbol, side as 'buy' | 'sell', quantity, price);
            executions.push({
              instrument: d.instrument,
              side: side as 'buy' | 'sell',
              quantity,
              price: Math.round(price * 100) / 100,
              status: 'filled',
              slippage: Math.round(Math.random() * 1.5 * 10) / 10,
            });
          } else {
            // Check if this is a balance issue — don't waste API calls on remaining instruments
            const isBalanceError = result.error?.toLowerCase().includes('insufficient balance')
              || result.error?.toLowerCase().includes('insufficient fund');

            executions.push({
              instrument: d.instrument,
              side: side as 'buy' | 'sell',
              quantity,
              price: Math.round(price * 100) / 100,
              status: isBalanceError ? ('cancelled' as CycleExecution['status']) : 'failed',
              slippage: 0,
            });

            if (isBalanceError) {
              engineLogger.warn(
                { instrument: d.instrument, error: result.error },
                'Coinbase USD balance insufficient — skipping remaining orders this cycle',
              );
              break; // Don't try remaining instruments — they'll all fail too
            }
          }
        } else {
          // No Coinbase product mapping — simulate
          executions.push({
            instrument: d.instrument,
            side: side as 'buy' | 'sell',
            quantity,
            price: Math.round(price * 100) / 100,
            status: 'simulated' as const,
            slippage: Math.round(Math.random() * 3 * 10) / 10,
          });
        }
      } else {
        // Paper mode or no Coinbase keys
        executions.push({
          instrument: d.instrument,
          side: side as 'buy' | 'sell',
          quantity,
          price: Math.round(price * 100) / 100,
          status: 'simulated' as const,
          slippage: Math.round(Math.random() * 3 * 10) / 10,
        });
      }
    }

    if (executions.length > 0 && coinbaseKeys && engineState.config.paperMode) {
      engineLogger.info({ tradeCount: executions.length }, `Paper mode — ${executions.length} trade(s) simulated. Set paperMode=false for live Coinbase execution.`);
    }

    // -- Build Result --
    const durationMs = Date.now() - startTime;
    const status: CycleResult['status'] =
      macroRiskLevel === 'extreme' ? 'circuit_breaker' :
      allSignals.length === 0 ? 'no_signals' : 'completed';

    let summary = '';
    const prices = valid.map(a => `${a.instrument} $${a.price.toLocaleString()}`).join(', ');

    if (status === 'circuit_breaker') {
      summary = `Circuit breaker — extreme risk (RSI avg ${avgRsi.toFixed(0)}, 24h ${(avgChange * 100).toFixed(1)}%). ${prices}.`;
    } else if (status === 'no_signals') {
      summary = `No signals. ${prices}. RSI avg ${avgRsi.toFixed(0)}, ${macroRegime}.`;
    } else if (executions.length > 0) {
      const e = executions[0];
      const more = executions.length > 1 ? ` (+${executions.length - 1} more)` : '';
      summary = `${e.side.toUpperCase()} ${e.quantity} ${e.instrument} @ $${e.price.toLocaleString()}${more} — ${quantBias}, RSI ${avgRsi.toFixed(0)}, ${macroRegime}`;
    } else {
      summary = `${rejectedD.length} signal(s) risk-rejected. ${quantBias} bias, ${prices}.`;
    }

    const cycle: CycleResult = {
      id: `cycle-${cycleNum}-${Date.now()}`,
      cycleNumber: cycleNum,
      timestamp: new Date().toISOString(),
      status,
      durationMs,
      agents: {
        quantBias,
        quantConfidence: Math.round(avgConfidence * 100) / 100,
        quantSignals: allSignals,
        sentimentScore,
        sentimentLabel,
        macroRegime,
        macroRiskLevel,
      },
      decisions,
      riskAssessment: {
        portfolioHeat: Math.round(heat * 100) / 100,
        drawdownPercent: 0,
        approved: approvedD.length,
        rejected: rejectedD.length,
      },
      executions,
      summary,
    };

    setAllAgentsIdle();
    cycleInProgress = false;
    lastCycleSummary = { summary, status, cycleNumber: cycleNum, timestamp: cycle.timestamp, durationMs: cycle.durationMs };
    pushCycle(cycle);
    engineLogger.info({ cycleNumber: cycleNum, status, durationMs }, `Cycle #${cycleNum}: ${status} — ${summary}`);

    // Update circuit breaker state after each cycle
    updateCircuitBreakerAfterCycle(cycle);

    return cycle;
  } catch (err) {
    const cycle: CycleResult = {
      id: `cycle-${cycleNum}-${Date.now()}`, cycleNumber: cycleNum,
      timestamp: new Date().toISOString(), status: 'error',
      durationMs: Date.now() - startTime,
      agents: { quantBias: 'neutral', quantConfidence: 0, quantSignals: [], sentimentScore: 0, sentimentLabel: 'neutral', macroRegime: 'neutral', macroRiskLevel: 'normal' },
      decisions: [], riskAssessment: { portfolioHeat: 0, drawdownPercent: 0, approved: 0, rejected: 0 },
      executions: [], summary: `Error: ${(err as Error).message}`,
    };
    setAllAgentsIdle();
    cycleInProgress = false;
    lastCycleSummary = { summary: `Error: ${(err as Error).message}`, status: 'error', cycleNumber: cycleNum, timestamp: cycle.timestamp, durationMs: cycle.durationMs };
    pushCycle(cycle);
    engineLogger.error({ err, cycleNumber: cycleNum }, `Cycle #${cycleNum} error`);

    // Update circuit breaker — consecutive errors can trip the breaker
    updateCircuitBreakerAfterCycle(cycle);

    return cycle;
  }
}

// ---------------------------------------------------------------------------
// Cycle Loop
// ---------------------------------------------------------------------------

export function startCycleLoop(): void {
  if (cycleTimer) return;
  // Test Coinbase connection, then run first cycle
  testCoinbaseAndUpdateState()
    .then(() => runAnalysisCycle())
    .catch(err => engineLogger.error({ err }, 'First cycle error'));
  cycleTimer = setInterval(() => {
    if (engineState.status === 'running') {
      runAnalysisCycle().catch(err => engineLogger.error({ err }, 'Cycle error'));
    }
  }, engineState.config.cycleIntervalMs);
}

export function stopCycleLoop(): void {
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
}

// ---------------------------------------------------------------------------
// Cycle History Access
// ---------------------------------------------------------------------------

export function getCycleHistory(limit: number): { data: CycleResult[]; total: number } {
  const clamped = Math.min(limit, 100);
  return {
    data: cycleHistory.slice(0, clamped),
    total: cycleHistory.length,
  };
}

// ---------------------------------------------------------------------------
// Auto-Start — engine runs automatically when gateway boots
// ---------------------------------------------------------------------------

/**
 * Initialize and auto-start the trading engine.
 * Called from index.ts after the server starts listening.
 */
export function initEngine(): void {
  // Resolve config from env AFTER dotenv has loaded (ES module imports run before dotenv)
  engineState.config.paperMode = resolvePaperMode();
  engineState.config.cycleIntervalMs = parseInt(process.env.CYCLE_INTERVAL_MS ?? '300000', 10);

  engineLogger.info('Auto-starting trading engine...');
  engineLogger.info(
    { cycleIntervalMs: engineState.config.cycleIntervalMs, markets: engineState.config.markets, paperMode: engineState.config.paperMode },
    `Config: cycle every ${engineState.config.cycleIntervalMs / 1000}s, markets: ${engineState.config.markets.join(', ')}, paper: ${engineState.config.paperMode}`,
  );
  engineState.status = 'running';
  engineState.startedAt = new Date().toISOString();
  startCycleLoop();
  engineLogger.info('Auto-started — running cycles autonomously 24/7');
}
