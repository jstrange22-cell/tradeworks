"""Sector rotation signal generator.

Cross-sectional momentum: rank the 11 SPDR sector ETFs by trailing ROC, take the
top-N, optionally apply an absolute-momentum filter (Antonacci dual momentum),
and equal-weight the survivors. Cash overflow goes to SHV (short treasuries).

This module is **stateless**: given price history up to a rebalance date, it
returns target weights for the next holding period. The runner (`run.py`) is
responsible for calling this on each rebalance date and stitching together
the equity curve. The drawdown circuit-breaker is also evaluated in the runner
because it depends on portfolio history, not the price universe.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

# 11 SPDR sector ETFs + SHV (cash proxy). Ordered for deterministic ranking
# tiebreaks (alphabetical within tied ROCs is fine for our purposes).
SECTOR_TICKERS: tuple[str, ...] = (
    "XLB",   # Materials
    "XLC",   # Communication Services
    "XLE",   # Energy
    "XLF",   # Financials
    "XLI",   # Industrials
    "XLK",   # Technology
    "XLP",   # Consumer Staples
    "XLRE",  # Real Estate
    "XLU",   # Utilities
    "XLV",   # Health Care
    "XLY",   # Consumer Discretionary
)
CASH_TICKER: str = "SHV"


@dataclass(frozen=True, slots=True)
class RebalanceParams:
    """Validated rebalance knobs (subset of params.yaml relevant to signal)."""

    roc_lookback: int = 21
    top_n: int = 3
    dual_momentum: bool = True

    def __post_init__(self) -> None:
        if self.roc_lookback < 2:
            raise ValueError(f"roc_lookback must be >= 2 (got {self.roc_lookback})")
        if self.top_n < 1 or self.top_n > len(SECTOR_TICKERS):
            raise ValueError(
                f"top_n must be in [1, {len(SECTOR_TICKERS)}] (got {self.top_n})"
            )


def _params_from_dict(params: dict[str, Any]) -> RebalanceParams:
    """Coerce a params dict into a validated RebalanceParams."""
    return RebalanceParams(
        roc_lookback=int(params.get("roc_lookback", 21)),
        top_n=int(params.get("top_n", 3)),
        dual_momentum=bool(params.get("dual_momentum", True)),
    )


def compute_roc(
    prices: dict[str, pd.DataFrame],
    asof: pd.Timestamp,
    *,
    lookback: int,
) -> dict[str, float]:
    """Return ROC over `lookback` trading days as of `asof` for each ticker.

    Uses each ticker's `close` series. Tickers with insufficient history are
    omitted (caller must handle missing keys). ROC = close[asof] / close[asof - lookback] - 1.
    """
    out: dict[str, float] = {}
    for ticker, df in prices.items():
        if "close" not in df.columns:
            raise ValueError(f"prices['{ticker}'] missing 'close' column")
        # All bars at-or-before asof.
        history = df.loc[df.index <= asof, "close"]
        if len(history) <= lookback:
            continue
        recent = float(history.iloc[-1])
        prior = float(history.iloc[-1 - lookback])
        if prior <= 0.0:
            continue
        out[ticker] = recent / prior - 1.0
    return out


def rebalance(
    prices: dict[str, pd.DataFrame],
    date: pd.Timestamp,
    params: dict[str, Any] | None = None,
) -> dict[str, float]:
    """Compute target portfolio weights as of `date`.

    Args:
        prices: dict mapping ticker -> OHLCV DataFrame (must include `close`).
                Must contain all 11 SECTOR_TICKERS plus the CASH_TICKER (SHV).
        date: the rebalance timestamp. Weights are computed using all data
              with index <= date.
        params: dict of rebalance knobs. See RebalanceParams.

    Returns:
        dict[ticker -> weight] summing to ~1.0 (within float tolerance).
        Tickers absent from the dict have weight 0.

    Logic:
        1. Compute trailing-`roc_lookback` ROC for the 11 sectors.
        2. Sort by ROC descending; take the top-N.
        3. If `dual_momentum`, drop any sector whose ROC <= 0.
        4. Equal-weight survivors (1/top_n each).
        5. If fewer than top_n sectors qualify, the remainder goes to SHV.
        6. If zero sectors qualify, 100% SHV.
    """
    p = _params_from_dict(params or {})

    if CASH_TICKER not in prices:
        raise ValueError(f"prices must include cash proxy '{CASH_TICKER}'")
    missing = [t for t in SECTOR_TICKERS if t not in prices]
    if missing:
        raise ValueError(f"prices missing sector tickers: {missing}")

    rocs = compute_roc(
        {t: prices[t] for t in SECTOR_TICKERS},
        date,
        lookback=p.roc_lookback,
    )

    # Sort by ROC desc; alphabetical ticker as a stable tiebreak.
    ranked = sorted(rocs.items(), key=lambda kv: (-kv[1], kv[0]))

    # Take the top-N candidates first, then apply dual-momentum filter.
    candidates = [(t, r) for t, r in ranked[: p.top_n]]
    if p.dual_momentum:
        candidates = [(t, r) for t, r in candidates if r > 0.0]

    weights: dict[str, float] = {}
    if candidates:
        equal_w = 1.0 / p.top_n
        for ticker, _roc in candidates:
            weights[ticker] = equal_w
    cash_weight = 1.0 - sum(weights.values())
    # Floating-point cleanup: if cash is essentially zero, drop it from output.
    if cash_weight > 1e-9:
        weights[CASH_TICKER] = cash_weight

    return weights


def apply_drawdown_breaker(
    weights: dict[str, float],
    *,
    portfolio_drawdown: float,
    breaker_threshold: float,
) -> dict[str, float]:
    """Override `weights` with 100% cash if drawdown breached.

    Args:
        weights: target weights from `rebalance()`.
        portfolio_drawdown: current portfolio drawdown as a NEGATIVE fraction
            (e.g. -0.13 for -13%). Pass 0.0 if at peak.
        breaker_threshold: positive fraction; if |drawdown| > breaker_threshold,
            allocate 100% to cash. Set to 0 or negative to disable.

    Returns:
        Either the original weights (if breaker not triggered) or {CASH_TICKER: 1.0}.
    """
    if breaker_threshold <= 0.0:
        return weights
    if portfolio_drawdown < -abs(breaker_threshold):
        return {CASH_TICKER: 1.0}
    return weights
