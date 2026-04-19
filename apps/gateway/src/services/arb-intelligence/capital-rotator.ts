/**
 * Capital Rotator — Exit Early to Free Capital
 *
 * When 70%+ of edge is captured, exit the position early.
 * Frees capital for the next arb opportunity.
 */

import { logger } from '../../lib/logger.js';
import type { ArbPaperPosition } from './models.js';

export interface RotationDecision {
  action: 'exit' | 'hold';
  reason: string;
  capturedPct: number;
}

/**
 * Check if a position should be exited early.
 *
 * Rules:
 * - Captured ≥70% of edge → EXIT (take profit, free capital)
 * - Underwater by ≥50% → EXIT (cut loss)
 * - Position older than 4 hours → EXIT (capital locked too long)
 * - Otherwise → HOLD
 */
export function checkRotation(position: ArbPaperPosition): RotationDecision {
  const originalEdge = position.opportunity.grossProfitPerContract * position.opportunity.fillableQuantity;
  if (originalEdge <= 0) return { action: 'hold', reason: 'No edge to capture', capturedPct: 0 };

  const currentPnl = position.pnl;
  const capturedPct = currentPnl / originalEdge;

  // Captured 70%+ of edge → take profit
  if (capturedPct >= 0.70) {
    logger.info({ id: position.id, capturedPct: (capturedPct * 100).toFixed(0) }, '[ArbRotator] Exiting — captured 70%+ of edge');
    return { action: 'exit', reason: `Captured ${(capturedPct * 100).toFixed(0)}% of edge`, capturedPct };
  }

  // Underwater by 50%+ → cut loss
  if (capturedPct < -0.50) {
    logger.warn({ id: position.id, capturedPct: (capturedPct * 100).toFixed(0) }, '[ArbRotator] Exiting — position underwater');
    return { action: 'exit', reason: `Position underwater ${(capturedPct * 100).toFixed(0)}%`, capturedPct };
  }

  // Position older than 4 hours → free capital
  const ageMs = Date.now() - new Date(position.entryTime).getTime();
  if (ageMs > 4 * 60 * 60 * 1000) {
    logger.info({ id: position.id, ageHours: (ageMs / 3600000).toFixed(1) }, '[ArbRotator] Exiting — position too old');
    return { action: 'exit', reason: `Position ${(ageMs / 3600000).toFixed(1)}h old — freeing capital`, capturedPct };
  }

  return { action: 'hold', reason: 'Holding — edge not yet captured', capturedPct };
}
