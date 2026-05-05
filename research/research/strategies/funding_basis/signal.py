"""Signal logic for the funding-basis trade.

Entry decision is per-pair, evaluated once per 8h funding period:

    enter when:
        - not currently in basis for this pair
        - funding_rate of the most recent settled period >= funding_min_per_period
        - global open-pair count < max_pairs

    exit when:
        - funding has been negative for `exit_neg_periods` consecutive periods, OR
        - |perp_close - spot_close| / spot_close > spread_blow_out, OR
        - macro kill-switch fires (caller passes the flag)

The `decide_position` function is pure — given the current state and the most recent
period's data, it returns an action. The `BasisBacktest` runner in run.py glues these
decisions across the full timeline.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Final, Literal

import numpy as np
import pandas as pd

Action = Literal["enter", "exit", "hold"]


@dataclass(slots=True)
class PairState:
    """Runtime state for one pair during the backtest."""

    pair: str
    in_basis: bool = False
    entry_index: int | None = None
    notional: float = 0.0
    spot_entry_price: float = 0.0
    perp_entry_price: float = 0.0
    # Rolling window of the most recent funding rates while in basis.
    recent_funding: deque[float] = field(default_factory=lambda: deque(maxlen=8))


@dataclass(frozen=True, slots=True)
class SignalParams:
    """Strict, type-safe view over the params dict."""

    funding_min_per_period: float
    exit_neg_periods: int
    spread_blow_out: float
    max_pairs: int
    macro_kill_switch: bool

    @classmethod
    def from_dict(cls, params: dict[str, object]) -> SignalParams:
        return cls(
            funding_min_per_period=float(params.get("funding_min_per_period", 0.0005)),  # type: ignore[arg-type]
            exit_neg_periods=int(params.get("exit_neg_periods", 3)),                      # type: ignore[arg-type]
            spread_blow_out=float(params.get("spread_blow_out", 0.01)),                  # type: ignore[arg-type]
            max_pairs=int(params.get("max_pairs", 3)),                                    # type: ignore[arg-type]
            macro_kill_switch=bool(params.get("macro_kill_switch", True)),                # type: ignore[arg-type]
        )


_NEAR_ZERO: Final[float] = 1e-12


def funding_flip_to_negative(
    state: PairState,
    *,
    threshold_periods: int,
) -> bool:
    """Return True when the trailing N funding observations are all <= 0.

    Uses `state.recent_funding` (a deque maintained by the runner). If the deque
    has fewer than `threshold_periods` samples, returns False — we wait for a
    full window before flipping out.
    """
    if not state.in_basis:
        return False
    if len(state.recent_funding) < threshold_periods:
        return False
    last_n = list(state.recent_funding)[-threshold_periods:]
    return all(x <= 0.0 + _NEAR_ZERO for x in last_n)


def spread_widened(
    spot_close: float,
    perp_close: float,
    *,
    threshold: float,
) -> bool:
    """Return True if |perp - spot| / spot exceeds threshold (e.g. 1%).

    A real basis blow-out flags a tracking-error risk: perp could be deviating from
    spot for a sustained period, which means our offsetting positions are no longer
    clean delta-neutral.
    """
    if spot_close <= 0.0:
        return False
    return abs(perp_close - spot_close) / spot_close > threshold


def decide_position(
    state: PairState,
    *,
    funding_rate: float,
    spot_close: float,
    perp_close: float,
    open_pair_count: int,
    macro_risk_off: bool,
    sp: SignalParams,
) -> Action:
    """Pure decision: given current state + bar data, what action to take.

    Note: `funding_rate` is the rate that just settled this period. The basis trade
    earns it next period. So entering on a rich rate captures the rich rate going
    forward (one period of look-ahead is intentional and matches real execution —
    you observe the realized funding, then decide).
    """
    # Already in basis: only consider exits.
    if state.in_basis:
        if sp.macro_kill_switch and macro_risk_off:
            return "exit"
        if funding_flip_to_negative(state, threshold_periods=sp.exit_neg_periods):
            return "exit"
        if spread_widened(spot_close, perp_close, threshold=sp.spread_blow_out):
            return "exit"
        return "hold"

    # Not in basis: only consider entry. Capacity limit + funding floor + macro filter.
    if sp.macro_kill_switch and macro_risk_off:
        return "hold"
    if open_pair_count >= sp.max_pairs:
        return "hold"
    if funding_rate < sp.funding_min_per_period:
        return "hold"
    return "enter"


def funding_rate_distribution_summary(
    funding_history: pd.DataFrame,
) -> dict[str, float]:
    """Quick summary stats on a funding-rate frame for the report.

    Expects a frame with a `funding_rate` column.
    """
    rates = funding_history["funding_rate"].dropna().to_numpy(dtype=np.float64)
    if rates.size == 0:
        return {"n": 0.0}
    return {
        "n": float(rates.size),
        "mean_per_period": float(rates.mean()),
        "mean_apr": float(rates.mean()) * 1095.0,  # 365 * 3
        "median_per_period": float(np.median(rates)),
        "p05": float(np.percentile(rates, 5.0)),
        "p95": float(np.percentile(rates, 95.0)),
        "pct_positive": float((rates > 0.0).mean()),
        "pct_above_5bp": float((rates > 0.0005).mean()),
    }
