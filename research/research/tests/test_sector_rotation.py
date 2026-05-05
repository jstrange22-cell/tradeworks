"""Tests for `research.strategies.sector_rotation`.

Covers:
- rebalance() outputs sum to ~1.0 and respect top_n
- dual-momentum filter behavior (positive-only sectors retained)
- drawdown breaker overrides to 100% cash on breach
- rebalance idempotency: same prices + same date -> same weights
- monthly turnover stays within sane bounds on the synthetic fixture
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research.strategies.sector_rotation import rebalance
from research.strategies.sector_rotation.run import (
    load_or_build_fixture,
    simulate_portfolio,
)
from research.strategies.sector_rotation.signal import (
    CASH_TICKER,
    SECTOR_TICKERS,
    apply_drawdown_breaker,
    compute_roc,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_constant_returns_prices(
    *,
    bars: int = 100,
    sector_daily_returns: dict[str, float] | None = None,
    cash_daily_return: float = 0.0001,
) -> dict[str, pd.DataFrame]:
    """Build prices where each sector grows at a fixed daily rate.

    Lets us control the ROC ranking exactly without random noise.
    """
    if sector_daily_returns is None:
        # Default: assign a unique linear ROC to each sector via daily-rate spread.
        # Higher index = lower return so XLB wins, XLY loses.
        sector_daily_returns = {
            t: 0.001 - 0.0001 * i for i, t in enumerate(SECTOR_TICKERS)
        }

    dates = pd.date_range(start="2020-01-01", periods=bars, freq="B")
    out: dict[str, pd.DataFrame] = {}
    for ticker, daily in sector_daily_returns.items():
        close = 100.0 * np.exp(np.cumsum(np.full(bars, daily)))
        open_ = np.r_[close[0], close[:-1]]
        out[ticker] = pd.DataFrame(
            {
                "open": open_,
                "high": close * 1.001,
                "low": close * 0.999,
                "close": close,
                "volume": np.full(bars, 1_000_000.0),
            },
            index=dates,
        )

    # Cash proxy.
    cash_close = 100.0 * np.exp(np.cumsum(np.full(bars, cash_daily_return)))
    out[CASH_TICKER] = pd.DataFrame(
        {
            "open": np.r_[cash_close[0], cash_close[:-1]],
            "high": cash_close * 1.0005,
            "low": cash_close * 0.9995,
            "close": cash_close,
            "volume": np.full(bars, 500_000.0),
        },
        index=dates,
    )
    # SPY for completeness (not strictly needed for signal tests).
    spy_close = 100.0 * np.exp(np.cumsum(np.full(bars, 0.0003)))
    out["SPY"] = pd.DataFrame(
        {
            "open": np.r_[spy_close[0], spy_close[:-1]],
            "high": spy_close * 1.001,
            "low": spy_close * 0.999,
            "close": spy_close,
            "volume": np.full(bars, 1_000_000.0),
        },
        index=dates,
    )
    return out


# ---------------------------------------------------------------------------
# Signal correctness
# ---------------------------------------------------------------------------


def test_rebalance_weights_sum_to_one() -> None:
    """Output weights must sum to ~1.0 (modulo float epsilon)."""
    prices = _make_constant_returns_prices(bars=80)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    weights = rebalance(prices, asof, params={"roc_lookback": 21, "top_n": 3})
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_rebalance_picks_top_three_in_uptrend() -> None:
    """When all sectors have positive ROC, top-3 ranked sectors get equal weight."""
    prices = _make_constant_returns_prices(bars=80)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    weights = rebalance(prices, asof, params={"roc_lookback": 21, "top_n": 3})
    # All sector daily returns positive in our default setup, so top-3 all win.
    sector_weights = {t: w for t, w in weights.items() if t in SECTOR_TICKERS}
    assert len(sector_weights) == 3
    # Each at 1/3.
    for w in sector_weights.values():
        assert abs(w - 1.0 / 3.0) < 1e-9
    # No cash.
    assert weights.get(CASH_TICKER, 0.0) < 1e-9


def test_rebalance_dual_momentum_drops_negative_sectors() -> None:
    """Dual momentum filter: sectors with negative ROC should NOT be held."""
    # Make XLB winning, XLC barely positive, all others NEGATIVE.
    daily_returns = {t: -0.001 for t in SECTOR_TICKERS}
    daily_returns["XLB"] = 0.002
    daily_returns["XLC"] = 0.0005
    prices = _make_constant_returns_prices(bars=80, sector_daily_returns=daily_returns)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    weights = rebalance(
        prices, asof, params={"roc_lookback": 21, "top_n": 3, "dual_momentum": True}
    )
    # Only XLB and XLC pass the absolute filter -> 2/3 sector + 1/3 cash.
    sector_weights = {t: w for t, w in weights.items() if t in SECTOR_TICKERS}
    assert set(sector_weights.keys()) == {"XLB", "XLC"}
    assert abs(weights[CASH_TICKER] - 1.0 / 3.0) < 1e-9


def test_rebalance_dual_momentum_disabled_keeps_negatives() -> None:
    """With dual_momentum=False, top-3 by ROC are held even if negative."""
    daily_returns = {t: -0.001 for t in SECTOR_TICKERS}
    daily_returns["XLB"] = -0.0001  # least bad
    daily_returns["XLC"] = -0.0002  # second-least bad
    daily_returns["XLE"] = -0.0003
    prices = _make_constant_returns_prices(bars=80, sector_daily_returns=daily_returns)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    weights = rebalance(
        prices, asof, params={"roc_lookback": 21, "top_n": 3, "dual_momentum": False}
    )
    sector_weights = {t: w for t, w in weights.items() if t in SECTOR_TICKERS}
    # Top-3 least-negative are XLB, XLC, XLE.
    assert set(sector_weights.keys()) == {"XLB", "XLC", "XLE"}
    assert weights.get(CASH_TICKER, 0.0) < 1e-9


def test_rebalance_all_negative_with_dual_momentum_goes_to_cash() -> None:
    """If every sector has ROC <= 0, dual momentum forces 100% cash."""
    daily_returns = {t: -0.001 for t in SECTOR_TICKERS}
    prices = _make_constant_returns_prices(bars=80, sector_daily_returns=daily_returns)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    weights = rebalance(
        prices, asof, params={"roc_lookback": 21, "top_n": 3, "dual_momentum": True}
    )
    assert abs(weights[CASH_TICKER] - 1.0) < 1e-9
    sector_weights = {t: w for t, w in weights.items() if t in SECTOR_TICKERS}
    assert len(sector_weights) == 0


# ---------------------------------------------------------------------------
# Determinism / idempotency
# ---------------------------------------------------------------------------


def test_rebalance_is_idempotent() -> None:
    """Same inputs -> same output (no hidden state, no rng)."""
    prices = _make_constant_returns_prices(bars=80)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    w1 = rebalance(prices, asof, params={"roc_lookback": 21, "top_n": 3})
    w2 = rebalance(prices, asof, params={"roc_lookback": 21, "top_n": 3})
    w3 = rebalance(prices, asof, params={"roc_lookback": 21, "top_n": 3})
    assert w1 == w2 == w3


def test_compute_roc_matches_manual_calc() -> None:
    """Spot-check ROC computation against a manual close[-1]/close[-1-N] - 1."""
    prices = _make_constant_returns_prices(bars=60)
    asof = prices["XLK"].index[-1]
    rocs = compute_roc({"XLK": prices["XLK"]}, asof, lookback=21)
    closes = prices["XLK"].loc[prices["XLK"].index <= asof, "close"]
    expected = float(closes.iloc[-1]) / float(closes.iloc[-22]) - 1.0
    assert pytest.approx(rocs["XLK"], rel=1e-12) == expected


# ---------------------------------------------------------------------------
# Drawdown breaker
# ---------------------------------------------------------------------------


def test_drawdown_breaker_fires_on_breach() -> None:
    """Drawdown beyond threshold -> 100% cash override."""
    base = {"XLK": 0.4, "XLF": 0.3, "XLE": 0.3}
    out = apply_drawdown_breaker(base, portfolio_drawdown=-0.15, breaker_threshold=0.12)
    assert out == {CASH_TICKER: 1.0}


def test_drawdown_breaker_passes_through_under_threshold() -> None:
    """Drawdown within threshold -> weights unchanged."""
    base = {"XLK": 0.4, "XLF": 0.3, "XLE": 0.3}
    out = apply_drawdown_breaker(base, portfolio_drawdown=-0.05, breaker_threshold=0.12)
    assert out == base


def test_drawdown_breaker_disabled_with_zero_threshold() -> None:
    """breaker_threshold <= 0 disables the override entirely."""
    base = {"XLK": 0.4, "XLF": 0.3, "XLE": 0.3}
    out = apply_drawdown_breaker(base, portfolio_drawdown=-0.99, breaker_threshold=0.0)
    assert out == base


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_rebalance_rejects_missing_cash_ticker() -> None:
    """Caller must supply SHV; we don't fabricate a synthetic cash series."""
    prices = _make_constant_returns_prices(bars=80)
    del prices[CASH_TICKER]
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    with pytest.raises(ValueError, match=CASH_TICKER):
        rebalance(prices, asof)


