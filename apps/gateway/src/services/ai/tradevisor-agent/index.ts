/**
 * TradeVisor Agent — public entry point.
 *
 * The webhook handler calls evaluateSignal() once per incoming TradeVisor
 * signal. That returns a Decision object the handler uses to gate (or skip,
 * or defer) execution.
 *
 * Two operating modes selected via env:
 *   - TRADEVISOR_AGENT_MODE=shadow (default): reasoner runs and decisions
 *     are logged but the webhook handler ALWAYS proceeds with execution
 *     using the original parameters. Lets you see what the agent WOULD have
 *     done without changing trading behavior. Use this for the first 1–2
 *     weeks of validation.
 *   - TRADEVISOR_AGENT_MODE=gate: decisions actually gate execution. veto
 *     skips the trade; escalate stores a pending decision and skips until
 *     human resolves; approve proceeds (with adjusted size/stop if reasoner
 *     suggested any).
 *
 * ENABLE_TRADEVISOR_AGENT=true is the master switch. When false, evaluateSignal
 * returns a fast pass-through "approve" without calling Claude — preserves
 * legacy behavior with zero latency overhead.
 */
import { logger } from '../../../lib/logger.js';
import { gatherContext } from './context.js';
import { reasonAboutSignal } from './reasoner.js';
import { reasonAboutSignalEnsemble } from './ensemble-reasoner.js';
import { recordDecision, getRecentDecisions, getPendingEscalations, getDecisionById, resolveEscalation, getDecisionStats } from './decisions.js';
import type { IncomingSignal, Decision } from './types.js';
import { randomUUID } from 'crypto';

export type AgentMode = 'disabled' | 'shadow' | 'gate';
export type ReasonerMode = 'solo' | 'ensemble';

export function getAgentMode(): AgentMode {
  if (process.env['ENABLE_TRADEVISOR_AGENT'] !== 'true') return 'disabled';
  const m = process.env['TRADEVISOR_AGENT_MODE'];
  return m === 'gate' ? 'gate' : 'shadow';
}

/**
 * Reasoner backend selector.
 *   - solo (default): single Claude call. Cheap, fast, well-tested.
 *   - ensemble: parallel Claude + GPT-4o + Gemini with consensus. More
 *     expensive (~3x) and slightly slower, but catches model bias and
 *     escalates 3-way disagreements as a quality signal.
 *
 * Default = solo for v2 paper. Switch to ensemble after a week of validation.
 */
export function getReasonerMode(): ReasonerMode {
  return process.env['TRADEVISOR_REASONER_MODE'] === 'ensemble' ? 'ensemble' : 'solo';
}

/**
 * Main entry. Returns a Decision the webhook handler uses to gate execution.
 * In disabled mode, returns a synthetic approve with no Claude call.
 * In shadow mode, runs the full reasoner but the result is informational.
 * In gate mode, the result actually drives execution.
 */
export async function evaluateSignal(signal: IncomingSignal): Promise<Decision> {
  const mode = getAgentMode();

  if (mode === 'disabled') {
    return {
      id: randomUUID(),
      signal,
      context: {
        signal,
        chart: null,
        news: [],
        portfolio: {
          cashUsd: 0, equityPositions: [], totalPositions: 0, maxPositions: 10,
          sectorCount: {}, sectorCap: 2, alreadyHolding: false,
        },
        scout: null,
        macro: {
          regime: 'unknown',
          regimeTag: null,
          regimeConfidence: 0,
          regimeRationale: '',
          spyRs5d: 0,
          spyRs20d: 0,
          notes: 'agent disabled',
        },
        dailyPnl: { pct: 0, limitPct: -3, remaining: 3 },
      },
      verdict: 'approve',
      reasoning: 'Agent disabled (ENABLE_TRADEVISOR_AGENT=false). Pass-through approve.',
      confidence: 1.0,
      adjustedSize: null,
      adjustedStopPct: -5,
      modelUsed: 'none',
      reasoningLatencyMs: 0,
      createdAt: new Date().toISOString(),
    };
  }

  // Shadow + gate: gather context, reason, persist decision.
  const ctx = await gatherContext(signal);
  const reasonerMode = getReasonerMode();
  const decision = reasonerMode === 'ensemble'
    ? await reasonAboutSignalEnsemble(ctx)
    : await reasonAboutSignal(ctx);
  recordDecision(decision);

  logger.info(
    {
      symbol: signal.symbol,
      action: signal.action,
      verdict: decision.verdict,
      confidence: decision.confidence,
      reasoning: decision.reasoning.slice(0, 200),
      adjSize: decision.adjustedSize,
      adjStopPct: decision.adjustedStopPct,
      latencyMs: decision.reasoningLatencyMs,
      mode,
      reasonerMode,
      modelUsed: decision.modelUsed,
    },
    `[TVAgent] ${signal.action.toUpperCase()} ${signal.symbol} → ${decision.verdict.toUpperCase()} (${mode}/${reasonerMode})`,
  );

  return decision;
}

// Re-export read APIs for the REST routes
export { getRecentDecisions, getPendingEscalations, getDecisionById, resolveEscalation, getDecisionStats };
export type { Decision, IncomingSignal };
