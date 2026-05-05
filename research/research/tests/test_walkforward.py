"""Tests for `research.lib.walkforward`. Synthetic OHLC + dummy strategy."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from research.lib import walkforward


def _build_ohlcv(years: int = 5, seed: int = 11) -> pd.DataFrame:
    """Daily synthetic OHLCV with mild positive drift."""
    rng = np.random.default_rng(seed)
    n = years * 252
    log_ret = rng.normal(loc=0.0005, scale=0.012, size=n)
    close = 100.0 * np.exp(np.cumsum(log_ret))
    dates = pd.date_range(start="2018-01-01", periods=n, freq="B")
    daily_range = np.abs(rng.normal(0, 0.012, size=n)) * close
    return pd.DataFrame(
        {
            "open": np.r_[close[0], close[:-1]],
            "high": close + daily_range / 2,
            "low": close - daily_range / 2,
            "close": close,
            "volume": rng.integers(1_000_000, 10_000_000, size=n).astype(float),
        },
        index=dates,
    )


def _dummy_buy_hold(ohlcv: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:  # noqa: ARG001
    """Buy on bar 1, never exit. Tests the engine with one trade per window."""
    entry = pd.Series(False, index=ohlcv.index)
    exit_ = pd.Series(False, index=ohlcv.index)
    if len(ohlcv) > 1:
        entry.iloc[1] = True
    return pd.DataFrame({"entry": entry, "exit": exit_, "size": 1.0})


def _dummy_sma_cross(ohlcv: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
    """Simple SMA crossover for a non-trivial test."""
    fast = int(params.get("fast", 10))
    slow = int(params.get("slow", 30))
    close = ohlcv["close"].astype(float)
    s_fast = close.rolling(fast).mean()
    s_slow = close.rolling(slow).mean()
    state = (s_fast > s_slow).fillna(False).astype(int)
    diff = state.diff().fillna(0)
    return pd.DataFrame(
        {
            "entry": (diff > 0),
            "exit": (diff < 0),
            "size": pd.Series(1.0, index=ohlcv.index),
        }
    )


def test_walk_forward_produces_windows() -> None:
    """5y of data with 2y train / 0.5y test / 0.5y step -> several windows."""
    ohlcv = _build_ohlcv(years=5)
    windows = walkforward.walk_forward(
        _dummy_sma_cross,
        ohlcv,
        params={"fast": 10, "slow": 30},
        train_years=2.0,
        test_years=0.5,
        step_years=0.5,
        use_vectorbt=False,  # use pandas path so test doesn't depend on vbt
    )
    assert len(windows) > 0
    for w in windows:
        # Train period must precede test period.
        assert w.train_period[1] <= w.test_period[0]
        # Stats must be finite floats.
        assert np.isfinite(w.sharpe)
        assert np.isfinite(w.sortino)
        assert w.max_dd <= 0.0
        assert w.num_trades >= 0


def test_walk_forward_empty_history() -> None:
    """Empty OHLCV must return empty list, not raise."""
    empty = pd.DataFrame(
        columns=["open", "high", "low", "close", "volume"],
        index=pd.DatetimeIndex([], name="timestamp"),
    )
    windows = walkforward.walk_forward(
        _dummy_buy_hold, empty,
        train_years=1, test_years=0.5, step_years=0.5,
        use_vectorbt=False,
    )
    assert windows == []


def test_walk_forward_too_short_history() -> None:
    """If history < train_years + test_years, no windows."""
    ohlcv = _build_ohlcv(years=1)
    windows = walkforward.walk_forward(
        _dummy_sma_cross, ohlcv,
        train_years=2.0, test_years=0.5, step_years=0.5,
        use_vectorbt=False,
    )
    assert windows == []


def test_run_full_backtest_returns_result() -> None:
    """run_full_backtest must produce a BacktestResult with non-empty equity."""
    ohlcv = _build_ohlcv(years=5)
    result = walkforward.run_full_backtest(
        signal_fn=_dummy_sma_cross,
        ohlcv=ohlcv,
        name="test_sma",
        params={"fast": 10, "slow": 30},
        use_vectorbt=False,
    )
    assert result.name == "test_sma"
    assert not result.full_equity.empty
    assert not result.full_returns.empty
    summary = result.summary()
    assert "sharpe" in summary
    assert np.isfinite(summary["max_dd"])


def test_windows_df_columns() -> None:
    """windows_df() must have the columns the report writer expects."""
    ohlcv = _build_ohlcv(years=5)
    result = walkforward.run_full_backtest(
        signal_fn=_dummy_sma_cross,
        ohlcv=ohlcv,
        name="test",
        params={"fast": 10, "slow": 30},
        use_vectorbt=False,
    )
    df = result.windows_df()
    expected = {
        "train_start", "train_end", "test_start", "test_end",
        "sharpe", "sortino", "max_dd", "expectancy",
        "win_rate", "num_trades",
    }
    assert set(df.columns) == expected


def test_simulator_entry_exit_produces_trade() -> None:
    """A clean entry+exit must produce at least one trade pnl."""
    n = 200
    dates = pd.date_range("2020-01-01", periods=n, freq="B")
    close = pd.Series(np.linspace(100.0, 200.0, n), index=dates)  # straight up
    ohlcv = pd.DataFrame(
        {"open": close, "high": close * 1.001, "low": close * 0.999, "close": close, "volume": 1.0},
        index=dates,
    )
    sigs = pd.DataFrame(
        {"entry": [False] * n, "exit": [False] * n, "size": [1.0] * n},
        index=dates,
    )
    sigs.iloc[10, sigs.columns.get_loc("entry")] = True
    sigs.iloc[100, sigs.columns.get_loc("exit")] = True

    eq, ret, pnls = walkforward._simulate_pandas(ohlcv, sigs, initial_cash=10_000.0)
    assert len(pnls) == 1
    # Profitable: bought at ~bar 11 open, sold at ~bar 101 open, line went up.
    assert pnls.iloc[0] > 0.0
    assert eq.iloc[-1] > 10_000.0