def test_rebalance_rejects_missing_sectors() -> None:
    """All 11 SPDR sectors are required."""
    prices = _make_constant_returns_prices(bars=80)
    del prices["XLK"]
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    with pytest.raises(ValueError, match="missing sector tickers"):
        rebalance(prices, asof)


def test_rebalance_params_validation() -> None:
    """Invalid params raise rather than silently mis-rebalancing."""
    prices = _make_constant_returns_prices(bars=80)
    asof = prices[SECTOR_TICKERS[0]].index[-1]
    with pytest.raises(ValueError, match="top_n"):
        rebalance(prices, asof, params={"top_n": 99})
    with pytest.raises(ValueError, match="roc_lookback"):
        rebalance(prices, asof, params={"roc_lookback": 0})


# ---------------------------------------------------------------------------
# End-to-end smoke test on the fixture
# ---------------------------------------------------------------------------


def test_simulate_portfolio_smoke() -> None:
    """Full simulator runs on a 5-year slice without error and produces equity."""
    prices = load_or_build_fixture(years=15)
    ref = prices[SECTOR_TICKERS[0]]
    start = ref.index[0]
    end = start + pd.DateOffset(years=5)
    end = ref.loc[ref.index <= end].index[-1]

    params = {
        "roc_lookback": 21,
        "top_n": 3,
        "dual_momentum": True,
        "drawdown_breaker": 0.12,
        "initial_cash": 10_000.0,
        "fee_bps": 1.0,
        "slippage_bps": 1.0,
    }
    run = simulate_portfolio(prices, start=start, end=end, params=params)

    assert len(run.equity) > 0
    assert run.equity.iloc[0] == pytest.approx(10_000.0, rel=1e-3)
    # Should rebalance roughly 5*12 = 60 times, allowing for warmup skip.
    assert 50 <= len(run.holdings) <= 65
    # Holdings rows must each sum to ~1.0.
    row_sums = run.holdings.sum(axis=1)
    assert ((row_sums - 1.0).abs() < 1e-6).all()


def test_simulate_portfolio_turnover_within_bounds() -> None:
    """Average one-way turnover should be in a sane range (5%-80%)."""
    prices = load_or_build_fixture(years=15)
    ref = prices[SECTOR_TICKERS[0]]
    start = ref.index[0]
    end = ref.index[-1]

    params = {
        "roc_lookback": 21,
        "top_n": 3,
        "dual_momentum": True,
        "drawdown_breaker": 0.12,
        "initial_cash": 10_000.0,
        "fee_bps": 1.0,
        "slippage_bps": 1.0,
    }
    run = simulate_portfolio(prices, start=start, end=end, params=params)
    avg_turnover = float(run.turnover.mean())
    assert 0.05 <= avg_turnover <= 0.80, f"turnover {avg_turnover:.3f} out of bounds"
