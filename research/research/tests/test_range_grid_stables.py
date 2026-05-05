"""Tests for Strategy B6: Range-Grid on Stablecoin Pairs.

Coverage targets (per spec):
    1. ``generate_grid`` produces a symmetric ladder at the right prices.
    2. A buy fill is replaced with a sell at the symmetric (one-notch-up) level.
    3. Inventory cap suppresses additional BUY fills once threshold is hit.
    4. Depeg pause: sustained >1.5% deviation flattens the grid; recovery
       resumes a fresh grid.
    5. End-to-end short backtest produces a finite equity curve and fills.
    6. Synthetic series is deterministic and hovers near 1.0 (with the depeg
       event correctly injected if requested).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research.strategies.range_grid_stables.grid import (
    GridOrderbook,
    OrderSide,
)
from research.strategies.range_grid_stables.run import (
    build_stable_pair_ticks,
)
from research.strategies.range_grid_stables.signal import (
    Action,
    GridOrder,
    compute_anchor,
    decide_action,
    generate_grid,
    is_depegged,
)
from research.strategies.range_grid_stables.simulator import (
    BARS_PER_DAY,
    simulate_grid,
)


# --------------------------------------------------------------------------- #
# 1. Grid placement / generate_grid                                            #
# --------------------------------------------------------------------------- #


def test_generate_grid_produces_symmetric_ladder() -> None:
    """5 buys + 5 sells at 5bps spacing around peg=1.0.

    Per spec the buys must hit 0.9990, 0.9985, 0.9980, 0.9975, 0.9970 and the
    sells 1.0010, 1.0015, 1.0020, 1.0025, 1.0030.
    """
    orders = generate_grid(peg=1.0, spacing_bps=5.0, num_levels=5, per_level_usd=1000.0)
    assert len(orders) == 10

    buys = [o for o in orders if o.side is OrderSide.BUY]
    sells = [o for o in orders if o.side is OrderSide.SELL]
    assert len(buys) == 5
    assert len(sells) == 5

    # Per spec the buy ladder is 0.9990, 0.9985, 0.9980, 0.9975, 0.9970.
    buys.sort(key=lambda o: -o.level)  # -1, -2, -3, -4, -5
    expected_buy_prices = [0.9990, 0.9985, 0.9980, 0.9975, 0.9970]
    for o, expected in zip(buys, expected_buy_prices):
        assert o.price == pytest.approx(expected, abs=1e-9)
        assert o.notional_quote == 1000.0

    sells.sort(key=lambda o: o.level)
    expected_sell_prices = [1.0010, 1.0015, 1.0020, 1.0025, 1.0030]
    for o, expected in zip(sells, expected_sell_prices):
        assert o.price == pytest.approx(expected, abs=1e-9)
        assert o.notional_quote == 1000.0


def test_generate_grid_rejects_bad_inputs() -> None:
    """Constructor must reject non-positive values."""
    with pytest.raises(ValueError):
        generate_grid(peg=0.0, spacing_bps=5.0, num_levels=5, per_level_usd=1000.0)
    with pytest.raises(ValueError):
        generate_grid(peg=1.0, spacing_bps=0.0, num_levels=5, per_level_usd=1000.0)
    with pytest.raises(ValueError):
        generate_grid(peg=1.0, spacing_bps=5.0, num_levels=0, per_level_usd=1000.0)
    with pytest.raises(ValueError):
        generate_grid(peg=1.0, spacing_bps=5.0, num_levels=5, per_level_usd=0.0)


def test_orderbook_place_grid_creates_symmetric_levels() -> None:
    """``GridOrderbook.place_grid`` mirrors the generate_grid layout when
    ``place_sells=True`` (legacy unconditional symmetric placement)."""
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=5,
        levels_below=5,
        spacing_bps=5.0,
        order_size_quote=500.0,
        maker_fee_bps=0.0,
        taker_fee_bps=10.0,
        maker_taker_mix=0.5,
    )
    book.place_grid(1.0, place_sells=True)
    assert len(book.rungs) == 10
    buys = [r for r in book.rungs.values() if r.side is OrderSide.BUY]
    sells = [r for r in book.rungs.values() if r.side is OrderSide.SELL]
    assert len(buys) == 5 and len(sells) == 5


def test_orderbook_place_grid_default_only_places_buys_with_no_inventory() -> None:
    """Default ``place_sells=None``: with no open inventory, no SELL rungs."""
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=5,
        levels_below=5,
        spacing_bps=5.0,
        order_size_quote=500.0,
        maker_fee_bps=0.0,
        taker_fee_bps=10.0,
        maker_taker_mix=0.5,
    )
    book.place_grid(1.0)  # default
    assert len(book.rungs) == 5  # only BUY rungs
    assert all(r.side is OrderSide.BUY for r in book.rungs.values())


def test_orderbook_place_grid_from_orders_round_trips() -> None:
    """Passing GridOrders through place_grid_from_orders preserves prices."""
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=5,
        levels_below=5,
        spacing_bps=5.0,
        order_size_quote=500.0,
        maker_fee_bps=0.0,
        taker_fee_bps=10.0,
        maker_taker_mix=0.5,
    )
    orders = generate_grid(peg=1.0, spacing_bps=5.0, num_levels=5, per_level_usd=500.0)
    book.place_grid_from_orders(orders)
    for o in orders:
        assert book.rungs[o.level].price == pytest.approx(o.price, abs=1e-12)


# --------------------------------------------------------------------------- #
# 2. Replacement on opposite side (fill replenishment)                         #
# --------------------------------------------------------------------------- #


def test_buy_fill_places_replacement_on_opposite_side() -> None:
    """Filling buy at level -k replaces it with a sell at level -k+1."""
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=5,
        levels_below=5,
        spacing_bps=10.0,
        order_size_quote=100.0,
        maker_fee_bps=0.0,
        taker_fee_bps=10.0,
        maker_taker_mix=0.5,
    )
    book.place_grid(1.0, place_sells=True)
    book.fill_event_handler(level=-2, timestamp_idx=1)
    # -2 + 1 = -1 -> sell at level -1.
    assert -1 in book.rungs
    assert book.rungs[-1].side is OrderSide.SELL
    expected_price = 1.0 * (1.0 + (-1) * 10.0 / 10_000.0)
    assert book.rungs[-1].price == pytest.approx(expected_price, abs=1e-12)


def test_sell_fill_replacement_books_realized_pnl() -> None:
    """Buy then sell on the replacement rung must produce positive realized P&L."""
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=5,
        levels_below=5,
        spacing_bps=10.0,
        order_size_quote=100.0,
        maker_fee_bps=0.0,
        taker_fee_bps=0.0,  # zero fees to test pure spread capture
        maker_taker_mix=1.0,
    )
    book.place_grid(1.0, place_sells=True)
    book.fill_event_handler(level=-2, timestamp_idx=0)
    sell_event = book.fill_event_handler(level=-1, timestamp_idx=1)
    assert sell_event is not None
    assert sell_event.side is OrderSide.SELL
    # Round-trip P&L = (0.999 - 0.998) * (100 / 0.998) ~= 0.1002
    assert sell_event.realized_pnl_quote == pytest.approx(0.1002, abs=1e-3)


def test_fee_math_uses_maker_taker_mix() -> None:
    """Effective fee = maker*mix + taker*(1-mix); applied per fill."""
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=3,
        levels_below=3,
        spacing_bps=5.0,
        order_size_quote=1000.0,
        maker_fee_bps=0.0,
        taker_fee_bps=10.0,
        maker_taker_mix=0.0,  # 100% taker
    )
    book.place_grid(1.0, place_sells=True)
    event = book.fill_event_handler(level=-1, timestamp_idx=0)
    assert event is not None
    assert event.fee_quote == pytest.approx(1.0, abs=1e-9)


# --------------------------------------------------------------------------- #
# 3. Inventory cap                                                             #
# --------------------------------------------------------------------------- #


def test_inventory_cap_blocks_additional_buys() -> None:
    """Once total open BUY notional exceeds max_inventory_quote, BUY fills are
    suppressed (rung remains in book). SELLs always proceed.
    """
    # Cap at $300 — only 3 buys of $100 should land before suppression kicks in.
    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=5,
        levels_below=5,
        spacing_bps=5.0,
        order_size_quote=100.0,
        maker_fee_bps=0.0,
        taker_fee_bps=0.0,
        maker_taker_mix=1.0,
        max_inventory_quote=300.0,
    )
    book.place_grid(1.0, place_sells=True)
    # Fill 3 buys.
    e1 = book.fill_event_handler(level=-1, timestamp_idx=0)
    e2 = book.fill_event_handler(level=-2, timestamp_idx=1)
    e3 = book.fill_event_handler(level=-3, timestamp_idx=2)
    assert e1 is not None and e2 is not None and e3 is not None

    # Now open inventory cost = 300. The next BUY attempt must be suppressed.
    e4 = book.fill_event_handler(level=-4, timestamp_idx=3)
    assert e4 is None
    assert book.skipped_buys_for_cap == 1
    # Rung -4 must still be in the book (just not filled).
    assert -4 in book.rungs

    # SELL fills must still proceed even when inventory is at the cap.
    # Place a sell rung manually (replacement chain produces it).
    # After the suppressed -4 the existing -3 fill placed a replacement at
    # level -2 (sell). That sell can fill.
    assert book.rungs.get(-2) is not None
    assert book.rungs[-2].side is OrderSide.SELL


# --------------------------------------------------------------------------- #
# 4. Depeg detection + pause/resume                                            #
# --------------------------------------------------------------------------- #


def test_is_depegged_threshold() -> None:
    """1.5% deviation from anchor must trip; 1.4% must not."""
    assert is_depegged(current_price=1.014, anchor=1.0, threshold_pct=1.5) is False
    assert is_depegged(current_price=1.016, anchor=1.0, threshold_pct=1.5) is True
    assert is_depegged(current_price=0.984, anchor=1.0, threshold_pct=1.5) is True
    assert is_depegged(current_price=0.985, anchor=1.0, threshold_pct=1.5) is False


def test_decide_action_holds_during_brief_spike() -> None:
    """A brief depeg spike (bars_outside_band < pause window) must NOT flatten."""
    history = pd.Series([1.0] * 100 + [0.97])  # 3% deviation
    decision = decide_action(
        history,
        bars_since_last_refresh=10,
        refresh_bars=240,
        anchor_window_bars=100,
        depeg_threshold_pct=1.5,
        depeg_pause_hours=24,  # 1440 bars
        bars_outside_band=10,  # only 10 bars so far
        paused=False,
    )
    assert decision.action is not Action.FLATTEN_AND_PAUSE


def test_decide_action_flattens_on_sustained_depeg() -> None:
    """When bars_outside_band >= pause_bars, the breaker trips."""
    history = pd.Series([1.0] * 100 + [0.97])
    decision = decide_action(
        history,
        bars_since_last_refresh=10,
        refresh_bars=240,
        anchor_window_bars=100,
        depeg_threshold_pct=1.5,
        depeg_pause_hours=1,  # 60 bars
        bars_outside_band=120,  # well past pause threshold
        paused=False,
    )
    assert decision.action is Action.FLATTEN_AND_PAUSE


def test_decide_action_resumes_when_paused_and_recovered() -> None:
    """If currently paused and price is back inside the band, return RESUME."""
    history = pd.Series([1.0] * 100 + [1.001])  # back inside band
    decision = decide_action(
        history,
        bars_since_last_refresh=10,
        refresh_bars=240,
        anchor_window_bars=100,
        depeg_threshold_pct=1.5,
        depeg_pause_hours=24,
        bars_outside_band=0,
        paused=True,
    )
    assert decision.action is Action.RESUME
    assert decision.anchor_price is not None


def test_decide_action_replaces_on_refresh_interval() -> None:
    """After ``refresh_bars`` elapse with no fills the grid must re-place."""
    history = pd.Series([1.0] * 200)
    decision = decide_action(
        history,
        bars_since_last_refresh=240,
        refresh_bars=240,
        anchor_window_bars=100,
        depeg_threshold_pct=1.5,
        depeg_pause_hours=24,
        bars_outside_band=0,
        paused=False,
    )
    assert decision.action is Action.REPLACE_GRID


def test_compute_anchor_falls_back_to_peg_during_warmup() -> None:
    """compute_anchor must return the peg fallback if history is too short."""
    assert compute_anchor(
        pd.Series([1.0, 1.001]), anchor_window_bars=10, peg_fallback=1.0
    ) == pytest.approx(1.0)
    assert compute_anchor(
        pd.Series([1.0] * 10), anchor_window_bars=10
    ) == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# 5. End-to-end short backtest                                                 #
# --------------------------------------------------------------------------- #


def _short_params(**overrides: object) -> dict[str, object]:
    """Smaller param set so tests run quickly."""
    base: dict[str, object] = {
        "pair": "USDC/USDT",
        "anchor_window_bars": 1440,           # 1 day
        "num_levels": 5,
        "spacing_bps": 5.0,
        "peg": 1.0,
        "per_pair_budget": 10_000.0,
        "initial_cash": 10_000.0,
        "max_inventory_pct": 0.5,
        "refresh_hours": 1,
        "depeg_threshold_pct": 1.5,
        "depeg_pause_hours": 1,
        "daily_loss_limit_pct": 2.0,
        "maker_fee_bps": 0.0,
        "taker_fee_bps": 10.0,
        "maker_taker_mix": 0.5,
        "max_orders_per_min": 10,
        "volume_pause_threshold": 0.0,        # disable volume guard for the smoke test
        "volume_window_days": 30,
    }
    base.update(overrides)
    return base


def test_end_to_end_short_backtest_smoke() -> None:
    """A small backtest must complete and produce finite equity + fills."""
    prices = build_stable_pair_ticks(
        years=1,
        seed=7,
        bars_per_year=30 * 1440,  # 30-day series
        inject_depeg_event=False,
    )
    result = simulate_grid(prices, _short_params(), progress_every=0)
    assert not result.equity.empty
    assert np.isfinite(result.summary["final_equity"])
    assert np.isfinite(result.summary["max_dd"])
    # On a mean-reverting series the grid should fill at least a handful of times.
    assert result.summary["total_fills"] > 0


def test_end_to_end_with_depeg_event_pauses_strategy() -> None:
    """Inject a depeg event in a small series; sim must register some pause bars."""
    prices = build_stable_pair_ticks(
        years=1,
        seed=42,
        bars_per_year=60 * 1440,  # 60-day series with depeg in the middle
        inject_depeg_event=True,
        depeg_low_price=0.95,
        depeg_recovery_days=5,
    )
    # depeg_pause_hours=1 to trip quickly in this short fixture.
    result = simulate_grid(
        prices,
        _short_params(depeg_pause_hours=1),
        progress_every=0,
    )
    assert result.bars_paused > 0, "expected the depeg event to pause the strategy"


# --------------------------------------------------------------------------- #
# 6. Synthetic series properties                                               #
# --------------------------------------------------------------------------- #


def test_synthetic_series_is_deterministic() -> None:
    """Same seed must yield identical price series (reproducibility check)."""
    a = build_stable_pair_ticks(years=1, seed=42, bars_per_year=10_000, inject_depeg_event=False)
    b = build_stable_pair_ticks(years=1, seed=42, bars_per_year=10_000, inject_depeg_event=False)
    pd.testing.assert_series_equal(a["close"], b["close"])


def test_synthetic_series_stays_near_one_without_depeg() -> None:
    """OU model with no injected event should stay within +/-2% of 1.0."""
    df = build_stable_pair_ticks(
        years=1, seed=7, bars_per_year=BARS_PER_DAY * 60, inject_depeg_event=False
    )
    closes = df["close"].to_numpy()
    assert abs(float(np.median(closes)) - 1.0) < 0.001
    deviation = np.abs(closes - 1.0)
    assert float(np.quantile(deviation, 0.99)) < 0.02


def test_synthetic_series_depeg_event_reaches_low_price() -> None:
    """When the depeg event is injected the series must briefly hit the low."""
    df = build_stable_pair_ticks(
        years=1,
        seed=7,
        bars_per_year=BARS_PER_DAY * 60,
        inject_depeg_event=True,
        depeg_low_price=0.95,
        depeg_recovery_days=5,
    )
    closes = df["close"].to_numpy()
    # The trough should be near 0.95.
    assert float(closes.min()) < 0.96


def test_grid_order_dataclass_is_frozen() -> None:
    """GridOrder must be immutable."""
    o = GridOrder(level=-1, side=OrderSide.BUY, price=0.999, notional_quote=100.0)
    with pytest.raises(Exception):
        o.price = 0.998  # type: ignore[misc]
