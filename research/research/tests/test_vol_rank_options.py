"""Tests for Strategy B3: Vol-Rank Mean Reversion (Options).

Covers:
  - Black-Scholes put pricing sanity (put-call parity, deep OTM, monotonicity)
  - Strike selection by delta target
  - Put credit spread quote correctness
  - Signal generator: respects all entry filters
  - End-to-end runner: produces a non-empty result and writes a report
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from research.strategies.vol_rank_options import pricing
from research.strategies.vol_rank_options.signal import find_entries


# ─────────────────────────── Pricing tests ──────────────────────────────

def test_bs_put_price_atm_positive() -> None:
    """An ATM put with positive vol and time has strictly positive price."""
    p = pricing.bs_put_price(spot=100.0, strike=100.0, time_to_expiry=0.1, sigma=0.3)
    assert p > 0.0
    assert p < 100.0  # bounded by strike


def test_bs_put_price_deep_otm_near_zero() -> None:
    """A put far OTM (spot >> strike) with short time has near-zero value."""
    p = pricing.bs_put_price(spot=200.0, strike=50.0, time_to_expiry=0.05, sigma=0.2)
    assert p < 0.5


def test_bs_put_price_deep_itm_intrinsic() -> None:
    """A put deep ITM is at least intrinsic value (strike - spot, discounted)."""
    spot, strike, t, r = 50.0, 100.0, 0.5, 0.05
    p = pricing.bs_put_price(spot=spot, strike=strike, time_to_expiry=t, sigma=0.2, risk_free_rate=r)
    intrinsic_discounted = strike * math.exp(-r * t) - spot
    # BS price should be >= discounted intrinsic (no early exercise edge for European).
    assert p >= intrinsic_discounted - 1e-6


def test_bs_put_call_parity() -> None:
    """Verify put-call parity via reconstructed call from put+spot-K*exp(-rT).

    P + S = C + K*e^(-rT) (no dividends). So C = P + S - K*e^(-rT). For any
    valid BS put price, the implied call must match a hand-computed BS call.
    """
    spot, strike, t, sigma, r = 100.0, 95.0, 0.5, 0.25, 0.03
    p = pricing.bs_put_price(spot=spot, strike=strike, time_to_expiry=t, sigma=sigma, risk_free_rate=r)
    # BS call closed-form
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    from scipy.stats import norm
    call = spot * norm.cdf(d1) - strike * math.exp(-r * t) * norm.cdf(d2)
    parity_lhs = p + spot
    parity_rhs = call + strike * math.exp(-r * t)
    assert abs(parity_lhs - parity_rhs) < 1e-6


def test_bs_put_delta_bounds() -> None:
    """Put delta is in [-1, 0], deep ITM ~= -1, deep OTM ~= 0."""
    deep_itm = pricing.bs_put_delta(spot=50.0, strike=100.0, time_to_expiry=0.1, sigma=0.2)
    deep_otm = pricing.bs_put_delta(spot=200.0, strike=100.0, time_to_expiry=0.1, sigma=0.2)
    atm = pricing.bs_put_delta(spot=100.0, strike=100.0, time_to_expiry=0.1, sigma=0.2)
    assert -1.0 <= deep_itm <= 0.0
    assert -1.0 <= deep_otm <= 0.0
    assert deep_itm < -0.95
    assert deep_otm > -0.05
    # ATM put delta is near -0.5 (slightly less negative due to drift term).
    assert -0.55 <= atm <= -0.40


def test_find_strike_by_delta_30() -> None:
    """Selected strike's actual delta should be near the target delta."""
    spot, sigma, t = 100.0, 0.25, 35 / 365.0
    k = pricing.find_strike_by_delta(
        spot=spot, target_delta=0.30, time_to_expiry=t, sigma=sigma,
    )
    actual_delta = pricing.bs_put_delta(
        spot=spot, strike=k, time_to_expiry=t, sigma=sigma,
    )
    # Should be reasonably close to -0.30 (rounding to $1 strike step adds a bit of slack).
    assert abs(actual_delta - (-0.30)) < 0.05


def test_quote_put_spread_credit_positive() -> None:
    """A put credit spread always has non-negative credit (short above long)."""
    quote = pricing.quote_put_spread(
        spot=100.0,
        short_strike=95.0,
        long_strike=90.0,
        time_to_expiry=35 / 365.0,
        sigma=0.25,
    )
    assert quote.credit > 0.0
    assert quote.width == 5.0
    assert quote.max_loss == quote.width - quote.credit
    assert quote.max_loss > 0.0
    assert quote.short_premium > quote.long_premium


