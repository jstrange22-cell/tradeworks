"""Template strategy runner.

Generates synthetic OHLCV, runs the backtest, writes a report. Real strategies
should swap the synthetic-data block for a `lib/data.fetch_yfinance` (or
Polygon/Coinbase) call.

Usage:
    uv run python -m research.strategies._template.run
    uv run python -m research.strategies._template.run --years 5
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

from research.lib import report, walkforward
from research.strategies._template.signal import generate_signals

STRATEGY_DIR: Path = Path(__file__).resolve().parent
PARAMS_PATH: Path = STRATEGY_DIR / "params.yaml"
REPORTS_DIR: Path = STRATEGY_DIR / "reports"


def _load_params() -> dict[str, Any]:
    """Load params.yaml as a dict."""
    with PARAMS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _build_synthetic_ohlcv(years: int, *, seed: int = 7) -> pd.DataFrame:
    """Generate a deterministic synthetic OHLCV frame at daily frequency.

    Uses a geometric random walk with mild drift + a couple of regime shifts so
    the SMA crossover has something to chew on.
    """
    rng = np.random.default_rng(seed)
    bars = years * 252  # business days approx
    end = pd.Timestamp("2026-01-01", tz="UTC")
    dates = pd.date_range(end=end, periods=bars, freq="B")

    # Walk: daily log-returns ~ N(mu, sigma) with drift shifts.
    drift = np.where(np.arange(bars) % 504 < 252, 0.0006, -0.0001)
    sigma = 0.012
    log_returns = rng.normal(loc=drift, scale=sigma, size=bars)
    close = 100.0 * np.exp(np.cumsum(log_returns))

    # Build OHLC from close with plausible intra-bar ranges.
    daily_range = np.abs(rng.normal(0, sigma, size=bars)) * close
    high = close + daily_range / 2.0
    low = close - daily_range / 2.0
    open_ = np.r_[close[0], close[:-1]]  # open = prev close
    volume = rng.integers(1_000_000, 10_000_000, size=bars).astype(float)

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


def run(years: int = 10) -> walkforward.BacktestResult:
    """Run the template strategy on synthetic data and write a report.

    Returns the BacktestResult so callers can post-process programmatically.
    """
    params = _load_params()
    ohlcv = _build_synthetic_ohlcv(years=years)

    result = walkforward.run_full_backtest(
        signal_fn=generate_signals,
        ohlcv=ohlcv,
        name="_template (SMA crossover)",
        params=params,
        initial_cash=float(params.get("initial_cash", 10_000.0)),
        train_years=float(params.get("train_years", 2.0)),
        test_years=float(params.get("test_years", 0.5)),
        step_years=float(params.get("step_years", 0.5)),
        # On Windows + Python 3.11/3.12 vectorbt should work; if it doesn't,
        # the simulator quietly falls back to the pandas path.
        use_vectorbt=True,
    )

    report.write_report(result, REPORTS_DIR)
    return result


def _main() -> None:
    """CLI entry point. Prints summary as JSON to stdout."""
    parser = argparse.ArgumentParser(description="Run the template SMA strategy.")
    parser.add_argument("--years", type=int, default=10, help="Years of synthetic data.")
    args = parser.parse_args()

    result = run(years=args.years)
    out = {
        "strategy": result.name,
        "summary": result.summary(),
        "num_windows": len(result.windows),
        "report": str(REPORTS_DIR / "report.md"),
    }
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    _main()
