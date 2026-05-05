"""Black-Scholes option pricing + put credit spread mechanics.

Pure functions — no I/O, no globals. Used by `signal.py` to size the spread on
entry and by `run.py` to revalue the spread each bar for exit logic.

We use the standard European-option BS formulas. American early-exercise on
short puts is *possible* near expiration when ITM, but in practice the time-stop
at 21 DTE plus the 50% profit-take exit eliminates most of that risk before it
becomes material. For research-grade fidelity this is the right level.

References:
  - Hull, "Options, Futures, and Other Derivatives" (10e), Ch. 15 (BS).
  - Natenberg, "Option Volatility & Pricing", Ch. 18 (vertical spreads).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.stats import norm

# Floor on time-to-expiry (years) — at exactly 0 the formulas blow up. 1 hour
# is small enough that it doesn't matter to research P&L but keeps math sane.
_T_FLOOR: float = 1.0 / (365.0 * 24.0)
# Floor on volatility — same reasoning. 0.1% IV is unrealistically tiny but
# still produces finite Greeks.
_SIGMA_FLOOR: float = 1e-4


@dataclass(frozen=True, slots=True)
class PutSpreadQuote:
    """Snapshot of a put credit spread at a point in time.

    All prices are *per share* (multiply by 100 for one contract). `credit` is
    positive for a credit spread (we received it on entry); `value_now` is the
    cost to close (positive) — so live P&L per share = credit - value_now.
    """

    short_strike: float
    long_strike: float
    width: float
    short_premium: float
    long_premium: float
    credit: float          # short_premium - long_premium (received on entry)
    max_profit: float      # = credit
    max_loss: float        # = width - credit
    short_delta: float     # negative for puts; absolute value used by signal logic
    long_delta: float
    net_delta: float       # short_delta - long_delta (positive net = bullish)


def bs_put_price(
    *,
    spot: float,
    strike: float,
    time_to_expiry: float,
    sigma: float,
    risk_free_rate: float = 0.045,
) -> float:
    """Black-Scholes European put price (no dividends).

    Returns 0.0 if the put is far OTM and time is essentially zero.
    """
    if spot <= 0.0 or strike <= 0.0:
        return 0.0
    t = max(time_to_expiry, _T_FLOOR)
    s = max(sigma, _SIGMA_FLOOR)

    d1 = (math.log(spot / strike) + (risk_free_rate + 0.5 * s * s) * t) / (s * math.sqrt(t))
    d2 = d1 - s * math.sqrt(t)
    return float(strike * math.exp(-risk_free_rate * t) * norm.cdf(-d2) - spot * norm.cdf(-d1))


def bs_put_delta(
    *,
    spot: float,
    strike: float,
    time_to_expiry: float,
    sigma: float,
    risk_free_rate: float = 0.045,
) -> float:
    """Black-Scholes put delta (negative, in [-1, 0]).

    A 30-delta put has delta approximately -0.30.
    """
    if spot <= 0.0 or strike <= 0.0:
        return 0.0
    t = max(time_to_expiry, _T_FLOOR)
    s = max(sigma, _SIGMA_FLOOR)

    d1 = (math.log(spot / strike) + (risk_free_rate + 0.5 * s * s) * t) / (s * math.sqrt(t))
    return float(norm.cdf(d1) - 1.0)


def find_strike_by_delta(
    *,
    spot: float,
    target_delta: float,
    time_to_expiry: float,
    sigma: float,
    risk_free_rate: float = 0.045,
    strike_step: float = 1.0,
) -> float:
    """Find the put strike whose absolute delta is closest to `target_delta`.

    Uses the closed-form inversion: for a put with delta = N(d1) - 1 = -p,
    we have N(d1) = 1 - p, so d1 = N^-1(1 - p), and the strike falls out.
    Then we round to `strike_step` (typical option chain step).

    `target_delta` is positive (e.g. 0.30 for a 30-delta put).
    """
    if not 0.0 < target_delta < 1.0:
        raise ValueError(f"target_delta must be in (0, 1), got {target_delta}")
    t = max(time_to_expiry, _T_FLOOR)
    s = max(sigma, _SIGMA_FLOOR)

    # delta_put = N(d1) - 1, so N(d1) = 1 - target_delta when target_delta is the
    # absolute value of the put delta we want.
    d1 = norm.ppf(1.0 - target_delta)
    # ln(S/K) = d1 * sigma * sqrt(t) - (r + 0.5*sigma^2) * t
    # So K = S * exp(-(d1 * sigma * sqrt(t) - (r + 0.5*sigma^2) * t))
    log_s_over_k = d1 * s * math.sqrt(t) - (risk_free_rate + 0.5 * s * s) * t
    raw_strike = spot * math.exp(-log_s_over_k)
    # Round to nearest step.
    rounded = round(raw_strike / strike_step) * strike_step
    return float(max(rounded, strike_step))


def quote_put_spread(  # noqa: PLR0913 — option-pricing knobs are intentional
    *,
    spot: float,
    short_strike: float,
    long_strike: float,
    time_to_expiry: float,
    sigma: float,
    risk_free_rate: float = 0.045,
) -> PutSpreadQuote:
    """Price a put credit spread (short higher strike, long lower strike).

    Validates that short_strike > long_strike (otherwise it's a debit spread).
    Returns a `PutSpreadQuote` with credit, max_profit, max_loss, and Greeks.
    """
    if short_strike <= long_strike:
        raise ValueError(
            f"Put credit spread requires short_strike > long_strike "
            f"(got short={short_strike}, long={long_strike})"
        )
    width = float(short_strike - long_strike)
    short_premium = bs_put_price(
        spot=spot, strike=short_strike,
        time_to_expiry=time_to_expiry, sigma=sigma, risk_free_rate=risk_free_rate,
    )
    long_premium = bs_put_price(
        spot=spot, strike=long_strike,
        time_to_expiry=time_to_expiry, sigma=sigma, risk_free_rate=risk_free_rate,
    )
    credit = max(short_premium - long_premium, 0.0)
    short_delta = bs_put_delta(
        spot=spot, strike=short_strike,
        time_to_expiry=time_to_expiry, sigma=sigma, risk_free_rate=risk_free_rate,
    )
    long_delta = bs_put_delta(
        spot=spot, strike=long_strike,
        time_to_expiry=time_to_expiry, sigma=sigma, risk_free_rate=risk_free_rate,
    )
    return PutSpreadQuote(
        short_strike=float(short_strike),
        long_strike=float(long_strike),
        width=width,
        short_premium=float(short_premium),
        long_premium=float(long_premium),
        credit=float(credit),
        max_profit=float(credit),
        max_loss=float(max(width - credit, 0.0)),
        short_delta=float(short_delta),
        long_delta=float(long_delta),
        net_delta=float(short_delta - long_delta),
    )


def spread_value_at_expiry(
    *,
    spot_at_expiry: float,
    short_strike: float,
    long_strike: float,
) -> float:
    """Intrinsic value of the put spread at expiration (cost to close, per share).

    For a put credit spread: payoff_to_short_side = max(0, short_strike - S)
    - max(0, long_strike - S). This is what we'd PAY to close, so it's the
    cost the spread-seller eats. Live P&L per share = credit - this.
    """
    short_intrinsic = max(short_strike - spot_at_expiry, 0.0)
    long_intrinsic = max(long_strike - spot_at_expiry, 0.0)
    return float(short_intrinsic - long_intrinsic)


def spread_pnl_per_share(
    *,
    credit_received: float,
    current_value_to_close: float,
) -> float:
    """Live P&L per share for a put credit spread.

    P&L = credit - cost_to_close. Positive = profit, negative = loss.
    """
    return float(credit_received - current_value_to_close)


def select_spread_strikes(
    *,
    spot: float,
    short_delta_target: float,
    long_delta_target: float,
    time_to_expiry: float,
    sigma: float,
    risk_free_rate: float = 0.045,
    strike_step: float | None = None,
) -> tuple[float, float]:
    """Pick (short_strike, long_strike) hitting the requested deltas.

    `strike_step` defaults to a reasonable value scaled by the underlying:
    $0.50 below $50, $1.00 between $50-$200, $2.50 between $200-$500, $5.00 above.
    """
    if strike_step is None:
        if spot < 50.0:
            strike_step = 0.5
        elif spot < 200.0:
            strike_step = 1.0
        elif spot < 500.0:
            strike_step = 2.5
        else:
            strike_step = 5.0

    short_k = find_strike_by_delta(
        spot=spot,
        target_delta=short_delta_target,
        time_to_expiry=time_to_expiry,
        sigma=sigma,
        risk_free_rate=risk_free_rate,
        strike_step=strike_step,
    )
    long_k = find_strike_by_delta(
        spot=spot,
        target_delta=long_delta_target,
        time_to_expiry=time_to_expiry,
        sigma=sigma,
        risk_free_rate=risk_free_rate,
        strike_step=strike_step,
    )
    # Belt-and-suspenders: if rounding made strikes equal, push long down one step.
    if long_k >= short_k:
        long_k = max(short_k - strike_step, strike_step)
    return float(short_k), float(long_k)


# Vectorized variants — convenient for fixture generation / batch revaluation.
def bs_put_price_vec(
    spot: np.ndarray,
    strike: np.ndarray,
    time_to_expiry: np.ndarray,
    sigma: np.ndarray,
    risk_free_rate: float = 0.045,
) -> np.ndarray:
    """Vectorized BS put price. Inputs are 1-D ndarrays of equal length."""
    spot = np.asarray(spot, dtype=np.float64)
    strike = np.asarray(strike, dtype=np.float64)
    t = np.maximum(np.asarray(time_to_expiry, dtype=np.float64), _T_FLOOR)
    s = np.maximum(np.asarray(sigma, dtype=np.float64), _SIGMA_FLOOR)

    d1 = (np.log(spot / strike) + (risk_free_rate + 0.5 * s * s) * t) / (s * np.sqrt(t))
    d2 = d1 - s * np.sqrt(t)
    return strike * np.exp(-risk_free_rate * t) * norm.cdf(-d2) - spot * norm.cdf(-d1)
