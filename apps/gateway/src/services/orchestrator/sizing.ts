/**
 * Quant sizing — vol-budgeted, ATR-distance, fractional-Kelly position sizing.
 *
 * Replaces the legacy grade-tier dollar sizing in
 * `services/stock-intelligence/sizing.ts`. See sizing-types.ts for the public
 * types and a high-level diagram of the sizing flow.
 *
 * Algorithm
 * ─────────
 *   1. portfolioBudget = getStrategyVolBudget(strategy)
 *      Falls back to { budgetUsd: equity * 10%, scalar: 1.0 } if D1's
 *      vol-target module hasn't shipped yet.
 *   2. banditWeight = getBanditWeight(strategy)
 *      Returns 1/N when the bandit weights file isn't loaded.
 *   3. strategyBudgetUsd = portfolioBudget.budgetUsd
 *      The vol-target module already multiplies by banditWeight upstream;
 *      we expose `banditWeight` here purely for telemetry.
 *   4. Read calibration.json:
 *        winRate     ← byStrategy[strategy].winRate     | 0.5
 *        avgR        ← byStrategy[strategy].avgRMultiple | 1.0
 *        kelly_full  = winRate - (1 - winRate) / avgR
 *        kelly_frac  = clamp(0, 0.5) of (kelly_full × 0.5)   // half-Kelly cap
 *   5. riskPerTradePct = 0.5% × (1 + kelly_frac)
 *      Base 0.5% scales up to 1.5% with strong calibration evidence.
 *   6. stopDistanceUsd = |entryPrice - stopPrice|.
 *      Stopless trades return zero quantity with a warning.
 *   7. recommendedRiskUsd = strategyBudgetUsd × riskPerTradePct
 *      Skipped (zero qty) if recommendedRiskUsd < $5.
 *   8. recommendedQuantity = floor(recommendedRiskUsd / stopDistanceUsd).
 *      For options: round to whole contracts (multiplier 100); zero if budget
 *      can't cover one contract.
 *   9. Hard cap: notional ≤ 5% of equity. Quantity scaled down proportionally
 *      if it would exceed the cap.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../lib/logger.js';
import { getBanditWeight } from './bandit-runner.js';
import type { SizingInputs, SizingResult } from './sizing-types.js';

// ── Constants ───────────────────────────────────────────────────────────

const BASE_RISK_PER_TRADE_PCT = 0.025;   // 2.5% of strategy budget at neutral Kelly (was 0.5% — produced $50 risk/$1K positions on $100K; now produces $250 risk/$5K positions)
const KELLY_FRACTION_CAP = 0.5;          // half-Kelly safety cap
const KELLY_RISK_BOOST = 1.0;            // risk = base × (1 + KELLY_RISK_BOOST × kelly_fraction)
const POSITION_CAP_PCT = 0.10;           // no single position > 10% of equity (was 5% — now allows prime signals up to $10K on $100K account)
const MIN_RISK_USD = 5;                  // skip trades smaller than $5 of risk
const DEFAULT_PORTFOLIO_BUDGET_PCT = 0.10; // 10% of equity when vol-target is missing
const NEUTRAL_WIN_RATE = 0.5;
const NEUTRAL_AVG_R = 1.0;
const OPTION_CONTRACT_MULTIPLIER = 100;

// ── Calibration cache (read-through with TTL) ───────────────────────────

const CALIBRATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let calibrationCache: { loadedAt: number; report: CalibrationFile | null } = {
  loadedAt: 0,
  report: null,
};

interface CalibrationStrategyRow {
  bucketKey: string;
  n: number;
  winRate: number;
  avgRMultiple: number;
  expectancyUsd: number;
}

interface CalibrationFile {
  generatedAt: string;
  windowDays: number;
  totalApproves: number;
  byStrategy: CalibrationStrategyRow[];
}

function calibrationFilePath(): string {
  // src/services/orchestrator/sizing.ts → apps/gateway/data/calibration.json
  const here = dirname(fileURLToPath(import.meta.url));
  const services = dirname(here);
  const srcOrDist = dirname(services);
  const gatewayRoot = dirname(srcOrDist);
  return resolve(gatewayRoot, 'data', 'calibration.json');
}

function loadCalibration(): CalibrationFile | null {
  const now = Date.now();
  if (calibrationCache.report && now - calibrationCache.loadedAt < CALIBRATION_CACHE_TTL_MS) {
    return calibrationCache.report;
  }
  try {
    const raw = readFileSync(calibrationFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CalibrationFile>;
    if (!parsed || !Array.isArray(parsed.byStrategy)) {
      calibrationCache = { loadedAt: now, report: null };
      return null;
    }
    const report: CalibrationFile = {
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
      windowDays: typeof parsed.windowDays === 'number' ? parsed.windowDays : 0,
      totalApproves: typeof parsed.totalApproves === 'number' ? parsed.totalApproves : 0,
      byStrategy: parsed.byStrategy as CalibrationStrategyRow[],
    };
    calibrationCache = { loadedAt: now, report };
    return report;
  } catch {
    calibrationCache = { loadedAt: now, report: null };
    return null;
  }
}

/**
 * Test-only helper — clears the calibration cache so tests can rewrite the
 * file between assertions. Not exported in the production barrel.
 */