def test_quote_put_spread_invalid_strikes_raises() -> None:
    """Short strike <= long strike must raise (it would be a debit spread)."""
    with pytest.raises(ValueError, match="(?i)put credit spread"):
        pricing.quote_put_spread(
            spot=100.0, short_strike=90.0, long_strike=95.0,
            time_to_expiry=0.1, sigma=0.2,
        )


def test_select_spread_strikes_orders() -> None:
    """select_spread_strikes returns short > long for puts."""
    short_k, long_k = pricing.select_spread_strikes(
        spot=100.0,
        short_delta_target=0.30,
        long_delta_target=0.15,
        time_to_expiry=35 / 365.0,
        sigma=0.25,
    )
    assert short_k > long_k


def test_spread_value_at_expiry_max_loss() -> None:
    """If spot expires below long strike, value = full width (max loss)."""
    val = pricing.spread_value_at_expiry(
        spot_at_expiry=80.0,
        short_strike=95.0,
        long_strike=90.0,
    )
    assert val == 5.0  # short ITM by 15, long ITM by 10 -> spread value = 5 (= width)


def test_spread_value_at_expiry_max_profit() -> None:
    """If spot expires above short strike, both expire worthless = max profit."""
    val = pricing.spread_value_at_expiry(
        spot_at_expiry=110.0,
        short_strike=95.0,
        long_strike=90.0,
    )
    assert val == 0.0


# ─────────────────────────── Signal tests ──────────────────────────────

