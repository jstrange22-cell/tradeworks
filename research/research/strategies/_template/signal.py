"""Template signal generator: SMA crossover.

Long when fast SMA crosses above slow SMA; flat when it crosses back below.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


def generate_signals(
    ohlcv: pd.DataFrame,
    params: dict[str, Any],
) -> pd.DataFrame:
    """Return a DataFrame with columns [entry, exit, size] indexed like ohlcv.

    Required `params` keys: `sma_fast`, `sma_slow`, `warmup_bars`, `position_size`.
    """
    if "close" not in ohlcv.columns:
        raise ValueError("ohlcv must have a 'close' column")

    fast = int(params.get("sma_fast", 20))
    slow = int(params.get("sma_slow", 50))
    warmup = int(params.get("warmup_bars", slow))
    size = float(params.get("position_size", 1.0))

    if fast >= slow:
        raise ValueError(f"sma_fast must be < sma_slow (got {fast} vs {slow})")

    close = ohlcv["close"].astype(float)
    sma_fast = close.rolling(fast, min_periods=fast).mean()
    sma_slow = close.rolling(slow, min_periods=slow).mean()

    long_state = (sma_fast > sma_slow).fillna(False)
    long_state[:warmup] = False  # respect warmup explicitly

    # Entry on rising edge of long_state, exit on falling edge.
    state_int = long_state.astype(int)
    diff = state_int.diff().fillna(0).astype(int)
    entries = diff > 0
    exits = diff < 0

    return pd.DataFrame(
        {
            "entry": entries.astype(bool),
            "exit": exits.astype(bool),
            "size": pd.Series(size, index=ohlcv.index, dtype=float),
        }
    )
