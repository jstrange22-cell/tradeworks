/**
 * Portfolio Heat — Real-Time Risk Scoring
 *
 * Calculates a 0-100 risk score based on exposure, position count,
 * drawdown severity, and concentration risk. Used by the Kelly Criterion
 * module to scale down position sizes when risk is elevated.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface PortfolioHeatFactors {
  /** Total position value / wallet balance (0-100) */
  exposurePct: number;
  /** Raw count of open positions */
  positionCount: number;
  /** Average unrealized P&L % across positions */
  avgPnlPercent: number;
  /** Worst single position P&L % */
  maxDrawdown: number;
  /** Largest position as % of total exposure */
  concentrationRisk: number;
}

export interface PortfolioHeat {
  /** Overall risk score 0-100 (100 = maximum risk) */
  score: number;
  factors: PortfolioHeatFactors;
  recommendation: 'increase' | 'maintain' | 'reduce' | 'stop';
}

export interface PositionSnapshot {
  buyCostSol: number;
  pnlPercent: number;
  currentValueSol: number;
}

export interface PortfolioHeatParams {
  walletBalanceSol: number;
  positions: PositionSnapshot[];
}

// ── Scoring Weights ───────────────────────────────────────────────────

const WEIGHT_EXPOSURE = 0.30;
const WEIGHT_COUNT = 0.20;
const WEIGHT_DRAWDOWN = 0.25;
const WEIGHT_CONCENTRATION = 0.25;

// ── Score Helpers ─────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Exposure % → heat score (0-100). Linear: 0% exposure = 0, 100% = 100 */
function scoreExposure(exposurePct: number): number {
  return clamp(exposurePct, 0, 100);
}

/** Position count → heat score. 0 = 0, 3 = 30, 5 = 50, 10 = 100 */
function scorePositionCount(count: number): number {
  return clamp((count / 10) * 100, 0, 100);
}

/**
 * Drawdown score based on worst position P&L.
 * +50% = 0 heat, 0% = 50 heat, -50% = 100 heat
 * Inverted: better P&L = lower heat
 */
function scoreDrawdown(worstPnlPercent: number): number {
  // Map from [-50, +50] → [100, 0]
  const normalized = 50 - worstPnlPercent;
  return clamp(normalized, 0, 100);
}

/** Concentration: largest position as % of total exposure → heat score */
function scoreConcentration(concentrationPct: number): number {
  // <30% = 0 heat, >70% = 100 heat
  if (concentrationPct <= 30) return 0;
  if (concentrationPct >= 70) return 100;
  // Linear interpolation between 30% and 70%
  return ((concentrationPct - 30) / 40) * 100;
}

function deriveRecommendation(score: number): PortfolioHeat['recommendation'] {
  if (score <= 30) return 'increase';
  if (score <= 60) return 'maintain';
  if (score <= 80) return 'reduce';
  return 'stop';
}

// ── Calculator ────────────────────────────────────────────────────────

export function calculatePortfolioHeat(params: PortfolioHeatParams): PortfolioHeat {
  const { walletBalanceSol, positions } = params;

  // Edge case: empty portfolio
  if (positions.length === 0) {
    return {
      score: 0,
      factors: {
        exposurePct: 0,
        positionCount: 0,
        avgPnlPercent: 0,
        maxDrawdown: 0,
        concentrationRisk: 0,
      },
      recommendation: 'increase',
    };
  }

  // Edge case: zero wallet balance — max risk
  if (walletBalanceSol <= 0) {
    return {
      score: 100,
      factors: {
        exposurePct: 100,
        positionCount: positions.length,
        avgPnlPercent: 0,
        maxDrawdown: 0,
        concentrationRisk: 100,
      },
      recommendation: 'stop',
    };
  }

  // ── Calculate factors ──
  const totalExposure = positions.reduce((sum, p) => sum + p.currentValueSol, 0);
  const exposurePct = (totalExposure / walletBalanceSol) * 100;

  const pnlValues = positions.map((p) => p.pnlPercent);
  const avgPnlPercent = pnlValues.reduce((sum, v) => sum + v, 0) / pnlValues.length;
  const maxDrawdown = Math.min(...pnlValues); // worst P&L (most negative)

  const largestPosition = Math.max(...positions.map((p) => p.currentValueSol));
  const concentrationRisk = totalExposure > 0
    ? (largestPosition / totalExposure) * 100
    : 0;

  // ── Weighted score ──
  const exposureScore = scoreExposure(exposurePct) * WEIGHT_EXPOSURE;
  const countScore = scorePositionCount(positions.length) * WEIGHT_COUNT;
  const drawdownScore = scoreDrawdown(maxDrawdown) * WEIGHT_DRAWDOWN;
  const concentrationScore = scoreConcentration(concentrationRisk) * WEIGHT_CONCENTRATION;

  const score = clamp(
    Math.round(exposureScore + countScore + drawdownScore + concentrationScore),
    0,
    100,
  );

  return {
    score,
    factors: {
      exposurePct: Math.round(exposurePct * 100) / 100,
      positionCount: positions.length,
      avgPnlPercent: Math.round(avgPnlPercent * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      concentrationRisk: Math.round(concentrationRisk * 100) / 100,
    },
    recommendation: deriveRecommendation(score),
  };
}
