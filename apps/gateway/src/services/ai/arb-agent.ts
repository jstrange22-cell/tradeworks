/**
 * APEX/OpenClaw Arb Intelligence Agent — Reasoning Layer
 *
 * A self-contained reasoning agent that sits ON TOP of the arb orchestrator.
 * Instead of hardcoded thresholds, it reasons about WHY spreads exist,
 * whether they're temporary or structural, and coordinates actions across
 * all trading systems (CEX, stocks, sniper, arb).
 *
 * Architecture:
 *   Arb Orchestrator (30s scan, 9 detectors) → raw opportunities
 *   Arb Agent (60s reasoning cycle) → observes, reasons, coordinates
 *
 * The agent does NOT replace existing systems — it adds intelligence on top.
 */

import { logger } from '../../lib/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ETFSpreadInfo {
  etfTicker: string;
  underlying: string;
  spread: number;       // percentage
  direction: 'premium' | 'discount';
  trend: 'widening' | 'narrowing' | 'stable';
  previousSpread: number;
  samples: number;      // how many data points in trend
}

interface CryptoMomentum {
  symbol: string;
  change1h: number;
  change24h: number;
  price: number;
  updatedAt: string;
}

export interface AgentAction {
  id: string;
  target: 'arb' | 'cex' | 'stocks' | 'sniper';
  action: 'buy' | 'sell' | 'hold' | 'increase' | 'decrease' | 'hedge';
  symbol: string;
  reasoning: string;
  confidence: number;   // 0-100
  urgency: 'immediate' | 'next_cycle' | 'when_convenient';
  executedAt: string | null;
  outcome: 'pending' | 'success' | 'failed' | 'skipped' | null;
  pnlImpact: number | null; // estimated P&L impact in USD
}

interface ReasoningChain {
  id: string;
  startedAt: string;
  completedAt: string;
  observations: string[];
  thesis: string;
  confidence: number;
  actions: AgentAction[];
  durationMs: number;
}

interface OutcomeRecord {
  actionId: string;
  target: string;
  symbol: string;
  action: string;
  confidence: number;
  profitable: boolean | null; // null = still pending
  pnl: number;
  recordedAt: string;
}

export interface ArbAgentState {
  // Market observations
  etfSpreads: Map<string, ETFSpreadInfo>;
  crossExchangeSpreads: Map<string, number>;
  cryptoMomentum: CryptoMomentum[];

  // Agent reasoning
  marketThesis: string;
  confidenceLevel: number;           // 0-100
  recommendedActions: AgentAction[];
  currentRegime: string;             // from arb orchestrator

  // Performance tracking
  totalCycles: number;
  totalDecisions: number;
  totalActionsExecuted: number;
  correctDecisions: number;
  incorrectDecisions: number;
  pendingOutcomes: number;
  cumulativePnl: number;
  aggressivenessMultiplier: number;  // 0.5 = very cautious, 1.0 = neutral, 1.5 = aggressive

  // Timing
  startedAt: string;
  lastReasoningAt: string | null;
  lastCycleDurationMs: number;
}

interface PatternMemory {
  pattern: string;
  occurrences: number;
  profitableCount: number;
  avgPnl: number;
  lastSeen: string;
  winRate: number;
}

// ── Agent State ────────────────────────────────────────────────────────────

const state: ArbAgentState = {
  etfSpreads: new Map(),
  crossExchangeSpreads: new Map(),
  cryptoMomentum: [],
  marketThesis: 'Initializing — gathering market observations.',
  confidenceLevel: 0,
  recommendedActions: [],
  currentRegime: 'unknown',
  totalCycles: 0,
  totalDecisions: 0,
  totalActionsExecuted: 0,
  correctDecisions: 0,
  incorrectDecisions: 0,
  pendingOutcomes: 0,
  cumulativePnl: 0,
  aggressivenessMultiplier: 0.5, // Start cautious
  startedAt: '',
  lastReasoningAt: null,
  lastCycleDurationMs: 0,
};

const reasoningHistory: ReasoningChain[] = [];
const outcomeHistory: OutcomeRecord[] = [];
const patternMemory: Map<string, PatternMemory> = new Map();
let cycleInterval: ReturnType<typeof setInterval> | null = null;

// Thesis override (from manual API)
let thesisOverride: { thesis: string; confidence: number; expiresAt: number } | null = null;

// ── Constants ──────────────────────────────────────────────────────────────

