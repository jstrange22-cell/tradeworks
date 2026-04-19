/**
 * Robinhood Options — Thin Read Wrapper
 *
 * Provides paper-mode-friendly access to an options chain + single-contract
 * quotes. Live Robinhood options order submission is intentionally stubbed:
 * it throws unless `ENABLE_LIVE_OPTIONS === 'true'`.
 *
 * Paper fallback (synthetic chain):
 *   If Robinhood credentials are not present, `getOptionsChain` synthesises
 *   a chain from the underlying spot price using:
 *     - strikes at spot ±20% in $5 increments,
 *     - linear-interpolated delta (call delta ≈ 0.5 at ATM, 1.0 deep ITM, 0
 *       deep OTM; puts mirrored with negative sign),
 *     - IV assumed 35%,
 *     - bid/ask priced from a simplified Black–Scholes approximation.
 *   This is a DEVELOPMENT-MODE fallback for paper trades only. When real
 *   Robinhood auth is wired up this path should be replaced by live data.
 *
 * The shape returned here matches the `OptionChainLeg` interface expected by
 * `options-policy.ts::selectOptionContract`.
 */

import { logger } from '../../lib/logger.js';
import type { OptionChainLeg, OptionType } from '../stock-intelligence/options-policy.js';

const RH_USERNAME = process.env.ROBINHOOD_USERNAME ?? '';
const RH_PASSWORD = process.env.ROBINHOOD_PASSWORD ?? '';

// ── Public API ──────────────────────────────────────────────────────────

export interface OptionQuote {
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  iv: number;
}

/**
 * Fetch an options chain for `symbol`. If `expiry` is provided, only legs
 * for that expiry are returned.
 *
 * Real Robinhood options endpoints are not wired yet — this currently
 * returns a synthetic chain derived from the spot price so the stock-agent
 * can run end-to-end in paper mode. Callers must treat this output as
 * advisory until live integration lands.
 */
export async function getOptionsChain(
  symbol: string,
  expiry?: string,
): Promise<OptionChainLeg[]> {
  // Live Robinhood options integration not yet implemented. Fall through
  // to synthetic chain generation for paper mode.
  if (!RH_USERNAME || !RH_PASSWORD) {
    return synthesizeChain(symbol, expiry);
  }

  // TODO: real Robinhood options chain fetch. When implemented, auth must
  // flow through the existing credential store used by `routes/robinhood.ts`.
  logger.info({ symbol }, '[RobinhoodOptions] live chain fetch not implemented — using synthetic chain');
  return synthesizeChain(symbol, expiry);
}

/**
 * Fetch a single-contract quote by OCC symbol. Falls back to a synthetic
 * quote when Robinhood creds are missing.
 */
export async function getOptionQuote(occSymbol: string): Promise<OptionQuote> {
  if (!RH_USERNAME || !RH_PASSWORD) {
    return synthesizeQuoteFromOcc(occSymbol);
  }

  // TODO: real Robinhood per-contract quote fetch.
  logger.info({ occSymbol }, '[RobinhoodOptions] live quote fetch not implemented — using synthetic quote');
  return synthesizeQuoteFromOcc(occSymbol);
}

/**
 * Submit a live options order. GATED behind ENABLE_LIVE_OPTIONS=true.
 * This is intentionally not implemented — a stub exists so the module
 * surface is stable and callers can detect the feature-flag state up-front.
 */
export async function placeOptionOrder(_order: {
  occSymbol: string;
  side: 'buy' | 'sell';
  contracts: number;
  limitPrice?: number;
}): Promise<never> {
  if (process.env.ENABLE_LIVE_OPTIONS !== 'true') {
    throw new Error('live options not enabled');
  }
  // TODO: implement real Robinhood options order submission here, reusing
  // the JWT / ED25519 signing helpers from routes/robinhood.ts where
  // applicable. Live path must enforce per-order size caps and daily
  // drawdown kill-switches before sending anything.
  throw new Error('live options order submission is not implemented');
}

// ── Spot Price Sourcing ─────────────────────────────────────────────────

async function getSpotPrice(symbol: string): Promise<number> {
  try {
    const { getSnapshots } = await import('./alpaca-client.js');
    const snapshots = await getSnapshots([symbol]);
    const snap = snapshots[symbol];
    if (snap?.latestTrade?.p) return snap.latestTrade.p;
  } catch { /* fall through */ }
  return 0;
}

// ── Synthetic Chain / Quote Helpers ────────────────────────────────────

const SYNTHETIC_IV = 0.35;           // Assumed flat IV
const DEFAULT_RATE = 0.05;           // Risk-free rate for BS approximation
const STRIKE_STEP = 5;               // Dollar spacing between strikes
const STRIKE_RANGE_PCT = 0.20;       // ±20% strikes around spot

/**
 * Build a synthetic options chain around the current spot price for paper
 * trading. Generates call + put legs for a near-term and a ~30-DTE expiry.
 */
