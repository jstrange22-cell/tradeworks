"""Event-driven tick simulator for the stablecoin range-grid strategy.

The simulator walks 1-minute price + volume bars and drives a
:class:`grid.GridOrderbook` through intra-bar crossings. Per-bar logic:

1. Track inventory cap (the orderbook itself enforces this on BUY fills).
2. Process intra-bar crossings -> book fills + replenishment orders.
3. Ask :func:`signal.decide_action` for the next high-level decision.
4. Apply ``REPLACE_GRID`` / ``FLATTEN_AND_PAUSE`` / ``RESUME`` / ``HOLD``.
5. Apply daily-loss-limit guard.
6. Apply volume guard (pause if rolling 24h volume drops below threshold).
7. Mark equity.

The simulator is pure (no I/O) and deterministic given a price/volume frame.
It returns a :class:`GridBacktestResult` with the full equity curve, daily
P&L series, fill log, and a summary dict.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from research.strategies.range_grid_stables.grid import (
    FillEvent,
    GridOrderbook,
    OrderSide,
)
from research.strategies.range_grid_stables.signal import (
    Action,
    Decision,
    is_volume_dead,
)

BARS_PER_DAY: int = 1440      # 1-minute bars
BARS_PER_YEAR: int = 525_600  # 1-minute bars

__all__ = [
    "BARS_PER_DAY",
    "BARS_PER_YEAR",
    "GridBacktestResult",
    "simulate_grid",
]


# --------------------------------------------------------------------------- #
# Result types                                                                 #
# --------------------------------------------------------------------------- #


@dataclass
class GridBacktestResult:
    """Container for the simulator's output."""

    name: str
    equity: pd.Series
    daily_pnl: pd.Series
    fills: list[FillEvent]
    params: dict[str, Any]
    summary: dict[str, float] = field(default_factory=dict)
    # Diagnostics
    skipped_buys_for_cap: int = 0
    bars_paused: int = 0
    depeg_pause_pnl: float = 0.0  # P&L impact during the depeg event window


# --------------------------------------------------------------------------- #
# Inline decision helper (hot path)                                            #
# --------------------------------------------------------------------------- #


def _decide_action_fast(
    *,
    anchor: float,
    current_price: float,
    bars_since_last_refresh: int,
    refresh_bars: int,
    depeg_threshold_pct: float,
    pause_bars: int,
    bars_outside_band: int,
    paused: bool,
) -> Decision:
    """Fast inline equivalent of :func:`signal.decide_action`.

    Avoids re-allocating the entire price-history Series on every iteration
    (the public ``decide_action`` is convenient for tests but quadratic when
    called from a tight loop). Behavior is identical given precomputed
    ``anchor`` and ``bars_outside_band``.
    """
    if anchor <= 0.0:
        return Decision(Action.HOLD, None, "no anchor")
    deviation = abs(current_price - anchor) / anchor * 100.0
    is_currently_outside = deviation > depeg_threshold_pct + 1e-9

    if is_currently_outside and bars_outside_band >= pause_bars:
        return Decision(Action.FLATTEN_AND_PAUSE, None, "sustained_depeg_circuit_breaker")
    if paused and not is_currently_outside:
        return Decision(Action.RESUME, anchor, "peg_recovered_resume")
    if paused:
        return Decision(Action.HOLD, None, "paused: still outside band")
    if bars_since_last_refresh >= refresh_bars:
        return Decision(Action.REPLACE_GRID, anchor, "refresh_interval")
    return Decision(Action.HOLD, None, "hold")


# --------------------------------------------------------------------------- #
# Public entry point                                                           #
# --------------------------------------------------------------------------- #


