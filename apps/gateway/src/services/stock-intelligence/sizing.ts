/**
 * Volatility-Adjusted Position Sizer
 *
 * Computes per-trade position size using:
 *   position_size_usd = (account × risk%) / stop_distance%
 *
 * where:
 *   - risk% comes from the signal grade (standard / strong / prime)
 *   - stop_distance% is (ATR × 2 / entry) when ATR is provided,
 *     otherwise a flat 5% fallback
 *
 * Position is capped at 10% of the account for equities, 5% for options,
 * so no single signal can dominate the book.
 */

import type { StockAgentSignal } from './stock-agent.js';

export interface SizingInput {
  accountUsd: number;
  grade: StockAgentSignal['grade'];
  entryPrice: number;
  atr?: number;           // 14-day ATR (from Alpaca bars). Optional.
  isOption?: boolean;
}

export interface SizingOutput {
  positionSizeUsd: number;
  /**
   * For equities: number of shares (fractional, 4-dp).
   * For options: number of contracts (integer, max 5).
   */
  shares: number;
  stopLossPrice: number;
  riskPct: number;
}

// Risk-per-trade by grade. Reject gets 0 so sizing returns zero work.
const RISK_PCT_BY_GRADE: Record<StockAgentSignal['grade'], number> = {
  standard: 0.005,   // 0.5%
  strong:   0.01,    // 1%
  prime:    0.02,    // 2%
  reject:   0,
};

const FLAT_STOP_DISTANCE_PCT = 0.05;   // 5% fallback stop distance
const EQUITY_POSITION_CAP_PCT = 0.10;  // max 10% of account on any single equity
const OPTION_POSITION_CAP_PCT = 0.05;  // max 5% of account on any single option
const MAX_OPTION_CONTRACTS = 5;        // hard cap on contracts per trade
const ATR_MULTIPLIER = 2;              // stop = 2 × ATR from entry

export function computePositionSize(input: SizingInput): SizingOutput {
  const { accountUsd, grade, entryPrice, atr, isOption } = input;

  const riskPct = RISK_PCT_BY_GRADE[grade] ?? 0;
  if (riskPct <= 0 || accountUsd <= 0 || entryPrice <= 0) {
    return { positionSizeUsd: 0, shares: 0, stopLossPrice: 0, riskPct: 0 };
  }

  // Stop distance as a fraction of entry price.
  // Options always use flat 5% (ATR on the option premium is not reliable).
  let stopDistancePct = FLAT_STOP_DISTANCE_PCT;
  if (!isOption && atr && atr > 0) {
    stopDistancePct = (atr * ATR_MULTIPLIER) / entryPrice;
    // Guard against absurd values: clamp to [2%, 15%].
    if (stopDistancePct < 0.02) stopDistancePct = 0.02;
    if (stopDistancePct > 0.15) stopDistancePct = 0.15;
  }

  // Risk-normalized position size.
  let positionSizeUsd = (accountUsd * riskPct) / stopDistancePct;

  // Cap at portfolio-level per-position ceiling.
  const cap = isOption
    ? accountUsd * OPTION_POSITION_CAP_PCT
    : accountUsd * EQUITY_POSITION_CAP_PCT;
  if (positionSizeUsd > cap) positionSizeUsd = cap;

  let shares: number;
  if (isOption) {
    // Options: contracts = min(5, floor(size / (mid * 100))).
    const perContractCost = entryPrice * 100;
    const raw = Math.floor(positionSizeUsd / perContractCost);
    shares = Math.max(0, Math.min(MAX_OPTION_CONTRACTS, raw));
  } else {
    // Equity: fractional shares with 4-dp precision (matches existing
    // stock-agent behavior).
    shares = Math.floor((positionSizeUsd / entryPrice) * 10000) / 10000;
  }

  const stopLossPrice = isOption
    ? entryPrice * (1 - FLAT_STOP_DISTANCE_PCT)
    : entryPrice * (1 - stopDistancePct);

  return {
    positionSizeUsd,
    shares,
    stopLossPrice,
    riskPct,
  };
}
