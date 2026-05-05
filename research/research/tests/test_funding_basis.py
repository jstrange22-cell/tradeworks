"""Tests for Strategy B5: Funding-Rate Cash-and-Carry Basis Trade.

Covers the exit-detection helpers, sizing math, signal layer (enter / hold / exit
state transitions), data-fixture determinism, and a smoke-test of the full backtest
runner. Each test is named for the behaviour it pins down.
"""

from __future__ import annotations

from collections import deque

import numpy as np
import pandas as pd
import pytest

from research.strategies.funding_basis import data as fb_data
from research.strategies.funding_basis import run as fb_run
from research.strategies.funding_basis import signal as fb_signal


# ----- Helpers ----------------------------------------------------------------


def _default_signal_params(**overrides: object) -> fb_signal.SignalParams:
    """Build a SignalParams with sane defaults; allow per-test overrides."""
    base: dict[str, object] = {
        "funding_min_per_period": 0.0005,
        "exit_neg_periods": 3,
        "spread_blow_out": 0.01,
        "max_pairs": 3,
        "macro_kill_switch": True,
    }
    base.update(overrides)
    return fb_signal.SignalParams.from_dict(base)


def _state_in_basis(pair: str = "BTC/USD", recent: list[float] | None = None) -> fb_signal.PairState:
    """Build a PairState already in basis with a deque of recent funding rates."""
    s = fb_signal.PairState(pair=pair)
    s.in_basis = True
    s.entry_index = 10
    s.notional = 30_000.0
    s.spot_entry_price = 30_000.0
    s.perp_entry_price = 30_000.0
    s.recent_funding = deque(recent or [], maxlen=8)
    return s


# ----- Funding-flip detection -------------------------------------------------


def test_funding_flip_triggers_after_three_consecutive_negative_periods() -> None:
    """When the last 3 funding observations are <= 0, the flip detector returns True."""
    state = _state_in_basis(recent=[0.0003, 0.0001, -0.0001, -0.0002, -0.00005])
    assert fb_signal.funding_flip_to_negative(state, threshold_periods=3) is True


def test_funding_flip_does_not_trigger_with_only_two_negative_periods() -> None:
    """Threshold = 3 should not fire when only 2 periods are negative."""
    state = _state_in_basis(recent=[0.0003, 0.0002, 0.0001, -0.0001, -0.0002])
    # Only the trailing 3 are checked: [0.0001, -0.0001, -0.0002] -> first is positive.
    assert fb_signal.funding_flip_to_negative(state, threshold_periods=3) is False


def test_funding_flip_waits_for_full_window() -> None:
    """If we haven't accumulated `threshold_periods` samples yet, return False."""
    state = _state_in_basis(recent=[-0.0001, -0.0002])  # only 2 samples
    assert fb_signal.funding_flip_to_negative(state, threshold_periods=3) is False


def test_funding_flip_skipped_when_not_in_basis() -> None:
    """A flat pair can't 'flip out' — guard against accidental exit signals."""
    state = fb_signal.PairState(pair="BTC/USD", in_basis=False)
    # Fake a deque of negative rates; in_basis=False should short-circuit to False.
    state.recent_funding = deque([-0.0005, -0.0006, -0.0007], maxlen=8)
    assert fb_signal.funding_flip_to_negative(state, threshold_periods=3) is False


# ----- Spread widening detection ----------------------------------------------


def test_spread_widened_above_threshold() -> None:
    """1% spread blow-out fires when |perp - spot| / spot > threshold."""
    assert fb_signal.spread_widened(spot_close=100.0, perp_close=101.5, threshold=0.01) is True


def test_spread_widened_below_threshold_is_false() -> None:
    """A 50 bp spread shouldn't trip a 1% threshold."""
    assert fb_signal.spread_widened(spot_close=100.0, perp_close=100.5, threshold=0.01) is False


def test_spread_widened_handles_zero_spot_safely() -> None:
    """Zero spot price (degenerate) should not raise — return False instead."""
    assert fb_signal.spread_widened(spot_close=0.0, perp_close=100.0, threshold=0.01) is False


# ----- decide_position transitions --------------------------------------------


def test_decide_position_enters_when_funding_above_threshold() -> None:
    """Flat pair with funding above threshold + capacity available -> enter."""
    state = fb_signal.PairState(pair="BTC/USD")
    sp = _default_signal_params(funding_min_per_period=0.0005)
    action = fb_signal.decide_position(
        state,
        funding_rate=0.0008,  # rich funding
        spot_close=30_000.0,
        perp_close=30_010.0,
        open_pair_count=0,
        macro_risk_off=False,
        sp=sp,
    )
    assert action == "enter"


def test_decide_position_holds_when_at_max_pairs() -> None:
    """Capacity check: even with rich funding, refuse if max_pairs reached."""
    state = fb_signal.PairState(pair="SOL/USD")
    sp = _default_signal_params(max_pairs=3)
    action = fb_signal.decide_position(
        state,
        funding_rate=0.0010,
        spot_close=50.0,
        perp_close=50.05,
        open_pair_count=3,  # already at cap
        macro_risk_off=False,
        sp=sp,
    )
    assert action == "hold"


def test_decide_position_exits_on_macro_kill_switch() -> None:
    """If we're in basis and macro flips risk-off, force exit."""
    state = _state_in_basis()
    sp = _default_signal_params(macro_kill_switch=True)
    action = fb_signal.decide_position(
        state,
        funding_rate=0.0006,
        spot_close=30_000.0,
        perp_close=30_010.0,
        open_pair_count=1,
        macro_risk_off=True,
        sp=sp,
    )
    assert action == "exit"