async function synthesizeChain(symbol: string, expiryFilter?: string): Promise<OptionChainLeg[]> {
  const spot = await getSpotPrice(symbol);
  if (!spot || spot <= 0) {
    logger.warn({ symbol }, '[RobinhoodOptions] cannot synthesize chain without spot price');
    return [];
  }

  const now = new Date();
  const expiries: string[] = [];
  // Include a near-term (~7 DTE) and a ~30 DTE expiry so both 0DTE-ish
  // scans and the policy-preferred 30 DTE pick can resolve.
  for (const dte of [7, 30]) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + dte);
    expiries.push(d.toISOString().slice(0, 10));
  }

  const legs: OptionChainLeg[] = [];
  const lowStrike = Math.floor((spot * (1 - STRIKE_RANGE_PCT)) / STRIKE_STEP) * STRIKE_STEP;
  const highStrike = Math.ceil((spot * (1 + STRIKE_RANGE_PCT)) / STRIKE_STEP) * STRIKE_STEP;

  for (const expiry of expiries) {
    if (expiryFilter && expiry !== expiryFilter) continue;
    const dte = Math.max(1, Math.round((new Date(expiry).getTime() - now.getTime()) / (24 * 3600 * 1000)));
    const t = dte / 365;

    for (let strike = lowStrike; strike <= highStrike; strike += STRIKE_STEP) {
      for (const type of ['call', 'put'] as OptionType[]) {
        const price = blackScholesPrice(spot, strike, t, SYNTHETIC_IV, DEFAULT_RATE, type);
        const delta = estimateDelta(spot, strike, type);
        const spread = Math.max(0.05, price * 0.04); // 4% spread, floor $0.05
        legs.push({
          occSymbol: buildOccSymbol(symbol, expiry, type, strike),
          strike,
          expiry,
          type,
          bid: Math.max(0.01, price - spread / 2),
          ask: Math.max(0.05, price + spread / 2),
          delta,
          iv: SYNTHETIC_IV,
        });
      }
    }
  }

  return legs;
}

/**
 * Parse an OCC symbol and rebuild a synthetic quote for it.
 * OCC format: ROOT + YYMMDD + C|P + STRIKE (8 digits, last 3 = thousandths).
 * Example: AAPL240517C00180000 → AAPL, 2024-05-17, call, $180.00
 */
async function synthesizeQuoteFromOcc(occSymbol: string): Promise<OptionQuote> {
  const parsed = parseOccSymbol(occSymbol);
  if (!parsed) {
    // Cannot parse — return a safe zero-quote rather than throwing.
    return { bid: 0, ask: 0, mid: 0, delta: 0, iv: SYNTHETIC_IV };
  }
  const { root, expiry, type, strike } = parsed;
  const spot = await getSpotPrice(root);
  if (!spot || spot <= 0) {
    return { bid: 0, ask: 0, mid: 0, delta: 0, iv: SYNTHETIC_IV };
  }
  const dte = Math.max(1, Math.round((new Date(expiry).getTime() - Date.now()) / (24 * 3600 * 1000)));
  const t = dte / 365;
  const price = blackScholesPrice(spot, strike, t, SYNTHETIC_IV, DEFAULT_RATE, type);
  const spread = Math.max(0.05, price * 0.04);
  const delta = estimateDelta(spot, strike, type);
  return {
    bid: Math.max(0.01, price - spread / 2),
    ask: Math.max(0.05, price + spread / 2),
    mid: price,
    delta,
    iv: SYNTHETIC_IV,
  };
}

/**
 * Black–Scholes European option price. Simplified (no dividends) — used
 * only for synthetic paper-mode pricing, NEVER for real risk decisions.
 */
function blackScholesPrice(
  spot: number,
  strike: number,
  t: number,
  iv: number,
  r: number,
  type: OptionType,
): number {
  if (t <= 0 || iv <= 0 || spot <= 0 || strike <= 0) return 0;
  const sigmaSqrtT = iv * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + (iv * iv) / 2) * t) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;
  if (type === 'call') {
    return spot * normCdf(d1) - strike * Math.exp(-r * t) * normCdf(d2);
  }
  return strike * Math.exp(-r * t) * normCdf(-d2) - spot * normCdf(-d1);
}

/** Abramowitz–Stegun approximation for Φ(x). */
function normCdf(x: number): number {
  // Rational approximation; accurate to ~1e-7.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const tt = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Estimate delta via a linear interpolation keyed off moneyness. Rough
 * enough to make the selection policy deterministic without requiring a
 * full Greeks engine for paper fills.
 */
function estimateDelta(spot: number, strike: number, type: OptionType): number {
  const moneyness = spot / strike;
  // Clamp: 0.80 → deep OTM (delta ~0.1), 1.00 → ATM (~0.5), 1.20 → deep ITM (~0.9)
  let callDelta = 0.50 + (moneyness - 1) * 2.0;
  callDelta = Math.max(0.05, Math.min(0.95, callDelta));
  return type === 'call' ? callDelta : -(1 - callDelta);
}

/** Build an OCC-formatted symbol: ROOT + YYMMDD + C|P + STRIKE(8). */
function buildOccSymbol(root: string, expiry: string, type: OptionType, strike: number): string {
  const y = expiry.slice(2, 4);
  const m = expiry.slice(5, 7);
  const d = expiry.slice(8, 10);
  const cp = type === 'call' ? 'C' : 'P';
  const strikeInt = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${root}${y}${m}${d}${cp}${strikeInt}`;
}

function parseOccSymbol(occ: string): { root: string; expiry: string; type: OptionType; strike: number } | null {
  // ROOT is 1–6 alphabetic chars. Date is 6 digits, then C or P, then 8 digits.
  const match = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(occ);
  if (!match) return null;
  const [, root, yy, mm, dd, cp, strikeRaw] = match;
  const expiry = `20${yy}-${mm}-${dd}`;
  const type: OptionType = cp === 'C' ? 'call' : 'put';
  const strike = Number(strikeRaw) / 1000;
  return { root, expiry, type, strike };
}
