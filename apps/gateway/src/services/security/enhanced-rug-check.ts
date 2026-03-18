/**
 * Enhanced Security Check — combines GoPlus scanner with existing RugCheck.
 *
 * Runs both scans in parallel and produces a single SecurityVerdict.
 * If GoPlus detects a critical threat (honeypot, extreme tax), the
 * verdict is critical regardless of what RugCheck says.
 */

import { scanToken, type GoPlusReport, type RiskLevel } from './goplus-scanner.js';
import { fetchRugCheck } from '../../routes/solana-sniper/monitoring.js';

// ── Public types ──────────────────────────────────────────────────────

export interface RugCheckResult {
  score: number;
  risks: string[];
}

export interface SecurityVerdict {
  safe: boolean;
  riskLevel: RiskLevel;
  score: number;
  flags: string[];
  goplus: GoPlusReport | null;
  rugCheck: RugCheckResult | null;
}

// ── RugCheck score normalization ──────────────────────────────────────
//
// RugCheck API returns a score from 0-1000 (higher = safer).
// We normalize to 0-100 to match GoPlus scoring.

const RUGCHECK_MAX_SCORE = 1000;
const RUGCHECK_TIMEOUT_MS = 3_000;

function normalizeRugCheckScore(raw: number): number {
  return Math.round((Math.max(0, Math.min(raw, RUGCHECK_MAX_SCORE)) / RUGCHECK_MAX_SCORE) * 100);
}

function rugCheckToResult(
  data: { score: number; topHolderPct: number; bundleDetected: boolean } | null,
): RugCheckResult | null {
  if (!data) return null;

  const risks: string[] = [];
  if (data.bundleDetected) {
    risks.push('Bundle/sybil attack detected by RugCheck');
  }
  if (data.topHolderPct > 30) {
    risks.push(`Top holder owns ${data.topHolderPct.toFixed(1)}% of supply`);
  } else if (data.topHolderPct > 15) {
    risks.push(`Top holder owns ${data.topHolderPct.toFixed(1)}% of supply (moderate concentration)`);
  }
  if (data.score < 300) {
    risks.push(`Low RugCheck score: ${data.score}/1000`);
  }

  return {
    score: normalizeRugCheckScore(data.score),
    risks,
  };
}

// ── Risk-level from score ─────────────────────────────────────────────

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 80) return 'low';
  if (score >= 60) return 'medium';
  if (score >= 30) return 'high';
  return 'critical';
}

// ── Main enhanced check ───────────────────────────────────────────────

export async function enhancedSecurityCheck(mint: string): Promise<SecurityVerdict> {
  // Run both scans in parallel — neither should throw
  const [goplusReport, rugCheckRaw] = await Promise.all([
    scanToken(mint).catch((): GoPlusReport | null => null),
    fetchRugCheck(mint, RUGCHECK_TIMEOUT_MS).catch(() => null),
  ]);

  const rugCheck = rugCheckToResult(rugCheckRaw);

  // If GoPlus is critical (honeypot / extreme tax), verdict is critical immediately
  if (goplusReport && goplusReport.riskLevel === 'critical') {
    const mergedFlags = [
      ...goplusReport.flags,
      ...(rugCheck?.risks ?? []),
    ];

    return {
      safe: false,
      riskLevel: 'critical',
      score: goplusReport.score,
      flags: mergedFlags,
      goplus: goplusReport,
      rugCheck,
    };
  }

  // Combine scores: 50/50 weighted average when both are available
  let finalScore: number;
  if (goplusReport && rugCheck) {
    finalScore = Math.round(goplusReport.score * 0.5 + rugCheck.score * 0.5);
  } else if (goplusReport) {
    finalScore = goplusReport.score;
  } else if (rugCheck) {
    finalScore = rugCheck.score;
  } else {
    // Both failed — neutral
    finalScore = 50;
  }

  // Clamp to 0-100
  finalScore = Math.max(0, Math.min(100, finalScore));

  const riskLevel = riskLevelFromScore(finalScore);
  const safe = riskLevel === 'low' || riskLevel === 'medium';

  // Merge flags from both sources
  const flags: string[] = [
    ...(goplusReport?.flags ?? []),
    ...(rugCheck?.risks ?? []),
  ];

  if (!goplusReport && !rugCheck) {
    flags.push('Both security scanners unavailable — proceed with caution');
  }

  return {
    safe,
    riskLevel,
    score: finalScore,
    flags,
    goplus: goplusReport,
    rugCheck,
  };
}
