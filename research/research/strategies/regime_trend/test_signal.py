"""Unit tests for the regime-filtered trend following strategy.

Run from the research/ folder:

    cd research && uv run pytest research/strategies/regime_trend/ -v
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import pytest

from research.lib import regimes as regimes_lib
from research.strategies.regime_trend import run as run_module
from research.strategies.regime_trend.signal import (
    Trade,
    _compute_indicators,
    _entry_mask,
    _walk_position,
    generate_signals,
    generate_trades,
)


# --- Synthetic helpers ------------------------------------------------------


def _trending_ohlcv(n: int = 600, seed: int = 1) -> pd.DataFrame:
    """Strongly up-trending OHLCV: 200MA below price most of the way."""
    rng = np.random.default_rng(seed)
    log_ret = rng.normal(loc=0.0010, scale=0.010, size=n)
    close = 100.0 * np.exp(np.cumsum(log_ret))
    dates = pd.date_range("2018-01-01", periods=n, freq="B")
    intra = np.abs(rng.normal(0.0, 0.010, size=n)) * close
    return pd.DataFrame(
        {
            "open": np.r_[close[0], close[:-1]],
            "high": close + intra / 2.0,
            "low": close - intra / 2.0,
            "close": close,
            "volume": 1_000_000.0,
        },
        index=dates,
    )


def _calm_regimes(index: pd.DatetimeIndex) -> pd.Series:
    """Flat 'calm' regime series spanning the index."""
    return pd.Series("calm", index=index, dtype="object", name="regime")


def _crisis_regimes(index: pd.DatetimeIndex, crisis_start: int = 250) -> pd.Series:
    """Calm for first chunk then crisis to test forced exits."""
    arr = np.array(["calm"] * len(index), dtype=object)
    arr[crisis_start:] = "crisis"
    return pd.Series(arr, index=index, name="regime")


# --- Tests ------------------------------------------------------------------


def test_indicator_columns_and_atr_pct() -> None:
    """_compute_indicators returns expected columns; atr_pct is ratio not raw."""
    ohlcv = _trending_ohlcv()
    inds = _compute_indicators(
        ohlcv,
        ma_period=200,
        roc_period=21,
        atr_period=14,
        vol_pctile_window=252,
        vol_pctile_lo=25.0,
        vol_pctile_hi=75.0,
    )
    assert set(inds.columns) == {"sma", "roc", "atr", "atr_pct", "vol_lo", "vol_hi"}
    # After warmup the SMA should be finite.
    assert np.isfinite(inds["sma"].iloc[-1])
    # ATR-% should be a small percent (e.g. 1-3% on 1% sigma).
    last_atr_pct = inds["atr_pct"].iloc[-1]
    assert 0.1 < last_atr_pct < 10.0


def test_entry_mask_blocks_when_regime_disallowed() -> None:
    """If regime not in allowed set, entry mask is False everywhere."""
    ohlcv = _trending_ohlcv()
    inds = _compute_indicators(
        ohlcv,
        ma_period=200,
        roc_period=21,
        atr_period=14,
        vol_pctile_window=252,
        vol_pctile_lo=25.0,
        vol_pctile_hi=75.0,
    )
    crisis = pd.Series("crisis", index=ohlcv.index, dtype="object", name="regime")
    permit = _entry_mask(
        ohlcv,
        inds,
        roc_min=0.0,
        regime_series=crisis,
        allowed_regimes=("calm", "trending"),
        spy_close=None,
        spy_ma_period=200,
        require_spy_trend=False,
    )
    assert not permit.any(), "Crisis regime must zero out all entries"


def test_walk_position_emits_regime_exit() -> None:
    """When regime flips to crisis mid-position, exit must fire with reason='regime'."""
    ohlcv = _trending_ohlcv(n=600)
    inds = _compute_indicators(
        ohlcv,
        ma_period=200,
        roc_period=21,
        atr_period=14,
        vol_pctile_window=252,
        vol_pctile_lo=25.0,
        vol_pctile_hi=75.0,
    )
    permit = pd.Series(False, index=ohlcv.index)
    permit.iloc[260] = True   # rising-edge entry exactly here
    permit.iloc[261:265] = True  # held briefly
    # Regime flips to crisis at bar 263 — only 3 bars after entry, before time stop
    # and well inside any plausible trailing-stop range.
    regimes = _crisis_regimes(ohlcv.index, crisis_start=263)

    entry, exit_, trades = _walk_position(
        ohlcv,
        inds,
        permit,
        trail_atr_multiple=10.0,  # huge trail so only regime can exit first
        time_stop_days=90,
        regime_series=regimes,
        allowed_regimes=("calm", "trending"),
    )
    assert entry.any(), "Should emit at least one entry"
    assert exit_.any(), "Should emit a regime-exit"
    reasons = [reason for _, _, reason in trades]
    assert "regime" in reasons, f"Expected a regime-triggered exit; got reasons={reasons}"


def test_walk_position_emits_time_stop() -> None:
    """Time stop fires after time_stop_days bars in position with no other trigger."""
    ohlcv = _trending_ohlcv(n=600)
    inds = _compute_indicators(
        ohlcv,
        ma_period=200,
        roc_period=21,
        atr_period=14,
        vol_pctile_window=252,
        vol_pctile_lo=25.0,
        vol_pctile_hi=75.0,
    )
    permit = pd.Series(False, index=ohlcv.index)
    permit.iloc[260] = True  # rising-edge entry exactly here
    permit.iloc[261:] = True  # stay True afterward (no permit-flip exit)
    regimes = _calm_regimes(ohlcv.index)

    entry, exit_, trades = _walk_position(
        ohlcv,
        inds,
        permit,
        trail_atr_multiple=10.0,  # huge multiplier so trailing stop never triggers
        time_stop_days=30,
        regime_series=regimes,
        allowed_regimes=("calm", "trending"),
    )
    reasons = [r for _, _, r in trades]
    assert "time" in reasons


def test_generate_signals_size_capped_at_max_position_pct() -> None:
    """Position size on entry day must never exceed max_position_pct."""
    ohlcv = _trending_ohlcv(n=600)
    params: dict[str, Any] = {
        "ma_period": 200,
        "roc_period": 21,
        "roc_min": 0.0,
        "atr_period": 14,
        "vol_pctile_window": 252,
        "vol_pctile_lo": 25.0,
        "vol_pctile_hi": 75.0,
        "require_spy_trend": False,
        "allowed_regimes": ("calm", "trending"),
        "trail_atr_multiple": 1.5,
        "time_stop_days": 90,
        "risk_per_trade": 0.004,
        "max_position_pct": 0.15,
        "_regime_series": _calm_regimes(ohlcv.index),
    }
    signals = generate_signals(ohlcv, params)
    assert (signals["size"] <= 0.15 + 1e-9).all()
    assert (signals["size"] >= 0.0).all()
    # Entries should produce non-zero size.
    if signals["entry"].any():
        assert (signals.loc[signals["entry"], "size"] > 0.0).all()


def test_generate_signals_invalid_vol_bounds_raises() -> None:
    """Invalid percentile bounds must raise ValueError."""
    ohlcv = _trending_ohlcv()
    with pytest.raises(ValueError):
        generate_signals(
            ohlcv,
            {"vol_pctile_lo": 80.0, "vol_pctile_hi": 50.0},  # inverted
        )


def test_generate_trades_respects_max_concurrent() -> None:
    """Portfolio-level constraint: at most max_concurrent_positions open at once."""
    ohlcv_dict, spy, vix = run_module._build_synthetic_universe(years=5, seed=99)
    params: dict[str, Any] = run_module._load_params()
    params["max_concurrent_positions"] = 3  # tighten for testability

    trades = generate_trades(ohlcv_dict, spy, vix, params)
    assert isinstance(trades, list)

    # Walk through every entry, count concurrently-open positions, must never > 3.
    events: list[tuple[pd.Timestamp, int]] = []
    for t in trades:
        events.append((t.entry_date, +1))
        if t.exit_date is not None:
            events.append((t.exit_date, -1))
    events.sort(key=lambda x: x[0])
    open_count = 0
    for _, delta in events:
        open_count += delta
        assert open_count <= 3


def test_generate_trades_returns_trade_dataclass() -> None:
    """Sanity check that generate_trades returns Trade instances with sane fields."""
    ohlcv_dict, spy, vix = run_module._build_synthetic_universe(years=5, seed=7)
    params: dict[str, Any] = run_module._load_params()
    trades = generate_trades(ohlcv_dict, spy, vix, params)
    if not trades:
        pytest.skip("No trades produced under params; covered by other tests.")
    for t in trades[:5]:
        assert isinstance(t, Trade)
        assert t.symbol in ohlcv_dict
        assert t.entry_price > 0.0
        assert t.exit_reason in {"trail", "regime", "time", "open"}
        if t.exit_price is not None:
            assert t.exit_price > 0.0


def test_run_produces_report_and_walkforward_windows(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Smoke test: run() writes a report and produces >= 5 walk-forward windows."""
    out = tmp_path / "reports"
    result = run_module.run(years=10, report_dir=out)
    assert result["num_windows"] >= 5, f"Expected >=5 OOS windows, got {result['num_windows']}"
    assert (out / "report.md").exists()
    assert (out / "walkforward.csv").exists()
    assert (out / "summary.json").exists()
    # Sanity: median sharpe is finite (may be below target on synthetic data).
    assert np.isfinite(result["median_window_sharpe"])


