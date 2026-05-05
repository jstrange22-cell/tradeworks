"""Tests for the PEAD strategy. Operates on the synthetic fixture only."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from research.strategies.pead import earnings as earnings_mod
from research.strategies.pead import run as run_mod
from research.strategies.pead.signal import (
    PeadEntry,
    _atr_position_size,
    generate_long_entries,
    run_pead_simulation,
)


@pytest.fixture(scope="module")
def small_universe() -> tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]]:
    """Small fixture: 20 symbols x 5y. Fast for tests, plenty of events."""
    return earnings_mod.load_fixture(n_symbols=20, years=5, seed=123)


@pytest.fixture
def base_params() -> dict[str, object]:
    """Default params matching the YAML, hand-built to avoid disk dependency in tests."""
    return {
        "surprise_min_pct": 5.0,
        "revenue_must_not_miss": True,
        "guidance_required": "maintain_or_raise",
        "pre_announce_momentum_days": 20,
        "gap_min_pct": 1.0,
        "no_earnings_within_days": 30,
        "no_exdiv_within_days": 30,
        "short_enabled": False,
        "short_surprise_max_pct": -5.0,
        "short_gap_max_pct": -1.0,
        "short_guidance_required": "lower",
        "time_stop_days": 60,
        "trail_atr_mult": 1.5,
        "hard_stop_pct": 8.0,
        "profit_ladder": [
            {"trigger_pct": 5.0, "size_pct": 50.0},
            {"trigger_pct": 10.0, "size_pct": 25.0},
        ],
        "exit_at_next_earnings": True,
        "risk_pct_per_trade": 0.005,
        "max_position_pct": 0.05,
        "atr_period": 14,
        "atr_stop_mult": 2.0,
        "initial_cash": 100_000.0,
        "fee_bps": 1.0,
        "slippage_bps": 2.0,
        "train_years": 2.0,
        "test_years": 0.5,
        "step_years": 0.5,
    }


def test_fixture_loads_and_is_well_formed(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
) -> None:
    """The fixture loader returns a non-empty price frame + earnings list."""
    prices, events = small_universe
    assert not prices.empty
    assert {"symbol", "open", "high", "low", "close", "volume"}.issubset(prices.columns)
    assert len(events) > 0
    # Every event has the required attributes.
    sample = events[0]
    assert isinstance(sample.symbol, str)
    assert isinstance(sample.announcement_date, pd.Timestamp)
    assert isinstance(sample.surprise_pct, float)
    assert sample.guidance in {"raise", "maintain", "lower"}


def test_fixture_csv_is_persisted_to_disk(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
) -> None:
    """`load_fixture` writes earnings_sample.csv so callers can inspect it."""
    _ = small_universe  # ensure load happened
    csv_path = Path(earnings_mod.EARNINGS_FIXTURE)
    assert csv_path.exists()
    df = pd.read_csv(csv_path)
    expected_cols = {
        "symbol", "announcement_date", "actual_eps", "consensus_eps",
        "surprise_pct", "revenue_beat", "guidance",
        "has_exdiv_within_30d", "next_earnings_date",
    }
    assert expected_cols.issubset(set(df.columns))
    assert len(df) > 100  # 20 symbols x 5y x 4/year = 400 events


def test_screener_filters_obey_thresholds(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
    base_params: dict[str, object],
) -> None:
    """Every emitted entry must pass every fundamentals + price filter."""
    prices, events = small_universe
    entries = generate_long_entries(prices, events, base_params)

    assert len(entries) > 0, "Screener should emit some entries on 20-symbol fixture"

    surprise_floor = float(base_params["surprise_min_pct"])
    gap_floor = float(base_params["gap_min_pct"]) / 100.0

    for e in entries:
        assert e.surprise_pct > surprise_floor
        assert e.gap_pct > gap_floor
        assert e.momentum_20d >= 0.0
        assert e.atr > 0.0
        assert e.entry_price > 0.0
        # Stop should be below entry for longs.
        assert e.stop_price < e.entry_price
        assert e.side == "long"  # short disabled by default


def test_screener_rejects_low_surprise(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
    base_params: dict[str, object],
) -> None:
    """Raising surprise_min_pct should monotonically reduce entry count."""
    prices, events = small_universe
    base = generate_long_entries(prices, events, base_params)

    stricter = dict(base_params)
    stricter["surprise_min_pct"] = 15.0  # 3x higher
    fewer = generate_long_entries(prices, events, stricter)

    assert len(fewer) < len(base)
    assert all(e.surprise_pct > 15.0 for e in fewer)


def test_atr_position_size_caps_correctly(base_params: dict[str, object]) -> None:
    """Position size must respect max_position_pct cap and zero out on bad inputs."""
    # ATR-driven size that would exceed cap.
    size_capped = _atr_position_size(
        equity=100_000.0,
        risk_pct=0.005,
        atr_value=0.10,           # tiny ATR -> huge size before cap
        atr_stop_mult=2.0,
        entry_price=50.0,
        max_position_pct=0.05,
    )
    # Cap = 100k * 0.05 / 50 = 100 shares
    assert size_capped == pytest.approx(100.0, rel=1e-6)

    # ATR-driven size below cap.
    size_uncapped = _atr_position_size(
        equity=100_000.0,
        risk_pct=0.005,
        atr_value=10.0,           # large ATR
        atr_stop_mult=2.0,
        entry_price=50.0,
        max_position_pct=0.05,
    )
    # Risk = 500 / (10 * 2) = 25 shares; cap = 100; risk wins.
    assert size_uncapped == pytest.approx(25.0, rel=1e-6)

    # Bad inputs -> zero, not exception.
    assert _atr_position_size(
        equity=100_000.0, risk_pct=0.005, atr_value=0.0,
        atr_stop_mult=2.0, entry_price=50.0, max_position_pct=0.05,
    ) == 0.0
    assert _atr_position_size(
        equity=0.0, risk_pct=0.005, atr_value=10.0,
        atr_stop_mult=2.0, entry_price=50.0, max_position_pct=0.05,
    ) == 0.0


def test_simulation_runs_and_produces_equity_curve(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
    base_params: dict[str, object],
) -> None:
    """End-to-end sim must emit non-empty equity, returns, trade pnls."""
    prices, events = small_universe
    result = run_pead_simulation(prices=prices, events=events, params=base_params)

    assert not result.full_equity.empty
    assert not result.full_returns.empty
    # Should have closed at least a few trades on this fixture size.
    assert len(result.full_trade_pnls) > 0
    # Equity curve starts at initial_cash and is finite throughout.
    assert result.full_equity.iloc[0] == pytest.approx(100_000.0, rel=0.01)
    assert np.all(np.isfinite(result.full_equity.to_numpy()))
    # Walk-forward windows produced.
    assert len(result.windows) > 0


def test_simulation_respects_time_stop(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
    base_params: dict[str, object],
) -> None:
    """Setting time_stop_days very low should close more trades quickly.

    We use the count of closed trades as a proxy: with a tighter time stop,
    ALL drift-takers close faster, so total closed-trade count >= baseline.
    """
    prices, events = small_universe
    fast = dict(base_params)
    fast["time_stop_days"] = 5  # closes most positions in a week
    fast["exit_at_next_earnings"] = False
    result_fast = run_pead_simulation(prices=prices, events=events, params=fast)

    slow = dict(base_params)
    slow["time_stop_days"] = 60
    result_slow = run_pead_simulation(prices=prices, events=events, params=slow)

    # Fast variant should produce at least as many closed trades.
    assert len(result_fast.full_trade_pnls) >= len(result_slow.full_trade_pnls)


def test_short_enabled_changes_entry_count(
    small_universe: tuple[pd.DataFrame, list[earnings_mod.EarningsEvent]],
    base_params: dict[str, object],
) -> None:
    """Enabling shorts should produce additional entries beyond long-only."""
    prices, events = small_universe
    long_only = generate_long_entries(prices, events, base_params)

    with_shorts_params = dict(base_params)
    with_shorts_params["short_enabled"] = True
    with_shorts = generate_long_entries(prices, events, with_shorts_params)

    assert len(with_shorts) >= len(long_only)
    # Short side has different sign expectations.
    short_entries = [e for e in with_shorts if e.side == "short"]
    for s in short_entries:
        assert s.surprise_pct < float(base_params["short_surprise_max_pct"])
        assert s.gap_pct < float(base_params["short_gap_max_pct"]) / 100.0


def test_run_module_writes_report_artifacts(
    tmp_path: Path,
) -> None:
    """`run.run(...)` must produce all the standard report artifacts."""
    out_dir = tmp_path / "reports"
    summary = run_mod.run(years=5, report_dir=out_dir)

    assert "summary" in summary
    assert summary["events_processed"] > 0

    # Standard artifacts.
    assert (out_dir / "report.md").exists()
    assert (out_dir / "walkforward.csv").exists()
    assert (out_dir / "summary.json").exists()
    # PNGs are written iff equity isn't empty — should be true here.
    assert (out_dir / "equity-curve.png").exists()
    assert (out_dir / "drawdown.png").exists()


def test_pead_entry_dataclass_is_frozen() -> None:
    """PeadEntry must be hashable + immutable so we can dedupe / index it safely."""
    entry = PeadEntry(
        symbol="ABC",
        entry_date=pd.Timestamp("2024-01-15"),
        announcement_date=pd.Timestamp("2024-01-12"),
        surprise_pct=10.0,
        gap_pct=0.025,
        momentum_20d=0.05,
        side="long",
        entry_price=100.0,
        atr=2.5,
        stop_price=95.0,
        next_earnings_date=pd.Timestamp("2024-04-15"),
    )
    with pytest.raises((AttributeError, Exception)):
        entry.symbol = "XYZ"  # type: ignore[misc]
