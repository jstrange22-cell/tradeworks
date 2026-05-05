"""Vol-Rank Mean Reversion (Options) — runner.

Reads/builds the fixture, scans every underlying for entries, simulates each
spread's lifecycle (revaluing daily under the realized IV path), aggregates
trade P&L into a portfolio equity curve, and writes the standard report.

We don't use vectorbt here because options spreads aren't a single-asset
buy/sell — instead we build per-trade P&L records and feed them through the
report writer's `summarize` + Monte Carlo helpers.

Usage:
    .venv/Scripts/python.exe -m research.strategies.vol_rank_options.run --years 8
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yaml

from research.lib import regimes as regimes_lib
from research.lib import stats
from research.strategies.vol_rank_options import pricing
from research.strategies.vol_rank_options.signal import Setup, find_entries

STRATEGY_DIR: Path = Path(__file__).resolve().parent
PARAMS_PATH: Path = STRATEGY_DIR / "params.yaml"
FIXTURES_DIR: Path = STRATEGY_DIR / "fixtures"
DEFAULT_REPORTS_DIR: Path = STRATEGY_DIR / "reports"

# Tradable universe: liquid optionable names with deep-OTM put markets.
UNIVERSE: tuple[str, ...] = (
    "SPY", "QQQ", "IWM",
    "AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "AMD", "NFLX",
    "TLT", "GLD", "USO",
)


@dataclass(frozen=True, slots=True)
class TradeRecord:
    """One closed put credit spread."""

    symbol: str
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp
    days_held: int
    spot_entry: float
    spot_exit: float
    short_strike: float
    long_strike: float
    width: float
    credit_per_share: float
    exit_value_per_share: float
    pnl_per_share: float
    contracts: int
    pnl_dollars: float
    exit_reason: str  # 'profit_target', 'loss_stop', 'time_stop', 'expired'


@dataclass(slots=True)
class PortfolioResult:
    """Aggregate result of running the vol-rank strategy across the universe."""

    name: str
    trades: list[TradeRecord] = field(default_factory=list)
    full_equity: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    full_returns: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    trade_pnls: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    params: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, float]:
        """Aggregate summary stats."""
        return stats.summarize(self.full_returns, self.trade_pnls)


# ────────────────────────── Fixture generation ────────────────────────────

def _build_synthetic_universe(
    *,
    years: int,
    params: dict[str, Any],
) -> dict[str, dict[str, pd.Series | pd.DatetimeIndex | pd.DataFrame]]:
    """Build per-symbol synthetic OHLCV + IV + earnings for the universe.

    Each underlying gets its own seed so paths are different. Volatility uses a
    mean-reverting square-root process around `synth_iv_long_run`. Underlying
    spot uses GBM with drift `synth_drift_annual` and time-varying sigma equal
    to the realized vol implied by the IV path (so HV-IV correlation is high
    without being identity).

    Earnings calendar: quarterly per non-ETF ticker, randomized first date.
    """
    rng = np.random.default_rng(int(params.get("synth_seed", 42)))
    bars = years * 252
    end = pd.Timestamp("2026-01-01")
    dates = pd.date_range(end=end, periods=bars, freq="B")
    dt = 1.0 / 252.0

    long_run_iv = float(params.get("synth_iv_long_run", 0.20))
    kappa = float(params.get("synth_iv_kappa", 3.0))
    vov = float(params.get("synth_iv_vol_of_vol", 0.6))
    drift = float(params.get("synth_drift_annual", 0.07))

    # Per-symbol starting spot — roughly market-realistic for 2026.
    starting_spots = {
        "SPY": 530.0, "QQQ": 460.0, "IWM": 215.0,
        "AAPL": 230.0, "NVDA": 145.0, "MSFT": 420.0, "GOOGL": 180.0,
        "AMZN": 195.0, "META": 600.0, "TSLA": 250.0, "AMD": 165.0, "NFLX": 740.0,
        "TLT": 90.0, "GLD": 230.0, "USO": 80.0,
    }
    # ETFs don't have earnings.
    is_etf = {"SPY", "QQQ", "IWM", "TLT", "GLD", "USO"}

    out: dict[str, dict[str, Any]] = {}
    for idx, sym in enumerate(UNIVERSE):
        sym_rng = np.random.default_rng(rng.integers(0, 2**31) + idx)
        # IV path — mean-reverting, positive (square-root reflective barrier).
        iv = np.empty(bars, dtype=np.float64)
        iv[0] = long_run_iv
        shocks = sym_rng.standard_normal(bars)
        for t in range(1, bars):
            new_iv = (
                iv[t - 1]
                + kappa * (long_run_iv - iv[t - 1]) * dt
                + vov * np.sqrt(max(iv[t - 1], 0.01)) * np.sqrt(dt) * shocks[t]
            )
            iv[t] = max(new_iv, 0.05)  # 5% IV floor

        # Spot path — GBM with sigma = IV/sqrt(252) per bar realized vol noise +
        # a small mean-reversion-correlated noise component so the 2-sigma trigger
        # actually fires from time to time.
        log_returns = (drift - 0.5 * iv * iv) * dt + iv * np.sqrt(dt) * sym_rng.standard_normal(bars)
        # Add occasional mean-reversion-friendly down spikes (~2-3% of bars).
        spike_mask = sym_rng.random(bars) < 0.025
        log_returns[spike_mask] -= sym_rng.uniform(0.02, 0.05, size=int(spike_mask.sum()))
        spot = starting_spots.get(sym, 100.0) * np.exp(np.cumsum(log_returns))

        # Build OHLCV.
        daily_range = np.abs(sym_rng.normal(0, 0.012, size=bars)) * spot
        ohlcv = pd.DataFrame(
            {
                "open": np.r_[spot[0], spot[:-1]],
                "high": spot + daily_range / 2,
                "low": spot - daily_range / 2,
                "close": spot,
                "volume": sym_rng.integers(1_000_000, 100_000_000, size=bars).astype(float),
            },
            index=dates,
        )
        iv_series = pd.Series(iv, index=dates, name="iv")

        # Earnings calendar (quarterly, jittered).
        if sym in is_etf:
            earnings = pd.DatetimeIndex([])
        else:
            first = dates[0] + pd.Timedelta(days=int(sym_rng.integers(20, 90)))
            earn_dates = []
            cur = first
            while cur < dates[-1]:
                jitter = pd.Timedelta(days=int(sym_rng.integers(-5, 6)))
                earn_dates.append(cur + jitter)
                cur = cur + pd.Timedelta(days=91)
            earnings = pd.DatetimeIndex(sorted(earn_dates))

        out[sym] = {"ohlcv": ohlcv, "iv": iv_series, "earnings": earnings}

    return out


def _save_fixture_csv(
    universe: dict[str, dict[str, Any]],
    path: Path,
) -> None:
    """Flatten the universe into a single tidy CSV (long format)."""
    frames: list[pd.DataFrame] = []
    for sym, data in universe.items():
        ohlcv = data["ohlcv"].copy()
        ohlcv["iv"] = data["iv"]
        ohlcv["symbol"] = sym
        ohlcv = ohlcv.reset_index().rename(columns={"index": "date"})
        ohlcv["earnings_dates"] = ";".join(data["earnings"].strftime("%Y-%m-%d").tolist())
        frames.append(ohlcv)
    combined = pd.concat(frames, ignore_index=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(path, index=False)


# ────────────────────────── Trade simulation ──────────────────────────────

def _simulate_trade(  # noqa: PLR0913 — option lifecycle has many knobs
    setup: Setup,
    *,
    ohlcv: pd.DataFrame,
    iv_series: pd.Series,
    contracts: int,
    profit_target: float,
    loss_stop: float,
    time_stop_dte: int,
    hard_close_days: int,
    risk_free_rate: float,
    fee_per_contract: float,
    slippage_bps: float,
) -> TradeRecord | None:
    """Simulate one put credit spread from entry to exit.

    Revalues the spread daily (using each day's spot + IV) until one of:
      - profit target reached (close at profit_target * credit captured)
      - loss stop reached (close at -loss_stop * credit lost)
      - time stop (DTE <= time_stop_dte)
      - hard close (entry + hard_close_days)
      - expiry (intrinsic value at exit)
    """
    entry = setup.entry_date
    expiry = setup.expiry
    hard_close_date = entry + pd.Timedelta(days=hard_close_days)

    # Trading-day index past entry.
    idx = ohlcv.index
    if entry not in idx:
        return None
    entry_pos = idx.get_loc(entry)
    if isinstance(entry_pos, slice):
        return None  # duplicate index, shouldn't happen

    credit_pct_keep = 1.0 - profit_target  # close when spread value <= credit * keep
    credit_pct_loss = 1.0 + loss_stop      # close when spread value >= credit * (1 + stop)

    # Per-side cost = fee_per_contract * 2 (open + close, 2 legs each = 4 fills total)
    # Convert to per-share basis: spread is 100 shares per contract.
    fee_dollars = fee_per_contract * 4.0 * contracts
    slippage_per_share_one_side = (slippage_bps / 10_000.0) * setup.credit_per_share
    # Two sides (open + close).
    slippage_dollars = 2.0 * slippage_per_share_one_side * 100.0 * contracts

    exit_reason = "expired"
    exit_date = expiry
    exit_value = 0.0
    spot_exit = setup.spot

    # Cap the search window to remaining bars in the OHLCV.
    for pos in range(entry_pos + 1, len(idx)):
        ts = idx[pos]
        if ts > expiry:
            # Past expiry — shouldn't happen often since hard-close should fire first.
            spot_exit = float(ohlcv["close"].iloc[pos - 1])
            exit_value = pricing.spread_value_at_expiry(
                spot_at_expiry=spot_exit,
                short_strike=setup.short_strike,
                long_strike=setup.long_strike,
            )
            exit_date = idx[pos - 1]
            exit_reason = "expired"
            break

        days_to_expiry = max((expiry - ts).days, 0)
        spot = float(ohlcv["close"].loc[ts])
        sigma = float(iv_series.loc[ts]) if ts in iv_series.index else setup.iv_at_entry
        if not np.isfinite(sigma) or sigma <= 0.0:
            sigma = setup.iv_at_entry

        if days_to_expiry == 0:
            value_to_close = pricing.spread_value_at_expiry(
                spot_at_expiry=spot,
                short_strike=setup.short_strike,
                long_strike=setup.long_strike,
            )
            spot_exit = spot
            exit_value = value_to_close
            exit_date = ts
            exit_reason = "expired"
            break

        time_to_expiry = days_to_expiry / 365.0
        quote = pricing.quote_put_spread(
            spot=spot,
            short_strike=setup.short_strike,
            long_strike=setup.long_strike,
            time_to_expiry=time_to_expiry,
            sigma=sigma,
            risk_free_rate=risk_free_rate,
        )
        # Cost to close = current short premium - current long premium (both worth
        # less than at entry hopefully). Already computed as quote.credit (which is
        # the current cost to *re-establish* the spread = cost to close it).
        value_to_close = max(quote.credit, 0.0)

        # Profit target: cost-to-close <= credit * (1 - profit_target).
        if value_to_close <= setup.credit_per_share * credit_pct_keep:
            spot_exit = spot
            exit_value = value_to_close
            exit_date = ts
            exit_reason = "profit_target"
            break

        # Loss stop: cost-to-close >= credit * (1 + loss_stop).
        if value_to_close >= setup.credit_per_share * credit_pct_loss:
            spot_exit = spot
            exit_value = value_to_close
            exit_date = ts
            exit_reason = "loss_stop"
            break

        # Time stop on DTE.
        if days_to_expiry <= time_stop_dte:
            spot_exit = spot
            exit_value = value_to_close
            exit_date = ts
            exit_reason = "time_stop"
            break

        # Hard close on calendar days since entry.
        if ts >= hard_close_date:
            spot_exit = spot
            exit_value = value_to_close
            exit_date = ts
            exit_reason = "time_stop"
            break
    else:
        # Loop fell off the end of OHLCV without exiting (data ran out).
        return None

    pnl_per_share = pricing.spread_pnl_per_share(
        credit_received=setup.credit_per_share,
        current_value_to_close=exit_value,
    )
    # 100 shares per contract. Fees + slippage already in dollars.
    pnl_dollars = pnl_per_share * 100.0 * contracts - fee_dollars - slippage_dollars

    return TradeRecord(
        symbol=setup.symbol,
        entry_date=entry,
        exit_date=exit_date,
        days_held=int((exit_date - entry).days),
        spot_entry=setup.spot,
        spot_exit=spot_exit,
        short_strike=setup.short_strike,
        long_strike=setup.long_strike,
        width=setup.width,
        credit_per_share=setup.credit_per_share,
        exit_value_per_share=exit_value,
        pnl_per_share=pnl_per_share,
        contracts=contracts,
        pnl_dollars=pnl_dollars,
        exit_reason=exit_reason,
    )


def _run_universe(
    universe: dict[str, dict[str, Any]],
    *,
    params: dict[str, Any],
    spy_for_regimes: pd.DataFrame | None = None,
) -> PortfolioResult:
    """Run vol-rank across every symbol; manage portfolio-level concurrency caps."""
    initial_cash = float(params.get("initial_cash", 100_000.0))
    risk_per_trade = float(params.get("risk_per_trade", 0.005))
    max_concurrent = int(params.get("max_concurrent", 6))
    max_per_underlying = int(params.get("max_per_underlying", 1))
    rfr = float(params.get("risk_free_rate", 0.045))
    fee_per_contract = float(params.get("fee_per_contract", 0.65))
    slippage_bps = float(params.get("slippage_bps", 5.0))
    profit_target = float(params.get("profit_target", 0.50))
    loss_stop = float(params.get("loss_stop", 1.00))
    time_stop_dte = int(params.get("time_stop_dte", 21))
    hard_close_days = int(params.get("hard_close_days", 21))

    # Regimes (use SPY proxy + synthetic VIX = first symbol's IV * 100 if no real VIX).
    if spy_for_regimes is None:
        spy_for_regimes = universe["SPY"]["ohlcv"]
    fake_vix = (universe["SPY"]["iv"] * 100.0).rename("vix")
    regimes = regimes_lib.classify_regimes(spy_for_regimes, fake_vix)

    # Step 1: collect all setups across symbols.
    all_setups: list[Setup] = []
    for sym in UNIVERSE:
        d = universe[sym]
        setups = find_entries(
            d["ohlcv"],
            d["iv"],
            d["earnings"],
            symbol=sym,
            regimes=regimes,
            params=params,
        )
        all_setups.extend(setups)

    all_setups.sort(key=lambda s: s.entry_date)

    # Step 2: sequentially apply concurrency caps and execute trades.
    open_by_symbol: dict[str, int] = {sym: 0 for sym in UNIVERSE}
    open_trades_close_dates: list[pd.Timestamp] = []
    trades: list[TradeRecord] = []

    # Equity is updated lazily — we record (date, dollar_pnl) events, then build a
    # daily mark-to-close equity curve from initial_cash + cumulative realized P&L.
    pnl_events: list[tuple[pd.Timestamp, float]] = []

    for setup in all_setups:
        # Free up "open" slots whose close date has passed at this setup's entry.
        open_trades_close_dates = [d for d in open_trades_close_dates if d > setup.entry_date]
        # Recompute per-symbol open count from trades closed.
        # Simpler approach: track explicitly via index in the realized-trades list.
        symbol_open = sum(
            1 for t in trades
            if t.symbol == setup.symbol
            and t.entry_date <= setup.entry_date < t.exit_date
        )
        if symbol_open >= max_per_underlying:
            continue
        if len(open_trades_close_dates) >= max_concurrent:
            continue

        # Position size: contracts such that max-loss <= equity * risk_per_trade.
        # Equity here = initial_cash + realized P&L up to this entry date.
        realized_so_far = sum(t.pnl_dollars for t in trades if t.exit_date <= setup.entry_date)
        equity_now = initial_cash + realized_so_far
        max_loss_dollars = setup.max_loss_per_share * 100.0  # per contract
        if max_loss_dollars <= 0.0:
            continue
        risk_dollars = equity_now * risk_per_trade
        contracts = max(int(risk_dollars // max_loss_dollars), 1)
        # Cap contracts so no single trade exceeds 5% of equity at risk (sanity).
        max_contracts = max(int((equity_now * 0.05) // max_loss_dollars), 1)
        contracts = min(contracts, max_contracts)

        d = universe[setup.symbol]
        trade = _simulate_trade(
            setup,
            ohlcv=d["ohlcv"],
            iv_series=d["iv"],
            contracts=contracts,
            profit_target=profit_target,
            loss_stop=loss_stop,
            time_stop_dte=time_stop_dte,
            hard_close_days=hard_close_days,
            risk_free_rate=rfr,
            fee_per_contract=fee_per_contract,
            slippage_bps=slippage_bps,
        )
        if trade is None:
            continue
        trades.append(trade)
        open_trades_close_dates.append(trade.exit_date)
        pnl_events.append((trade.exit_date, trade.pnl_dollars))

    # Build equity curve at the union of all underlying date indexes.
    all_dates = universe[UNIVERSE[0]]["ohlcv"].index
    pnl_df = pd.DataFrame(pnl_events, columns=["date", "pnl"]) if pnl_events else pd.DataFrame(columns=["date", "pnl"])
    if not pnl_df.empty:
        pnl_df = pnl_df.groupby("date", as_index=True).sum().sort_index()
    daily_pnl = pd.Series(0.0, index=all_dates, dtype=float)
    if not pnl_df.empty:
        common = pnl_df.index.intersection(daily_pnl.index)
        daily_pnl.loc[common] = pnl_df["pnl"].loc[common].to_numpy()
    equity = initial_cash + daily_pnl.cumsum()
    returns = equity.pct_change().fillna(0.0)
    trade_pnls = pd.Series([t.pnl_dollars for t in trades], dtype=float, name="trade_pnl")

    return PortfolioResult(
        name="vol_rank_options (Strategy B3)",
        trades=trades,
        full_equity=equity,
        full_returns=returns,
        trade_pnls=trade_pnls,
        params=params,
    )


# ────────────────────────── Reporting ──────────────────────────────────────

def _plot_equity_curve(equity: pd.Series, out_path: Path, title: str) -> None:
    """Write an equity curve PNG."""
    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=120)
    ax.plot(equity.index, equity.to_numpy(), linewidth=1.5, color="#1f77b4")
    ax.set_title(f"{title} — Equity Curve")
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity ($)")
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def _plot_drawdown(equity: pd.Series, out_path: Path, title: str) -> None:
    """Write a drawdown PNG."""
    arr = equity.to_numpy(dtype=np.float64)
    if arr.size == 0:
        return
    peak = np.maximum.accumulate(arr)
    peak = np.where(peak == 0.0, np.nan, peak)
    dd = (arr - peak) / peak * 100.0

    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=120)
    ax.fill_between(equity.index, dd, 0.0, color="#d62728", alpha=0.4)
    ax.plot(equity.index, dd, linewidth=1.0, color="#d62728")
    ax.set_title(f"{title} — Drawdown")
    ax.set_xlabel("Date")
    ax.set_ylabel("Drawdown (%)")
    ax.grid(True, alpha=0.3)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def _plot_pnl_histogram(trade_pnls: pd.Series, out_path: Path, title: str) -> None:
    """Histogram of per-trade P&L."""
    if trade_pnls.empty:
        return
    fig, ax = plt.subplots(figsize=(10, 4.5), dpi=120)
    arr = trade_pnls.to_numpy(dtype=np.float64)
    ax.hist(arr, bins=40, color="#2ca02c", edgecolor="black", alpha=0.8)
    ax.axvline(0.0, color="black", linestyle="--", linewidth=1)
    ax.axvline(arr.mean(), color="#d62728", linestyle="-", linewidth=1.5,
               label=f"mean={arr.mean():.2f}")
    ax.set_title(f"{title} — Per-Trade P&L Distribution")
    ax.set_xlabel("P&L ($)")
    ax.set_ylabel("Trades")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def _format_pct(x: float, digits: int = 2) -> str:
    if not np.isfinite(x):
        return "n/a"
    return f"{x * 100.0:+.{digits}f}%"


def _format_num(x: float, digits: int = 4) -> str:
    if not np.isfinite(x):
        return "n/a"
    return f"{x:.{digits}f}"


def _trades_summary(trades: list[TradeRecord]) -> dict[str, float]:
    """Custom strategy-specific trade stats."""
    if not trades:
        return {
            "num_trades": 0.0, "wins": 0.0, "losses": 0.0, "win_rate": 0.0,
            "avg_win": 0.0, "avg_loss": 0.0, "loss_win_ratio": 0.0,
            "avg_credit_pct": 0.0, "avg_days_held": 0.0,
        }
    pnls = np.array([t.pnl_dollars for t in trades])
    credits = np.array([t.credit_per_share / t.width if t.width > 0 else 0.0 for t in trades])
    days = np.array([t.days_held for t in trades])
    wins = pnls[pnls > 0.0]
    losses = pnls[pnls <= 0.0]
    avg_win = float(wins.mean()) if wins.size else 0.0
    avg_loss = float(losses.mean()) if losses.size else 0.0
    return {
        "num_trades": float(len(trades)),
        "wins": float(wins.size),
        "losses": float(losses.size),
        "win_rate": float(wins.size / len(trades)),
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "loss_win_ratio": float(abs(avg_loss) / avg_win) if avg_win > 0 else float("inf"),
        "avg_credit_pct": float(credits.mean()),
        "avg_days_held": float(days.mean()),
    }


def _write_report(
    result: PortfolioResult,
    out_dir: Path,
    *,
    pass_fail: dict[str, Any],
) -> Path:
    """Write report.md + PNGs + trades.csv + summary.json."""
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = result.summary()
    trades_summary = _trades_summary(result.trades)

    eq_png = out_dir / "equity-curve.png"
    dd_png = out_dir / "drawdown.png"
    hist_png = out_dir / "pnl-histogram.png"
    trades_csv = out_dir / "trades.csv"
    summary_path = out_dir / "summary.json"
    md_path = out_dir / "report.md"

    if not result.full_equity.empty:
        _plot_equity_curve(result.full_equity, eq_png, result.name)
        _plot_drawdown(result.full_equity, dd_png, result.name)
    _plot_pnl_histogram(result.trade_pnls, hist_png, result.name)

    if result.trades:
        pd.DataFrame(
            [
                {
                    "symbol": t.symbol,
                    "entry_date": t.entry_date.strftime("%Y-%m-%d"),
                    "exit_date": t.exit_date.strftime("%Y-%m-%d"),
                    "days_held": t.days_held,
                    "spot_entry": round(t.spot_entry, 2),
                    "spot_exit": round(t.spot_exit, 2),
                    "short_strike": t.short_strike,
                    "long_strike": t.long_strike,
                    "width": t.width,
                    "credit_per_share": round(t.credit_per_share, 4),
                    "exit_value_per_share": round(t.exit_value_per_share, 4),
                    "pnl_per_share": round(t.pnl_per_share, 4),
                    "contracts": t.contracts,
                    "pnl_dollars": round(t.pnl_dollars, 2),
                    "exit_reason": t.exit_reason,
                }
                for t in result.trades
            ]
        ).to_csv(trades_csv, index=False)
    else:
        pd.DataFrame().to_csv(trades_csv, index=False)

    full_summary = {**summary, "strategy": trades_summary, "pass_fail": pass_fail}
    summary_path.write_text(json.dumps(full_summary, indent=2, default=str), encoding="utf-8")

    mc = stats.monte_carlo_dd_ci(result.trade_pnls, n_paths=10_000)

    md_lines = [
        f"# {result.name} — Backtest Report",
        "",
        "## Edge Thesis",
        "",
        "Selling fear when implied volatility is rich (IV-rank > 70) AND price is "
        "stretched 2σ below its 20-day mean. The variance risk premium "
        "(IV systematically exceeds realized vol — see Carr & Wu 2009) plus mean "
        "reversion in liquid large-caps creates positive expectancy on short put spreads.",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        f"| Sharpe | {_format_num(summary['sharpe'], 3)} |",
        f"| Sortino | {_format_num(summary['sortino'], 3)} |",
        f"| Calmar | {_format_num(summary['calmar'], 3)} |",
        f"| CAGR | {_format_pct(summary['cagr'])} |",
        f"| Max Drawdown | {_format_pct(summary['max_dd'])} |",
        f"| Total Trades | {int(trades_summary['num_trades'])} |",
        f"| Win Rate | {_format_pct(trades_summary['win_rate'], digits=1)} |",
        f"| Avg Win | ${_format_num(trades_summary['avg_win'], 2)} |",
        f"| Avg Loss | ${_format_num(trades_summary['avg_loss'], 2)} |",
        f"| Loss/Win Ratio | {_format_num(trades_summary['loss_win_ratio'], 2)} |",
        f"| Avg Credit (% of width) | {_format_pct(trades_summary['avg_credit_pct'], digits=1)} |",
        f"| Avg Days Held | {_format_num(trades_summary['avg_days_held'], 1)} |",
        "",
        "## Pass/Fail",
        "",
        f"- Win rate ≥ 60%: **{'PASS' if pass_fail['win_rate_pass'] else 'FAIL'}** "
        f"(actual {trades_summary['win_rate']*100:.1f}%)",
        f"- Loss/Win ratio ≤ 2.0: **{'PASS' if pass_fail['loss_win_pass'] else 'FAIL'}** "
        f"(actual {trades_summary['loss_win_ratio']:.2f})",
        f"- Overall: **{'PASS' if pass_fail['overall_pass'] else 'FAIL'}**",
        "",
        "## Equity Curve",
        "",
        "![Equity Curve](equity-curve.png)" if eq_png.exists() else "_No equity curve._",
        "",
        "## Drawdown",
        "",
        "![Drawdown](drawdown.png)" if dd_png.exists() else "_No drawdown chart._",
        "",
        "## P&L Distribution",
        "",
        "![P&L Distribution](pnl-histogram.png)" if hist_png.exists() else "_No P&L histogram._",
        "",
        "## Monte Carlo Drawdown CI",
        "",
        f"_Bootstrapped {mc.n_paths:,} paths from realized trade pnls._",
        "",
        "| Quantile | Max Drawdown |",
        "| --- | --- |",
        f"| Median | {_format_pct(mc.median_max_dd)} |",
        f"| 95% CI Low | {_format_pct(mc.ci_low_95)} |",
        f"| 95% CI High | {_format_pct(mc.ci_high_95)} |",
        f"| 99th pct (worst) | {_format_pct(mc.p99_max_dd)} |",
        "",
        "## Parameters",
        "",
        "```json",
        json.dumps(result.params, indent=2, default=str),
        "```",
        "",
        "---",
        "",
        "_This is research output. Not financial advice._",
        "",
    ]
    md_path.write_text("\n".join(md_lines), encoding="utf-8")
    return md_path


# ────────────────────────── Public entry point ────────────────────────────

def _load_params() -> dict[str, Any]:
    with PARAMS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def run(years: int = 8, report_dir: Path | None = None) -> PortfolioResult:
    """Run the strategy. Builds fixture if missing, simulates, writes report."""
    params = _load_params()
    universe = _build_synthetic_universe(years=years, params=params)

    fixture_path = FIXTURES_DIR / "options_universe.csv"
    if not fixture_path.exists():
        _save_fixture_csv(universe, fixture_path)

    result = _run_universe(universe, params=params)
    trades_summary = _trades_summary(result.trades)
    pass_fail = {
        "win_rate_pass": trades_summary["win_rate"] >= 0.60,
        "loss_win_pass": trades_summary["loss_win_ratio"] <= 2.0,
    }
    pass_fail["overall_pass"] = pass_fail["win_rate_pass"] and pass_fail["loss_win_pass"]

    out_dir = report_dir or DEFAULT_REPORTS_DIR
    _write_report(result, out_dir, pass_fail=pass_fail)
    return result


def _main() -> None:
    parser = argparse.ArgumentParser(description="Run vol-rank mean-reversion (options) strategy.")
    parser.add_argument("--years", type=int, default=8, help="Years of synthetic data.")
    parser.add_argument(
        "--report-dir",
        type=str,
        default=str(DEFAULT_REPORTS_DIR),
        help="Where to write the report bundle.",
    )
    args = parser.parse_args()
    out_dir = Path(args.report_dir).resolve()

    result = run(years=args.years, report_dir=out_dir)
    summary = result.summary()
    trades_summary = _trades_summary(result.trades)

    overall_pass = (
        trades_summary["win_rate"] >= 0.60
        and trades_summary["loss_win_ratio"] <= 2.0
    )

    out = {
        "strategy": result.name,
        "trades": int(trades_summary["num_trades"]),
        "win_rate": round(trades_summary["win_rate"], 4),
        "avg_win": round(trades_summary["avg_win"], 2),
        "avg_loss": round(trades_summary["avg_loss"], 2),
        "loss_win_ratio": round(trades_summary["loss_win_ratio"], 2),
        "avg_credit_pct": round(trades_summary["avg_credit_pct"], 4),
        "max_dd": round(summary["max_dd"], 4),
        "sharpe": round(summary["sharpe"], 4),
        "result": "PASS" if overall_pass else "FAIL",
        "report": str(out_dir / "report.md"),
    }
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    _main()