const CYCLE_INTERVAL_MS = 60_000;           // 60 seconds
const MIN_CONFIDENCE_TO_ACT = 40;           // Don't act below 40% confidence
const MAX_REASONING_HISTORY = 100;
const MAX_OUTCOME_HISTORY = 500;
const ETF_CRYPTO_MAP: Record<string, string> = {
  GBTC: 'BTC', IBIT: 'BTC', FBTC: 'BTC', ARKB: 'BTC', BITB: 'BTC',
  ETHE: 'ETH', ETHA: 'ETH',
  BITO: 'BTC', // Futures ETF
};
const HISTORICAL_AVG_SPREADS: Record<string, number> = {
  GBTC: 1.5, IBIT: 0.3, FBTC: 0.5, ETHE: 2.0, ETHA: 0.4, BITO: 0.8,
};

// ── Step 1: Observe All Markets ────────────────────────────────────────────

async function gatherObservations(): Promise<string[]> {
  const observations: string[] = [];

  // 1a. Pull arb orchestrator data
  try {
    const { getRecentOpportunities, getArbRegime, getArbPortfolio } = await import('../arb-intelligence/orchestrator.js');
    const opps = getRecentOpportunities();
    const regime = getArbRegime();
    const portfolio = getArbPortfolio();

    state.currentRegime = regime.dislocationsActive ? 'crisis_dislocations' : 'normal';

    if (opps.length > 0) {
      observations.push(`Arb orchestrator: ${opps.length} active opportunities across 9 detectors.`);

      // Extract T9 ETF-crypto spreads
      const t9Opps = opps.filter(o => o.arbType === 'type9_stock_crypto_spread');
      for (const opp of t9Opps) {
        const ticker = opp.ticker_a?.replace(/[^A-Z]/gi, '') ?? '';
        const spreadPct = opp.grossProfitPerContract * 100;
        const underlying = ETF_CRYPTO_MAP[ticker] ?? 'BTC';

        const existing = state.etfSpreads.get(ticker);
        const previousSpread = existing?.spread ?? spreadPct;
        const trend: ETFSpreadInfo['trend'] =
          Math.abs(spreadPct - previousSpread) < 0.1 ? 'stable' :
          spreadPct > previousSpread ? 'widening' : 'narrowing';

        state.etfSpreads.set(ticker, {
          etfTicker: ticker,
          underlying,
          spread: spreadPct,
          direction: spreadPct > 0 ? 'premium' : 'discount',
          trend,
          previousSpread,
          samples: (existing?.samples ?? 0) + 1,
        });

        const histAvg = HISTORICAL_AVG_SPREADS[ticker] ?? 1.0;
        if (Math.abs(spreadPct) > histAvg * 1.5) {
          observations.push(`${ticker} spread at ${spreadPct.toFixed(2)}% — ${(spreadPct / histAvg).toFixed(1)}x historical average of ${histAvg}%. Trend: ${trend}.`);
        }
      }

      // Extract cross-exchange spreads (T8)
      const t8Opps = opps.filter(o => o.arbType === 'type8_exchange_spread');
      for (const opp of t8Opps) {
        const key = `${opp.ticker_a}_${opp.venue_a}_${opp.venue_b}`;
        state.crossExchangeSpreads.set(key, opp.grossProfitPerContract * 100);
        if (opp.grossProfitPerContract > 0.01) {
          observations.push(`Cross-exchange: ${opp.ticker_a} ${(opp.grossProfitPerContract * 100).toFixed(2)}% spread between ${opp.venue_a} and ${opp.venue_b}.`);
        }
      }
    }

    if (regime.dislocationsActive) {
      observations.push('ALERT: Multiple extreme dislocations detected across arb detectors — possible market crisis or liquidity event.');
    }

    observations.push(`Arb portfolio: $${portfolio.totalPnlUsd.toFixed(2)} P&L, ${portfolio.openPositions.length} open positions, ${portfolio.winRate}% win rate.`);
  } catch {
    observations.push('Arb orchestrator: unavailable this cycle.');
  }

  // 1b. Pull CEX portfolio state
  try {
    const cryptoMod = await import('../../routes/crypto-agent.js') as Record<string, unknown>;
    const getCEXState = cryptoMod.getCEXPortfolioState;
    if (typeof getCEXState === 'function') {
      const cexState = getCEXState() as { positionCount?: number; totalValue?: number } | null;
      if (cexState) {
        observations.push(`CEX portfolio: ${cexState.positionCount ?? 0} positions, $${(cexState.totalValue ?? 0).toFixed(2)} total value.`);
      }
    }
  } catch {
    // CEX state not available — non-critical
  }

  // 1c. Pull crypto momentum data
  try {
    const { getDiscoveredCoins } = await import('../coin-discovery-service.js');
    const coins = getDiscoveredCoins();
    const topCoins = coins
      .filter(c => ['BTC', 'ETH', 'SOL'].includes(c.symbol.toUpperCase()))
      .map(c => ({
        symbol: c.symbol.toUpperCase(),
        change1h: 0, // Discovery service doesn't have 1h data
        change24h: c.change24h ?? 0,
        price: c.price,
        updatedAt: new Date().toISOString(),
      }));

    state.cryptoMomentum = topCoins;

    for (const coin of topCoins) {
      if (Math.abs(coin.change24h) > 3) {
        observations.push(`${coin.symbol} ${coin.change24h > 0 ? 'up' : 'down'} ${Math.abs(coin.change24h).toFixed(1)}% (24h) at $${coin.price.toFixed(2)}.`);
      }
    }
  } catch {
    // Discovery not available
  }

  // 1d. Pull stock portfolio state
  try {
    const stockMod = await import('../stock-intelligence/stock-orchestrator.js') as Record<string, unknown>;
    if (typeof stockMod.getStockPortfolio === 'function') {
      const stockPortfolio = (stockMod.getStockPortfolio as () => { positionCount: number; totalPnl: number })();
      if (stockPortfolio) {
        observations.push(`Stock portfolio: ${stockPortfolio.positionCount} positions, $${stockPortfolio.totalPnl.toFixed(2)} P&L.`);
      }
    }
  } catch {
    // Stock engine not loaded
  }

  // 1e. Check macro regime from swarm
  try {
    const { getLastBriefing } = await import('./swarm-coordinator.js');
    const briefing = getLastBriefing();
    if (briefing) {
      state.currentRegime = briefing.regime.regime;
      observations.push(`Macro regime: ${briefing.regime.regime} (confidence ${briefing.regime.confidence}%).`);
    }
  } catch {
    // Swarm not available
  }

  if (observations.length === 0) {
    observations.push('No market data available this cycle — all data sources offline.');
  }

  return observations;
}