def simulate_grid(
    prices: pd.DataFrame,
    params: dict[str, Any],
    *,
    progress_every: int = 200_000,
    pair_label: str | None = None,
) -> GridBacktestResult:
    """Drive the GridOrderbook tick-by-tick over the price series.

    Parameters
    ----------
    prices:
        DataFrame with ``close`` and (optionally) ``volume`` columns.
    params:
        Strategy parameters (see params.yaml). Required keys:
        ``anchor_window_bars``, ``num_levels``, ``spacing_bps``, ``peg``,
        ``per_pair_budget``, ``max_inventory_pct``, ``refresh_hours``,
        ``depeg_threshold_pct``, ``depeg_pause_hours``,
        ``daily_loss_limit_pct``, ``maker_fee_bps``, ``taker_fee_bps``,
        ``maker_taker_mix``, ``max_orders_per_min``,
        ``volume_pause_threshold``, ``volume_window_days``.
    progress_every:
        Print a progress line every N bars (0 = silent).
    pair_label:
        Optional pair name surfaced in the result for reporting.
    """
    if "close" not in prices.columns:
        raise ValueError("prices must have a 'close' column")
    has_volume = "volume" in prices.columns

    close = prices["close"].astype(float).to_numpy()
    volume = (
        prices["volume"].astype(float).to_numpy()
        if has_volume
        else np.ones_like(close, dtype=np.float64)
    )
    n = close.size
    if n == 0:
        raise ValueError("prices is empty")

    # ---- read params --------------------------------------------------- #
    anchor_window_bars = int(params["anchor_window_bars"])
    num_levels = int(params["num_levels"])
    spacing_bps = float(params["spacing_bps"])
    refresh_bars = int(params["refresh_hours"]) * 60
    depeg_threshold_pct = float(params["depeg_threshold_pct"])
    depeg_pause_hours = int(params["depeg_pause_hours"])
    daily_loss_limit_pct = float(params["daily_loss_limit_pct"])
    initial_cash = float(params.get("initial_cash", params["per_pair_budget"]))
    per_pair_budget = float(params["per_pair_budget"])
    n_levels_total = 2 * num_levels
    order_size = per_pair_budget / n_levels_total
    max_orders_per_min = int(params["max_orders_per_min"])
    max_inventory_pct = float(params.get("max_inventory_pct", 0.5))
    max_inventory_quote = max_inventory_pct * per_pair_budget

    volume_pause_threshold = float(params.get("volume_pause_threshold", 0.0))
    volume_window_bars = int(params.get("volume_window_days", 30)) * BARS_PER_DAY

    book = GridOrderbook(
        anchor_price=1.0,
        levels_above=num_levels,
        levels_below=num_levels,
        spacing_bps=spacing_bps,
        order_size_quote=order_size,
        maker_fee_bps=float(params["maker_fee_bps"]),
        taker_fee_bps=float(params["taker_fee_bps"]),
        maker_taker_mix=float(params["maker_taker_mix"]),
        max_inventory_quote=max_inventory_quote,
    )

    # ---- per-bar state -------------------------------------------------- #
    cash = initial_cash
    equity_arr = np.full(n, initial_cash, dtype=np.float64)
    bars_since_refresh = 0
    grid_active = False
    paused = False
    halted_today = False
    day_open_equity = initial_cash
    last_day_idx = -1
    orders_placed_this_min = 0
    last_minute_idx = -1
    bars_outside_band = 0
    bars_paused_total = 0
    depeg_event_pnl_start = initial_cash
    depeg_event_active = False
    depeg_event_pnl = 0.0
    prev_price = close[0]

    # ---- precompute rolling stats (vectorized; major perf win) ------- #
    peg_fallback = float(params.get("peg", 1.0))
    # Rolling 7d median anchor; falls back to peg_fallback during warmup.
    close_series = pd.Series(close)
    anchor_full = (
        close_series.rolling(anchor_window_bars, min_periods=anchor_window_bars)
        .median()
        .to_numpy()
    )
    # NaN warmup -> peg fallback.
    np.nan_to_num(anchor_full, copy=False, nan=peg_fallback)
    anchor_full = np.where(anchor_full <= 0.0, peg_fallback, anchor_full)

    if has_volume and volume_pause_threshold > 0.0:
        median_volume = (
            pd.Series(volume).rolling(volume_window_bars, min_periods=1).median().to_numpy()
        )
        recent_volume = (
            pd.Series(volume).rolling(BARS_PER_DAY, min_periods=1).sum().to_numpy()
        )
    else:
        median_volume = np.full(n, np.nan, dtype=np.float64)
        recent_volume = np.full(n, np.nan, dtype=np.float64)

    # Pause window in 1-min bars.
    pause_bars = depeg_pause_hours * 60

    for i in range(n):
        cur_price = close[i]

        # ---- daily-loss-limit reset on day rollover ------------------- #
        day_idx = i // BARS_PER_DAY
        if day_idx != last_day_idx:
            day_open_equity = equity_arr[i - 1] if i > 0 else initial_cash
            halted_today = False
            last_day_idx = day_idx

        # Order rate-limit window resets each minute.
        if i != last_minute_idx:
            orders_placed_this_min = 0
            last_minute_idx = i

        # ---- intra-bar fills based on prev->cur crossings ------------- #
        if grid_active and not halted_today and not paused:
            crossed_levels = book.crossings(prev_price, cur_price)
            for level in crossed_levels:
                rung = book.rungs.get(level)
                if rung is None:
                    continue  # already filled by an earlier crossing this bar
                event = book.fill_event_handler(level, timestamp_idx=i)
                if event is None:
                    # Suppressed by inventory cap.
                    continue
                if event.side is OrderSide.BUY:
                    cash -= event.quote_notional
                else:  # SELL
                    cash += event.quote_notional
                cash -= event.fee_quote
                orders_placed_this_min += 1
                if orders_placed_this_min > max_orders_per_min:
                    break

        # ---- maintain depeg-band counter (vectorized lookup) ----------- #
        anchor = anchor_full[i]
        deviation = abs(cur_price - anchor) / anchor * 100.0 if anchor > 0 else 0.0
        if deviation > depeg_threshold_pct + 1e-9:
            bars_outside_band += 1
        else:
            bars_outside_band = 0

        # Detect entry/exit of depeg event for diagnostic P&L.
        if deviation > depeg_threshold_pct and not depeg_event_active:
            depeg_event_active = True
            depeg_event_pnl_start = equity_arr[i - 1] if i > 0 else initial_cash
        elif deviation <= depeg_threshold_pct and depeg_event_active:
            current_eq = cash + book.open_inventory_quote(cur_price)
            depeg_event_pnl += current_eq - depeg_event_pnl_start
            depeg_event_active = False

        # ---- decide action (inline for speed) ------------------------- #
        decision = _decide_action_fast(
            anchor=anchor,
            current_price=cur_price,
            bars_since_last_refresh=bars_since_refresh,
            refresh_bars=refresh_bars,
            depeg_threshold_pct=depeg_threshold_pct,
            pause_bars=pause_bars,
            bars_outside_band=bars_outside_band,
            paused=paused,
        )

        if decision.action is Action.REPLACE_GRID and decision.anchor_price is not None:
            book.place_grid(decision.anchor_price)
            grid_active = True
            bars_since_refresh = 0
        elif decision.action is Action.RESUME and decision.anchor_price is not None:
            book.place_grid(decision.anchor_price)
            grid_active = True
            paused = False
            bars_since_refresh = 0
        elif decision.action is Action.FLATTEN_AND_PAUSE:
            cash += book.flatten(cur_price)
            grid_active = False
            paused = True
        else:
            bars_since_refresh += 1

        # ---- volume guard --------------------------------------------- #
        if has_volume and volume_pause_threshold > 0.0 and not paused and grid_active:
            if is_volume_dead(
                recent_volume[i],
                median_volume[i],
                volume_pause_threshold,
            ):
                cash += book.flatten(cur_price)
                grid_active = False
                paused = True

        # ---- daily-loss-limit ----------------------------------------- #
        equity_now = cash + book.open_inventory_quote(cur_price)
        if not halted_today and day_open_equity > 0:
            drawdown_today = (day_open_equity - equity_now) / day_open_equity * 100.0
            if drawdown_today >= daily_loss_limit_pct:
                cash += book.flatten(cur_price)
                grid_active = False
                halted_today = True
                equity_now = cash

        if paused:
            bars_paused_total += 1

        equity_arr[i] = equity_now
        prev_price = cur_price

        if progress_every > 0 and (i + 1) % progress_every == 0:
            done = (i + 1) / n * 100.0
            print(
                f"  ...{done:5.1f}% ({i + 1:>9,}/{n:,} bars)"
                f"  equity={equity_now:>10.2f}  fills={len(book.fills):>5}",
                flush=True,
            )

    equity = pd.Series(equity_arr, index=prices.index, name="equity")
    daily_pnl = equity.resample("1D").last().diff().dropna()

    summary = _compute_summary(equity, daily_pnl, fills=book.fills, n_bars=n)
    label = pair_label or params.get("pair", "stablecoin pair")

    return GridBacktestResult(
        name=f"range_grid_stables ({label})",
        equity=equity,
        daily_pnl=daily_pnl,
        fills=list(book.fills),
        params=params,
        summary=summary,
        skipped_buys_for_cap=book.skipped_buys_for_cap,
        bars_paused=bars_paused_total,
        depeg_pause_pnl=depeg_event_pnl,
    )


