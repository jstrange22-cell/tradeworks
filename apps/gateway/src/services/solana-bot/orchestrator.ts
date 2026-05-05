/**
 * Solana DEX bot v2 — orchestrator.
 *
 *   scan → score → agent gate → (if approve + gate mode) → paper open
 *
 * Cron-style: setInterval every SOLANA_SCAN_INTERVAL_MS (default 10 min).
 * Gated by ENABLE_SOLANA_BOT=true. Off by default — even with the agent
 * enabled in shadow mode, the orchestrator stays parked unless explicitly
 * turned on.
 */
import { logger } from '../../lib/logger.js';
import { scanCandidates } from './scanner.js';
import { scoreCandidate } from './ai-scorer.js';
import { openPosition, getLedgerSummaryForReasoner } from './paper-ledger.js';
import { evaluateCandidate, getSolanaAgentMode } from '../ai/solana-agent/index.js';

const AI_SCORE_THRESHOLD = 0.70;
const SCAN_INTERVAL_MS = Number(process.env['SOLANA_SCAN_INTERVAL_MS'] ?? 10 * 60 * 1000);

let scannerInterval: NodeJS.Timeout | null = null;
let cycleInProgress = false;

export interface CycleResult {
  startedAt: string;
  finishedAt: string;
  candidatesFound: number;
  scoredAboveThreshold: number;
  agentDecisions: { approved: number; vetoed: number; escalated: number };
  positionsOpened: number;
  errors: string[];
}

let lastCycle: CycleResult | null = null;

export function getLastCycleResult(): CycleResult | null {
  return lastCycle;
}

export async function runScannerCycle(): Promise<CycleResult> {
  if (cycleInProgress) {
    logger.warn('[SolanaOrchestrator] cycle already in progress, skipping');
    return lastCycle ?? {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      candidatesFound: 0, scoredAboveThreshold: 0,
      agentDecisions: { approved: 0, vetoed: 0, escalated: 0 },
      positionsOpened: 0, errors: ['cycle already in progress'],
    };
  }
  cycleInProgress = true;
  const startedAt = new Date().toISOString();
  const result: CycleResult = {
    startedAt,
    finishedAt: '',
    candidatesFound: 0,
    scoredAboveThreshold: 0,
    agentDecisions: { approved: 0, vetoed: 0, escalated: 0 },
    positionsOpened: 0,
    errors: [],
  };

  try {
    const candidates = await scanCandidates();
    result.candidatesFound = candidates.length;
    if (candidates.length === 0) {
      logger.info('[SolanaOrchestrator] no candidates this cycle');
      return result;
    }

    for (const candidate of candidates) {
      try {
        const aiScore = await scoreCandidate(candidate);
        if (aiScore.score < AI_SCORE_THRESHOLD) {
          logger.debug(
            { symbol: candidate.symbol, score: aiScore.score },
            `[SolanaOrchestrator] ${candidate.symbol} below threshold (${aiScore.score.toFixed(2)} < ${AI_SCORE_THRESHOLD})`,
          );
          continue;
        }
        result.scoredAboveThreshold++;

        const ledgerSummary = getLedgerSummaryForReasoner();
        const decision = await evaluateCandidate(candidate, {
          aiScore,
          paperLedger: ledgerSummary,
        });

        if (decision.verdict === 'approve') result.agentDecisions.approved++;
        else if (decision.verdict === 'veto') result.agentDecisions.vetoed++;
        else result.agentDecisions.escalated++;

        const mode = getSolanaAgentMode();
        if (mode === 'gate' && decision.verdict === 'approve') {
          const sizeUsd = decision.sizeUsd ?? 25;
          const open = openPosition(candidate, sizeUsd, decision.id);
          if (open.ok) {
            result.positionsOpened++;
            logger.info(
              { symbol: candidate.symbol, mint: candidate.mint.slice(0, 8), sizeUsd, decisionId: decision.id },
              `[SolanaOrchestrator] OPENED paper position`,
            );
          } else {
            result.errors.push(`open ${candidate.symbol}: ${open.reason}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`candidate ${candidate.symbol}: ${msg}`);
        logger.warn({ err: msg, symbol: candidate.symbol }, '[SolanaOrchestrator] candidate processing failed');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`cycle: ${msg}`);
    logger.error({ err: msg }, '[SolanaOrchestrator] cycle threw');
  } finally {
    result.finishedAt = new Date().toISOString();
    cycleInProgress = false;
    lastCycle = result;
    logger.info(
      {
        candidatesFound: result.candidatesFound,
        scoredAboveThreshold: result.scoredAboveThreshold,
        decisions: result.agentDecisions,
        positionsOpened: result.positionsOpened,
        errors: result.errors.length,
      },
      `[SolanaOrchestrator] cycle complete`,
    );
  }

  return result;
}

export function startSolanaScanner(): void {
  if (process.env['ENABLE_SOLANA_BOT'] !== 'true') {
    logger.info('[SolanaOrchestrator] disabled (ENABLE_SOLANA_BOT != true)');
    return;
  }
  if (scannerInterval) {
    logger.warn('[SolanaOrchestrator] already started');
    return;
  }
  logger.info({ intervalMs: SCAN_INTERVAL_MS, agentMode: getSolanaAgentMode() }, '[SolanaOrchestrator] starting');
  // Fire-and-forget first cycle, then schedule
  void runScannerCycle();
  scannerInterval = setInterval(() => { void runScannerCycle(); }, SCAN_INTERVAL_MS);
}

export function stopSolanaScanner(): void {
  if (scannerInterval) {
    clearInterval(scannerInterval);
    scannerInterval = null;
    logger.info('[SolanaOrchestrator] stopped');
  }
}