// ── Step 2: Reason About Opportunities ─────────────────────────────────────

function reason(_observations: string[]): { thesis: string; confidence: number; actions: AgentAction[] } {
  const actions: AgentAction[] = [];
  const thesisComponents: string[] = [];
  let baseConfidence = 50; // Start neutral

  // Check for manual override
  if (thesisOverride && Date.now() < thesisOverride.expiresAt) {
    return {
      thesis: `[MANUAL OVERRIDE] ${thesisOverride.thesis}`,
      confidence: thesisOverride.confidence,
      actions: [], // Don't generate actions on override — human controls
    };
  }

  // ── Analyze ETF spreads ────────────────────────────────────────────────

  for (const [ticker, info] of state.etfSpreads) {
    const histAvg = HISTORICAL_AVG_SPREADS[ticker] ?? 1.0;
    const deviationRatio = Math.abs(info.spread) / histAvg;
    const crypto = info.underlying;

    // Is this spread structural or temporary?
    if (info.samples >= 5 && info.trend === 'stable' && deviationRatio < 1.3) {
      // Structural — close to historical average, not changing
      continue;
    }

    if (deviationRatio > 2.0) {
      // Significant deviation from historical average
      if (info.direction === 'premium' && info.trend === 'widening') {
        // ETF at premium and widening → strong institutional demand
        // Action: Buy crypto (institutional demand is bullish), consider selling ETF
        thesisComponents.push(`${ticker} at ${info.spread.toFixed(1)}% premium (${deviationRatio.toFixed(1)}x avg), widening. Institutional demand driving premium.`);
        baseConfidence += 10;

        actions.push({
          id: `${Date.now()}_${ticker}_buy_${crypto}`,
          target: 'cex',
          action: 'buy',
          symbol: `${crypto}-USD`,
          reasoning: `${ticker} at ${info.spread.toFixed(1)}% premium (hist avg ${histAvg}%). Premium widening suggests strong institutional demand → bullish for ${crypto}. Increasing ${crypto} exposure.`,
          confidence: Math.min(85, 50 + deviationRatio * 10),
          urgency: info.trend === 'widening' ? 'immediate' : 'next_cycle',
          executedAt: null,
          outcome: null,
          pnlImpact: null,
        });

        actions.push({
          id: `${Date.now()}_${ticker}_sell_etf`,
          target: 'stocks',
          action: 'sell',
          symbol: ticker,
          reasoning: `${ticker} trading at ${info.spread.toFixed(1)}% premium over ${crypto} spot. Selling overpriced ETF while buying underlying crypto is a convergence trade.`,
          confidence: Math.min(80, 45 + deviationRatio * 10),
          urgency: 'next_cycle',
          executedAt: null,
          outcome: null,
          pnlImpact: null,
        });

      } else if (info.direction === 'discount' && info.trend === 'widening') {
        // ETF at discount and widening → potential ETF outflows or crypto overpriced
        thesisComponents.push(`${ticker} at ${Math.abs(info.spread).toFixed(1)}% discount (${deviationRatio.toFixed(1)}x avg), widening. ETF redemption pressure or crypto rally outpacing ETF.`);
        baseConfidence += 5;

        actions.push({
          id: `${Date.now()}_${ticker}_sell_${crypto}`,
          target: 'cex',
          action: 'decrease',
          symbol: `${crypto}-USD`,
          reasoning: `${ticker} at ${Math.abs(info.spread).toFixed(1)}% discount. Widening discount suggests ETF outflow pressure — bearish signal for ${crypto}. Reducing exposure.`,
          confidence: Math.min(75, 40 + deviationRatio * 8),
          urgency: 'next_cycle',
          executedAt: null,
          outcome: null,
          pnlImpact: null,
        });

        actions.push({
          id: `${Date.now()}_${ticker}_buy_etf`,
          target: 'stocks',
          action: 'buy',
          symbol: ticker,
          reasoning: `${ticker} at ${Math.abs(info.spread).toFixed(1)}% discount to NAV. Buying discounted ETF while reducing spot crypto is a mean-reversion trade.`,
          confidence: Math.min(70, 40 + deviationRatio * 8),
          urgency: 'when_convenient',
          executedAt: null,
          outcome: null,
          pnlImpact: null,
        });

      } else if (info.trend === 'narrowing') {
        // Spread narrowing → convergence happening, reduce urgency
        thesisComponents.push(`${ticker} spread narrowing (${info.spread.toFixed(1)}% → converging). Market correcting organically.`);
        baseConfidence -= 5; // Less need to act
      }
    }
  }

  // ── Analyze cross-exchange spreads ──────────────────────────────────────

  const significantCrossExSpreads = Array.from(state.crossExchangeSpreads.entries())
    .filter(([, spread]) => spread > 0.5);

  if (significantCrossExSpreads.length > 0) {
    thesisComponents.push(`${significantCrossExSpreads.length} cross-exchange spreads >0.5%: ${significantCrossExSpreads.map(([k, v]) => `${k.split('_')[0]}:${v.toFixed(2)}%`).join(', ')}.`);
    baseConfidence += significantCrossExSpreads.length * 3;
  }

  // ── Analyze crypto momentum ────────────────────────────────────────────

  const btc = state.cryptoMomentum.find(c => c.symbol === 'BTC');
  if (btc) {
    if (btc.change24h > 5) {
      thesisComponents.push(`BTC strong rally (+${btc.change24h.toFixed(1)}% 24h). Check if ETF premiums are lagging — potential convergence trade.`);
      baseConfidence += 8;
    } else if (btc.change24h < -5) {
      thesisComponents.push(`BTC selling off (${btc.change24h.toFixed(1)}% 24h). Monitor ETF discounts for potential buying opportunity.`);
      baseConfidence += 5;
    }

    // Cross-market correlation check
    const gbtcInfo = state.etfSpreads.get('GBTC');
    const ibitInfo = state.etfSpreads.get('IBIT');
    if (gbtcInfo && btc.change24h > 3 && gbtcInfo.spread < 1) {
      thesisComponents.push(`BTC up ${btc.change24h.toFixed(1)}% but GBTC premium only ${gbtcInfo.spread.toFixed(1)}% — ETF lagging crypto. Potential ETF catch-up trade.`);
      actions.push({
        id: `${Date.now()}_correlation_gbtc_lag`,
        target: 'stocks',
        action: 'buy',
        symbol: 'GBTC',
        reasoning: `BTC rallied ${btc.change24h.toFixed(1)}% but GBTC premium is only ${gbtcInfo.spread.toFixed(1)}%. ETF typically catches up within market hours. Buying GBTC for convergence.`,
        confidence: 55,
        urgency: 'next_cycle',
        executedAt: null,
        outcome: null,
        pnlImpact: null,
      });
    }

    if (ibitInfo && btc.change24h < -3 && ibitInfo.spread > 0.5) {
      thesisComponents.push(`BTC down ${Math.abs(btc.change24h).toFixed(1)}% but IBIT still at ${ibitInfo.spread.toFixed(1)}% premium. ETF hasn't caught up to the sell-off.`);
      actions.push({
        id: `${Date.now()}_correlation_ibit_lag`,
        target: 'stocks',
        action: 'sell',
        symbol: 'IBIT',
        reasoning: `BTC dropped ${Math.abs(btc.change24h).toFixed(1)}% but IBIT still at ${ibitInfo.spread.toFixed(1)}% premium. Selling IBIT before premium erodes.`,
        confidence: 55,
        urgency: 'next_cycle',
        executedAt: null,
        outcome: null,
        pnlImpact: null,
      });
    }
  }

  // ── Regime-based adjustments ───────────────────────────────────────────

  if (state.currentRegime === 'crisis' || state.currentRegime === 'crisis_dislocations') {
    thesisComponents.push('CRISIS regime — extreme caution. Reducing all position sizes and raising confidence thresholds.');
    baseConfidence = Math.max(20, baseConfidence - 20);

    // In crisis, prioritize capital preservation
    for (const action of actions) {
      action.confidence = Math.round(action.confidence * 0.7);
      if (action.action === 'buy' || action.action === 'increase') {
        action.urgency = 'when_convenient';
      }
    }
  }

  // ── Apply aggressiveness multiplier ────────────────────────────────────

  for (const action of actions) {
    action.confidence = Math.round(action.confidence * state.aggressivenessMultiplier);
  }

  // ── Apply pattern memory bonuses/penalties ─────────────────────────────

  for (const action of actions) {
    const patternKey = `${action.target}_${action.action}_${action.symbol}`;
    const pattern = patternMemory.get(patternKey);
    if (pattern && pattern.occurrences >= 3) {
      if (pattern.winRate > 0.65) {
        action.confidence = Math.min(95, action.confidence + 10);
        action.reasoning += ` [Pattern memory: ${(pattern.winRate * 100).toFixed(0)}% win rate over ${pattern.occurrences} occurrences — boosting confidence.]`;
      } else if (pattern.winRate < 0.35) {
        action.confidence = Math.max(5, action.confidence - 15);
        action.reasoning += ` [Pattern memory: ${(pattern.winRate * 100).toFixed(0)}% win rate over ${pattern.occurrences} occurrences — reducing confidence.]`;
      }
    }
  }

  // Filter out actions below minimum confidence
  const viableActions = actions.filter(a => a.confidence >= MIN_CONFIDENCE_TO_ACT);

  // Build thesis
  const thesis = thesisComponents.length > 0
    ? thesisComponents.join(' ')
    : 'Market appears stable with no significant deviations from historical norms. No action recommended.';

  // Clamp confidence
  const confidence = Math.max(0, Math.min(100, baseConfidence));

  return { thesis, confidence, actions: viableActions };
}

