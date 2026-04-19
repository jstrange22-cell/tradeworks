/**
 * APEX Arb Brain — Core Reasoning Engine
 *
 * 6-Step Master Pipeline for every opportunity:
 * 1. Quick Kill Checks (sub-ms, no LLM)
 * 2. Fee-Adjusted Validation (validator)
 * 3. Type-Specific Deep Validation (LLM for Type 4/7)
 * 4. Memory Check (historical win rate)
 * 5. Final Sizing
 * 6. Approve & Log
 */

import { logger } from '../../lib/logger.js';
import type { ArbOpportunity, ArbDecision, ArbConfig } from './models.js';
import { validateOpportunity, calculateFinalSize } from './validator.js';
import { verifyCombinatorialDependency, checkSettlementRisk, verifyOptionsModel } from './reasoner.js';
import { getMemoryMultiplier, isDetectorPaused } from './learner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const KILL_SWITCH_PATH = resolve(process.cwd(), 'data/STOP');

export async function evaluate(opp: ArbOpportunity, config: ArbConfig): Promise<ArbDecision> {
  const start = Date.now();
  const warnings: string[] = [];

  // ── Step 1: Quick Kill Checks ───────────────────────────────────────────

  // Kill switch
  if (existsSync(KILL_SWITCH_PATH)) {
    return decision('skip', opp, 'Kill switch active — data/STOP exists', 0, [], start);
  }

  // Stale opportunity (>60s old)
  const age = Date.now() - new Date(opp.detectedAt).getTime();
  if (age > 60_000) {
    return decision('skip', opp, `Stale opportunity — ${(age / 1000).toFixed(0)}s old`, 0, [], start);
  }

  // Blocked category
  if (config.blockedCategories.includes(opp.category)) {
    return decision('skip', opp, `Category ${opp.category} is blocked`, 0, [], start);
  }

  // Non-positive gross profit
  if (opp.grossProfitPerContract <= 0) {
    return decision('skip', opp, 'Non-positive gross profit', 0, [], start);
  }

  // Detector paused by learner
  if (isDetectorPaused(opp.arbType)) {
    return decision('skip', opp, `Detector ${opp.arbType} paused after consecutive losses`, 0, [], start);
  }

  // ── Step 2: Fee-Adjusted Validation ─────────────────────────────────────

  const validation = validateOpportunity(opp, config);

  // For Type 9 (ETF vs crypto), the standard fee model doesn't apply —
  // these are not prediction market contracts. In paper mode, approve if
  // the gross spread is positive (we'll track real P&L separately).
  const isType9 = opp.arbType === 'type9_stock_crypto_spread';
  if (!validation.profitable && !isType9) {
    return decision('skip', opp, `Not profitable after fees: net=$${validation.netProfit.toFixed(2)} (fees=$${validation.totalFees.toFixed(2)}, slippage=$${validation.slippage.toFixed(2)})`, 0, [], start);
  }
  if (isType9 && opp.grossProfitPerContract <= 0) {
    return decision('skip', opp, 'T9: No positive spread detected', 0, [], start);
  }

  // ── Step 3: Type-Specific Deep Validation ───────────────────────────────

  // Type 4: LLM verification of logical dependency
  if (opp.arbType === 'type4_combinatorial' || opp.arbType === 'type4_combinatorial_mutex') {
    const depCheck = await verifyCombinatorialDependency(opp);
    if (!depCheck.valid) {
      return decision('skip', opp, `LLM rejected dependency: ${depCheck.reasoning}`, 0, [], start);
    }
    if (depCheck.confidence < 0.80) {
      return decision('investigate', opp, `LLM confidence ${(depCheck.confidence * 100).toFixed(0)}% below 80% threshold`, depCheck.confidence, [`Low LLM confidence: ${depCheck.reasoning}`], start);
    }
    opp.confidence = Math.min(opp.confidence, depCheck.confidence * 0.9);
    if (depCheck.edgeCases.length > 0) {
      warnings.push(`Edge cases: ${depCheck.edgeCases.join('; ')}`);
    }
  }

  // Type 3/6: Settlement risk check
  if (opp.arbType === 'type3_cross_platform' || opp.arbType === 'type6_latency') {
    const settlementCheck = await checkSettlementRisk(opp);
    if (!settlementCheck.safe) {
      return decision('skip', opp, `Settlement risk: ${settlementCheck.reasoning}`, 0, [], start);
    }
    if (settlementCheck.risk === 'medium') {
      warnings.push(`Settlement risk: ${settlementCheck.reasoning}`);
      opp.sizeMultiplier *= 0.7; // Reduce size for medium risk
    }
  }

  // Type 7: Options model confidence
  if (opp.arbType === 'type7_options_implied') {
    const optionsCheck = verifyOptionsModel(opp);
    if (!optionsCheck.valid) {
      return decision('skip', opp, `Options model invalid: ${optionsCheck.reasoning}`, 0, [], start);
    }
    opp.confidence = Math.min(opp.confidence, optionsCheck.confidence);
  }

  // ── Step 4: Memory Check ────────────────────────────────────────────────

  const memoryMult = getMemoryMultiplier(opp.arbType);
  if (memoryMult < 1.0) {
    warnings.push(`Historical win rate low — size reduced to ${(memoryMult * 100).toFixed(0)}%`);
  }

  // ── Step 5: Final Sizing ────────────────────────────────────────────────

  // For T9, skip the standard sizing — orchestrator uses fixed dollar sizing
  if (isType9) {
    // Keep existing fillableQuantity and approve
    logger.info({
      arbType: opp.arbType,
      ticker: opp.ticker_a,
      grossSpread: (opp.grossProfitPerContract * 100).toFixed(2) + '%',
      confidence: opp.confidence.toFixed(2),
    }, `[ArbBrain] APPROVED T9: ${opp.ticker_a} spread ${(opp.grossProfitPerContract * 100).toFixed(2)}%`);

    return decision('execute', opp, `Approved T9: ${opp.ticker_a} — ${(opp.grossProfitPerContract * 100).toFixed(2)}% spread`, opp.confidence, warnings, start);
  }

  const finalQty = calculateFinalSize(opp, validation, config, memoryMult);
  if (finalQty <= 0) {
    return decision('skip', opp, 'Final quantity too small after adjustments', 0, warnings, start);
  }

  // Update opportunity with final values
  opp.fillableQuantity = finalQty;
  opp.netProfitPerContract = validation.netProfit / finalQty;

  // ── Step 6: Approve ─────────────────────────────────────────────────────

  logger.info({
    arbType: opp.arbType,
    ticker: opp.ticker_a,
    qty: finalQty,
    netProfit: validation.netProfit.toFixed(2),
    confidence: opp.confidence.toFixed(2),
  }, `[ArbBrain] APPROVED: ${opp.arbType} — $${validation.netProfit.toFixed(2)} net profit`);

  return decision('execute', opp, `Approved: ${opp.arbType} — net $${validation.netProfit.toFixed(2)} (${finalQty} contracts)`, opp.confidence, warnings, start);
}

function decision(
  action: ArbDecision['action'],
  opp: ArbOpportunity,
  reasoning: string,
  confidence: number,
  warnings: string[],
  startMs: number,
): ArbDecision {
  return {
    action,
    reasoning,
    opportunity: opp,
    confidence,
    warnings,
    elapsedMs: Date.now() - startMs,
  };
}
