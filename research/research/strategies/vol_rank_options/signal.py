"""Vol-Rank entry signal.

Per-symbol scan: for each daily bar, decide whether the entry filters fire and
emit a `Setup` describing the put credit spread to open.

The entry rules (all must be true):
  1. IV-rank > iv_rank_min (top 30% of trailing 252d IV)
  2. close < SMA(20) - sigma_below * stdev(close, 20)
  3. close > SMA(200)              -- long-bias trend filter
  4. regime in {'calm', 'trending'} -- avoid 'crisis' / 'volatile'
  5. No earnings within next earnings_blackout_days

This module is read-only: it returns a list of `Setup` records. The runner
in `run.py` translates those into trade simulations.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import numpy as np
import pandas as pd

from . import pricing


@dataclass(frozen=True, slots=True)
class Setup:
    """One vol-rank trade setup.

    Strikes are computed using the *delta target* given the IV at signal time
    and a chosen DTE inside [dte_min, dte_max]. The runner then revalues this
    spread daily until profit/loss/time exits trigger.
    """

    entry_date: pd.Timestamp
    symbol: str
    spot: float
    iv_rank: float
    iv_at_entry: float
    expiry: pd.Timestamp
    dte_at_entry: int
    short_strike: float
    long_strike: float
    width: float
    credit_per_share: float
    credit_pct_of_width: float   # credit / width (typical "1/3 of width" rule of thumb)
    max_loss_per_share: float
    short_delta: float


def _iv_rank(iv: pd.Series, lookback: int) -> pd.Series:
    """Trailing-percentile IV rank in [0, 100].

    For each row, what percent of the prior `lookback` IV observations was the
    current IV strictly greater than? IV-rank > 70 means current IV is in the
    top 30% of the past year.
    """
    iv_arr = iv.to_numpy(dtype=np.float64)
    out = np.full_like(iv_arr, np.nan)
    n = iv_arr.size
    for i in range(lookback, n):
        window = iv_arr[i - lookback : i]
        # Strict less-than count (current beats N% of history).
        out[i] = float((window < iv_arr[i]).mean()) * 100.0
    return pd.Series(out, index=iv.index, name="iv_rank")


def _next_earnings_within(
    dates: pd.DatetimeIndex,
    earnings: pd.DatetimeIndex,
    days: int,
) -> pd.Series:
    """For each `dates[i]`, True if any earnings date lies within (dates[i], dates[i] + days].

    `earnings` is the calendar of earnings announcements for ONE symbol. If
    empty, returns all-False.
    """
    if len(earnings) == 0:
        return pd.Series(False, index=dates)

    earn_sorted = earnings.sort_values()
    out = np.zeros(len(dates), dtype=bool)
    earn_arr = earn_sorted.to_numpy()  # datetime64[ns]
    for i, d in enumerate(dates):
        d_np = np.datetime64(d)
        end_np = np.datetime64(d + timedelta(days=days))
        # searchsorted returns insertion index — anything in [d_np, end_np] is in blackout.
        lo = np.searchsorted(earn_arr, d_np, side="left")
        hi = np.searchsorted(earn_arr, end_np, side="right")
        out[i] = hi > lo
    return pd.Series(out, index=dates)


def find_entries(  # noqa: PLR0913 — needs the full filter knob set
    ohlcv: pd.DataFrame,
    iv_history: pd.Series,
    earnings_calendar: pd.DatetimeIndex,
    *,
    symbol: str,
    regimes: pd.Series | None = None,
    params: dict[str, Any] | None = None,
) -> list[Setup]:
    """Return a list of `Setup` records: one per qualifying entry day.

    `ohlcv`, `iv_history`, and `regimes` (if provided) must share an index.
    """
    if params is None:
        params = {}
    if "close" not in ohlcv.columns:
        raise ValueError("ohlcv must have a 'close' column")
    if not isinstance(ohlcv.index, pd.DatetimeIndex):
        raise TypeError("ohlcv must have a DatetimeIndex")

    iv_rank_min = float(params.get("iv_rank_min", 70.0))
    sigma_below = float(params.get("sigma_below", 2.0))
    sma_lookback = int(params.get("sma_lookback", 20))
    iv_rank_lookback = int(params.get("iv_rank_lookback", 252))
    trend_lookback = int(params.get("trend_filter_lookback", 200))
    blackout_days = int(params.get("earnings_blackout_days", 14))
    allowed_regimes: tuple[str, ...] = tuple(params.get("allowed_regimes", ("calm", "trending")))
    dte_min = int(params.get("dte_min", 30))
    dte_max = int(params.get("dte_max", 45))
    short_delta = float(params.get("short_delta", 0.30))
    long_delta = float(params.get("long_delta", 0.15))
    rfr = float(params.get("risk_free_rate", 0.045))

    close = ohlcv["close"].astype(float)
    iv = iv_history.reindex(close.index).ffill()

    # Indicators.
    sma20 = close.rolling(sma_lookback, min_periods=sma_lookback).mean()
    std20 = close.rolling(sma_lookback, min_periods=sma_lookback).std(ddof=0)
    sma200 = close.rolling(trend_lookback, min_periods=trend_lookback).mean()
    iv_rank = _iv_rank(iv, iv_rank_lookback)

    # Filters as boolean Series.
    f_iv = iv_rank > iv_rank_min
    f_stretch = close < (sma20 - sigma_below * std20)
    f_trend = close > sma200
    f_earnings = ~_next_earnings_within(close.index, earnings_calendar, blackout_days)

    if regimes is not None:
        f_regime = regimes.reindex(close.index).fillna("calm").isin(allowed_regimes)
    else:
        f_regime = pd.Series(True, index=close.index)

    qualifying = f_iv & f_stretch & f_trend & f_earnings & f_regime
    qualifying = qualifying.fillna(False).astype(bool)

    # Build setups.
    target_dte = (dte_min + dte_max) // 2  # 37 days for 30-45 default
    setups: list[Setup] = []
    for ts, fire in qualifying.items():
        if not bool(fire):
            continue
        spot = float(close.loc[ts])
        sigma = float(iv.loc[ts])
        if not np.isfinite(spot) or not np.isfinite(sigma) or spot <= 0 or sigma <= 0:
            continue

        expiry = ts + pd.Timedelta(days=target_dte)
        time_to_expiry = target_dte / 365.0
        try:
            short_k, long_k = pricing.select_spread_strikes(
                spot=spot,
                short_delta_target=short_delta,
                long_delta_target=long_delta,
                time_to_expiry=time_to_expiry,
                sigma=sigma,
                risk_free_rate=rfr,
            )
            quote = pricing.quote_put_spread(
                spot=spot,
                short_strike=short_k,
                long_strike=long_k,
                time_to_expiry=time_to_expiry,
                sigma=sigma,
                risk_free_rate=rfr,
            )
        except (ValueError, ZeroDivisionError):
            continue

        if quote.credit <= 0.0 or quote.width <= 0.0:
            continue

        setups.append(
            Setup(
                entry_date=pd.Timestamp(ts),
                symbol=symbol,
                spot=spot,
                iv_rank=float(iv_rank.loc[ts]),
                iv_at_entry=sigma,
                expiry=pd.Timestamp(expiry),
                dte_at_entry=target_dte,
                short_strike=quote.short_strike,
                long_strike=quote.long_strike,
                width=quote.width,
                credit_per_share=quote.credit,
                credit_pct_of_width=quote.credit / quote.width if quote.width > 0 else 0.0,
                max_loss_per_share=quote.max_loss,
                short_delta=quote.short_delta,
            )
        )
    return setups