// ── Step 3: Execute Coordinated Actions ────────────────────────────────────

async function executeActions(actions: AgentAction[]): Promise<void> {
  for (const action of actions) {
    // Only execute 'immediate' urgency actions automatically
    // 'next_cycle' and 'when_convenient' are stored as recommendations
    if (action.urgency !== 'immediate') {
      action.outcome = 'pending';
      state.pendingOutcomes++;
      continue;
    }

    try {
      let success = false;

      if (action.target === 'cex') {
        success = await executeCEXAction(action);
      } else if (action.target === 'stocks') {
        success = await executeStockAction(action);
      } else if (action.target === 'arb') {
        // Arb actions are advisory — the orchestrator handles execution
        success = true;
      }

      action.executedAt = new Date().toISOString();
      action.outcome = success ? 'success' : 'failed';
      state.totalActionsExecuted++;

      // Record outcome for pattern learning
      recordOutcome(action, success);

      logger.info({
        target: action.target,
        action: action.action,
        symbol: action.symbol,
        confidence: action.confidence,
        success,
      }, `[ArbAgent] Executed: ${action.action} ${action.symbol} → ${action.target} (${success ? 'OK' : 'FAILED'})`);

    } catch (err) {
      action.executedAt = new Date().toISOString();
      action.outcome = 'failed';
      logger.warn({
        err: err instanceof Error ? err.message : err,
        target: action.target,
        symbol: action.symbol,
      }, `[ArbAgent] Action execution failed: ${action.symbol}`);
    }
  }
}

