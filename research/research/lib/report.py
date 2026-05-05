"""Report generation: writes report.md + equity-curve.png + drawdown.png + walkforward.csv.

`write_report` takes a `BacktestResult` and an output directory, writes all artifacts,
and returns the path to the markdown file. The markdown is human-readable and
parseable in CI (we use plain GFM tables — no fancy templating).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

import matplotlib

# Force a non-interactive backend so the report writer works in CI / SSH / no-X11.
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

if TYPE_CHECKING:
    from .walkforward import BacktestResult

from . import regimes as regimes_lib
from . import stats


def _format_pct(x: float, digits: int = 2) -> str:
    """Format a fraction as a percentage string with a sign."""
    if not np.isfinite(x):
        return "n/a"
    return f"{x * 100.0:+.{digits}f}%"


def _format_num(x: float, digits: int = 4) -> str:
    """Format a float with `digits` decimals, or `n/a` if non-finite."""
    if not np.isfinite(x):
        return "n/a"
    return f"{x:.{digits}f}"


def _summary_table(summary: dict[str, float]) -> str:
    """Render the summary stats dict as a Markdown table."""
    rows = [
        ("Sharpe", _format_num(summary["sharpe"], 3)),
        ("Sortino", _format_num(summary["sortino"], 3)),
        ("Calmar", _format_num(summary["calmar"], 3)),
        ("CAGR", _format_pct(summary["cagr"])),
        ("Max Drawdown", _format_pct(summary["max_dd"])),
        ("Win Rate", _format_pct(summary["win_rate"], digits=1)),
        ("Expectancy ($/trade)", _format_num(summary["expectancy"], 2)),
        ("Num Trades", f"{int(summary['num_trades'])}"),
    ]
    out = ["| Metric | Value |", "| --- | --- |"]
    out.extend(f"| {k} | {v} |" for k, v in rows)
    return "\n".join(out)


def _windows_table(windows_df) -> str:  # type: ignore[no-untyped-def]
    """Render walk-forward windows DF as a Markdown table."""
    if windows_df.empty:
        return "_No walk-forward windows produced (history too short)._"

    cols = list(windows_df.columns)
    header = "| " + " | ".join(cols) + " |"
    separator = "| " + " | ".join(["---"] * len(cols)) + " |"
    body_rows = []
    for _, row in windows_df.iterrows():
        cells = []
        for c in cols:
            val = row[c]
            if hasattr(val, "strftime"):
                cells.append(val.strftime("%Y-%m-%d"))
            elif isinstance(val, float):
                cells.append(f"{val:.4f}")
            else:
                cells.append(str(val))
        body_rows.append("| " + " | ".join(cells) + " |")
    return "\n".join([header, separator, *body_rows])


def _mc_table(mc) -> str:  # type: ignore[no-untyped-def]
    """Render a Monte Carlo DD result as a Markdown table."""
    return "\n".join([
        "| Quantile | Max Drawdown |",
        "| --- | --- |",
        f"| Median | {_format_pct(mc.median_max_dd)} |",
        f"| 95% CI Low | {_format_pct(mc.ci_low_95)} |",
        f"| 95% CI High | {_format_pct(mc.ci_high_95)} |",
        f"| 99th pct (worst) | {_format_pct(mc.p99_max_dd)} |",
        f"| Paths | {mc.n_paths} |",
    ])


def _regime_table(regime_breakdown) -> str:  # type: ignore[no-untyped-def]
    """Render the regime breakdown DF as a Markdown table."""
    if regime_breakdown is None or regime_breakdown.empty:
        return "_No regime classification provided._"
    rows = ["| Regime | Days | % |", "| --- | --- | --- |"]
    for _, r in regime_breakdown.iterrows():
        rows.append(f"| {r['regime']} | {int(r['days'])} | {r['pct']:.2f}% |")
    return "\n".join(rows)


def _plot_equity_curve(equity, out_path: Path, title: str) -> None:  # type: ignore[no-untyped-def]
    """Save an equity-curve PNG."""
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


def _plot_drawdown(equity, out_path: Path, title: str) -> None:  # type: ignore[no-untyped-def]
    """Save a drawdown PNG (filled area showing % drawdown over time)."""
    arr = equity.to_numpy(dtype=np.float64)
    if arr.size == 0:
        return
    peak = np.maximum.accumulate(arr)
    peak = np.where(peak == 0.0, np.nan, peak)
    dd = (arr - peak) / peak * 100.0  # in %

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


def write_report(
    result: BacktestResult,
    out_dir: Path,
    *,
    mc_paths: int = 10_000,
) -> Path:
    """Write report.md + PNGs + windows CSV + summary.json into `out_dir`.

    Returns the path to report.md.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = result.summary()
    windows_df = result.windows_df()

    # Artifacts.
    eq_png = out_dir / "equity-curve.png"
    dd_png = out_dir / "drawdown.png"
    csv_path = out_dir / "walkforward.csv"
    summary_path = out_dir / "summary.json"
    md_path = out_dir / "report.md"

    if not result.full_equity.empty:
        _plot_equity_curve(result.full_equity, eq_png, result.name)
        _plot_drawdown(result.full_equity, dd_png, result.name)
    windows_df.to_csv(csv_path, index=False)
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    # Monte Carlo CI on trade pnls.
    mc = stats.monte_carlo_dd_ci(result.full_trade_pnls, n_paths=mc_paths)

    # Regime breakdown if available.
    regime_md = "_No regime classification provided._"
    if result.regimes is not None:
        regime_md = _regime_table(regimes_lib.regime_breakdown(result.regimes))

    md_lines = [
        f"# {result.name} — Backtest Report",
        "",
        "## Summary",
        "",
        _summary_table(summary),
        "",
        "## Equity Curve",
        "",
        "![Equity Curve](equity-curve.png)" if eq_png.exists() else "_No equity curve._",
        "",
        "## Drawdown",
        "",
        "![Drawdown](drawdown.png)" if dd_png.exists() else "_No drawdown chart._",
        "",
        "## Walk-Forward Windows",
        "",
        _windows_table(windows_df),
        "",
        "## Monte Carlo Drawdown CI",
        "",
        f"_Bootstrapped {mc.n_paths:,} paths from realized trade pnls (resample-with-replacement)._",
        "",
        _mc_table(mc),
        "",
        "## Regime Breakdown",
        "",
        regime_md,
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
