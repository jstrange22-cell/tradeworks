"""Position sizing: ATR-based risk units and fractional Kelly.

Use these as **inputs** to `signal.size`, not as final allocators. The engine
caps total leverage downstream.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Hard cap on Kelly fraction. Full Kelly is way too aggressive in practice; even
# half-Kelly can blow up if win-rate / win-loss-ratio estimates are off.
KELLY_MAX_CAP: float = 0.25


def atr(
    ohlcv: pd.DataFrame,
    *,
    period: int = 14,
) -> pd.Series:
    """Average True Range over `period` bars.

    Wilder's smoothing (EMA with alpha = 1/period). NaN for the first
    `period - 1` rows.
    """
    required = {"high", "low", "close"}
    missing = required - set(ohlcv.columns)
    if missing:
        raise ValueError(f"ohlcv missing columns: {sorted(missing)}")

    high = ohlcv["high"].astype(float)
    low = ohlcv["low"].astype(float)
    close = ohlcv["close"].astype(float)
    prev_close = close.shift(1)

    tr = pd.concat(
        [
            (high - low),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def atr_position_size(
    *,
    equity: float,
    atr_value: float,
    risk_per_trade: float = 0.01,
    atr_stop_multiple: float = 2.0,
) -> float:
    """Position size in *units* (shares/contracts) given ATR-based stop.

    Risk per trade is a fraction of equity (default 1%). Stop is `atr_stop_multiple`
    * current ATR. Position = equity * risk_per_trade / (atr * stop_multiple).

    Returns 0.0 if ATR is zero/NaN (insufficient data).
    """
    if not np.isfinite(atr_value) or atr_value <= 0.0:
        return 0.0
    if equity <= 0.0:
        return 0.0
    if not 0.0 < risk_per_trade <= 1.0:
        raise ValueError(f"risk_per_trade must be in (0, 1], got {risk_per_trade}")
    if atr_stop_multiple <= 0.0:
        raise ValueError(f"atr_stop_multiple must be > 0, got {atr_stop_multiple}")

    risk_dollars = equity * risk_per_trade
    stop_distance = atr_value * atr_stop_multiple
    return float(risk_dollars / stop_distance)


def fractional_kelly(
    *,
    win_rate: float,
    win_loss_ratio: float,
    kelly_fraction: float = 0.5,
) -> float:
    """Fractional Kelly fraction-of-equity to bet per trade.

    - `win_rate` in [0, 1]
    - `win_loss_ratio` = avg_win / |avg_loss|, must be > 0
    - `kelly_fraction` scales the raw Kelly down (0.5 = half-Kelly is sensible)

    Returns 0 if Kelly turns negative (no edge). Caps at KELLY_MAX_CAP.
    """
    if not 0.0 <= win_rate <= 1.0:
        raise ValueError(f"win_rate must be in [0, 1], got {win_rate}")
    if win_loss_ratio <= 0.0:
        raise ValueError(f"win_loss_ratio must be > 0, got {win_loss_ratio}")
    if not 0.0 < kelly_fraction <= 1.0:
        raise ValueError(f"kelly_fraction must be in (0, 1], got {kelly_fraction}")

    # Kelly criterion: f* = p - (1 - p) / b
    raw = win_rate - (1.0 - win_rate) / win_loss_ratio
    if raw <= 0.0:
        return 0.0
    return float(min(raw * kelly_fraction, KELLY_MAX_CAP))
