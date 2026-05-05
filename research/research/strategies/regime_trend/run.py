"""Regime-Filtered Trend Following (Strategy B2) runner.

Builds a synthetic 14-ETF universe (single market factor + sector idiosyncratic
noise + occasional crisis regimes), constructs a synthetic SPY proxy + VIX-like
series, classifies regimes, then walks the strategy forward on an equal-weighted
diversified composite. Per-symbol portfolio trades are also materialized for
the regime-breakdown table in the report.

Usage:
    cd research && uv run python -m research.strategies.regime_trend.run
    cd research && uv run python -m research.strategies.regime_trend.run --years 10
    cd research && uv run python -m research.strategies.regime_trend.run --report-dir custom/dir
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

from research.lib import regimes as regimes_lib
from research.lib import report, walkforward
from research.strategies.regime_trend.signal import (
    generate_signals,
    generate_trades,
)

STRATEGY_DIR: Path = Path(__file__).resolve().parent
PARAMS_PATH: Path = STRATEGY_DIR / "params.yaml"
DEFAULT_REPORTS_DIR: Path = STRATEGY_DIR / "reports"
FIXTURES_DIR: Path = STRATEGY_DIR / "fixtures"
FIXTURE_CSV: Path = FIXTURES_DIR / "universe_ohlcv.csv"

# 14-ETF universe per spec.
UNIVERSE: tuple[str, ...] = (
    "SPY",
    "QQQ",
    "IWM",
    "XLK",
    "XLF",
    "XLE",
    "XLV",
    "XLY",
    "XLI",
    "XLP",
    "XLU",
    "XLB",
    "XLRE",
    "XLC",
)

# Median window Sharpe target for PASS/FAIL gate.
TARGET_MEDIAN_SHARPE: float = 0.7


def _load_params() -> dict[str, Any]:
    """Load params.yaml as a dict."""
    with PARAMS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _build_synthetic_universe(
    years: int,
    *,
    seed: int = 42,
) -> tuple[dict[str, pd.DataFrame], pd.DataFrame, pd.Series]:
    """Build a deterministic 14-ETF synthetic universe with a market factor.

    Model:
      - Daily log-returns for each symbol = beta * market_factor + idio_noise
      - Market factor has drift shifts + scheduled "crisis" volatility spikes so
        the regime classifier sees calm/trending/volatile/crisis.
      - Sector ETFs get higher idiosyncratic vol than broad-market ETFs.
      - SPY is constructed from the market factor directly (highest correlation).
      - VIX-like series scales inversely with realized 20d volatility of SPY.

    Returns (ohlcv_dict, spy_ohlcv, vix_series).
    """
    rng = np.random.default_rng(seed)
    n = years * 252
    end = pd.Timestamp("2026-01-01", tz="UTC")
    dates = pd.date_range(end=end, periods=n, freq="B")

    # --- Market factor with regime mix ---
    # Bull years (drift positive, low vol), bear/crisis years (negative drift, high vol).
    cycle = np.arange(n) // 252  # year index 0..years-1
    # Cycle pattern: 3 bull years, 1 chop, 1 bear, repeat
    drift = np.where(cycle % 5 < 3, 0.0008, np.where(cycle % 5 == 3, 0.0001, -0.0006))
    base_sigma = np.where(cycle % 5 == 4, 0.024, 0.011)  # bear years much more volatile

    # Inject 2 short crisis spikes (60 trading days each) at known times.
    crisis_starts = [int(n * 0.35), int(n * 0.72)]
    for s in crisis_starts:
        end_s = min(s + 60, n)
        drift[s:end_s] = -0.003
        base_sigma[s:end_s] = 0.040

    market_returns = rng.normal(loc=drift, scale=base_sigma, size=n)

    # Per-symbol betas + idiosyncratic vol. Broad-market ETFs ~ beta 1.0.
    # Sectors have higher idio-vol; tech / energy higher beta.
    spec: dict[str, tuple[float, float]] = {
        # symbol: (beta, idio_sigma)
        "SPY": (1.00, 0.0010),
        "QQQ": (1.10, 0.0040),
        "IWM": (1.15, 0.0055),
        "XLK": (1.18, 0.0060),
        "XLF": (1.05, 0.0070),
        "XLE": (1.20, 0.0120),
        "XLV": (0.85, 0.0055),
        "XLY": (1.10, 0.0070),
        "XLI": (1.05, 0.0060),
        "XLP": (0.65, 0.0045),
        "XLU": (0.55, 0.0050),
        "XLB": (1.05, 0.0075),
        "XLRE": (0.80, 0.0080),
        "XLC": (1.05, 0.0070),
    }

    ohlcv_dict: dict[str, pd.DataFrame] = {}
    for symbol, (beta, idio_sigma) in spec.items():
        idio = rng.normal(loc=0.0, scale=idio_sigma, size=n)
        log_ret = beta * market_returns + idio
        close = 100.0 * np.exp(np.cumsum(log_ret))
        # OHLC scaffolding from close.
        intra = np.abs(rng.normal(0.0, idio_sigma + 0.005, size=n)) * close
        high = close + intra / 2.0
        low = close - intra / 2.0
        open_ = np.r_[close[0], close[:-1]]
        volume = rng.integers(1_000_000, 10_000_000, size=n).astype(float)
        ohlcv_dict[symbol] = pd.DataFrame(
            {
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            },
            index=dates,
        )

    spy_ohlcv = ohlcv_dict["SPY"].copy()

    # VIX-like proxy: 20d realized vol of SPY * 100 * sqrt(252), with floor + noise.
    spy_close = spy_ohlcv["close"].astype(float)
    spy_log_ret = np.log(spy_close / spy_close.shift(1))
    realized_vol = spy_log_ret.rolling(20, min_periods=5).std() * np.sqrt(252) * 100.0
    vix = (realized_vol * 1.10 + rng.normal(0.0, 1.5, size=n)).clip(lower=10.0)
    vix.name = "vix"

    return ohlcv_dict, spy_ohlcv, vix


def _ensure_fixture(years: int) -> tuple[dict[str, pd.DataFrame], pd.DataFrame, pd.Series]:
    """Build and persist a CSV fixture so tests can reload deterministically.

    The CSV has columns: timestamp, symbol, open, high, low, close, volume,
    plus extra rows where symbol == 'VIX' (close column carries the VIX value).
    """
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    ohlcv_dict, spy_ohlcv, vix = _build_synthetic_universe(years=years)

    # Persist a flat-long CSV with all symbols + VIX.
    rows: list[pd.DataFrame] = []
    for symbol, df in ohlcv_dict.items():
        flat = df.reset_index().rename(columns={"index": "timestamp"})
        flat.insert(0, "symbol", symbol)
        rows.append(flat)
    vix_flat = pd.DataFrame(
        {
            "symbol": "VIX",
            "timestamp": vix.index,
            "open": vix.to_numpy(),
            "high": vix.to_numpy(),
            "low": vix.to_numpy(),
            "close": vix.to_numpy(),
            "volume": 0.0,
        }
    )
    rows.append(vix_flat)
    pd.concat(rows, ignore_index=True).to_csv(FIXTURE_CSV, index=False)
    return ohlcv_dict, spy_ohlcv, vix


def _build_composite(ohlcv_dict: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Equal-weighted price-composite of the universe for the engine to walk-forward.

    Synthesizes a single OHLCV frame whose 'close' is the equal-weighted average
    of all symbols' close, normalized so the first close = 100. Open/high/low/
    volume are similarly aggregated. Lets the engine backtest the strategy as
    if running on a diversified portfolio, while preserving regime gating + ATR.
    """
    closes = pd.concat({s: df["close"] for s, df in ohlcv_dict.items()}, axis=1)
    opens = pd.concat({s: df["open"] for s, df in ohlcv_dict.items()}, axis=1)
    highs = pd.concat({s: df["high"] for s, df in ohlcv_dict.items()}, axis=1)
    lows = pd.concat({s: df["low"] for s, df in ohlcv_dict.items()}, axis=1)
    volumes = pd.concat({s: df["volume"] for s, df in ohlcv_dict.items()}, axis=1)

    composite_close = closes.mean(axis=1)
    norm = 100.0 / composite_close.iloc[0]
    return pd.DataFrame(
        {
            "open": opens.mean(axis=1) * norm,
            "high": highs.mean(axis=1) * norm,
            "low": lows.mean(axis=1) * norm,
            "close": composite_close * norm,
            "volume": volumes.sum(axis=1),
        },
        index=composite_close.index,
    )


