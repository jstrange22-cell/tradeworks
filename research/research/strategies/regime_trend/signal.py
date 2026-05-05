"""Regime-Filtered Trend Following (Strategy B2) signal generator.

Long-only entries fire when ALL of:
  - Price > N-day SMA (default 200) — canonical trend filter (Faber 2007)
  - K-day ROC > 0% (default 21) — positive momentum
  - ATR(P)-% within [lo, hi] percentiles of its rolling distribution
  - Regime in {calm, trending} (from `lib.regimes.classify_regimes`)
  - SPY > 200d MA confluence (optional, default True)

Exits:
  - Trailing stop: 1.5 * ATR(14) below highest close since entry
  - Regime flip: regime moves to {volatile, crisis} -> close immediately
  - Time stop: optional N-day max hold (default 90)

Two entry points:
  - `generate_signals(ohlcv, params)` — engine-compatible, per-symbol. Reads an
    optional pre-computed regime series and SPY close from `params` to gate entries.
  - `generate_trades(ohlcv_dict, spy, vix, params)` — portfolio-level. Iterates
    every symbol, materializes trades, and applies the max-concurrent-positions cap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from research.lib import regimes as regimes_lib
from research.lib import sizing


@dataclass(frozen=True, slots=True)
class Trade:
    """A single closed (or open) long trade for portfolio aggregation."""

    symbol: str
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp | None
    entry_price: float
    exit_price: float | None
    units: float
    exit_reason: str  # one of: 'trail', 'regime', 'time', 'open'


def _compute_indicators(
    ohlcv: pd.DataFrame,
    *,
    ma_period: int,
    roc_period: int,
    atr_period: int,
    vol_pctile_window: int,
    vol_pctile_lo: float,
    vol_pctile_hi: float,
) -> pd.DataFrame:
    """Compute trend / momentum / vol-percentile indicators on a single OHLCV frame.

    Returns a DataFrame with columns: sma, roc, atr, atr_pct, vol_lo, vol_hi.
    """
    close = ohlcv["close"].astype(float)
    sma = close.rolling(ma_period, min_periods=ma_period).mean()
    roc = close.pct_change(roc_period)

    atr_series = sizing.atr(ohlcv, period=atr_period)
    atr_pct = (atr_series / close) * 100.0

    # Rolling percentile bounds. min_periods=vol_pctile_window keeps NaN early.
    vol_lo = atr_pct.rolling(vol_pctile_window, min_periods=vol_pctile_window).quantile(
        vol_pctile_lo / 100.0
    )
    vol_hi = atr_pct.rolling(vol_pctile_window, min_periods=vol_pctile_window).quantile(
        vol_pctile_hi / 100.0
    )

    return pd.DataFrame(
        {
            "sma": sma,
            "roc": roc,
            "atr": atr_series,
            "atr_pct": atr_pct,
            "vol_lo": vol_lo,
            "vol_hi": vol_hi,
        }
    )


def _entry_mask(
    ohlcv: pd.DataFrame,
    indicators: pd.DataFrame,
    *,
    roc_min: float,
    regime_series: pd.Series | None,
    allowed_regimes: tuple[str, ...],
    spy_close: pd.Series | None,
    spy_ma_period: int,
    require_spy_trend: bool,
) -> pd.Series:
    """Build the boolean entry-permission mask (does NOT trigger on rising edge yet)."""
    close = ohlcv["close"].astype(float)
    above_sma = close > indicators["sma"]
    pos_momentum = indicators["roc"] > roc_min
    vol_in_band = (indicators["atr_pct"] >= indicators["vol_lo"]) & (
        indicators["atr_pct"] <= indicators["vol_hi"]
    )

    permit = above_sma & pos_momentum & vol_in_band

    if regime_series is not None:
        aligned = regime_series.reindex(close.index).ffill().fillna("calm")
        permit = permit & aligned.isin(allowed_regimes)

    if require_spy_trend and spy_close is not None:
        spy_aligned = spy_close.reindex(close.index).ffill().astype(float)
        spy_sma = spy_aligned.rolling(spy_ma_period, min_periods=spy_ma_period).mean()
        permit = permit & (spy_aligned > spy_sma).fillna(False)

    return permit.fillna(False).astype(bool)


def _walk_position(
    ohlcv: pd.DataFrame,
    indicators: pd.DataFrame,
    permit: pd.Series,
    *,
    trail_atr_multiple: float,
    time_stop_days: int | None,
    regime_series: pd.Series | None,
    allowed_regimes: tuple[str, ...],
) -> tuple[pd.Series, pd.Series, list[tuple[int, int, str]]]:
    """Walk the bars, entering on rising edge of permit, exiting on stop/regime/time.

    Returns (entry_signal, exit_signal, trade_indices) where trade_indices is a
    list of (entry_idx, exit_idx, reason). Exits are emitted on the bar where
    the trigger fires; the engine then executes at next bar's open.
    """
    n = len(ohlcv)
    close_arr = ohlcv["close"].to_numpy(dtype=np.float64)
    atr_arr = indicators["atr"].to_numpy(dtype=np.float64)
    permit_arr = permit.to_numpy(dtype=bool)

    if regime_series is not None:
        regime_arr = (
            regime_series.reindex(ohlcv.index).ffill().fillna("calm").to_numpy(dtype=object)
        )
    else:
        regime_arr = np.array(["calm"] * n, dtype=object)

    entry = np.zeros(n, dtype=bool)
    exit_ = np.zeros(n, dtype=bool)
    trades: list[tuple[int, int, str]] = []

    in_pos = False
    entry_idx = -1
    highest_close = -np.inf

    for i in range(n):
        if not in_pos:
            # Need rising edge of permit (was False yesterday, True today).
            prev_permit = permit_arr[i - 1] if i > 0 else False
            if permit_arr[i] and not prev_permit and np.isfinite(atr_arr[i]):
                entry[i] = True
                in_pos = True
                entry_idx = i
                highest_close = close_arr[i]
            continue

        # In position: update trailing-high, then check exits.
        if close_arr[i] > highest_close:
            highest_close = close_arr[i]

        # 1. Regime exit takes precedence (immediate risk-off).
        if regime_arr[i] not in allowed_regimes:
            exit_[i] = True
            trades.append((entry_idx, i, "regime"))
            in_pos = False
            entry_idx = -1
            highest_close = -np.inf
            continue

        # 2. Trailing ATR stop.
        atr_now = atr_arr[i] if np.isfinite(atr_arr[i]) else 0.0
        stop_level = highest_close - trail_atr_multiple * atr_now
        if close_arr[i] <= stop_level:
            exit_[i] = True
            trades.append((entry_idx, i, "trail"))
            in_pos = False
            entry_idx = -1
            highest_close = -np.inf
            continue

        # 3. Time stop.
        if time_stop_days is not None and (i - entry_idx) >= time_stop_days:
            exit_[i] = True
            trades.append((entry_idx, i, "time"))
            in_pos = False
            entry_idx = -1
            highest_close = -np.inf

    # Position still open at end-of-history: don't force-exit; engine will MTM.
    if in_pos:
        trades.append((entry_idx, n - 1, "open"))

    return (
        pd.Series(entry, index=ohlcv.index, name="entry"),
        pd.Series(exit_, index=ohlcv.index, name="exit"),
        trades,
    )


def _size_series(
    ohlcv: pd.DataFrame,
    indicators: pd.DataFrame,
    entry: pd.Series,
    *,
    risk_per_trade: float,
    max_position_pct: float,
    trail_atr_multiple: float,
) -> pd.Series:
    """Compute position size (fraction of equity) for each entry bar.

    size = min(risk_per_trade / (atr_pct/100 * trail_atr_multiple), max_position_pct).
    Equivalent to: dollars_at_risk / dollars_per_position-stop-distance, expressed
    as fraction of equity. Returns 0 on non-entry bars.
    """
    close = ohlcv["close"].astype(float)
    atr_pct_frac = (indicators["atr"] / close).astype(float)  # ATR as fraction of price
    stop_dist_frac = atr_pct_frac * trail_atr_multiple
    raw_size = (risk_per_trade / stop_dist_frac).where(stop_dist_frac > 0, other=0.0)
    sized = raw_size.clip(upper=max_position_pct).fillna(0.0)
    out = pd.Series(0.0, index=ohlcv.index, dtype=float)
    out[entry.astype(bool)] = sized[entry.astype(bool)]
    return out


def generate_signals(
    ohlcv: pd.DataFrame,
    params: dict[str, Any],
) -> pd.DataFrame:
    """Engine-compatible signal generator (single symbol).

    Recognized `params` keys:
      ma_period, roc_period, roc_min, atr_period, vol_pctile_window,
      vol_pctile_lo, vol_pctile_hi, require_spy_trend, allowed_regimes,
      trail_atr_multiple, time_stop_days, risk_per_trade, max_position_pct.

    Optional injected runtime keys:
      `_regime_series` (pd.Series of regime labels)
      `_spy_close`     (pd.Series of SPY close for confluence filter)
    """
    if "close" not in ohlcv.columns:
        raise ValueError("ohlcv must have a 'close' column")
    if not isinstance(ohlcv.index, pd.DatetimeIndex):
        raise TypeError("ohlcv must have a DatetimeIndex")

    ma_period = int(params.get("ma_period", 200))
    roc_period = int(params.get("roc_period", 21))
    roc_min = float(params.get("roc_min", 0.0))
    atr_period = int(params.get("atr_period", 14))
    vol_pctile_window = int(params.get("vol_pctile_window", 252))
    vol_pctile_lo = float(params.get("vol_pctile_lo", 25.0))
    vol_pctile_hi = float(params.get("vol_pctile_hi", 75.0))
    require_spy_trend = bool(params.get("require_spy_trend", True))
    allowed_regimes_param = params.get("allowed_regimes", ("calm", "trending"))
    allowed_regimes: tuple[str, ...] = tuple(allowed_regimes_param)
    trail_atr_multiple = float(params.get("trail_atr_multiple", 1.5))
    time_stop_raw = params.get("time_stop_days", 90)
    time_stop_days: int | None = int(time_stop_raw) if time_stop_raw is not None else None
    risk_per_trade = float(params.get("risk_per_trade", 0.004))
    max_position_pct = float(params.get("max_position_pct", 0.15))

    if not 0.0 <= vol_pctile_lo < vol_pctile_hi <= 100.0:
        raise ValueError(
            f"vol percentile bounds invalid: lo={vol_pctile_lo} hi={vol_pctile_hi}"
        )

    regime_series: pd.Series | None = params.get("_regime_series")
    spy_close: pd.Series | None = params.get("_spy_close")

    indicators = _compute_indicators(
        ohlcv,
        ma_period=ma_period,
        roc_period=roc_period,
        atr_period=atr_period,
        vol_pctile_window=vol_pctile_window,
        vol_pctile_lo=vol_pctile_lo,
        vol_pctile_hi=vol_pctile_hi,
    )

    permit = _entry_mask(
        ohlcv,
        indicators,
        roc_min=roc_min,
        regime_series=regime_series,
        allowed_regimes=allowed_regimes,
        spy_close=spy_close,
        spy_ma_period=ma_period,
        require_spy_trend=require_spy_trend,
    )

    entry, exit_, _trades = _walk_position(
        ohlcv,
        indicators,
        permit,
        trail_atr_multiple=trail_atr_multiple,
        time_stop_days=time_stop_days,
        regime_series=regime_series,
        allowed_regimes=allowed_regimes,
    )

    size = _size_series(
        ohlcv,
        indicators,
        entry,
        risk_per_trade=risk_per_trade,
        max_position_pct=max_position_pct,
        trail_atr_multiple=trail_atr_multiple,
    )

    return pd.DataFrame({"entry": entry, "exit": exit_, "size": size})


def generate_trades(
    ohlcv_dict: dict[str, pd.DataFrame],
    spy: pd.DataFrame,
    vix: pd.Series,
    params: dict[str, Any],
) -> list[Trade]:
    """Portfolio-level trade generator.

    Iterates every symbol, runs the per-symbol signal logic, materializes Trades,
    then applies the `max_concurrent_positions` cap by chronologically taking the
    earliest entries when the cap is hit.
    """
    if "close" not in spy.columns:
        raise ValueError("spy frame must have a 'close' column")
    regime_series = regimes_lib.classify_regimes(spy, vix)
    spy_close = spy["close"].astype(float)

    max_concurrent = int(params.get("max_concurrent_positions", 8))
    allowed_regimes: tuple[str, ...] = tuple(params.get("allowed_regimes", ("calm", "trending")))

    # Materialize per-symbol candidate trades.
    candidate: list[Trade] = []
    for symbol, ohlcv in ohlcv_dict.items():
        if not isinstance(ohlcv.index, pd.DatetimeIndex):
            continue

        # Re-use generate_signals with injected regime + spy.
        per_params = dict(params)
        per_params["_regime_series"] = regime_series
        per_params["_spy_close"] = spy_close

        # We need the trades list directly, not the signals frame; so call internal helpers.
        indicators = _compute_indicators(
            ohlcv,
            ma_period=int(params.get("ma_period", 200)),
            roc_period=int(params.get("roc_period", 21)),
            atr_period=int(params.get("atr_period", 14)),
            vol_pctile_window=int(params.get("vol_pctile_window", 252)),
            vol_pctile_lo=float(params.get("vol_pctile_lo", 25.0)),
            vol_pctile_hi=float(params.get("vol_pctile_hi", 75.0)),
        )
        permit = _entry_mask(
            ohlcv,
            indicators,
            roc_min=float(params.get("roc_min", 0.0)),
            regime_series=regime_series,
            allowed_regimes=allowed_regimes,
            spy_close=spy_close,
            spy_ma_period=int(params.get("ma_period", 200)),
            require_spy_trend=bool(params.get("require_spy_trend", True)),
        )
        _entry, _exit, trade_idxs = _walk_position(
            ohlcv,
            indicators,
            permit,
            trail_atr_multiple=float(params.get("trail_atr_multiple", 1.5)),
            time_stop_days=int(params["time_stop_days"])
            if params.get("time_stop_days") is not None
            else None,
            regime_series=regime_series,
            allowed_regimes=allowed_regimes,
        )
        risk = float(params.get("risk_per_trade", 0.004))
        cap = float(params.get("max_position_pct", 0.15))
        trail = float(params.get("trail_atr_multiple", 1.5))

        for entry_idx, exit_idx, reason in trade_idxs:
            entry_price = float(ohlcv["close"].iloc[entry_idx])
            atr_at_entry = float(indicators["atr"].iloc[entry_idx])
            if not np.isfinite(atr_at_entry) or atr_at_entry <= 0.0:
                continue
            stop_dist = trail * atr_at_entry
            # Per-trade unit count, not equity-aware (portfolio aggregator handles equity).
            position_value_frac = min(risk / (stop_dist / entry_price), cap)
            units = position_value_frac  # stored as equity fraction; aggregator scales.
            exit_price = (
                float(ohlcv["close"].iloc[exit_idx]) if reason != "open" else None
            )
            exit_date = ohlcv.index[exit_idx] if reason != "open" else None
            candidate.append(
                Trade(
                    symbol=symbol,
                    entry_date=ohlcv.index[entry_idx],
                    exit_date=exit_date,
                    entry_price=entry_price,
                    exit_price=exit_price,
                    units=units,
                    exit_reason=reason,
                )
            )

    # Apply max-concurrent constraint: at any moment, no more than `max_concurrent`
    # positions open. Chronological FIFO admission — accept earliest entries first.
    candidate.sort(key=lambda t: t.entry_date)
    accepted: list[Trade] = []
    open_positions: list[Trade] = []  # currently-held trades

    for trade in candidate:
        # Drop trades that exited before this trade's entry.
        open_positions = [
            t for t in open_positions if t.exit_date is None or t.exit_date > trade.entry_date
        ]
        if len(open_positions) >= max_concurrent:
            continue
        accepted.append(trade)
        open_positions.append(trade)

    return accepted
