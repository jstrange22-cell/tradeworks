/**
 * Solana DEX agent — public entry point. Same shadow/gate semantics as the
 * stocks-side TradeVisor agent.
 *
 *   ENABLE_SOLANA_AGENT=true    master switch (default false)
 *   SOLANA_AGENT_MODE=shadow|gate (default shadow)
 *
 * In shadow: reasoner runs and decisions are logged, but the orchestrator
 * never opens paper positions even on approve. In gate: approves dispatch
 * to the paper ledger. Disabled: synthetic veto pass-through (DEX
 * fails-veto so disabled === blocked).
 */
import { logger } from '../../../lib/logger.js';
import { reasonAboutCandidate } from './reasoner.js';
import {
  recordDecision,
  getRecentDecisions,
  getPendingEscalations,
  getDecisionById,
  resolveEscalation,
  getDecisionStats,
} from './decisions.js';
import type { SolanaSignalContext, SolanaDecision, TokenCandidate } from './types.js';
import { randomUUID } from 'crypto';

export type SolanaAgentMode = 'disabled' | 'shadow' | 'gate';

export function getSolanaAgentMode(): SolanaAgentMode {
  if (process.env['ENABLE_SOLANA_AGENT'] !== 'true') return 'disabled';
  return process.env['SOLANA_AGENT_MODE'] === 'gate' ? 'gate' : 'shadow';
}

/**
 * Main entry. Reasoner is called for shadow + gate modes. Disabled returns
 * a synthetic VETO so callers don't accidentally fire trades when the agent
 * is off (DEX fails-closed).
 */
export async function evaluateCandidate(
  candidate: TokenCandidate,
  ctxExtras: Pick<SolanaSignalContext, 'aiScore' | 'paperLedger'>,
): Promise<SolanaDecision> {
  const mode = getSolanaAgentMode();

  if (mode === 'disabled') {
    return {
      id: randomUUID(),
      candidate,
      context: { candidate, ...ctxExtras, whaleActivity: null },
      verdict: 'veto',
      reasoning: 'Solana agent disabled (ENABLE_SOLANA_AGENT=false). Default VETO per fail-closed safety.',
      confidence: 1.0,
      sizeUsd: null,
      modelUsed: 'none',
      reasoningLatencyMs: 0,
      createdAt: new Date().toISOString(),
    };
  }

  const ctx: SolanaSignalContext = { candidate, ...ctxExtras, whaleActivity: null };
  const decision = await reasonAboutCandidate(ctx);
  recordDecision(decision);

  logger.info(
    {
      symbol: candidate.symbol,
      mint: candidate.mint.slice(0, 8),
      verdict: decision.verdict,
      confidence: decision.confidence,
      sizeUsd: decision.sizeUsd,
      reasoning: decision.reasoning.slice(0, 200),
      latencyMs: decision.reasoningLatencyMs,
      mode,
    },
    `[SolanaAgent] ${candidate.symbol} (${candidate.mint.slice(0, 8)}) -> ${decision.verdict.toUpperCase()} (${mode})`,
  );

  return decision;
}

export {
  recordDecision,
  getRecentDecisions,
  getPendingEscalations,
  getDecisionById,
  resolveEscalation,
  getDecisionStats,
};
export type { SolanaDecision, TokenCandidate };