# --------------------------------------------------------------------------- #
# Summary stats                                                                #
# --------------------------------------------------------------------------- #


def _compute_summary(
    equity: pd.Series,
    daily_pnl: pd.Series,
    *,
    fills: list[FillEvent],
    n_bars: int,
) -> dict[str, float]:
    """Annualized return, max DD, Sharpe, total fills, average bps/trade."""
    if equity.empty:
        return {
            "ann_return": 0.0,
            "max_dd": 0.0,
            "sharpe": 0.0,
            "total_fills": 0.0,
            "total_round_trips": 0.0,
            "total_fees_quote": 0.0,
            "final_equity": 0.0,
            "avg_profit_bps_per_trade": 0.0,
            "trades_per_day": 0.0,
        }

    initial = float(equity.iloc[0])
    final = float(equity.iloc[-1])
    years = n_bars / BARS_PER_YEAR
    if years <= 0 or initial <= 0 or final <= 0:
        ann_return = 0.0
    else:
        ann_return = (final / initial) ** (1.0 / years) - 1.0

    arr = equity.to_numpy(dtype=np.float64)
    peak = np.maximum.accumulate(arr)
    dd = (arr - peak) / peak
    max_dd = float(dd.min())  # negative

    if not daily_pnl.empty and daily_pnl.std(ddof=1) > 0:
        daily_ret = daily_pnl / initial
        sharpe = float(np.sqrt(365.0) * daily_ret.mean() / daily_ret.std(ddof=1))
    else:
        sharpe = 0.0

    n_fills = len(fills)
    total_fees = float(sum(f.fee_quote for f in fills))
    n_sells = sum(1 for f in fills if f.side is OrderSide.SELL)
    n_round_trip_pnl = sum(f.realized_pnl_quote for f in fills if f.side is OrderSide.SELL)
    avg_profit_bps_per_trade = (
        (n_round_trip_pnl / n_sells) / max(initial, 1.0) * 10_000.0
        if n_sells > 0
        else 0.0
    )
    days = n_bars / BARS_PER_DAY
    trades_per_day = n_fills / days if days > 0 else 0.0

    return {
        "ann_return": float(ann_return),
        "max_dd": max_dd,
        "sharpe": sharpe,
        "total_fills": float(n_fills),
        "total_round_trips": float(n_sells),
        "total_fees_quote": total_fees,
        "final_equity": final,
        "avg_profit_bps_per_trade": float(avg_profit_bps_per_trade),
        "trades_per_day": float(trades_per_day),
    }