def _regime_breakdown_for_trades(
    trades: list[Any],
    regime_series: pd.Series,
) -> pd.DataFrame:
    """Compute trades / win-rate / Sharpe / avg-pnl-pct by entry-day regime.

    `trades` is a list of `signal.Trade` objects. We tag each trade by its
    entry-day regime, compute per-trade pct returns, and aggregate.
    """
    rows: list[dict[str, Any]] = []
    by_regime: dict[str, list[float]] = {}
    for t in trades:
        if t.exit_price is None or t.exit_price <= 0.0 or t.entry_price <= 0.0:
            continue
        regime_label = str(regime_series.reindex([t.entry_date]).ffill().iloc[0])
        pnl_pct = (t.exit_price - t.entry_price) / t.entry_price
        by_regime.setdefault(regime_label, []).append(pnl_pct)

    for regime_label, pnls in by_regime.items():
        arr = np.asarray(pnls, dtype=np.float64)
        if arr.size == 0:
            continue
        win_rate = float((arr > 0.0).mean())
        std = arr.std(ddof=1) if arr.size > 1 else 0.0
        sharpe_like = float(arr.mean() / std * np.sqrt(252.0)) if std > 1e-9 else 0.0
        rows.append(
            {
                "regime": regime_label,
                "trades": int(arr.size),
                "win_rate": round(win_rate, 4),
                "avg_pnl_pct": round(float(arr.mean()), 4),
                "sharpe_like": round(sharpe_like, 4),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["regime", "trades", "win_rate", "avg_pnl_pct", "sharpe_like"])
    return pd.DataFrame(rows).sort_values("trades", ascending=False).reset_index(drop=True)


def run(
    *,
    years: int = 10,
    report_dir: Path | None = None,
) -> dict[str, Any]:
    """Run the regime-trend strategy on the synthetic universe and write a report.

    Returns a dict containing the BacktestResult summary, walk-forward windows,
    portfolio trades, regime breakdown, and the PASS/FAIL gate.
    """
    out_dir = report_dir or DEFAULT_REPORTS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    params = _load_params()
    ohlcv_dict, spy_ohlcv, vix = _ensure_fixture(years=years)
    regime_series = regimes_lib.classify_regimes(spy_ohlcv, vix)

    # Inject regime + spy into params so walk-forward signal_fn sees them.
    composite = _build_composite(ohlcv_dict)
    composite_params: dict[str, Any] = {
        **params,
        "_regime_series": regime_series,
        "_spy_close": spy_ohlcv["close"].astype(float),
    }

    result = walkforward.run_full_backtest(
        signal_fn=generate_signals,
        ohlcv=composite,
        name="Regime-Filtered Trend Following (B2)",
        params=composite_params,
        initial_cash=float(params.get("initial_cash", 100_000.0)),
        train_years=float(params.get("train_years", 2.0)),
        test_years=float(params.get("test_years", 0.5)),
        step_years=float(params.get("step_years", 0.5)),
        use_vectorbt=True,
        regimes=regime_series,
    )

    # Strip injected runtime keys before persisting params (keeps report.md clean).
    serializable_params: dict[str, Any] = {
        k: v for k, v in result.params.items() if not k.startswith("_")
    }
    result.params = serializable_params

    # Portfolio-level trades (multi-symbol) for the regime-breakdown table.
    portfolio_trades = generate_trades(ohlcv_dict, spy_ohlcv, vix, params)
    regime_perf = _regime_breakdown_for_trades(portfolio_trades, regime_series)

    md_path = report.write_report(result, out_dir)

    # Append a strategy-specific regime-by-trade breakdown.
    extra = ["", "## Regime Performance Breakdown (portfolio trades)", ""]
    if regime_perf.empty:
        extra.append("_No portfolio trades produced — check filters._")
    else:
        cols = list(regime_perf.columns)
        extra.append("| " + " | ".join(cols) + " |")
        extra.append("| " + " | ".join(["---"] * len(cols)) + " |")
        for _, r in regime_perf.iterrows():
            extra.append("| " + " | ".join(str(r[c]) for c in cols) + " |")
    extra.extend(["", f"_Portfolio trades: {len(portfolio_trades)} (max concurrent cap applied)._", ""])

    with md_path.open("a", encoding="utf-8") as fp:
        fp.write("\n".join(extra))

    # Pass/fail gate: median walk-forward Sharpe across windows >= target.
    sharpes = [w.sharpe for w in result.windows if np.isfinite(w.sharpe)]
    median_sharpe = float(statistics.median(sharpes)) if sharpes else 0.0
    passed = median_sharpe >= TARGET_MEDIAN_SHARPE

    return {
        "strategy": result.name,
        "summary": result.summary(),
        "num_windows": len(result.windows),
        "median_window_sharpe": median_sharpe,
        "target_median_sharpe": TARGET_MEDIAN_SHARPE,
        "pass": passed,
        "report": str(md_path),
        "portfolio_trade_count": len(portfolio_trades),
        "regime_breakdown": regime_perf.to_dict(orient="records"),
    }


def _main() -> None:
    """CLI entry point. Prints summary as JSON + PASS/FAIL line to stdout."""
    parser = argparse.ArgumentParser(description="Regime-filtered trend following backtest.")
    parser.add_argument("--years", type=int, default=10, help="Years of synthetic data.")
    parser.add_argument(
        "--report-dir",
        type=str,
        default=None,
        help="Output directory for report.md + artifacts.",
    )
    args = parser.parse_args()

    out_dir = Path(args.report_dir) if args.report_dir else None
    result = run(years=args.years, report_dir=out_dir)
    verdict = "PASS" if result["pass"] else "FAIL"
    print(json.dumps(result, indent=2, default=str))
    print(
        f"{verdict}: median window Sharpe = {result['median_window_sharpe']:.3f} "
        f"(target >= {result['target_median_sharpe']:.2f}; "
        f"{result['num_windows']} OOS windows)"
    )


if __name__ == "__main__":
    _main()
