"""Signal layer for the stablecoin range-grid strategy.

Pure-functional helpers used by both :mod:`simulator` and the eventual
FreqTrade port. There is no I/O, no exchange concept, and no time concept —
everything operates on numpy/pandas series passed in by the caller.

Public surface
--------------
- :class:`GridOrder`  — immutable description of one rung in the ladder.
- :func:`generate_grid` — symmetric ladder of N bids + N asks around a peg.
- :func:`compute_anchor` — rolling 7-day median (with peg fallback while warm).
- :func:`is_depegged` — point-in-time deviation check.
- :class:`Action`, :class:`Decision` — high-level decisions emitted to the
  simulator: HOLD, REPLACE_GRID, FLATTEN_AND_PAUSE, RESUME.
- :func:`decide_action` — given price history + risk state, return a Decision.

The ``generate_signals`` shim at the bottom satisfies the walk-forward engine's
DataFrame contract; it returns a no-op frame because the grid strategy fills on
intra-bar limit orders, not on the bar close.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import numpy as np
import pandas as pd


# --------------------------------------------------------------------------- #
# Types                                                                        #
# --------------------------------------------------------------------------- #


class OrderSide(str, Enum):
    """Side of a resting limit order on the ladder."""

    BUY = "buy"
    SELL = "sell"


@dataclass(frozen=True)
class GridOrder:
    """Immutable spec of one rung in the grid.

    Attributes
    ----------
    level:
        Signed integer rung index. Negative -> buy below the peg; positive ->
        sell above. The anchor itself (level 0) is never quoted.
    side:
        :class:`OrderSide` consistent with ``level``.
    price:
        Limit price of the rung (quote currency per unit of base).
    notional_quote:
        Quote-currency notional of the order (e.g. USD value).
    """

    level: int
    side: OrderSide
    price: float
    notional_quote: float


class Action(str, Enum):
    """High-level decisions emitted by :func:`decide_action`.

    The simulator is expected to apply these atomically:

    - ``HOLD``               — keep the grid as-is.
    - ``REPLACE_GRID``       — re-anchor and re-place all rungs around the new
      anchor, **preserving open inventory** so partial fills still have an
      exit path.
    - ``FLATTEN_AND_PAUSE``  — depeg circuit breaker tripped or volume guard
      tripped: cancel every rung and unwind open inventory at the current
      mark. Strategy stays paused until ``RESUME`` is returned.
    - ``RESUME``             — peg recovered / volume returned; place a fresh
      grid on the next tick.
    """

    HOLD = "hold"
    REPLACE_GRID = "replace_grid"
    FLATTEN_AND_PAUSE = "flatten_and_pause"
    RESUME = "resume"


@dataclass(frozen=True)
class Decision:
    """Result of one signal evaluation."""

    action: Action
    anchor_price: float | None  # only set on REPLACE_GRID / RESUME
    reason: str


# --------------------------------------------------------------------------- #
# Grid construction                                                            #
# --------------------------------------------------------------------------- #


def generate_grid(
    *,
    peg: float,
    spacing_bps: float,
    num_levels: int,
    per_level_usd: float,
    inner_offset_bps: float | None = None,
) -> list[GridOrder]:
    """Build a symmetric ladder of ``num_levels`` bids + ``num_levels`` asks.

    Parameters
    ----------
    peg:
        Anchor price for the ladder (typically 1.0 or the rolling 7d median).
    spacing_bps:
        Distance between adjacent rungs in basis points.
    num_levels:
        Number of rungs on each side of the anchor.
    per_level_usd:
        Quote-currency notional placed on each rung.
    inner_offset_bps:
        Distance from the peg to the *innermost* rung. Defaults to
        ``2 * spacing_bps`` so the spec's exact ladder of
        (0.9990, 0.9985, 0.9980, 0.9975, 0.9970) and
        (1.0010, 1.0015, 1.0020, 1.0025, 1.0030) emerges with
        ``spacing_bps=5`` and ``num_levels=5``. Set this equal to
        ``spacing_bps`` for a "no-deadzone" grid (innermost rung 5bps from
        peg).

    Returns
    -------
    list[GridOrder]
        ``2 * num_levels`` orders. Buys are returned first (level=-1..-N) then
        sells (level=+1..+N). The anchor (level 0) is not quoted.

    Raises
    ------
    ValueError
        If any input is non-positive.
    """
    if peg <= 0.0:
        raise ValueError(f"peg must be positive, got {peg}")
    if spacing_bps <= 0.0:
        raise ValueError(f"spacing_bps must be positive, got {spacing_bps}")
    if num_levels <= 0:
        raise ValueError(f"num_levels must be positive, got {num_levels}")
    if per_level_usd <= 0.0:
        raise ValueError(f"per_level_usd must be positive, got {per_level_usd}")
    if inner_offset_bps is None:
        inner_offset_bps = 2.0 * spacing_bps
    if inner_offset_bps <= 0.0:
        raise ValueError(f"inner_offset_bps must be positive, got {inner_offset_bps}")

    spacing = spacing_bps / 10_000.0
    inner = inner_offset_bps / 10_000.0
    orders: list[GridOrder] = []
    # Innermost buy at peg * (1 - inner), then walk outward by ``spacing``.
    for k in range(1, num_levels + 1):
        offset = inner + (k - 1) * spacing
        orders.append(
            GridOrder(
                level=-k,
                side=OrderSide.BUY,
                price=peg * (1.0 - offset),
                notional_quote=per_level_usd,
            )
        )
    for k in range(1, num_levels + 1):
        offset = inner + (k - 1) * spacing
        orders.append(
            GridOrder(
                level=k,
                side=OrderSide.SELL,
                price=peg * (1.0 + offset),
                notional_quote=per_level_usd,
            )
        )
    return orders


# --------------------------------------------------------------------------- #
# Anchor / risk primitives                                                     #
# --------------------------------------------------------------------------- #


def compute_anchor(
    price_history: pd.Series,
    *,
    anchor_window_bars: int,
    peg_fallback: float = 1.0,
) -> float:
    """Rolling-window median of the recent close prices.

    Returns ``peg_fallback`` (default 1.0) while the history is shorter than
    ``anchor_window_bars`` — this lets the grid quote during the warmup period
    without waiting a full week for the median to populate.

    The median (rather than SMA) is more robust to brief jumps inside the
    window; a single 30-minute spike to 0.97 inside a 7-day window barely
    moves the median, but moves the SMA enough to skew the grid noticeably.
    """
    if len(price_history) < anchor_window_bars:
        return float(peg_fallback)
    window = price_history.iloc[-anchor_window_bars:]
    return float(np.median(window.to_numpy(dtype=np.float64)))


def is_depegged(
    current_price: float,
    anchor: float,
    threshold_pct: float,
) -> bool:
    """True if ``|current - anchor| / anchor`` exceeds ``threshold_pct``.

    A small absolute tolerance (1e-9) keeps floating-point dust from tripping
    the breaker exactly on the boundary.
    """
    if anchor <= 0.0 or not np.isfinite(current_price):
        return False
    deviation = abs(current_price - anchor) / anchor * 100.0
    return deviation > threshold_pct + 1e-9


def is_volume_dead(
    recent_volume: float,
    median_volume: float,
    threshold: float,
) -> bool:
    """True if rolling 24h volume is below ``threshold * median_volume``."""
    if median_volume <= 0.0 or not np.isfinite(recent_volume):
        return False
    return recent_volume < threshold * median_volume


# --------------------------------------------------------------------------- #
# Decision logic                                                               #
# --------------------------------------------------------------------------- #


def decide_action(
    price_history: pd.Series,
    *,
    bars_since_last_refresh: int,
    refresh_bars: int,
    anchor_window_bars: int,
    depeg_threshold_pct: float,
    depeg_pause_hours: int,
    bars_outside_band: int,
    paused: bool,
) -> Decision:
    """Decide what to do at the current bar.

    Parameters
    ----------
    price_history:
        Series of close prices up to and including the current bar.
    bars_since_last_refresh:
        Bars elapsed since the last grid replacement (time-based refresh).
    refresh_bars:
        Time-based refresh interval, in bars.
    anchor_window_bars:
        Window for the rolling median anchor.
    depeg_threshold_pct:
        Percent deviation that counts as a depeg (e.g. 1.5).
    depeg_pause_hours:
        How many hours the price must remain outside the band before we
        actually flatten. We track this via ``bars_outside_band`` rather than a
        timestamp so the function stays pure / testable.
    bars_outside_band:
        Counter the simulator maintains: number of consecutive bars the price
        has been outside the depeg band.
    paused:
        Whether the strategy is currently paused (depeg or volume guard).
    """
    # 1) During warmup the grid still quotes against the static peg of 1.0;
    #    we never hold during warmup because that would mean missing the
    #    initial grid placement entirely.
    anchor = compute_anchor(
        price_history,
        anchor_window_bars=anchor_window_bars,
        peg_fallback=1.0,
    )
    if not price_history.empty:
        current = float(price_history.iloc[-1])
    else:
        return Decision(Action.HOLD, None, "no price data yet")

    # 2) Depeg check: only if the price has been outside the band for the full
    #    pause window do we flatten. A brief flicker outside the band does
    #    not trip the breaker (otherwise an OU model with rare jumps would
    #    constantly halt).
    pause_bars = depeg_pause_hours * 60  # 1-min bars
    is_currently_outside = is_depegged(current, anchor, depeg_threshold_pct)

    if is_currently_outside and bars_outside_band >= pause_bars:
        return Decision(Action.FLATTEN_AND_PAUSE, None, "sustained_depeg_circuit_breaker")

    # 3) If we're already paused and the band has been restored, resume with
    #    a fresh grid on the current anchor.
    if paused and not is_currently_outside:
        return Decision(Action.RESUME, anchor, "peg_recovered_resume")

    # 4) If still paused, hold (paused state will be cleared by RESUME above).
    if paused:
        return Decision(Action.HOLD, None, "paused: still outside band")

    # 5) Time-based refresh.
    if bars_since_last_refresh >= refresh_bars:
        return Decision(Action.REPLACE_GRID, anchor, "refresh_interval")

    return Decision(Action.HOLD, None, "hold")


# --------------------------------------------------------------------------- #
# Walk-forward engine compatibility shim                                       #
# --------------------------------------------------------------------------- #


def generate_signals(
    ohlcv: pd.DataFrame,
    params: dict[str, Any],  # noqa: ARG001 — protocol parity
) -> pd.DataFrame:
    """No-op shim — the grid strategy uses :class:`simulator.GridSimulator`.

    The standard walk-forward engine expects a DataFrame of (entry, exit, size)
    columns produced from OHLCV. The grid strategy doesn't fit that contract
    because it keeps many limit orders working at once and fills happen at
    intra-bar prices, not on the bar close. This shim returns an empty frame
    so the strategy folder satisfies the scaffold contract without engaging
    the engine.
    """
    return pd.DataFrame(
        {
            "entry": pd.Series(False, index=ohlcv.index),
            "exit": pd.Series(False, index=ohlcv.index),
            "size": pd.Series(0.0, index=ohlcv.index),
        }
    )