def test_decide_position_exits_on_funding_flip() -> None:
    """3 consecutive negative funding periods -> exit."""
    state = _state_in_basis(recent=[0.0001, -0.0001, -0.0001, -0.0001])
    sp = _default_signal_params(exit_neg_periods=3)
    action = fb_signal.decide_position(
        state,
        funding_rate=-0.0001,
        spot_close=30_000.0,
        perp_close=30_010.0,
        open_pair_count=1,
        macro_risk_off=False,
        sp=sp,
    )
    assert action == "exit"


def test_decide_position_exits_on_spread_blow_out() -> None:
    """In basis with perp 1.5% above spot -> exit on blow-out (threshold 1%)."""
    state = _state_in_basis()
    sp = _default_signal_params(spread_blow_out=0.01)
    action = fb_signal.decide_position(
        state,
        funding_rate=0.0008,  # still rich funding, but spread blew out
        spot_close=30_000.0,
        perp_close=30_450.0,
        open_pair_count=1,
        macro_risk_off=False,
        sp=sp,
    )
    assert action == "exit"


# ----- Sizing math -------------------------------------------------------------


def test_sizing_per_pair_notional_math() -> None:
    """per_pair_notional = initial_cash × strategy_alloc × per_pair_cap."""
    sizing = fb_run.Sizing(
        initial_cash=100_000.0,
        strategy_alloc_pct=0.30,
        per_pair_cap_pct=0.50,
        max_pairs=3,
    )
    assert sizing.strategy_budget == pytest.approx(30_000.0)
    assert sizing.per_pair_notional == pytest.approx(15_000.0)


def test_sizing_with_full_alloc_and_full_pair_cap() -> None:
    """At 100% alloc and 100% pair cap, per_pair_notional == initial_cash."""
    sizing = fb_run.Sizing(
        initial_cash=50_000.0,
        strategy_alloc_pct=1.0,
        per_pair_cap_pct=1.0,
        max_pairs=1,
    )
    assert sizing.per_pair_notional == pytest.approx(50_000.0)


# ----- Data fixture ----------------------------------------------------------


def test_fixture_determinism() -> None:
    """Same seeds -> identical funding rates and prices."""
    f1 = fb_data.build_synthetic_fixture(
        pairs=["BTC/USD", "ETH/USD"], years=1, funding_seed=17, price_seed=42, regime_seed=99,
    )
    f2 = fb_data.build_synthetic_fixture(
        pairs=["BTC/USD", "ETH/USD"], years=1, funding_seed=17, price_seed=42, regime_seed=99,
    )
    np.testing.assert_array_equal(
        f1.funding["BTC/USD"]["funding_rate"].to_numpy(),
        f2.funding["BTC/USD"]["funding_rate"].to_numpy(),
    )
    np.testing.assert_array_equal(
        f1.prices["ETH/USD"]["spot_close"].to_numpy(),
        f2.prices["ETH/USD"]["spot_close"].to_numpy(),
    )


def test_fixture_has_correct_cadence_and_length() -> None:
    """4 years × 365 × 3 (8h periods/day) = 4380 rows; index spaced at 8h."""
    fixture = fb_data.build_synthetic_fixture(
        pairs=["BTC/USD"], years=4, funding_seed=17, price_seed=42,
    )
    assert len(fixture.index) == 4 * fb_data.PERIODS_PER_YEAR
    deltas = pd.Series(fixture.index).diff().dropna().unique()
    # All deltas should be exactly 8h.
    assert len(deltas) == 1
    assert deltas[0] == pd.Timedelta(hours=8)


def test_fixture_funding_distribution_is_realistic() -> None:
    """Mean funding should be positive but moderate; majority of obs < 5bp."""
    fixture = fb_data.build_synthetic_fixture(
        pairs=["BTC/USD"], years=4, funding_seed=17, price_seed=42,
    )
    rates = fixture.funding["BTC/USD"]["funding_rate"].to_numpy()
    assert rates.mean() > 0.0
    # More positive than negative observations.
    assert (rates > 0.0).mean() > 0.5
    # Truly extreme (>50 bp/8h) observations should be rare even in bull regimes.
    assert (np.abs(rates) > 0.005).mean() < 0.05


# ----- Full backtest smoke -----------------------------------------------------


def test_run_smoke_produces_pass_fail_and_artifacts(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """End-to-end run: artifacts present, equity not empty, pass/fail dict populated."""
    result = fb_run.run(years=2, report_dir=tmp_path)
    assert not result.artifacts.equity.empty
    assert result.artifacts.equity.iloc[0] > 0
    # Pass/fail keys present.
    for key in ("annual_return_meets_8pct", "max_dd_within_5pct", "overall_pass"):
        assert key in result.pass_fail
    # Report files written.
    assert (tmp_path / "report.md").exists()
    assert (tmp_path / "funding-distribution.png").exists()
    assert (tmp_path / "cumulative-pnl-per-pair.png").exists()


def test_run_records_at_least_one_trade_when_funding_is_rich(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """With 4y of regime-aware data the strategy should fire entries — `trades` non-empty."""
    result = fb_run.run(years=4, report_dir=tmp_path)
    assert len(result.artifacts.trades) > 0
    # Every trade record carries the bookkeeping fields.
    for t in result.artifacts.trades:
        assert t.notional > 0
        assert np.isfinite(t.pnl)