export function __resetSizingCachesForTests(): void {
  calibrationCache = { loadedAt: 0, report: null };
}

// ── Vol-target shim (D1) ───────────────────────────────────────────────

interface VolBudget {
  budgetUsd: number;
  realizedVolAnnualizedPct: number;
  /** Portfolio-level risk-on/off scalar in [scalarMin, scalarMax]. */
  scalar: number;
  banditWeight: number;
}

async function getVolBudget(
  strategy: string,
  totalEquityUsd: number,
): Promise<VolBudget | null> {
  // Defensive dynamic import: vol-target.ts may not exist when this module is
  // first introduced (parallel agent D1). When missing, return null and let
  // the caller fall back to the equity-percent default.
  try {
    const mod = (await import('./vol-target.js' as string)) as Partial<{
      getStrategyVolBudget: (
        s: string,
        cfg?: { totalEquityUsd?: number },
      ) => Promise<{
        strategy: string;
        banditWeight: number;
        realizedVolAnnualizedPct: number;
        budgetUsd: number;
      }>;
      getPortfolioVolBudget: (cfg?: { totalEquityUsd?: number }) => Promise<{
        scalar: number;
        realizedVolAnnualizedPct: number;
      }>;
    }>;
    if (
      typeof mod.getStrategyVolBudget !== 'function' ||
      typeof mod.getPortfolioVolBudget !== 'function'
    ) {
      return null;
    }
    // Pass totalEquityUsd through so the vol-target module sizes the budget
    // off the live account equity rather than its env/default.
    const [strategyBudget, portfolioBudget] = await Promise.all([
      mod.getStrategyVolBudget(strategy, { totalEquityUsd }),
      mod.getPortfolioVolBudget({ totalEquityUsd }),
    ]);
    if (
      !strategyBudget ||
      typeof strategyBudget.budgetUsd !== 'number' ||
      !Number.isFinite(strategyBudget.budgetUsd)
    ) {
      return null;
    }
    return {
      budgetUsd: strategyBudget.budgetUsd,
      realizedVolAnnualizedPct:
        typeof strategyBudget.realizedVolAnnualizedPct === 'number'
          ? strategyBudget.realizedVolAnnualizedPct
          : 0,
      scalar: typeof portfolioBudget?.scalar === 'number' ? portfolioBudget.scalar : 1.0,
      banditWeight:
        typeof strategyBudget.banditWeight === 'number' ? strategyBudget.banditWeight : 1.0,
    };
  } catch {
    // Module not present (or import error) — silently fall back.
    return null;
  }
}

// ── Kelly math ──────────────────────────────────────────────────────────

interface KellyOutput {
  kellyFraction: number;
  winRate: number;
  avgR: number;
  /** True if calibration data was used; false if neutral defaults applied. */
  usedCalibration: boolean;
  sampleSize: number;
}

