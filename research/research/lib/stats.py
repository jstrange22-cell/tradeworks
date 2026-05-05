"""Performance statistics: sharpe, sortino, max_dd, expectancy, calmar, MC max-DD CI.

All functions accept either a returns series (per-bar / per-trade) or an equity curve
where appropriate. Returns are arithmetic by default; switch to log via the `log` flag
where supported. NaNs are dropped, not zero-filled, to avoid silent bias.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    from collections.abc import Sequence

# Trading days per year — used for Sharpe/Sortino annualization. Crypto strategies
# should override to 365 when scaling.
DEFAULT_PERIODS_PER_YEAR: int = 252


@dataclass(frozen=True, slots=True)
class MonteCarloDDResult:
    """Result of a Monte Carlo bootstrap on trade pnls for max-drawdown CI."""

    median_max_dd: float
    ci_low_95: float
    ci_high_95: float
    p99_max_dd: float
    n_paths: int


def _as_array(x: pd.Series | np.ndarray | Sequence[float]) -> np.ndarray:
    """Coerce to 1-D float64 ndarray, dropping NaNs."""
    arr = np.asarray(x, dtype=np.float64).ravel()
    return arr[~np.isnan(arr)]


def sharpe(
    returns: pd.Series | np.ndarray,
    *,
    risk_free: float = 0.0,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> float:
    """Annualized Sharpe ratio. Returns 0.0 if std is zero or sample empty."""
    arr = _as_array(returns)
    if arr.size == 0:
        return 0.0
    excess = arr - (risk_free / periods_per_year)
    std = excess.std(ddof=1)
    # Guard against zero / NaN / pathologically tiny std (floating-point noise on
    # constant series). 1e-12 is well below any real-market volatility.
    if not np.isfinite(std) or std < 1e-12:
        return 0.0
    return float(excess.mean() / std * np.sqrt(periods_per_year))


def sortino(
    returns: pd.Series | np.ndarray,
    *,
    risk_free: float = 0.0,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> float:
    """Annualized Sortino ratio (downside-deviation denominator)."""
    arr = _as_array(returns)
    if arr.size == 0:
        return 0.0
    excess = arr - (risk_free / periods_per_year)
    downside = excess[excess < 0.0]
    if downside.size == 0:
        # No down days. Convention: large but finite, not inf.
        return float(excess.mean() * np.sqrt(periods_per_year) * 1e6)
    dd_std = np.sqrt((downside**2).mean())
    if not np.isfinite(dd_std) or dd_std < 1e-12:
        return 0.0
    return float(excess.mean() / dd_std * np.sqrt(periods_per_year))


def max_drawdown(equity_curve: pd.Series | np.ndarray) -> float:
    """Peak-to-trough drawdown as a negative float (-0.25 = -25%)."""
    arr = _as_array(equity_curve)
    if arr.size == 0:
        return 0.0
    peak = np.maximum.accumulate(arr)
    # Avoid div-by-zero on starts at 0.
    peak = np.where(peak == 0.0, np.nan, peak)
    dd = (arr - peak) / peak
    return float(np.nanmin(dd)) if np.any(~np.isnan(dd)) else 0.0


def expectancy(trade_pnls: pd.Series | np.ndarray) -> float:
    """Average pnl per trade in $ (or whatever unit the input is in)."""
    arr = _as_array(trade_pnls)
    if arr.size == 0:
        return 0.0
    return float(arr.mean())


def win_rate(trade_pnls: pd.Series | np.ndarray) -> float:
    """Fraction of trades with pnl > 0. Zero-pnl trades count as losses."""
    arr = _as_array(trade_pnls)
    if arr.size == 0:
        return 0.0
    return float((arr > 0.0).mean())


def calmar(
    returns: pd.Series | np.ndarray,
    *,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> float:
    """Annualized return / |max drawdown|. Returns 0.0 if no drawdown."""
    arr = _as_array(returns)
    if arr.size == 0:
        return 0.0
    equity = (1.0 + arr).cumprod()
    cagr_val = (equity[-1]) ** (periods_per_year / arr.size) - 1.0
    mdd = max_drawdown(equity)
    if mdd == 0.0:
        return 0.0
    return float(cagr_val / abs(mdd))


def cagr(
    returns: pd.Series | np.ndarray,
    *,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> float:
    """Compound annual growth rate from a per-bar returns series."""
    arr = _as_array(returns)
    if arr.size == 0:
        return 0.0
    equity = (1.0 + arr).cumprod()
    return float(equity[-1] ** (periods_per_year / arr.size) - 1.0)


def monte_carlo_dd_ci(
    trade_pnls: pd.Series | np.ndarray,
    *,
    n_paths: int = 10_000,
    initial_equity: float = 10_000.0,
    seed: int | None = 42,
) -> MonteCarloDDResult:
    """Bootstrap trade pnls n_paths times to build a 95% CI for max drawdown.

    Each path resamples-with-replacement from the realized trade pnl distribution,
    preserving sample size. We compute max_dd for each path and report the median,
    95% CI bounds, and p99 worst-case.
    """
    pnls = _as_array(trade_pnls)
    if pnls.size == 0:
        return MonteCarloDDResult(0.0, 0.0, 0.0, 0.0, n_paths)

    rng = np.random.default_rng(seed)
    n_trades = pnls.size
    # Resample-with-replacement: shape (n_paths, n_trades).
    samples = rng.choice(pnls, size=(n_paths, n_trades), replace=True)
    # Build equity curves: cumulative sum starting from initial_equity.
    equity_paths = initial_equity + np.cumsum(samples, axis=1)
    # Max drawdown per path, vectorized.
    running_peak = np.maximum.accumulate(equity_paths, axis=1)
    # Guard against zero peaks (initial_equity > 0 keeps us safe in practice).
    safe_peak = np.where(running_peak == 0.0, np.nan, running_peak)
    dds = (equity_paths - safe_peak) / safe_peak
    max_dds = np.nanmin(dds, axis=1)

    return MonteCarloDDResult(
        median_max_dd=float(np.median(max_dds)),
        ci_low_95=float(np.percentile(max_dds, 2.5)),
        ci_high_95=float(np.percentile(max_dds, 97.5)),
        p99_max_dd=float(np.percentile(max_dds, 1.0)),
        n_paths=n_paths,
    )


def summarize(
    returns: pd.Series | np.ndarray,
    trade_pnls: pd.Series | np.ndarray | None = None,
    *,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> dict[str, float]:
    """Build a summary stats dict suitable for reports.

    `returns` is per-bar returns. `trade_pnls` is per-trade pnl in $; pass None if
    your strategy is bar-level only (in which case trade-level stats are 0).
    """
    arr = _as_array(returns)
    if arr.size == 0:
        return {
            "sharpe": 0.0,
            "sortino": 0.0,
            "calmar": 0.0,
            "cagr": 0.0,
            "max_dd": 0.0,
            "win_rate": 0.0,
            "expectancy": 0.0,
            "num_trades": 0.0,
        }
    equity = (1.0 + arr).cumprod()
    pnls_arr = _as_array(trade_pnls) if trade_pnls is not None else np.array([])
    return {
        "sharpe": sharpe(arr, periods_per_year=periods_per_year),
        "sortino": sortino(arr, periods_per_year=periods_per_year),
        "calmar": calmar(arr, periods_per_year=periods_per_year),
        "cagr": cagr(arr, periods_per_year=periods_per_year),
        "max_dd": max_drawdown(equity),
        "win_rate": win_rate(pnls_arr),
        "expectancy": expectancy(pnls_arr),
        "num_trades": float(pnls_arr.size),
    }
