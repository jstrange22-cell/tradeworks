/**
 * EV Calculator — Expected Value + De-Vig + Odds Conversion
 *
 * Core math for all sports betting engines.
 * De-vigs Pinnacle (sharp) lines to get true probabilities.
 * Compares against soft book odds to find +EV.
 */

import type { EVResult } from './sports-models.js';

// ── Odds Conversion ─────────────────────────────────────────────────────

export function americanToDecimal(american: number): number {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function decimalToImpliedProb(decimal: number): number {
  return decimal > 0 ? 1 / decimal : 0;
}

export function impliedProbToDecimal(prob: number): number {
  return prob > 0 ? 1 / prob : 0;
}

// ── De-Vig (Remove Bookmaker Margin) ────────────────────────────────────

/**
 * De-vig a 2-way market using multiplicative method.
 * Input: American odds for both sides.
 * Output: True probabilities (sum to 1.0).
 */
export function deVig2Way(homeAmerican: number, awayAmerican: number): {
  trueHome: number;
  trueAway: number;
  totalVig: number;
} {
  const homeDecimal = americanToDecimal(homeAmerican);
  const awayDecimal = americanToDecimal(awayAmerican);
  const impliedHome = 1 / homeDecimal;
  const impliedAway = 1 / awayDecimal;
  const total = impliedHome + impliedAway;
  const vig = (total - 1) * 100; // Vig as percentage

  return {
    trueHome: impliedHome / total,
    trueAway: impliedAway / total,
    totalVig: Math.round(vig * 100) / 100,
  };
}

/**
 * De-vig a 3-way market (e.g., soccer: home/draw/away).
 */
export function deVig3Way(homeAmerican: number, drawAmerican: number, awayAmerican: number): {
  trueHome: number;
  trueDraw: number;
  trueAway: number;
} {
  const hd = americanToDecimal(homeAmerican);
  const dd = americanToDecimal(drawAmerican);
  const ad = americanToDecimal(awayAmerican);
  const ih = 1 / hd;
  const id = 1 / dd;
  const ia = 1 / ad;
  const total = ih + id + ia;
  return { trueHome: ih / total, trueDraw: id / total, trueAway: ia / total };
}

// ── +EV Calculation ─────────────────────────────────────────────────────

/**
 * Calculate Expected Value of a bet.
 * trueProb: de-vigged probability from sharp book (Pinnacle)
 * softBookDecimal: decimal odds from soft book (DraftKings, FanDuel, etc.)
 * Returns: EV as decimal (0.05 = 5% +EV)
 */
export function calculateEV(trueProb: number, softBookDecimal: number): number {
  return (trueProb * softBookDecimal) - 1;
}

/**
 * Full +EV analysis: de-vig Pinnacle, compare to soft book.
 */
export function analyzeEV(params: {
  pinnacleHome: number;      // Pinnacle home American odds
  pinnacleAway: number;      // Pinnacle away American odds
  softBookOdds: number;      // Soft book American odds for the side we're betting
  side: 'home' | 'away';
  minEvPct?: number;         // Minimum EV% to be profitable (default 3%)
}): EVResult {
  const { pinnacleHome, pinnacleAway, softBookOdds, side, minEvPct = 0.03 } = params;

  const deVigged = deVig2Way(pinnacleHome, pinnacleAway);
  const trueProb = side === 'home' ? deVigged.trueHome : deVigged.trueAway;
  const softDecimal = americanToDecimal(softBookOdds);
  const pinnDecimal = side === 'home' ? americanToDecimal(pinnacleHome) : americanToDecimal(pinnacleAway);
  const evPct = calculateEV(trueProb, softDecimal);

  if (evPct < minEvPct) {
    return {
      profitable: false,
      evPct,
      trueProb,
      softBookDecimal: softDecimal,
      pinnacleDecimal: pinnDecimal,
      edge: evPct,
      reason: `EV ${(evPct * 100).toFixed(1)}% < min ${(minEvPct * 100).toFixed(1)}%`,
    };
  }

  return {
    profitable: true,
    evPct,
    trueProb,
    softBookDecimal: softDecimal,
    pinnacleDecimal: pinnDecimal,
    edge: evPct,
    reason: `+EV ${(evPct * 100).toFixed(1)}% against Pinnacle benchmark`,
  };
}

// ── Sportsbook Vig Extraction ───────────────────────────────────────────

export function extractVig(homeAmerican: number, awayAmerican: number): number {
  const homeDecimal = americanToDecimal(homeAmerican);
  const awayDecimal = americanToDecimal(awayAmerican);
  const total = (1 / homeDecimal) + (1 / awayDecimal);
  return (total - 1) * 100; // Vig as percentage
}