function computeKellyFraction(strategy: string): KellyOutput {
  const cal = loadCalibration();
  if (!cal || cal.byStrategy.length === 0) {
    return {
      kellyFraction: 0,
      winRate: NEUTRAL_WIN_RATE,
      avgR: NEUTRAL_AVG_R,
      usedCalibration: false,
      sampleSize: 0,
    };
  }
  const row = cal.byStrategy.find((r) => r.bucketKey === strategy);
  if (!row || row.n <= 0) {
    return {
      kellyFraction: 0,
      winRate: NEUTRAL_WIN_RATE,
      avgR: NEUTRAL_AVG_R,
      usedCalibration: false,
      sampleSize: 0,
    };
  }
  // Guard against degenerate values from bucket aggregation.
  const winRate = clamp(row.winRate, 0, 1);
  const avgR = row.avgRMultiple > 0 ? row.avgRMultiple : NEUTRAL_AVG_R;
  // Kelly: f* = winRate - (1 - winRate) / avgR
  const kellyFull = winRate - (1 - winRate) / avgR;
  // Half-Kelly, clamped to [0, KELLY_FRACTION_CAP].
  const halfKelly = kellyFull * 0.5;
  const kellyFraction = clamp(halfKelly, 0, KELLY_FRACTION_CAP);
  return {
    kellyFraction,
    winRate,
    avgR,
    usedCalibration: true,
    sampleSize: row.n,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// ── Public API ──────────────────────────────────────────────────────────

const ZERO_RESULT = (
  warnings: string[],
  breakdown: SizingResult['breakdown'],
): SizingResult => ({
  recommendedQuantity: 0,
  recommendedNotionalUsd: 0,
  recommendedRiskUsd: 0,
  breakdown,
  warnings,
});

export async function computePositionSize(inputs: SizingInputs): Promise<SizingResult> {
  const warnings: string[] = [];
  const {
    strategy,
    symbol,
    side,
    entryPrice,
    stopPrice,
    totalEquityUsd,
    isOption = false,
  } = inputs;

  // ── input sanity ─────────────────────────────────────────────────────
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return ZERO_RESULT(['invalid entryPrice'], emptyBreakdown(totalEquityUsd));
  }
  if (!Number.isFinite(totalEquityUsd) || totalEquityUsd <= 0) {
    return ZERO_RESULT(['invalid totalEquityUsd'], emptyBreakdown(totalEquityUsd));
  }
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) {
    return ZERO_RESULT(['invalid stopPrice'], emptyBreakdown(totalEquityUsd));
  }

  const stopDistanceUsd = Math.abs(entryPrice - stopPrice);
  if (stopDistanceUsd <= 0) {
    warnings.push('stopless trade — cannot size without a stop distance');
    return ZERO_RESULT(warnings, emptyBreakdown(totalEquityUsd));
  }

  // ── 0. Regime crisis gate ────────────────────────────────────────────
  // When the orchestrator regime classifier reports `crisis`, sizing returns
  // zero quantity. This is a hard stop on new entries — only manual override
  // (BANDIT_OVERRIDE / direct executor) can bypass. Logged loudly so the
  // post-mortem trail is unambiguous about why a signal was sized to zero.
  // Dynamic import keeps this safe if regime.ts is ever toggled off.
  try {
    const regimeMod = await import('./regime.js');
    const regime = await regimeMod.getCurrentRegime();
    if (regimeMod.isCrisisGate(regime.tag)) {
      warnings.push(
        `regime gate: ${regime.tag} (confidence=${regime.confidence.toFixed(2)}) — zero size`,
      );
      logger.warn(
        { strategy, symbol, side, regime: regime.tag, confidence: regime.confidence, rationale: regime.rationale },
        '[sizing] crisis regime — zero quantity returned',
      );
      return ZERO_RESULT(warnings, emptyBreakdown(totalEquityUsd));
    }
  } catch (err) {
    // Regime fetch failure is non-fatal — proceed with sizing. A flaky
    // regime feed should not freeze trading entirely.
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[sizing] regime check failed — proceeding without crisis gate',
    );
  }

  // ── 1. portfolio vol budget ─────────────────────────────────────────
  const volBudget = await getVolBudget(strategy, totalEquityUsd);
  let strategyBudgetUsd: number;
  let portfolioVolScalar: number;
  // Bandit weight is reported in the breakdown for telemetry. When vol-target
  // is available it already multiplied the weight into budgetUsd; when it's
  // missing we fold the weight into the fallback budget here.
  let banditWeight = 1.0;
  if (volBudget) {
    strategyBudgetUsd = volBudget.budgetUsd;
    portfolioVolScalar = volBudget.scalar;
    banditWeight = volBudget.banditWeight;
  } else {
    try {
      banditWeight = getBanditWeight(strategy);
    } catch {
      warnings.push('bandit weight read failed — assuming 1.0');
    }
    // Fold bandit weight into the fallback budget so a single strategy can't
    // claim 100% of equity when the vol-target module is offline.
    strategyBudgetUsd = totalEquityUsd * DEFAULT_PORTFOLIO_BUDGET_PCT * banditWeight;
    portfolioVolScalar = 1.0;
    warnings.push('vol-target unavailable — using default 10% of equity × bandit weight');
  }

  // ── 3. Kelly fraction from calibration ──────────────────────────────
  const kelly = computeKellyFraction(strategy);
  if (!kelly.usedCalibration) {
    warnings.push('no calibration data — used neutral Kelly = 0');
  }

  // ── 4. risk-per-trade % (0.5% base, scaled by Kelly) ────────────────
  const riskPerTradePct = BASE_RISK_PER_TRADE_PCT * (1 + KELLY_RISK_BOOST * kelly.kellyFraction);

  // ── 5. risk dollars ─────────────────────────────────────────────────
  const recommendedRiskUsd = strategyBudgetUsd * riskPerTradePct;
  const stopDistancePct = stopDistanceUsd / entryPrice;
  const maxPositionCapUsd = totalEquityUsd * POSITION_CAP_PCT;

  const breakdown: SizingResult['breakdown'] = {
    strategyBudgetUsd,
    banditWeight,
    portfolioVolScalar,
    riskPerTradePct,
    stopDistancePct,
    kellyFraction: kelly.kellyFraction,
    maxPositionCapUsd,
  };

  if (recommendedRiskUsd < MIN_RISK_USD) {
    warnings.push(
      `strategy budget too small — risk $${recommendedRiskUsd.toFixed(2)} below $${MIN_RISK_USD.toFixed(2)} floor`,
    );
    return ZERO_RESULT(warnings, breakdown);
  }

  // ── 6. raw quantity from risk / stop-distance ───────────────────────
  let quantity: number;
  let notionalUsd: number;

  if (isOption) {
    // Each contract carries 100 shares of risk. Stop distance is per-share
    // (typically 50% of premium, set by caller).
    const perContractRiskUsd = stopDistanceUsd * OPTION_CONTRACT_MULTIPLIER;
    const perContractNotionalUsd = entryPrice * OPTION_CONTRACT_MULTIPLIER;
    if (perContractRiskUsd <= 0 || perContractNotionalUsd <= 0) {
      warnings.push('invalid option contract economics');
      return ZERO_RESULT(warnings, breakdown);
    }
    quantity = Math.floor(recommendedRiskUsd / perContractRiskUsd);
    notionalUsd = quantity * perContractNotionalUsd;
  } else {
    quantity = Math.floor(recommendedRiskUsd / stopDistanceUsd);
    notionalUsd = quantity * entryPrice;
  }

  // ── 7. position cap (5% of equity) ──────────────────────────────────
  let cappedNotional = notionalUsd;
  if (notionalUsd > maxPositionCapUsd) {
    cappedNotional = maxPositionCapUsd;
    if (isOption) {
      const perContractNotionalUsd = entryPrice * OPTION_CONTRACT_MULTIPLIER;
      quantity = Math.floor(maxPositionCapUsd / perContractNotionalUsd);
      cappedNotional = quantity * perContractNotionalUsd;
    } else {
      quantity = Math.floor(maxPositionCapUsd / entryPrice);
      cappedNotional = quantity * entryPrice;
    }
    warnings.push(
      `position scaled down to 5% of equity cap ($${maxPositionCapUsd.toFixed(0)})`,
    );
  }

  // ── 8. floor: at least one share / contract ─────────────────────────
  if (quantity < 1) {
    warnings.push('budget too small — fewer than one whole share/contract');
    return ZERO_RESULT(warnings, breakdown);
  }

  // ── 9. final risk computed on actual filled quantity ────────────────
  const finalRiskUsd = isOption
    ? quantity * stopDistanceUsd * OPTION_CONTRACT_MULTIPLIER
    : quantity * stopDistanceUsd;

  // ── 10. structured log line ─────────────────────────────────────────
  logger.info(
    {
      strategy,
      symbol,
      side,
      entry: entryPrice,
      stop: stopPrice,
      budget: strategyBudgetUsd,
      kelly: kelly.kellyFraction,
      risk_pct: riskPerTradePct,
      qty: quantity,
      notional: cappedNotional,
      cap: maxPositionCapUsd,
      bandit: banditWeight,
      vol_scalar: portfolioVolScalar,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    `[sizing] strategy=${strategy} symbol=${symbol} side=${side} entry=${entryPrice.toFixed(2)} stop=${stopPrice.toFixed(2)} budget=$${strategyBudgetUsd.toFixed(0)} kelly=${kelly.kellyFraction.toFixed(2)} risk=${(riskPerTradePct * 100).toFixed(2)}% qty=${quantity} notional=$${cappedNotional.toFixed(0)} cap=$${maxPositionCapUsd.toFixed(0)} OK`,
  );

  return {
    recommendedQuantity: quantity,
    recommendedNotionalUsd: cappedNotional,
    recommendedRiskUsd: finalRiskUsd,
    breakdown,
    warnings,
  };
}

function emptyBreakdown(totalEquityUsd: number): SizingResult['breakdown'] {
  return {
    strategyBudgetUsd: 0,
    banditWeight: 0,
    portfolioVolScalar: 1.0,
    riskPerTradePct: 0,
    stopDistancePct: 0,
    kellyFraction: 0,
    maxPositionCapUsd: Number.isFinite(totalEquityUsd) && totalEquityUsd > 0
      ? totalEquityUsd * POSITION_CAP_PCT
      : 0,
  };
}