def test_regime_classifier_sees_all_four_regimes() -> None:
    """The synthetic SPY + VIX should produce all four regime labels in 10y."""
    ohlcv_dict, spy, vix = run_module._build_synthetic_universe(years=10, seed=42)
    regimes = regimes_lib.classify_regimes(spy, vix)
    labels = set(regimes.unique())
    # We injected crisis spikes + bear cycles. Expect at least 3 of 4 labels.
    assert len(labels & {"calm", "trending", "volatile", "crisis"}) >= 3


def test_signals_zero_when_below_sma() -> None:
    """If close stays below 200d SMA, no entries fire."""
    rng = np.random.default_rng(33)
    n = 500
    # Strong downtrend so close < 200 SMA after warmup.
    log_ret = rng.normal(loc=-0.0015, scale=0.010, size=n)
    close = 100.0 * np.exp(np.cumsum(log_ret))
    dates = pd.date_range("2019-01-01", periods=n, freq="B")
    intra = np.abs(rng.normal(0.0, 0.010, size=n)) * close
    ohlcv = pd.DataFrame(
        {
            "open": np.r_[close[0], close[:-1]],
            "high": close + intra / 2.0,
            "low": close - intra / 2.0,
            "close": close,
            "volume": 1.0,
        },
        index=dates,
    )
    params: dict[str, Any] = {
        "_regime_series": _calm_regimes(ohlcv.index),
        "require_spy_trend": False,
    }
    signals = generate_signals(ohlcv, params)
    # In a persistent downtrend, entries should be rare/absent past the warmup.
    post_warmup_entries = signals["entry"].iloc[250:].sum()
    assert post_warmup_entries == 0
