"""Sector rotation runner.

Builds a synthetic 13-ETF (11 sectors + SPY + SHV) fixture, simulates the
monthly rebalance, runs walk-forward analysis, and writes a portfolio report
including a holdings-by-month heatmap.

The shared walk-forward engine is single-asset oriented (entry/exit/size
signals on one OHLCV stream). Sector rotation is fundamentally multi-asset,
so this module provides its own portfolio simulator. We still emit a
`BacktestResult` so the standard `report.write_report` artifact set works,
plus we layer a custom heatmap and turnover plot on top.

Usage:
    uv run python -m research.strategies.sector_rotation.run
    uv run python -m research.strategies.sector_rotation.run --years 15
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

from research.lib import report, stats, walkforward  # noqa: E402
from research.strategies.sector_rotation.signal import (  # noqa: E402
    CASH_TICKER,
    SECTOR_TICKERS,
    apply_drawdown_breaker,
    rebalance,
)

STRATEGY_DIR: Path = Path(__file__).resolve().parent
PARAMS_PATH: Path = STRATEGY_DIR / "params.yaml"
REPORTS_DIR: Path = STRATEGY_DIR / "reports"
FIXTURES_DIR: Path = STRATEGY_DIR / "fixtures"
FIXTURE_PATH: Path = FIXTURES_DIR / "sector_ohlcv.csv"

ALL_TICKERS: tuple[str, ...] = (*SECTOR_TICKERS, "SPY", CASH_TICKER)


# ---------------------------------------------------------------------------
# Synthetic fixture: realistic sector dispersion via a 3-factor return model.
# ---------------------------------------------------------------------------

# Per-sector annual drift (mu) and idiosyncratic vol. These are loosely
# calibrated to long-run sector behavior so the cross-section has spread.
SECTOR_PROFILES: dict[str, dict[str, float]] = {
    # ticker:  (annual mu, annual idio vol, market beta)
    "XLK":  {"mu": 0.13, "idio_vol": 0.16, "beta": 1.20},   # Tech
    "XLF":  {"mu": 0.09, "idio_vol": 0.18, "beta": 1.15},   # Financials
    "XLE":  {"mu": 0.06, "idio_vol": 0.28, "beta": 1.05},   # Energy
    "XLV":  {"mu": 0.10, "idio_vol": 0.13, "beta": 0.85},   # Health Care
    "XLY":  {"mu": 0.11, "idio_vol": 0.17, "beta": 1.10},   # Consumer Disc
    "XLI":  {"mu": 0.09, "idio_vol": 0.15, "beta": 1.05},   # Industrials
    "XLP":  {"mu": 0.07, "idio_vol": 0.10, "beta": 0.55},   # Consumer Staples
    "XLU":  {"mu": 0.06, "idio_vol": 0.12, "beta": 0.45},   # Utilities
    "XLB":  {"mu": 0.07, "idio_vol": 0.18, "beta": 1.05},   # Materials
    "XLRE": {"mu": 0.07, "idio_vol": 0.16, "beta": 0.85},   # Real Estate
    "XLC":  {"mu": 0.10, "idio_vol": 0.16, "beta": 1.00},   # Communication
}

# Market and short-treasury baselines.
MARKET_MU: float = 0.085
MARKET_VOL: float = 0.16
CASH_MU: float = 0.025
CASH_VOL: float = 0.005

# Long-run regime cycle: bull / bear / recovery in trading days. The market
# factor flips drift periodically so momentum strategies have rotation to ride.
REGIME_CYCLE_DAYS: int = 252 * 2  # ~2-year cycle


def _build_synthetic_ohlcv(years: int, *, seed: int = 7) -> dict[str, pd.DataFrame]:
    """Build a deterministic synthetic 13-ETF OHLCV fixture with sector dispersion.

    Uses a 3-factor return model:
        sector_return = beta * market_factor + sector_idio_factor + noise
    where the market factor cycles between bull/bear regimes and sector
    idiosyncratic returns are persistent so cross-sectional momentum has signal.
    """
    rng = np.random.default_rng(seed)
    bars = years * 252
    end = pd.Timestamp("2025-12-31")
    dates = pd.date_range(end=end, periods=bars, freq="B")

    # Market factor: cycles between bull (positive drift) and bear (negative).
    cycle = (np.arange(bars) // (REGIME_CYCLE_DAYS // 4)) % 4
    market_drift = np.where(
        np.isin(cycle, [0, 1]),
        MARKET_MU / 252,
        -MARKET_MU / 252 * 0.5,  # bears are shallower-but-still-noisy
    )
    market_daily_vol = MARKET_VOL / np.sqrt(252)
    market_returns = rng.normal(loc=market_drift, scale=market_daily_vol, size=bars)

    # SPY = market + tiny noise.
    spy_returns = market_returns + rng.normal(0, 0.001, size=bars)

    # Cash (SHV): drifts up at ~2.5%/yr with negligible vol.
    cash_returns = rng.normal(
        loc=CASH_MU / 252, scale=CASH_VOL / np.sqrt(252), size=bars
    )

    # Per-sector returns: persistent idiosyncratic factor (low-frequency AR(1))
    # + daily noise, mixed with market beta. The persistent factor drives the
    # rotation signal that B4 is designed to exploit.
    out: dict[str, pd.DataFrame] = {}

    # Generate independent persistent factors per sector.
    # The persistent factor is intentionally small (~25% of idio_vol) so we
    # don't manufacture an unrealistically strong momentum signal. The bulk
    # of sector idiosyncratic vol is daily noise, matching real-market behavior.
    for ticker, profile in SECTOR_PROFILES.items():
        idio_factor = _generate_persistent_factor(
            rng, n=bars, vol_annual=profile["idio_vol"]
        )
        daily_drift = profile["mu"] / 252
        # Daily noise carries most of the idio variance.
        daily_noise = rng.normal(
            0, profile["idio_vol"] / np.sqrt(252) * 0.95, size=bars
        )
        sector_returns = (
            daily_drift
            + profile["beta"] * (market_returns - market_drift)
            + idio_factor
            + daily_noise
        )
        out[ticker] = _returns_to_ohlcv(sector_returns, dates, rng, base_price=100.0)

    out["SPY"] = _returns_to_ohlcv(spy_returns, dates, rng, base_price=400.0)
    out[CASH_TICKER] = _returns_to_ohlcv(
        cash_returns, dates, rng, base_price=110.0, vol_floor=1e-5
    )
    return out


def _generate_persistent_factor(
    rng: np.random.Generator, *, n: int, vol_annual: float, half_life_days: int = 30
) -> np.ndarray:
    """AR(1) factor with given daily-equivalent vol and half-life.

    Steady-state std is calibrated to ~25% of `vol_annual / sqrt(252)` so the
    persistent component is real but small relative to daily noise. This keeps
    the cross-sectional momentum effect realistic (academic studies put the
    momentum Sharpe in the 0.5-1.5 range, not 10+).
    """
    rho = 0.5 ** (1.0 / half_life_days)
    target_daily = vol_annual / np.sqrt(252) * 0.25
    # AR(1) steady-state std = innovation_std / sqrt(1 - rho^2).
    innovation_std = target_daily * np.sqrt(1.0 - rho * rho)
    out = np.empty(n, dtype=np.float64)
    out[0] = rng.normal(0, target_daily)
    innovations = rng.normal(0, innovation_std, size=n - 1)
    for i in range(1, n):
        out[i] = rho * out[i - 1] + innovations[i - 1]
    return out


def _returns_to_ohlcv(
    returns: np.ndarray,
    dates: pd.DatetimeIndex,
    rng: np.random.Generator,
    *,
    base_price: float = 100.0,
    vol_floor: float = 0.001,
) -> pd.DataFrame:
    """Compose a daily OHLCV frame from a returns array."""
    close = base_price * np.exp(np.cumsum(returns))
    intraday_range = np.maximum(np.abs(rng.normal(0, 0.008, size=len(returns))), vol_floor) * close
    high = close + intraday_range / 2.0
    low = np.maximum(close - intraday_range / 2.0, 0.01)
    open_ = np.r_[close[0], close[:-1]]
    volume = rng.integers(500_000, 5_000_000, size=len(returns)).astype(float)
    return pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        },
        index=dates,
    )


def load_or_build_fixture(years: int = 15) -> dict[str, pd.DataFrame]:
    """Load fixture from CSV if it matches expected length; otherwise rebuild + persist.

    The fixture is shipped in `fixtures/sector_ohlcv.csv` (long format with
    `ticker` column) so the strategy is reproducible without re-running the
    generator.
    """
    target_bars = years * 252
    if FIXTURE_PATH.exists():
        df = pd.read_csv(FIXTURE_PATH, parse_dates=["date"])
        if len(df) == target_bars * len(ALL_TICKERS):
            return _long_csv_to_dict(df)

    prices = _build_synthetic_ohlcv(years=years)
    _write_long_csv(prices, FIXTURE_PATH)
    return prices


def _long_csv_to_dict(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Reshape a long-format ticker/date/OHLCV CSV into the dict-of-frames form."""
    out: dict[str, pd.DataFrame] = {}
    df = df.sort_values(["ticker", "date"])
    for ticker, group in df.groupby("ticker"):
        frame = group.set_index("date")[["open", "high", "low", "close", "volume"]].copy()
        frame.index = pd.DatetimeIndex(frame.index)
        out[str(ticker)] = frame
    return out