def _make_synthetic_inputs(
    *,
    n_bars: int = 600,
    seed: int = 0,
    inject_signal_at: int | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.DatetimeIndex]:
    """Build inputs where (optionally) we inject a clean entry trigger at index `inject_signal_at`."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    log_returns = rng.normal(0.0004, 0.012, n_bars)
    close = 100.0 * np.exp(np.cumsum(log_returns))
    iv = np.full(n_bars, 0.20)

    if inject_signal_at is not None and inject_signal_at < n_bars:
        i = inject_signal_at
        # Bias the entire prior history way up so the 200d SMA sits well above
        # post-dip price (we still need close > 200d SMA after the dip).
        close[: i - 4] *= 0.6  # compress: prior history is at lower price
        close[i - 4 : i + 1] = close[i - 4 - 1] * np.linspace(1.0, 0.93, 5)
        close[i + 1 :] = close[i] * 1.05  # bounce back after
        # Force IV-rank > 70 by setting most prior IV way below current.
        iv[: i - 4] = 0.10
        iv[i - 4 : i + 1] = 0.40
        # The 200d SMA over the LAST 200 bars (incl. the dip) needs to be BELOW
        # `close[i]`. After the bias and dip, close[i] ~= 0.93 * 0.6 * baseline ~=
        # too low. Easier: only need close > sma200 — push the LAST 200 bars
        # leading up to i to a slightly RISING regime so sma200 < close[i].
        # Re-design: fill bars [i-200, i-5] with a flat low-price regime
        # then the dip; after the dip close should be just barely above that
        # low regime's mean.
        baseline = 80.0
        close[: i - 200] = baseline  # very long ancient history (doesn't enter SMA)
        close[i - 200 : i - 4] = baseline  # 200d SMA window: flat at 80
        close[i - 4 : i + 1] = baseline * np.linspace(1.05, 0.95, 5)
        # Now sma200 ~= 80, close[i] ~= 76 — still BELOW. Try higher post-window:
        # shift so most of last-200 window is at 80, with a brief PRE-dip rally.
        close[i - 30 : i - 4] = baseline * 1.10  # 26-bar rally before dip
        # During the dip, close[i] = 1.10 * 80 * 0.95 = 83.6
        # SMA20 will be (around) ~88 from rally, std20 will be elevated.
        # SMA200 will be (~196 days at 80) + (4 rally bars at 88) = mostly 80.
        # So close[i] (~83.6) > sma200 (~80) -- f_trend: TRUE.
        close[i - 4 : i + 1] = (baseline * 1.10) * np.linspace(1.0, 0.78, 5)
        close[i + 1 :] = close[i] * 1.05

    ohlcv = pd.DataFrame(
        {
            "open": np.r_[close[0], close[:-1]],
            "high": close * 1.005,
            "low": close * 0.995,
            "close": close,
            "volume": np.full(n_bars, 1e6),
        },
        index=dates,
    )
    iv_series = pd.Series(iv, index=dates, name="iv")
    earnings = pd.DatetimeIndex([])
    return ohlcv, iv_series, earnings


def test_find_entries_returns_no_setups_in_calm_market() -> None:
    """Boring drift + flat IV should not trigger entries."""
    ohlcv, iv, earnings = _make_synthetic_inputs(n_bars=600, seed=1)
    setups = find_entries(
        ohlcv, iv, earnings,
        symbol="TEST",
        params={"iv_rank_min": 70.0, "sigma_below": 2.0},
    )
    # Flat IV -> IV-rank ~ 0, can't trigger.
    assert len(setups) == 0


def test_find_entries_fires_on_injected_setup() -> None:
    """Inject a clean trigger and verify the signal fires."""
    ohlcv, iv, earnings = _make_synthetic_inputs(
        n_bars=600, seed=2, inject_signal_at=400,
    )
    setups = find_entries(
        ohlcv, iv, earnings,
        symbol="TEST",
        params={
            "iv_rank_min": 70.0,
            "sigma_below": 2.0,
            "sma_lookback": 20,
            "iv_rank_lookback": 252,
            "trend_filter_lookback": 200,
            "earnings_blackout_days": 14,
            "allowed_regimes": ("calm", "trending"),
        },
    )
    assert len(setups) >= 1
    s = setups[0]
    assert s.symbol == "TEST"
    assert s.short_strike > s.long_strike
    assert s.credit_per_share > 0.0
    assert 0.0 < s.credit_pct_of_width < 1.0
    assert s.dte_at_entry >= 30


def test_find_entries_blocked_by_earnings() -> None:
    """An entry that would otherwise fire is blocked when earnings are within 14 days."""
    ohlcv, iv, _ = _make_synthetic_inputs(n_bars=600, seed=3, inject_signal_at=400)

    # Add an earnings date 7 calendar days after the inject point.
    earn_date = ohlcv.index[400] + pd.Timedelta(days=7)
    earnings_with = pd.DatetimeIndex([earn_date])

    setups_with_blackout = find_entries(
        ohlcv, iv, earnings_with,
        symbol="TEST",
        params={"earnings_blackout_days": 14},
    )
    setups_without = find_entries(
        ohlcv, iv, pd.DatetimeIndex([]),
        symbol="TEST",
        params={"earnings_blackout_days": 14},
    )
    # Blackout must produce strictly fewer (or equal-zero) setups around the earn date.
    if setups_without:
        # Among those that would have fired without earnings, the trade closest to
        # the earn date should be removed by the blackout.
        all_dates_without = {s.entry_date for s in setups_without}
        all_dates_with = {s.entry_date for s in setups_with_blackout}
        # At least one entry within 14d of earn_date should be excluded.
        excluded = {
            d for d in all_dates_without
            if 0 <= (earn_date - d).days <= 14
        }
        assert excluded.isdisjoint(all_dates_with) or len(excluded) == 0


def test_find_entries_iv_rank_filter() -> None:
    """Setting iv_rank_min very high suppresses all entries."""
    ohlcv, iv, earnings = _make_synthetic_inputs(n_bars=600, seed=4, inject_signal_at=400)
    setups = find_entries(
        ohlcv, iv, earnings,
        symbol="TEST",
        params={"iv_rank_min": 99.99},  # essentially impossible
    )
    assert len(setups) == 0


# ─────────────────────────── Runner E2E ──────────────────────────────

def test_runner_end_to_end(tmp_path: Path) -> None:
    """Run the strategy on a small (3y) universe; report files must be written."""
    from research.strategies.vol_rank_options import run as runner

    result = runner.run(years=3, report_dir=tmp_path)
    assert result.name.startswith("vol_rank_options")
    # Basic invariants — equity curve has length, params dict has the iv_rank_min knob.
    assert not result.full_equity.empty
    assert result.params.get("iv_rank_min", 0.0) > 0.0
    # Report files produced.
    assert (tmp_path / "report.md").exists()
    assert (tmp_path / "summary.json").exists()
    assert (tmp_path / "trades.csv").exists()
