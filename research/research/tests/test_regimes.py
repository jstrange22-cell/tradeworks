"""Tests for `research.lib.regimes`. Synthetic SPY + VIX only."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.lib import regimes


def _build_spy(n_days: int, start_price: float = 400.0, drift: float = 0.0005, seed: int = 0) -> pd.DataFrame:
    """Synthetic SPY OHLCV with a controlled drift."""
    rng = np.random.default_rng(seed)
    log_ret = rng.normal(loc=drift, scale=0.01, size=n_days)
    close = start_price * np.exp(np.cumsum(log_ret))
    dates = pd.date_range(start="2020-01-01", periods=n_days, freq="B")
    return pd.DataFrame(
        {
            "open": close,
            "high": close * 1.005,
            "low": close * 0.995,
            "close": close,
            "volume": 1_000_000,
        },
        index=dates,
    )


def test_classify_returns_series_with_correct_index() -> None:
    """Output must be indexed identically to SPY input."""
    spy = _build_spy(300)
    vix = pd.Series(15.0, index=spy.index)
    out = regimes.classify_regimes(spy, vix)
    assert isinstance(out, pd.Series)
    assert (out.index == spy.index).all()


def test_calm_when_low_vix_and_no_trend() -> None:
    """Low VIX, slowly drifting market -> mostly calm after 200d warmup."""
    spy = _build_spy(400, drift=0.0001, seed=1)
    vix = pd.Series(12.0, index=spy.index)
    out = regimes.classify_regimes(spy, vix)
    # Look only past the 200d warmup.
    tail = out.iloc[250:]
    # At least some calm bars in there (with low drift it's hard to be trending).
    assert (tail == "calm").sum() > 0


def test_volatile_when_vix_above_22_below_25() -> None:
    """VIX in (22, 25] with SPY above MA -> volatile (not crisis)."""
    spy = _build_spy(400, drift=0.0008, seed=2)  # mild uptrend so we stay above 200MA
    vix = pd.Series(23.0, index=spy.index)
    out = regimes.classify_regimes(spy, vix)
    # Past warmup, should be volatile (or trending if return is also large).
    tail = out.iloc[250:]
    labels = set(tail.unique())
    assert "volatile" in labels or "trending" in labels


def test_crisis_when_vix_above_35() -> None:
    """VIX > 35 -> crisis regardless of SPY trend."""
    spy = _build_spy(400, drift=0.0005, seed=3)
    vix = pd.Series(40.0, index=spy.index)
    out = regimes.classify_regimes(spy, vix)
    # All non-warmup days should be crisis.
    tail = out.iloc[250:]
    assert (tail == "crisis").all()


def test_crisis_when_below_ma_and_vix_above_25() -> None:
    """SPY below 200MA AND VIX > 25 -> crisis even if VIX < 35."""
    # Create a market that crashes after the 200MA establishes.
    n_days = 500
    rng = np.random.default_rng(4)
    log_ret = np.concatenate(
        [
            rng.normal(0.0005, 0.01, size=250),     # uptrend
            rng.normal(-0.003, 0.02, size=250),     # crash
        ]
    )
    close = 400.0 * np.exp(np.cumsum(log_ret))
    dates = pd.date_range(start="2020-01-01", periods=n_days, freq="B")
    spy = pd.DataFrame(
        {"open": close, "high": close, "low": close, "close": close, "volume": 1.0},
        index=dates,
    )
    vix = pd.Series(28.0, index=dates)
    out = regimes.classify_regimes(spy, vix)
    # Late in the crash, should be classified as crisis.
    last_50 = out.iloc[-50:]
    assert (last_50 == "crisis").any()


def test_breakdown_sums_to_total() -> None:
    """regime_breakdown days column must sum to total non-NaN days."""
    spy = _build_spy(400)
    vix = pd.Series(15.0, index=spy.index)
    out = regimes.classify_regimes(spy, vix)
    bd = regimes.regime_breakdown(out)
    assert bd["days"].sum() == len(out)
    # pct should sum to ~100.
    assert abs(bd["pct"].sum() - 100.0) < 0.5


def test_filter_zeros_out_non_allowed_regime() -> None:
    """regime_filter must zero out entries on non-allowed regime days."""
    idx = pd.date_range("2020-01-01", periods=10, freq="B")
    sigs = pd.DataFrame({
        "entry": [True] * 10,
        "exit": [False] * 10,
        "size": [1.0] * 10,
    }, index=idx)
    rgs = pd.Series(
        ["calm", "calm", "trending", "trending", "volatile", "volatile", "crisis", "crisis", "calm", "trending"],
        index=idx,
    )
    filtered = regimes.regime_filter(sigs, rgs, allowed=("trending",))
    assert filtered["entry"].sum() == 3  # only the 3 trending days
    # Original untouched.
    assert sigs["entry"].sum() == 10


def test_classify_validates_inputs() -> None:
    """Missing close column should raise ValueError."""
    bad = pd.DataFrame({"open": [1, 2, 3]}, index=pd.date_range("2020-01-01", periods=3, freq="B"))
    vix = pd.Series([15.0, 15.0, 15.0], index=bad.index)
    try:
        regimes.classify_regimes(bad, vix)
    except ValueError:
        return
    raise AssertionError("Expected ValueError for missing close column")