async function executeCEXAction(action: AgentAction): Promise<boolean> {
  try {
    const { executeSignalTrade } = await import('../../routes/crypto-agent.js');
    return executeSignalTrade({
      symbol: action.symbol,
      action: action.action === 'buy' || action.action === 'increase' ? 'buy' : 'sell',
      price: 0, // Let the agent determine market price
      source: 'arb_agent',
      confidence: action.confidence,
      reason: `[ArbAgent] ${action.reasoning}`,
    });
  } catch {
    return false;
  }
}

async function executeStockAction(action: AgentAction): Promise<boolean> {
  try {
    const stockMod = await import('../stock-intelligence/stock-orchestrator.js') as Record<string, unknown>;
    const injectFn = stockMod.injectArbSignal;
    if (typeof injectFn === 'function') {
      injectFn({
        source: 'arb_agent',
        ticker: action.symbol,
        action: action.action === 'buy' || action.action === 'increase' ? 'buy' : 'sell',
        confidence: action.confidence,
        reasoning: `[ArbAgent] ${action.reasoning}`,
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Step 4: Learn From Outcomes ────────────────────────────────────────────

function recordOutcome(action: AgentAction, success: boolean): void {
  const record: OutcomeRecord = {
    actionId: action.id,
    target: action.target,
    symbol: action.symbol,
    action: action.action,
    confidence: action.confidence,
    profitable: success ? null : false, // true profitability determined later
    pnl: 0,
    recordedAt: new Date().toISOString(),
  };

  outcomeHistory.push(record);
  if (outcomeHistory.length > MAX_OUTCOME_HISTORY) outcomeHistory.shift();

  // Update pattern memory
  const patternKey = `${action.target}_${action.action}_${action.symbol}`;
  const existing = patternMemory.get(patternKey);
  if (existing) {
    existing.occurrences++;
    existing.lastSeen = record.recordedAt;
    if (success) existing.profitableCount++;
    existing.winRate = existing.profitableCount / existing.occurrences;
  } else {
    patternMemory.set(patternKey, {
      pattern: patternKey,
      occurrences: 1,
      profitableCount: success ? 1 : 0,
      avgPnl: 0,
      lastSeen: record.recordedAt,
      winRate: success ? 1 : 0,
    });
  }

  state.totalDecisions++;
}

function updateAggressiveness(): void {
  // Every 20 decisions, adjust aggressiveness based on track record
  if (state.totalDecisions === 0 || state.totalDecisions % 20 !== 0) return;

  const recent = outcomeHistory.slice(-50);
  const withOutcome = recent.filter(r => r.profitable !== null);
  if (withOutcome.length < 10) return;

  const winRate = withOutcome.filter(r => r.profitable).length / withOutcome.length;

  if (winRate > 0.65) {
    // Winning consistently — increase aggressiveness (max 1.5x)
    state.aggressivenessMultiplier = Math.min(1.5, state.aggressivenessMultiplier + 0.1);
    logger.info({ winRate, mult: state.aggressivenessMultiplier }, '[ArbAgent] Win rate high — increasing aggressiveness');
  } else if (winRate < 0.35) {
    // Losing consistently — decrease aggressiveness (min 0.3x)
    state.aggressivenessMultiplier = Math.max(0.3, state.aggressivenessMultiplier - 0.1);
    logger.info({ winRate, mult: state.aggressivenessMultiplier }, '[ArbAgent] Win rate low — decreasing aggressiveness');
  }
  // Between 0.35 and 0.65 — stay where we are
}

// ── Main Reasoning Cycle ───────────────────────────────────────────────────

async function runReasoningCycle(): Promise<void> {
  const cycleStart = Date.now();
  state.totalCycles++;

  try {
    // Step 1: Gather observations
    const observations = await gatherObservations();

    // Step 2: Reason about opportunities
    const { thesis, confidence, actions } = reason(observations);

    // Update state
    state.marketThesis = thesis;
    state.confidenceLevel = confidence;
    state.recommendedActions = actions;

    // Step 3: Execute coordinated actions
    if (actions.length > 0) {
      await executeActions(actions);
    }

    // Step 4: Adjust aggressiveness based on track record
    updateAggressiveness();

    // Record reasoning chain
    const chain: ReasoningChain = {
      id: `rc_${state.totalCycles}_${Date.now()}`,
      startedAt: new Date(cycleStart).toISOString(),
      completedAt: new Date().toISOString(),
      observations,
      thesis,
      confidence,
      actions,
      durationMs: Date.now() - cycleStart,
    };

    reasoningHistory.push(chain);
    if (reasoningHistory.length > MAX_REASONING_HISTORY) reasoningHistory.shift();

    state.lastReasoningAt = chain.completedAt;
    state.lastCycleDurationMs = chain.durationMs;

    // Log cycle summary
    const actionSummary = actions.length > 0
      ? actions.map(a => `${a.action} ${a.symbol}→${a.target}(${a.confidence}%)`).join(', ')
      : 'no actions';

    logger.info({
      cycle: state.totalCycles,
      observations: observations.length,
      thesis: thesis.slice(0, 120),
      confidence,
      actions: actions.length,
      durationMs: chain.durationMs,
      aggressiveness: state.aggressivenessMultiplier,
    }, `[ArbAgent] Cycle #${state.totalCycles} — ${observations.length} obs, ${confidence}% conf, ${actionSummary} — ${chain.durationMs}ms`);

  } catch (err) {
    state.lastCycleDurationMs = Date.now() - cycleStart;
    logger.error({ err: err instanceof Error ? err.message : err, cycle: state.totalCycles }, '[ArbAgent] Reasoning cycle failed');
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function startArbAgent(): void {
  if (cycleInterval) return;

  state.startedAt = new Date().toISOString();
  logger.info('[ArbAgent] Starting APEX/OpenClaw Arb Intelligence Agent (60s reasoning cycles)');

  cycleInterval = setInterval(runReasoningCycle, CYCLE_INTERVAL_MS);

  // First cycle after 45s (let arb orchestrator and other systems warm up)
  setTimeout(runReasoningCycle, 45_000);
}

export function stopArbAgent(): void {
  if (cycleInterval) {
    clearInterval(cycleInterval);
    cycleInterval = null;
    logger.info('[ArbAgent] Agent stopped');
  }
}

export function getArbAgentStatus(): {
  state: Omit<ArbAgentState, 'etfSpreads' | 'crossExchangeSpreads'> & {
    etfSpreads: Record<string, ETFSpreadInfo>;
    crossExchangeSpreads: Record<string, number>;
  };
  running: boolean;
  recentActions: AgentAction[];
  patternCount: number;
  topPatterns: PatternMemory[];
} {
  // Convert Maps to plain objects for JSON serialization
  const etfObj: Record<string, ETFSpreadInfo> = {};
  for (const [k, v] of state.etfSpreads) etfObj[k] = v;

  const crossObj: Record<string, number> = {};
  for (const [k, v] of state.crossExchangeSpreads) crossObj[k] = v;

  // Get top patterns by occurrence count
  const topPatterns = Array.from(patternMemory.values())
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 10);

  // Get recent actions from last 5 reasoning chains
  const recentActions = reasoningHistory.slice(-5).flatMap(r => r.actions);

  return {
    state: {
      ...state,
      etfSpreads: etfObj,
      crossExchangeSpreads: crossObj,
    },
    running: cycleInterval !== null,
    recentActions,
    patternCount: patternMemory.size,
    topPatterns,
  };
}

export function getArbAgentReasoning(limit = 20): ReasoningChain[] {
  return reasoningHistory.slice(-limit);
}

export function setArbAgentOverride(thesis: string, confidence: number, durationMinutes = 30): void {
  thesisOverride = {
    thesis,
    confidence: Math.max(0, Math.min(100, confidence)),
    expiresAt: Date.now() + durationMinutes * 60_000,
  };
  logger.info({ thesis, confidence, durationMinutes }, '[ArbAgent] Manual thesis override set');
}

export function clearArbAgentOverride(): void {
  thesisOverride = null;
  logger.info('[ArbAgent] Manual thesis override cleared');
}

export function getArbAgentOutcomes(limit = 50): OutcomeRecord[] {
  return outcomeHistory.slice(-limit);
}
