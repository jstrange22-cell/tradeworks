/**
 * Kelly Criterion Position Sizer — Shared by Arb + Sports
 *
 * Quarter-Kelly by default (fraction=0.25).
 * Adjusts size based on edge, probability, and bankroll.
 */

// ── Kelly Criterion ─────────────────────────────────────────────────────

/**
 * Full Kelly: f* = (bp - q) / b
 * Where: b = decimal odds - 1, p = win probability, q = 1 - p
 *
 * Quarter-Kelly (fraction=0.25) is recommended for real trading.
 */
export function kellySize(params: {
  winProb: number;          // True probability of winning (0-1)
  decimalOdds: number;      // Decimal odds offered
  bankroll: number;         // Current bankroll
  fraction?: number;        // Kelly fraction (0.25 = quarter-Kelly)
  maxBetPct?: number;       // Max % of bankroll per bet (default 5%)
}): number {
  const { winProb, decimalOdds, bankroll, fraction = 0.25, maxBetPct = 0.05 } = params;

  if (winProb <= 0 || winProb >= 1 || decimalOdds <= 1 || bankroll <= 0) return 0;

  const b = decimalOdds - 1;
  const q = 1 - winProb;
  const fullKelly = (b * winProb - q) / b;

  // Negative Kelly = negative EV → don't bet
  if (fullKelly <= 0) return 0;

  const adjustedKelly = fullKelly * fraction;
  const maxBet = bankroll * maxBetPct;

  return Math.min(adjustedKelly * bankroll, maxBet);
}

// ── Engine-Specific Caps ────────────────────────────────────────────────

const ENGINE_CAPS: Record<string, number> = {
  // Arb engines
  A1: 300, A2: 300, A3: 500, A4: 300, A5: 200, A6: 200, A7: 150,
  // Sports engines
  S1: 200, S2: 300, S3: 200, S4: 150, S5: 100, S6: 150,
};

export function getEngineCap(engine: string): number {
  return ENGINE_CAPS[engine] ?? 100;
}

/**
 * Calculate final bet size with all constraints applied.
 */
export function calculateBetSize(params: {
  winProb: number;
  decimalOdds: number;
  bankroll: number;
  engine: string;
  kellyFraction?: number;
  sizeMultiplier?: number;  // From memory/learning adjustments
}): { size: number; kellyPct: number; capped: boolean; reason: string } {
  const { winProb, decimalOdds, bankroll, engine, kellyFraction = 0.25, sizeMultiplier = 1.0 } = params;

  let size = kellySize({ winProb, decimalOdds, bankroll, fraction: kellyFraction });

  // Apply memory-based multiplier
  size *= sizeMultiplier;

  // Apply engine cap
  const cap = getEngineCap(engine);
  const capped = size > cap;
  size = Math.min(size, cap);

  // Round to nearest $5 for anti-limiting
  size = Math.round(size / 5) * 5;

  // Minimum bet $5
  if (size < 5) size = 0;

  const b = decimalOdds - 1;
  const q = 1 - winProb;
  const fullKelly = (b * winProb - q) / b;

  return {
    size,
    kellyPct: fullKelly * 100,
    capped,
    reason: size > 0
      ? `Kelly ${(fullKelly * 100).toFixed(1)}% × ${kellyFraction} = $${size} (cap: $${cap})`
      : `Kelly negative or below minimum — no bet`,
  };
}
