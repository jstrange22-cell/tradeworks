"""Backtest runner for Strategy B5: funding-rate cash-and-carry.

The trade is delta-neutral (long spot + short perp 1:1) so we don't reuse the
generic long-only simulator from `research.lib.walkforward`. Instead this module
implements a per-period event loop that:

    1. Reads each pair's funding rate.
    2. Asks the signal layer whether to enter / hold / exit.
    3. Books per-period P&L:
         - funding leg: +funding_rate × notional (when in basis)
         - tracking leg: spot return - perp return (≈ 0 in fixture, small in real markets)
         - fee leg: 4 fills × (taker + slippage) at entry+exit
    4. Aggregates a single equity curve across all pairs.

Then it constructs a `BacktestResult` so the standard report writer renders the
output identically to other strategies.

CLI:

    uv run python -m research.strategies.funding_basis.run \
        --years 4 \
        --report-dir research/strategies/funding_basis/reports
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import matplotlib

# Force a non-interactive backend so the report writer works in CI / SSH / no-X11.
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402  — must follow `matplotlib.use("Agg")`
import numpy as np
import pandas as pd
import yaml

from research.lib import report, stats, walkforward
from research.strategies.funding_basis import data as fb_data
from research.strategies.funding_basis import signal as fb_signal

STRATEGY_DIR: Final[Path] = Path(__file__).resolve().parent
PARAMS_PATH: Final[Path] = STRATEGY_DIR / "params.yaml"
REPORTS_DIR: Final[Path] = STRATEGY_DIR / "reports"


# ----- Param loading + sizing math -------------------------------------------

def _load_params() -> dict[str, Any]:
    """Load params.yaml as a plain dict."""
    with PARAMS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@dataclass(frozen=True, slots=True)
class Sizing:
    """Capital sizing. ``per_pair_notional`` is the notional of *each* leg.

    Long spot + short perp at the same notional: net cash deploy ≈ ``per_pair_notional``
    (spot tying up cash, perp using margin). The basis trade sleeve multiplier is
    ``strategy_alloc_pct × per_pair_cap_pct`` of `initial_cash`.
    """

    initial_cash: float
    strategy_alloc_pct: float
    per_pair_cap_pct: float
    max_pairs: int

    @property
    def strategy_budget(self) -> float:
        """Sleeve allocation in $."""
        return self.initial_cash * self.strategy_alloc_pct

    @property
    def per_pair_notional(self) -> float:
        """Notional per pair (cap × strategy budget)."""
        return self.strategy_budget * self.per_pair_cap_pct


# ----- Per-pair P&L bookkeeping -----------------------------------------------

@dataclass(slots=True)
class TradeRecord:
    """One closed basis-trade (enter -> exit), used for trade-level stats + MC."""

    pair: str
    entry_index: int
    exit_index: int
    notional: float
    funding_pnl: float
    tracking_pnl: float
    fee_pnl: float

    @property
    def pnl(self) -> float:
        return self.funding_pnl + self.tracking_pnl + self.fee_pnl


@dataclass(slots=True)
class BacktestArtifacts:
    """Backtest output: equity, returns, trade records, and the funding history."""

    equity: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    returns: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    trades: list[TradeRecord] = field(default_factory=list)
    per_pair_pnl: dict[str, pd.Series] = field(default_factory=dict)
    funding_summary: dict[str, dict[str, float]] = field(default_factory=dict)
    pass_fail: dict[str, bool] = field(default_factory=dict)


def _macro_risk_off_series(prices: dict[str, pd.DataFrame]) -> pd.Series:
    """Cheap macro filter on BTC: BTC < 200d MA AND > +2 sigma realized vol shock.

    Operates on the 8h grid. The "200d MA" becomes a 600-period MA on 8h bars.
    `+2 sigma realized vol shock` is approximated by comparing the rolling 200-period
    realized vol to its 1000-period mean.
    """
    if "BTC/USD" not in prices:
        # No BTC reference -> never macro risk-off.
        return pd.Series(False, index=next(iter(prices.values())).index)
    btc = prices["BTC/USD"]["spot_close"]
    ma200 = btc.rolling(window=200 * fb_data.PERIODS_PER_DAY, min_periods=200).mean()
    rolling_vol = btc.pct_change().rolling(200, min_periods=50).std()
    long_run_vol = rolling_vol.rolling(1000, min_periods=200).mean()
    long_run_sigma = rolling_vol.rolling(1000, min_periods=200).std()
    vol_shock = rolling_vol > (long_run_vol + 2.0 * long_run_sigma)
    below_ma = btc < ma200
    risk_off = (below_ma & vol_shock).fillna(False)
    return risk_off.astype(bool)


# ----- Core event loop --------------------------------------------------------

def _run_event_loop(
    fixture: fb_data.FundingBasisFixture,
    *,
    sp: fb_signal.SignalParams,
    sizing: Sizing,
    spot_taker_bps: float,
    perp_taker_bps: float,
    slippage_bps_per_side: float,
) -> BacktestArtifacts:
    """Stream every 8h period, advancing per-pair state and recording PnL.

    P&L is booked into a per-pair `pnl` series indexed by `fixture.index`.
    The combined equity curve sums these and adds it to `initial_cash`.
    """
    pairs = fixture.pair_keys()
    index = fixture.index
    n_periods = index.size

    # Fee per round-trip per pair (entry + exit, both legs):
    # 2 × (spot_taker_bps + slippage) + 2 × (perp_taker_bps + slippage), all in bps.
    bps_total = (
        2.0 * (spot_taker_bps + slippage_bps_per_side)
        + 2.0 * (perp_taker_bps + slippage_bps_per_side)
    )
    round_trip_fee_frac = bps_total / 10_000.0

    # Per-pair $ pnl arrays.
    per_pair_pnl: dict[str, np.ndarray] = {p: np.zeros(n_periods, dtype=np.float64) for p in pairs}

    # State + trade ledger.
    states: dict[str, fb_signal.PairState] = {p: fb_signal.PairState(pair=p) for p in pairs}
    trades: list[TradeRecord] = []

    # Macro filter on BTC (computed once).
    macro_risk_off = _macro_risk_off_series(fixture.prices)

    open_pair_count = 0

    for i in range(n_periods):
        risk_off_now = bool(macro_risk_off.iloc[i]) if i < macro_risk_off.size else False

        for pair in pairs:
            state = states[pair]
            funding_rate = float(fixture.funding[pair]["funding_rate"].iloc[i])
            spot_close = float(fixture.prices[pair]["spot_close"].iloc[i])
            perp_close = float(fixture.prices[pair]["perp_close"].iloc[i])

            # --- Step 1: book funding + tracking PnL on existing positions ---
            if state.in_basis:
                # Funding: long spot earns nothing; short perp receives funding when > 0
                # (longs pay shorts on positive funding). PnL = +funding_rate × notional.
                funding_pnl = funding_rate * state.notional
                # Tracking PnL: spot leg returns (long), perp leg returns (short, so flip).
                # Period return = (close_t / open_t) - 1, but on a per-period mark-to-market
                # basis we use successive closes. Approximate with close-on-close.
                if i > 0 and state.entry_index is not None and i > state.entry_index:
                    prev_spot = float(fixture.prices[pair]["spot_close"].iloc[i - 1])
                    prev_perp = float(fixture.prices[pair]["perp_close"].iloc[i - 1])
                    spot_ret = (spot_close - prev_spot) / prev_spot if prev_spot > 0 else 0.0
                    perp_ret = (perp_close - prev_perp) / prev_perp if prev_perp > 0 else 0.0
                    # Net: long spot wins on spot_ret, short perp wins when perp_ret < 0.
                    tracking_pnl = (spot_ret - perp_ret) * state.notional
                else:
                    tracking_pnl = 0.0
                period_pnl = funding_pnl + tracking_pnl
                per_pair_pnl[pair][i] += period_pnl
                state.recent_funding.append(funding_rate)

            # --- Step 2: ask the signal layer what to do ---
            action = fb_signal.decide_position(
                state,
                funding_rate=funding_rate,
                spot_close=spot_close,
                perp_close=perp_close,
                open_pair_count=open_pair_count,
                macro_risk_off=risk_off_now,
                sp=sp,
            )

            if action == "enter" and not state.in_basis:
                # Open the basis. Pay entry fees on both legs (half of round-trip).
                entry_fee = (round_trip_fee_frac / 2.0) * sizing.per_pair_notional
                per_pair_pnl[pair][i] -= entry_fee
                state.in_basis = True
                state.entry_index = i
                state.notional = sizing.per_pair_notional
                state.spot_entry_price = spot_close
                state.perp_entry_price = perp_close
                state.recent_funding.clear()
                open_pair_count += 1

            elif action == "exit" and state.in_basis:
                # Close the basis. Pay exit fees on both legs (the other half).
                exit_fee = (round_trip_fee_frac / 2.0) * state.notional
                per_pair_pnl[pair][i] -= exit_fee

                # Build a TradeRecord for trade-level stats. Sum the booked PnL between
                # entry_index and i for this pair.
                if state.entry_index is not None:
                    sl = slice(state.entry_index, i + 1)
                    booked = per_pair_pnl[pair][sl].sum()
                    fee_pnl = -(round_trip_fee_frac * state.notional)
                    funding_pnl_estimate = sum(
                        float(fixture.funding[pair]["funding_rate"].iloc[j]) * state.notional
                        for j in range(state.entry_index, i + 1)
                    )
                    tracking_pnl_estimate = booked - funding_pnl_estimate - fee_pnl
                    trades.append(
                        TradeRecord(
                            pair=pair,
                            entry_index=state.entry_index,
                            exit_index=i,
                            notional=state.notional,
                            funding_pnl=funding_pnl_estimate,
                            tracking_pnl=tracking_pnl_estimate,
                            fee_pnl=fee_pnl,
                        )
                    )
                state.in_basis = False
                state.entry_index = None
                state.notional = 0.0
                state.recent_funding.clear()
                open_pair_count = max(0, open_pair_count - 1)

    # Aggregate: sum all per-pair pnl streams into one $ pnl series.
    combined_pnl = np.zeros(n_periods, dtype=np.float64)
    for pair in pairs:
        combined_pnl += per_pair_pnl[pair]

    equity = pd.Series(
        sizing.initial_cash + np.cumsum(combined_pnl),
        index=index,
        name="equity",
    )
    returns = equity.pct_change().fillna(0.0)
    pair_pnl_series = {
        pair: pd.Series(per_pair_pnl[pair], index=index, name=f"{pair}_pnl") for pair in pairs
    }

    return BacktestArtifacts(
        equity=equity,
        returns=returns,
        trades=trades,
        per_pair_pnl=pair_pnl_series,
    )


# ----- Walk-forward (slice the timeline) -------------------------------------

def _walk_forward_windows(
    fixture: fb_data.FundingBasisFixture,
    *,
    sp: fb_signal.SignalParams,
    sizing: Sizing,
    spot_taker_bps: float,
    perp_taker_bps: float,
    slippage_bps_per_side: float,
    train_years: float = 2.0,
    test_years: float = 0.5,
    step_years: float = 0.5,
) -> list[walkforward.WindowResult]:
    """Slice the fixture into walk-forward windows and produce per-window OOS stats.

    For this strategy we don't *fit* parameters in the train segment — we just use the
    train segment as a warm-up so funding state, regime detection, and the macro filter
    are populated when we start booking PnL on the test segment.
    """
    index = fixture.index
    if index.empty:
        return []

    # Convert to seconds-based deltas for the 8h grid.
    train_off = pd.Timedelta(days=int(round(train_years * 365.25)))
    test_off = pd.Timedelta(days=int(round(test_years * 365.25)))
    step_off = pd.Timedelta(days=int(round(step_years * 365.25)))

    start = index[0]
    end = index[-1]
    cursor = start
    windows: list[walkforward.WindowResult] = []

    while True:
        train_start = cursor
        train_end = cursor + train_off
        test_start = train_end
        test_end = test_start + test_off
        if test_end > end:
            break

        sub_idx = (index >= train_start) & (index <= test_end)
        if not sub_idx.any():
            cursor = cursor + step_off
            continue
        sub_prices = {p: fixture.prices[p].loc[sub_idx] for p in fixture.pair_keys()}
        sub_funding = {p: fixture.funding[p].loc[sub_idx] for p in fixture.pair_keys()}
        sub_index = index[sub_idx]
        sub_fixture = fb_data.FundingBasisFixture(
            prices=sub_prices,
            funding=sub_funding,
            regimes=fixture.regimes.loc[sub_idx],
            index=pd.DatetimeIndex(sub_index),
        )
        artifacts = _run_event_loop(
            sub_fixture,
            sp=sp,
            sizing=sizing,
            spot_taker_bps=spot_taker_bps,
            perp_taker_bps=perp_taker_bps,
            slippage_bps_per_side=slippage_bps_per_side,
        )

        # Compute stats only on the test segment to keep walk-forward honest.
        test_mask = (artifacts.equity.index >= test_start) & (artifacts.equity.index <= test_end)
        test_equity = artifacts.equity[test_mask]
        test_returns = artifacts.returns[test_mask]
        test_trade_pnls = pd.Series(
            [t.pnl for t in artifacts.trades if test_start <= sub_fixture.index[t.exit_index] <= test_end],
            dtype=float,
        )

        windows.append(
            walkforward.WindowResult(
                train_period=(pd.Timestamp(train_start), pd.Timestamp(train_end)),
                test_period=(pd.Timestamp(test_start), pd.Timestamp(test_end)),
                sharpe=stats.sharpe(test_returns, periods_per_year=fb_data.PERIODS_PER_YEAR),
                sortino=stats.sortino(test_returns, periods_per_year=fb_data.PERIODS_PER_YEAR),
                max_dd=stats.max_drawdown(test_equity),
                expectancy=stats.expectancy(test_trade_pnls),
                win_rate=stats.win_rate(test_trade_pnls),
                num_trades=int(test_trade_pnls.size),
            )
        )
        cursor = cursor + step_off

    return windows


# ----- Funding-rate histogram + cumulative-pnl-per-pair plot ------------------

def _plot_funding_distribution(
    fixture: fb_data.FundingBasisFixture,
    out_path: Path,
) -> None:
    """Histogram of funding rates per pair (overlaid)."""
    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=120)
    bins = np.linspace(-0.001, 0.0015, 61)
    colors = ["#1f77b4", "#ff7f0e", "#2ca02c"]
    for i, pair in enumerate(fixture.pair_keys()):
        rates = fixture.funding[pair]["funding_rate"].to_numpy(dtype=np.float64)
        ax.hist(
            rates,
            bins=bins,
            histtype="step",
            linewidth=2.0,
            label=pair,
            color=colors[i % len(colors)],
        )
    ax.axvline(0.0, color="black", linewidth=0.7, linestyle="--", label="0 (break-even)")
    ax.axvline(0.0005, color="red", linewidth=0.7, linestyle=":", label="entry threshold (5 bp/8h)")
    ax.set_title("Funding-rate distribution (per 8h period, by pair)")
    ax.set_xlabel("funding rate (fraction per 8h)")
    ax.set_ylabel("count")
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def _plot_cumulative_pnl_per_pair(
    artifacts: BacktestArtifacts,
    out_path: Path,
) -> None:
    """Cumulative $ PnL per pair as separate lines."""
    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=120)
    colors = ["#1f77b4", "#ff7f0e", "#2ca02c"]
    for i, (pair, series) in enumerate(sorted(artifacts.per_pair_pnl.items())):
        ax.plot(
            series.index,
            series.cumsum().to_numpy(),
            label=pair,
            linewidth=1.5,
            color=colors[i % len(colors)],
        )
    ax.set_title("Cumulative PnL per pair ($)")
    ax.set_xlabel("date")
    ax.set_ylabel("cumulative PnL ($)")
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


# ----- Public entry point -----------------------------------------------------

@dataclass(slots=True)
class FundingBasisRunResult:
    """Top-level result returned by `run`. Contains both the BacktestResult and extras."""

    backtest_result: walkforward.BacktestResult
    artifacts: BacktestArtifacts
    pass_fail: dict[str, bool]

    def summary(self) -> dict[str, float]:
        return self.backtest_result.summary()


def run(
    *,
    years: int | None = None,
    report_dir: Path | None = None,
) -> FundingBasisRunResult:
    """Run the funding-basis backtest end-to-end and write a report.

    Returns the result dataclass for programmatic inspection.
    """
    params = _load_params()
    if years is None:
        years = int(params.get("years", 4))
    if report_dir is None:
        report_dir = REPORTS_DIR

    sp = fb_signal.SignalParams.from_dict(params)
    sizing = Sizing(
        initial_cash=float(params.get("initial_cash", 100_000.0)),
        strategy_alloc_pct=float(params.get("strategy_alloc_pct", 0.30)),
        per_pair_cap_pct=float(params.get("per_pair_cap_pct", 0.50)),
        max_pairs=int(params.get("max_pairs", 3)),
    )
    fixture = fb_data.load_fixture(
        pairs=list(params.get("pairs", ["BTC/USD", "ETH/USD", "SOL/USD"])),
        years=years,
        funding_seed=int(params.get("fixture_funding_seed", 17)),
        price_seed=int(params.get("seed", 42)),
    )

    artifacts = _run_event_loop(
        fixture,
        sp=sp,
        sizing=sizing,
        spot_taker_bps=float(params.get("spot_taker_bps", 5.0)),
        perp_taker_bps=float(params.get("perp_taker_bps", 6.0)),
        slippage_bps_per_side=float(params.get("slippage_bps_per_side", 2.0)),
    )

    # Walk-forward windows.
    windows = _walk_forward_windows(
        fixture,
        sp=sp,
        sizing=sizing,
        spot_taker_bps=float(params.get("spot_taker_bps", 5.0)),
        perp_taker_bps=float(params.get("perp_taker_bps", 6.0)),
        slippage_bps_per_side=float(params.get("slippage_bps_per_side", 2.0)),
        train_years=2.0,
        test_years=0.5,
        step_years=0.5,
    )

    # Build a BacktestResult so the standard report writer works.
    trade_pnls = pd.Series([t.pnl for t in artifacts.trades], dtype=float, name="trade_pnl")
    bt_result = walkforward.BacktestResult(
        name="funding_basis (cash-and-carry)",
        windows=windows,
        full_equity=artifacts.equity,
        full_returns=artifacts.returns,
        full_trade_pnls=trade_pnls,
        params=params,
        regimes=fixture.regimes,
    )

    # Annualize CAGR using crypto cadence (8h periods per year, not equity 252).
    summary = bt_result.summary()
    # Override sharpe/cagr with the crypto cadence so the pass/fail bars are honest.
    crypto_summary = stats.summarize(
        artifacts.returns,
        trade_pnls,
        periods_per_year=fb_data.PERIODS_PER_YEAR,
    )
    target_apr = float(params.get("target_annual_return", 0.08))
    target_dd = float(params.get("target_max_dd", 0.05))
    pass_fail = {
        "annual_return_meets_8pct": crypto_summary["cagr"] >= target_apr,
        "max_dd_within_5pct": abs(crypto_summary["max_dd"]) <= target_dd,
        "overall_pass": (
            crypto_summary["cagr"] >= target_apr and abs(crypto_summary["max_dd"]) <= target_dd
        ),
    }

    # Funding-rate distribution stats per pair (for the report).
    funding_summary = {
        pair: fb_signal.funding_rate_distribution_summary(fixture.funding[pair])
        for pair in fixture.pair_keys()
    }
    artifacts.funding_summary = funding_summary
    artifacts.pass_fail = pass_fail

    # Write the standard report (equity / dd / windows / MC).
    report_dir.mkdir(parents=True, exist_ok=True)
    md_path = report.write_report(bt_result, report_dir)

    # Append funding-distribution histogram + per-pair cumulative pnl + pass/fail.
    funding_png = report_dir / "funding-distribution.png"
    cumpnl_png = report_dir / "cumulative-pnl-per-pair.png"
    _plot_funding_distribution(fixture, funding_png)
    _plot_cumulative_pnl_per_pair(artifacts, cumpnl_png)

    # Append addendum to report.md so the reader sees the strategy-specific charts.
    addendum: list[str] = [
        "",
        "## Funding-Rate Distribution (per pair, per 8h)",
        "",
        f"![Funding Distribution]({funding_png.name})",
        "",
        _funding_summary_table(funding_summary),
        "",
        "## Cumulative PnL per Pair",
        "",
        f"![Cumulative PnL]({cumpnl_png.name})",
        "",
        "## Crypto-Cadence Summary (annualized at 1095 periods/year)",
        "",
        _crypto_summary_table(crypto_summary),
        "",
        "## PASS / FAIL Bars",
        "",
        _pass_fail_table(pass_fail, crypto_summary, target_apr, target_dd),
        "",
        "## FreqTrade Port (deferred)",
        "",
        "FreqTrade port — `infra/freqtrade/user_data/strategies/FundingBasis.py` will subscribe "
        "to funding-rate events and call `populate_entry_trend` accordingly. The current "
        "research run produces backtest stats; FreqTrade integration is a follow-up "
        "implementation.",
        "",
    ]
    md_existing = md_path.read_text(encoding="utf-8")
    md_path.write_text(md_existing + "\n".join(addendum), encoding="utf-8")

    return FundingBasisRunResult(
        backtest_result=bt_result,
        artifacts=artifacts,
        pass_fail=pass_fail,
    )


def _funding_summary_table(per_pair: dict[str, dict[str, float]]) -> str:
    """Render the per-pair funding-distribution stats as a markdown table."""
    cols = ["pair", "n", "mean (per 8h)", "mean APR", "median", "p05", "p95", "% positive", "% > 5bp"]
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join(["---"] * len(cols)) + " |"]
    for pair, s in sorted(per_pair.items()):
        lines.append(
            "| " + " | ".join([
                pair,
                f"{int(s.get('n', 0)):,}",
                f"{s.get('mean_per_period', 0.0):.6f}",
                f"{s.get('mean_apr', 0.0) * 100.0:+.2f}%",
                f"{s.get('median_per_period', 0.0):.6f}",
                f"{s.get('p05', 0.0):.6f}",
                f"{s.get('p95', 0.0):.6f}",
                f"{s.get('pct_positive', 0.0) * 100.0:.1f}%",
                f"{s.get('pct_above_5bp', 0.0) * 100.0:.1f}%",
            ]) + " |"
        )
    return "\n".join(lines)


def _crypto_summary_table(summary: dict[str, float]) -> str:
    """Re-render the summary stats with crypto-cadence annualization."""
    rows = [
        ("Sharpe (1095 periods/yr)", f"{summary['sharpe']:.3f}"),
        ("Sortino", f"{summary['sortino']:.3f}"),
        ("Calmar", f"{summary['calmar']:.3f}"),
        ("CAGR", f"{summary['cagr'] * 100:+.2f}%"),
        ("Max Drawdown", f"{summary['max_dd'] * 100:+.2f}%"),
        ("Win Rate", f"{summary['win_rate'] * 100:.1f}%"),
        ("Expectancy ($/trade)", f"{summary['expectancy']:.2f}"),
        ("Num Trades", f"{int(summary['num_trades'])}"),
    ]
    out = ["| Metric | Value |", "| --- | --- |"]
    out.extend(f"| {k} | {v} |" for k, v in rows)
    return "\n".join(out)


def _pass_fail_table(
    pf: dict[str, bool],
    summary: dict[str, float],
    target_apr: float,
    target_dd: float,
) -> str:
    """Markdown table summarizing the pass/fail bars."""
    apr = summary["cagr"]
    mdd = summary["max_dd"]
    return "\n".join([
        "| Bar | Target | Actual | Status |",
        "| --- | --- | --- | --- |",
        f"| Annualized return >= {target_apr * 100:.0f}% | {target_apr * 100:.0f}% | "
        f"{apr * 100:+.2f}% | {'PASS' if pf['annual_return_meets_8pct'] else 'FAIL'} |",
        f"| Max drawdown <= {target_dd * 100:.0f}% | {target_dd * 100:.0f}% | "
        f"{abs(mdd) * 100:.2f}% | {'PASS' if pf['max_dd_within_5pct'] else 'FAIL'} |",
        f"| **Overall** | both | both | "
        f"**{'PASS' if pf['overall_pass'] else 'FAIL'}** |",
    ])


def _main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Run the funding-basis backtest.")
    parser.add_argument("--years", type=int, default=None, help="Years of fixture history.")
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=None,
        help="Where to write the report (default: research/strategies/funding_basis/reports).",
    )
    args = parser.parse_args()

    result = run(years=args.years, report_dir=args.report_dir)
    out = {
        "strategy": result.backtest_result.name,
        "summary": result.summary(),
        "pass_fail": result.pass_fail,
        "num_windows": len(result.backtest_result.windows),
        "num_trades": len(result.artifacts.trades),
        "report": str((args.report_dir or REPORTS_DIR) / "report.md"),
    }
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    _main()
