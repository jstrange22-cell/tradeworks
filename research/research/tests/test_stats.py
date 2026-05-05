"""Tests for `research.lib.stats`. Synthetic data only."""

from __future__ import annotations

import numpy as np
import pandas as pd

from research.lib import stats


def test_sharpe_zero_std_returns_zero() -> None:
    """Constant returns -> std is 0 -> Sharpe should be 0, not NaN."""
    returns = pd.Series([0.001] * 100)
    assert stats.sharpe(returns) == 0.0


def test_sharpe_positive_drift() -> None:
    """A positive-drift series should have positive Sharpe."""
    rng = np.random.default_rng(0)
    returns = pd.Series(rng.normal(loc=0.001, scale=0.01, size=500))
    assert stats.sharpe(returns) > 0.0


def test_sharpe_negative_drift() -> None:
    """A negative-drift series should have negative Sharpe."""
    rng = np.random.default_rng(1)
    returns = pd.Series(rng.normal(loc=-0.001, scale=0.01, size=500))
    assert stats.sharpe(returns) < 0.0


def test_sortino_no_downside_is_huge_but_finite() -> None:
    """All positive returns -> Sortino convention: large finite, never inf."""
    returns = pd.Series([0.01] * 100)
    val = stats.sortino(returns)
    assert np.isfinite(val)
    assert val > 0.0


def test_max_drawdown_negative() -> None:
    """A peak-then-trough equity curve should have negative max DD."""
    eq = pd.Series([100, 110, 120, 90, 95, 80, 100])
    mdd = stats.max_drawdown(eq)
    assert mdd < 0.0
    # 120 -> 80 = -33.33%
    assert abs(mdd - (-40.0 / 120.0)) < 1e-9


def test_max_drawdown_monotonic_zero() -> None:
    """A monotonically increasing curve has zero drawdown."""
    eq = pd.Series([100, 101, 102, 103])
    assert stats.max_drawdown(eq) == 0.0


def test_expectancy_and_win_rate() -> None:
    """Hand-checked expectancy + win rate."""
    pnls = pd.Series([10.0, -5.0, 20.0, -10.0, 5.0])
    assert abs(stats.expectancy(pnls) - 4.0) < 1e-9
    assert abs(stats.win_rate(pnls) - 0.6) < 1e-9


def test_calmar_zero_with_no_drawdown() -> None:
    """Calmar = 0 by convention when there's no drawdown."""
    returns = pd.Series([0.001] * 252)  # monotonic upward, no DD
    assert stats.calmar(returns) == 0.0


def test_cagr_basic() -> None:
    """1% per day for 252 days should give CAGR ~ (1.01^252 - 1) ~ 1209%."""
    returns = pd.Series([0.01] * 252)
    val = stats.cagr(returns)
    expected = (1.01**252) - 1.0
    assert abs(val - expected) < 1e-6


def test_monte_carlo_dd_ci_shape_and_bounds() -> None:
    """MC result must have ci_low <= median <= ci_high <= 0 (DDs are negative)."""
    rng = np.random.default_rng(42)
    pnls = pd.Series(rng.normal(loc=2.0, scale=20.0, size=100))
    mc = stats.monte_carlo_dd_ci(pnls, n_paths=2_000)
    assert mc.n_paths == 2_000
    # All max-DD values are <= 0.
    assert mc.median_max_dd <= 0.0
    assert mc.ci_low_95 <= mc.median_max_dd <= mc.ci_high_95
    # p99 is the worst -> most negative -> <= ci_low_95.
    assert mc.p99_max_dd <= mc.ci_low_95


def test_monte_carlo_handles_empty() -> None:
    """Empty trade pnls -> all-zeros result, no exception."""
    mc = stats.monte_carlo_dd_ci(pd.Series(dtype=float), n_paths=100)
    assert mc.median_max_dd == 0.0
    assert mc.ci_low_95 == 0.0
    assert mc.ci_high_95 == 0.0


def test_summarize_keys_present() -> None:
    """summarize() must return all the keys the report writer expects."""
    rng = np.random.default_rng(3)
    returns = pd.Series(rng.normal(0.0005, 0.01, size=300))
    pnls = pd.Series(rng.normal(1.0, 5.0, size=30))
    summary = stats.summarize(returns, pnls)
    expected = {
        "sharpe", "sortino", "calmar", "cagr",
        "max_dd", "win_rate", "expectancy", "num_trades",
    }
    assert set(summary.keys()) == expected


def test_nan_handling() -> None:
    """NaNs in input must not propagate to output."""
    returns = pd.Series([0.01, np.nan, -0.005, 0.002, np.nan, 0.001])
    sr = stats.sharpe(returns)
    assert np.isfinite(sr)
