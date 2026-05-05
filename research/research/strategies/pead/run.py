"""PEAD strategy runner.

End-to-end: load fixture → run multi-symbol simulation → write report.
Designed to run without external API keys against the synthetic fixture.

Usage:
    uv run python -m research.strategies.pead.run
    uv run python -m research.strategies.pead.run --years 10 --report-dir ./reports
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import yaml

from research.lib import report

from . import earnings as earnings_mod
from .signal import run_pead_simulation

STRATEGY_DIR: Path = Path(__file__).resolve().parent
PARAMS_PATH: Path = STRATEGY_DIR / "params.yaml"
DEFAULT_REPORT_DIR: Path = STRATEGY_DIR / "reports"

# Acceptance bar from the v2 spec; we PRINT the verdict but do not exit non-zero
# because the fixture is synthetic and Sharpe can swing.
SHARPE_TARGET: float = 0.7
MIN_WINDOW_SHARPE: float = 0.5


def _load_params() -> dict[str, Any]:
    """Load params.yaml as a dict."""
    with PARAMS_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _print_pass_fail(result_summary: dict[str, float], windows: list[dict[str, float]]) -> None:
    """Print a clear PASS/FAIL line against v2 acceptance criteria."""
    full_sharpe = float(result_summary["sharpe"])
    if windows:
        win_sharpes = [float(w["sharpe"]) for w in windows]
        min_win = min(win_sharpes)
        max_win = max(win_sharpes)
    else:
        min_win = max_win = 0.0
    full_pass = "PASS" if full_sharpe >= SHARPE_TARGET else "FAIL"
    win_pass = "PASS" if min_win >= MIN_WINDOW_SHARPE else "FAIL"

    print()
    print("=" * 72)
    print("v2 ACCEPTANCE CHECK")
    print("=" * 72)
    print(
        f"Full-history Sharpe: {full_sharpe:+.3f} (target >= {SHARPE_TARGET}) -> {full_pass}"
    )
    print(
        f"Per-window Sharpe range: {min_win:+.3f} ... {max_win:+.3f} "
        f"(min target >= {MIN_WINDOW_SHARPE}) -> {win_pass}"
    )
    print(
        "(Synthetic fixture; flag if real-data Sharpe materially differs.)"
    )
    print("=" * 72)


def run(years: int = 10, report_dir: Path | None = None) -> dict[str, Any]:
    """Run PEAD against the fixture and write the standard report bundle.

    Returns a JSON-friendly summary dict.
    """
    params = _load_params()
    out_dir = (report_dir or DEFAULT_REPORT_DIR).resolve()

    prices, events = earnings_mod.load_fixture(
        n_symbols=earnings_mod.DEFAULT_NUM_SYMBOLS,
        years=years,
        seed=int(params.get("seed", 42)),
    )

    result = run_pead_simulation(prices=prices, events=events, params=params)
    report_path = report.write_report(result, out_dir)

    summary = result.summary()
    windows_df = result.windows_df()
    windows_records = windows_df.to_dict("records") if not windows_df.empty else []

    print(f"Strategy: {result.name}")
    print(f"Events processed: {len(events)}")
    print(f"Total trades closed: {int(summary['num_trades'])}")
    print(f"Win rate: {summary['win_rate'] * 100.0:.1f}%")
    print(f"Expectancy: ${summary['expectancy']:+.2f} per trade")
    print(f"Full Sharpe: {summary['sharpe']:+.3f}")
    print(f"Sortino: {summary['sortino']:+.3f}")
    print(f"Max Drawdown: {summary['max_dd'] * 100.0:+.2f}%")
    print(f"CAGR: {summary['cagr'] * 100.0:+.2f}%")
    print(f"Walk-forward windows: {len(windows_records)}")
    print(f"Report dir: {out_dir}")
    print(f"Markdown: {report_path}")

    # Monthly distribution of trade pnl ($) — quick sanity.
    if not result.full_trade_pnls.empty:
        pnls = result.full_trade_pnls
        # We don't have per-trade dates back, so monthly is over the equity curve.
        monthly_returns = result.full_returns.resample("ME").apply(lambda r: (1 + r).prod() - 1)
        months_pos = int((monthly_returns > 0).sum())
        months_neg = int((monthly_returns < 0).sum())
        months_zero = int((monthly_returns == 0).sum())
        print(
            f"Monthly distribution: {months_pos} up / {months_neg} down / "
            f"{months_zero} flat"
        )
        print(f"Best month: {monthly_returns.max() * 100:+.2f}%")
        print(f"Worst month: {monthly_returns.min() * 100:+.2f}%")
        _ = pnls  # kept for future per-trade analytics

    _print_pass_fail(summary, windows_records)

    return {
        "strategy": result.name,
        "summary": summary,
        "num_windows": len(windows_records),
        "events_processed": len(events),
        "report_dir": str(out_dir),
        "report_md": str(report_path),
    }


def _main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Run the PEAD (Post-Earnings Announcement Drift) strategy.",
    )
    parser.add_argument(
        "--years", type=int, default=10, help="Years of synthetic data (default: 10).",
    )
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=DEFAULT_REPORT_DIR,
        help="Where to write report artifacts (default: ./reports).",
    )
    args = parser.parse_args()

    out = run(years=args.years, report_dir=args.report_dir)
    print()
    print(json.dumps({k: v for k, v in out.items() if k != "summary"}, indent=2, default=str))


if __name__ == "__main__":
    _main()