def _write_long_csv(prices: dict[str, pd.DataFrame], path: Path) -> None:
    """Write the dict-of-frames as a long-format CSV with a `ticker` column."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows: list[pd.DataFrame] = []
    for ticker, frame in prices.items():
        f = frame.copy()
        f.insert(0, "ticker", ticker)
        f.index.name = "date"
        rows.append(f.reset_index())
    long_df = pd.concat(rows, axis=0, ignore_index=True)
    long_df.to_csv(path, index=False)


# ---------------------------------------------------------------------------
# Portfolio simulator: monthly rebalance, equal-weight, fee/slippage costs.
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class PortfolioRun:
    """Output of one full-history portfolio simulation."""

    equity: pd.Series
    returns: pd.Series
    holdings: pd.DataFrame  # rebalance_date x ticker -> weight
    rebalance_pnls: pd.Series  # one pnl per rebalance period
    turnover: pd.Series  # one-way turnover per rebalance, in fraction of NAV


def _month_end_dates(index: pd.DatetimeIndex) -> list[pd.Timestamp]:
    """Return the last trading-day-of-month timestamps from a DatetimeIndex."""
    periods = index.to_period("M")
    # Mark the last index entry per month: True where next period differs (or last bar).
    is_last = pd.Series(periods).ne(pd.Series(periods).shift(-1)).to_numpy()
    return [pd.Timestamp(d) for d in index[is_last]]


def simulate_portfolio(
    prices: dict[str, pd.DataFrame],
    *,
    start: pd.Timestamp,
    end: pd.Timestamp,
    params: dict[str, Any],
) -> PortfolioRun:
    """Simulate the sector-rotation portfolio across [start, end].

    On each month-end rebalance: compute target weights via `rebalance()`,
    apply the drawdown circuit-breaker if triggered, settle costs as a
    one-way turnover-times-bps charge, then mark-to-market daily until the
    next rebalance.
    """
    initial_cash = float(params.get("initial_cash", 10_000.0))
    fee_bps = float(params.get("fee_bps", 1.0))
    slip_bps = float(params.get("slippage_bps", 1.0))
    breaker = float(params.get("drawdown_breaker", 0.12))
    cost_per_unit = (fee_bps + slip_bps) / 10_000.0

    # Build a unified daily index from one of the sector frames.
    ref = prices[SECTOR_TICKERS[0]]
    daily_idx = ref.loc[(ref.index >= start) & (ref.index <= end)].index
    if len(daily_idx) < 2:
        raise ValueError(f"insufficient bars in [{start}, {end}]")

    # Daily close prices aligned to a single DataFrame (rows=dates, cols=tickers).
    closes = pd.DataFrame(
        {t: prices[t].loc[daily_idx, "close"].to_numpy() for t in ALL_TICKERS},
        index=daily_idx,
    )

    rebal_dates = _month_end_dates(daily_idx)
    # Drop any rebalance dates with insufficient ROC history.
    lookback = int(params.get("roc_lookback", 21))
    rebal_dates = [d for d in rebal_dates if (d - daily_idx[0]).days >= lookback + 5]

    equity_arr = np.full(len(daily_idx), np.nan, dtype=np.float64)
    cash = initial_cash
    units: dict[str, float] = {t: 0.0 for t in ALL_TICKERS}
    holdings_log: list[dict[str, float]] = []
    holdings_dates: list[pd.Timestamp] = []
    rebal_pnls: list[float] = []
    turnover_log: list[float] = []
    last_rebal_equity = initial_cash
    peak_equity = initial_cash

    next_rebal_idx = 0

    for i, date in enumerate(daily_idx):
        # Mark-to-market.
        position_value = sum(units[t] * float(closes.iloc[i][t]) for t in ALL_TICKERS)
        equity = cash + position_value
        equity_arr[i] = equity
        peak_equity = max(peak_equity, equity)

        # Trigger rebalance on the next scheduled date if `date` reaches it.
        if next_rebal_idx < len(rebal_dates) and date == rebal_dates[next_rebal_idx]:
            current_dd = equity / peak_equity - 1.0 if peak_equity > 0 else 0.0
            target_w = rebalance(prices, date, params)
            target_w = apply_drawdown_breaker(
                target_w, portfolio_drawdown=current_dd, breaker_threshold=breaker
            )
            # Compute target dollar allocations.
            target_value = {t: target_w.get(t, 0.0) * equity for t in ALL_TICKERS}
            current_value = {
                t: units[t] * float(closes.iloc[i][t]) for t in ALL_TICKERS
            }
            # One-way turnover = sum of |target - current| / equity / 2 (each
            # dollar moved is sold from one and bought into another).
            gross_change = sum(
                abs(target_value[t] - current_value[t]) for t in ALL_TICKERS
            )
            turnover_one_way = gross_change / equity / 2.0 if equity > 0 else 0.0
            cost = gross_change * cost_per_unit  # fees on every $ traded

            cash = equity - sum(target_value.values()) - cost
            for t in ALL_TICKERS:
                price = float(closes.iloc[i][t])
                units[t] = target_value[t] / price if price > 0 else 0.0

            holdings_log.append({t: target_w.get(t, 0.0) for t in ALL_TICKERS})
            holdings_dates.append(date)
            rebal_pnls.append(equity - last_rebal_equity)
            turnover_log.append(turnover_one_way)
            last_rebal_equity = equity
            next_rebal_idx += 1

    equity_series = pd.Series(equity_arr, index=daily_idx, name="equity").ffill()
    returns_series = equity_series.pct_change().fillna(0.0)
    holdings_df = pd.DataFrame(holdings_log, index=pd.DatetimeIndex(holdings_dates))
    pnl_series = pd.Series(rebal_pnls, index=pd.DatetimeIndex(holdings_dates), name="rebal_pnl")
    turnover_series = pd.Series(
        turnover_log, index=pd.DatetimeIndex(holdings_dates), name="turnover"
    )
    return PortfolioRun(
        equity=equity_series,
        returns=returns_series,
        holdings=holdings_df,
        rebalance_pnls=pnl_series,
        turnover=turnover_series,
    )


# ---------------------------------------------------------------------------
# Walk-forward orchestration: rolling 5y train / 1y test windows.
# ---------------------------------------------------------------------------


def walk_forward_portfolio(
    prices: dict[str, pd.DataFrame],
    *,
    params: dict[str, Any],
) -> tuple[list[walkforward.WindowResult], PortfolioRun]:
    """Run rolling walk-forward windows + a single full-history sim.

    The portfolio strategy has no free parameters that we fit per-window
    here; we treat each test segment as an independent OOS evaluation.
    Returns (windows, full_run).
    """
    ref = prices[SECTOR_TICKERS[0]]
    full_start = ref.index[0]
    full_end = ref.index[-1]
    full_run = simulate_portfolio(prices, start=full_start, end=full_end, params=params)

    train_years = float(params.get("train_years", 5.0))
    test_years = float(params.get("test_years", 1.0))
    step_years = float(params.get("step_years", 1.0))

    train_off = pd.DateOffset(days=int(round(train_years * 365.25)))
    test_off = pd.DateOffset(days=int(round(test_years * 365.25)))
    step_off = pd.DateOffset(days=int(round(step_years * 365.25)))

    windows: list[walkforward.WindowResult] = []
    cursor = full_start
    while True:
        train_start = cursor
        train_end = cursor + train_off
        test_start = train_end
        test_end = test_start + test_off
        if test_end > full_end:
            break

        run = simulate_portfolio(prices, start=test_start, end=test_end, params=params)
        windows.append(
            walkforward.WindowResult(
                train_period=(train_start, train_end),
                test_period=(test_start, test_end),
                sharpe=stats.sharpe(run.returns),
                sortino=stats.sortino(run.returns),
                max_dd=stats.max_drawdown(run.equity),
                expectancy=stats.expectancy(run.rebalance_pnls),
                win_rate=stats.win_rate(run.rebalance_pnls),
                num_trades=int(len(run.rebalance_pnls)),
            )
        )
        cursor = cursor + step_off

    return windows, full_run


# ---------------------------------------------------------------------------
# Custom plots: monthly turnover line, holdings-by-month heatmap.
# ---------------------------------------------------------------------------


def _plot_holdings_heatmap(holdings: pd.DataFrame, out_path: Path) -> None:
    """Render a heatmap showing target weights per ticker per month."""
    if holdings.empty:
        return
    # Reorder columns for visual sanity: sectors first, then SPY/SHV.
    ordered = [t for t in (*SECTOR_TICKERS, CASH_TICKER) if t in holdings.columns]
    data = holdings[ordered].fillna(0.0).to_numpy().T  # tickers x months

    fig, ax = plt.subplots(figsize=(12, 5), dpi=120)
    im = ax.imshow(data, aspect="auto", cmap="YlGnBu", vmin=0, vmax=1)
    ax.set_yticks(range(len(ordered)))
    ax.set_yticklabels(ordered)
    n_months = data.shape[1]
    # Show ~12 x-ticks regardless of length so labels stay legible.
    tick_step = max(1, n_months // 12)
    tick_idx = list(range(0, n_months, tick_step))
    ax.set_xticks(tick_idx)
    ax.set_xticklabels(
        [holdings.index[i].strftime("%Y-%m") for i in tick_idx],
        rotation=45,
        ha="right",
    )
    ax.set_title("Sector Rotation — Holdings by Month")
    fig.colorbar(im, ax=ax, label="Weight")
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def _plot_turnover(turnover: pd.Series, out_path: Path) -> None:
    """Render a turnover-per-rebalance bar chart."""
    if turnover.empty:
        return
    fig, ax = plt.subplots(figsize=(10, 3.5), dpi=120)
    ax.bar(turnover.index, turnover.to_numpy() * 100.0, width=20.0, color="#9467bd", alpha=0.8)
    ax.set_title("Sector Rotation — One-Way Turnover per Rebalance")
    ax.set_xlabel("Rebalance Date")
    ax.set_ylabel("Turnover (%)")
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main runner.
# ---------------------------------------------------------------------------


def _load_params() -> dict[str, Any]:
    with PARAMS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def run(years: int = 15, *, report_dir: Path | None = None) -> dict[str, Any]:
    """Run the full sector-rotation backtest and write artifacts.

    Returns a summary dict with key metrics + PASS/FAIL evaluation.
    """
    params = _load_params()
    out_dir = report_dir if report_dir is not None else REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    prices = load_or_build_fixture(years=years)
    windows, full_run = walk_forward_portfolio(prices, params=params)

    # Build a BacktestResult so the standard report artifacts are produced.
    bt_result = walkforward.BacktestResult(
        name="Sector Rotation by Relative Strength (B4)",
        windows=windows,
        full_equity=full_run.equity,
        full_returns=full_run.returns,
        full_trade_pnls=full_run.rebalance_pnls,
        params=params,
        regimes=None,
    )
    report.write_report(bt_result, out_dir)

    # Custom artifacts.
    _plot_holdings_heatmap(full_run.holdings, out_dir / "holdings-heatmap.png")
    _plot_turnover(full_run.turnover, out_dir / "turnover.png")
    full_run.holdings.to_csv(out_dir / "holdings.csv")
    full_run.turnover.to_csv(out_dir / "turnover.csv", header=True)

    # Append custom sections to the report.md.
    summary = bt_result.summary()
    median_sharpe = (
        float(np.median([w.sharpe for w in windows])) if windows else 0.0
    )
    avg_turnover = float(full_run.turnover.mean()) if not full_run.turnover.empty else 0.0
    pass_sharpe = median_sharpe >= 0.7
    pass_dd = abs(summary["max_dd"]) <= 0.25
    overall_pass = pass_sharpe and pass_dd

    md_extra = [
        "",
        "## Strategy-Specific Metrics",
        "",
        f"- **Median window Sharpe**: {median_sharpe:.3f}",
        f"- **Average one-way turnover per rebalance**: {avg_turnover * 100:.2f}%",
        f"- **Implied annual turnover**: {avg_turnover * 12 * 100:.0f}%",
        f"- **Number of rebalances**: {len(full_run.rebalance_pnls)}",
        f"- **PASS Sharpe (>= 0.7)**: {pass_sharpe}",
        f"- **PASS Max DD (<= 25%)**: {pass_dd}",
        f"- **OVERALL: {'PASS' if overall_pass else 'FAIL'}**",
        "",
        "## Holdings Heatmap",
        "",
        "![Holdings Heatmap](holdings-heatmap.png)",
        "",
        "## Turnover",
        "",
        "![Turnover](turnover.png)",
        "",
    ]
    md_path = out_dir / "report.md"
    existing_md = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    md_path.write_text(existing_md + "\n".join(md_extra), encoding="utf-8")

    return {
        "strategy": bt_result.name,
        "summary": summary,
        "median_sharpe": median_sharpe,
        "avg_turnover": avg_turnover,
        "num_windows": len(windows),
        "num_rebalances": len(full_run.rebalance_pnls),
        "pass_sharpe": pass_sharpe,
        "pass_dd": pass_dd,
        "overall_pass": overall_pass,
        "report": str(md_path),
    }


def _main() -> None:
    parser = argparse.ArgumentParser(description="Run the sector-rotation strategy.")
    parser.add_argument("--years", type=int, default=15, help="Years of synthetic data.")
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=None,
        help="Override the reports/ output directory.",
    )
    args = parser.parse_args()

    out = run(years=args.years, report_dir=args.report_dir)
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    _main()
