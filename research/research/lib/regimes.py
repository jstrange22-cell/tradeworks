"""Market regime classifier.

Each calendar day is labeled one of:
  - 'crisis'    : VIX > 35  OR (SPY < 200d MA AND VIX > 25)
  - 'volatile'  : VIX > 22
  - 'trending'  : SPY > 200d MA AND |20d return| > 0.03
  - 'calm'      : default

Strategies use the regime tag as a filter (e.g. `regime_trend` only takes
trades when label == 'trending').
"""

from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd

Regime = Literal["calm", "trending", "volatile", "crisis"]

# Thresholds. Sourced from common practitioner heuristics; tune per study.
VIX_CRISIS: float = 35.0
VIX_CRISIS_BELOW_MA: float = 25.0
VIX_VOLATILE: float = 22.0
TREND_RETURN_THRESHOLD: float = 0.03
SMA_LOOKBACK: int = 200
MOMENTUM_LOOKBACK: int = 20


def classify_regimes(
    spy_ohlcv: pd.DataFrame,
    vix: pd.Series,
) -> pd.Series:
    """Return a Series of regime labels indexed by SPY's DatetimeIndex.

    - `spy_ohlcv` must have a 'close' column with a DatetimeIndex.
    - `vix` is the VIX close series; will be re-indexed to SPY's index, ffilled.

    The first `SMA_LOOKBACK` bars are NaN-tolerant: 200d MA is undefined there,
    so we fall back to the VIX-only rules. We never label NaN — those bars get 'calm'.
    """
    if "close" not in spy_ohlcv.columns:
        raise ValueError("spy_ohlcv must have a 'close' column")
    if not isinstance(spy_ohlcv.index, pd.DatetimeIndex):
        raise TypeError("spy_ohlcv must have a DatetimeIndex")

    close = spy_ohlcv["close"].astype(float)
    vix_aligned = vix.reindex(close.index).ffill().astype(float)

    sma_200 = close.rolling(SMA_LOOKBACK, min_periods=SMA_LOOKBACK).mean()
    ret_20 = close.pct_change(MOMENTUM_LOOKBACK)

    above_ma = close > sma_200
    abs_ret_high = ret_20.abs() > TREND_RETURN_THRESHOLD

    # Build labels from most-restrictive to least.
    out = pd.Series("calm", index=close.index, dtype="object", name="regime")

    # Trending: must have valid 200MA and 20d return + above MA + strong move.
    trending_mask = above_ma.fillna(False) & abs_ret_high.fillna(False)
    out[trending_mask] = "trending"

    # Volatile: VIX > 22.
    volatile_mask = vix_aligned > VIX_VOLATILE
    out[volatile_mask] = "volatile"

    # Crisis: VIX > 35, OR (below 200MA AND VIX > 25). Crisis overrides volatile.
    below_ma = (~above_ma).fillna(False)
    crisis_mask = (vix_aligned > VIX_CRISIS) | (below_ma & (vix_aligned > VIX_CRISIS_BELOW_MA))
    out[crisis_mask] = "crisis"

    return out


def regime_breakdown(regimes: pd.Series) -> pd.DataFrame:
    """Return a DataFrame with regime counts and % of total days.

    Columns: ['regime', 'days', 'pct']. Sorted by `days` descending.
    """
    counts = regimes.value_counts()
    total = float(counts.sum())
    if total == 0.0:
        return pd.DataFrame(columns=["regime", "days", "pct"])
    return pd.DataFrame(
        {
            "regime": counts.index,
            "days": counts.to_numpy(dtype=int),
            "pct": (counts.to_numpy() / total * 100.0).round(2),
        }
    ).reset_index(drop=True)


def regime_filter(
    signals: pd.DataFrame,
    regimes: pd.Series,
    allowed: tuple[Regime, ...],
) -> pd.DataFrame:
    """Zero out entry signals on days whose regime isn't in `allowed`.

    Modifies a *copy*; original signals frame is untouched.
    """
    if "entry" not in signals.columns:
        raise ValueError("signals must have an 'entry' column")
    aligned = regimes.reindex(signals.index).fillna("calm")
    mask = aligned.isin(allowed)
    out = signals.copy()
    if np.issubdtype(out["entry"].dtype, np.bool_):
        out["entry"] = out["entry"] & mask
    else:
        out.loc[~mask, "entry"] = 0
    return out
