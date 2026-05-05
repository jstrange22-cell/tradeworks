"""Walk-forward backtest engine.

Slides a (train, test) window across the full OHLCV history. For each window
we compute Sharpe / Sortino / max-DD / expectancy / win-rate / num-trades on
the **out-of-sample test segment**. Train segment is reserved for parameter
fitting by the strategy author (we don't fit here — we just expose the segments).

Generic over `signal_fn`: any callable matching the strategy contract:

    def signal_fn(ohlcv: pd.DataFrame, params: dict) -> pd.DataFrame:
        # returns a frame indexed like ohlcv with cols: entry, exit, size

Uses vectorbt for the actual portfolio simulation when available; falls back to
a pure-pandas simulator otherwise (kept minimal — match vectorbt's defaults).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

from . import stats

if TYPE_CHECKING:
    from collections.abc import Callable

# Strategy signal function signature: (ohlcv, params) -> signals_df
SignalFn = "Callable[[pd.DataFrame, dict[str, Any]], pd.DataFrame]"


@dataclass(frozen=True, slots=True)
class WindowResult:
    """One walk-forward window's out-of-sample stats."""

    train_period: tuple[pd.Timestamp, pd.Timestamp]
    test_period: tuple[pd.Timestamp, pd.Timestamp]
    sharpe: float
    sortino: float
    max_dd: float
    expectancy: float
    win_rate: float
    num_trades: int


@dataclass(slots=True)
class BacktestResult:
    """Result of running a strategy through walk-forward + holding the full equity curve."""

    name: str
    windows: list[WindowResult] = field(default_factory=list)
    full_equity: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    full_returns: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    full_trade_pnls: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    params: dict[str, Any] = field(default_factory=dict)
    regimes: pd.Series | None = None

    def summary(self) -> dict[str, float]:
        """Aggregate stats across the full equity curve."""
        return stats.summarize(self.full_returns, self.full_trade_pnls)

    def windows_df(self) -> pd.DataFrame:
        """Return windows as a DataFrame for CSV / report."""
        if not self.windows:
            return pd.DataFrame(
                columns=[
                    "train_start", "train_end", "test_start", "test_end",
                    "sharpe", "sortino", "max_dd", "expectancy",
                    "win_rate", "num_trades",
                ]
            )
        return pd.DataFrame(
            [
                {
                    "train_start": w.train_period[0],
                    "train_end": w.train_period[1],
                    "test_start": w.test_period[0],
                    "test_end": w.test_period[1],
                    "sharpe": round(w.sharpe, 4),
                    "sortino": round(w.sortino, 4),
                    "max_dd": round(w.max_dd, 4),
                    "expectancy": round(w.expectancy, 4),
                    "win_rate": round(w.win_rate, 4),
                    "num_trades": w.num_trades,
                }
                for w in self.windows
            ]
        )


def _years_to_offset(years: float) -> pd.DateOffset:
    """Convert a fractional year count to a pandas DateOffset."""
    days = int(round(years * 365.25))
    return pd.DateOffset(days=days)


def _simulate_pandas(
    ohlcv: pd.DataFrame,
    signals: pd.DataFrame,
    *,
    initial_cash: float = 10_000.0,
    fee_bps: float = 1.0,
    slippage_bps: float = 1.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Pure-pandas long-only simulator. Returns (equity, returns, trade_pnls).

    Falls back to this when vectorbt isn't usable. Logic: enter at next bar's
    open on entry signal, exit at next bar's open on exit signal. Single
    position at a time. fee/slippage bps applied per side.
    """
    close = ohlcv["close"].astype(float)
    open_ = ohlcv["open"].astype(float)

    entries = signals["entry"].astype(bool).to_numpy()
    exits = signals["exit"].astype(bool).to_numpy()
    sizes = signals.get("size", pd.Series(1.0, index=signals.index)).astype(float).to_numpy()

    equity = np.full(len(ohlcv), np.nan, dtype=np.float64)
    cash = initial_cash
    units = 0.0
    entry_price = 0.0
    trade_pnls: list[float] = []

    cost_bps_total = (fee_bps + slippage_bps) / 10_000.0

    for i in range(len(ohlcv)):
        # Mark-to-market.
        if i == 0:
            equity[i] = cash
            continue

        # Execute on bar i using the *previous* bar's signal at bar i's open.
        prev_entry = entries[i - 1]
        prev_exit = exits[i - 1]
        prev_size = sizes[i - 1]
        bar_open = float(open_.iloc[i])

        if prev_entry and units == 0.0 and prev_size > 0.0:
            # Enter long. Size is fraction of cash for size <=1, else units.
            position_value = cash * min(prev_size, 1.0) if prev_size <= 1.0 else prev_size * bar_open
            position_value = min(position_value, cash)
            units = position_value / bar_open if bar_open > 0 else 0.0
            cost = units * bar_open * (1.0 + cost_bps_total)
            cash -= cost
            entry_price = bar_open

        if prev_exit and units > 0.0:
            proceeds = units * bar_open * (1.0 - cost_bps_total)
            cash += proceeds
            trade_pnl = proceeds - units * entry_price * (1.0 + cost_bps_total)
            trade_pnls.append(trade_pnl)
            units = 0.0
            entry_price = 0.0

        # Mark to market with current close.
        bar_close = float(close.iloc[i])
        equity[i] = cash + units * bar_close

    equity_series = pd.Series(equity, index=ohlcv.index, name="equity").ffill()
    returns_series = equity_series.pct_change().fillna(0.0)
    pnl_series = pd.Series(trade_pnls, name="trade_pnl") if trade_pnls else pd.Series(dtype=float, name="trade_pnl")
    return equity_series, returns_series, pnl_series


def _simulate_vectorbt(
    ohlcv: pd.DataFrame,
    signals: pd.DataFrame,
    *,
    initial_cash: float = 10_000.0,
    fee_bps: float = 1.0,
    slippage_bps: float = 1.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """vectorbt-backed simulator. Falls back silently to pandas if vbt not importable."""
    try:
        import vectorbt as vbt  # type: ignore[import-untyped]
    except (ImportError, OSError):
        return _simulate_pandas(
            ohlcv, signals,
            initial_cash=initial_cash, fee_bps=fee_bps, slippage_bps=slippage_bps,
        )

    close = ohlcv["close"].astype(float)
    entries = signals["entry"].astype(bool)
    exits = signals["exit"].astype(bool)

    pf = vbt.Portfolio.from_signals(
        close=close,
        entries=entries,
        exits=exits,
        init_cash=initial_cash,
        fees=fee_bps / 10_000.0,
        slippage=slippage_bps / 10_000.0,
        freq="1D",
    )
    equity_series = pf.value()
    returns_series = pf.returns()
    # vectorbt trades may be empty.
    try:
        trades = pf.trades.records_readable
        pnl_series = trades["PnL"].astype(float).reset_index(drop=True) if not trades.empty else pd.Series(dtype=float)
    except Exception:  # noqa: BLE001 — vbt internals vary by version
        pnl_series = pd.Series(dtype=float)
    pnl_series.name = "trade_pnl"
    return equity_series, returns_series, pnl_series


def walk_forward(  # noqa: PLR0913 — config knobs are intentional
    signal_fn: SignalFn,  # type: ignore[valid-type]
    ohlcv: pd.DataFrame,
    *,
    params: dict[str, Any] | None = None,
    train_years: float = 2.0,
    test_years: float = 0.5,
    step_years: float = 0.5,
    initial_cash: float = 10_000.0,
    use_vectorbt: bool = True,
) -> list[WindowResult]:
    """Walk a (train, test) window across `ohlcv`, returning per-window OOS stats.

    Train segment is exposed to the signal function (e.g. for fitting); we
    do *not* fit here. We just compute test-segment performance.

    Yields windows where: train_start = i, train_end = i + train_years,
    test_start = train_end, test_end = test_start + test_years. Step by step_years.
    """
    if params is None:
        params = {}
    if not isinstance(ohlcv.index, pd.DatetimeIndex):
        raise TypeError("ohlcv must have a DatetimeIndex")
    if len(ohlcv) == 0:
        return []

    train_off = _years_to_offset(train_years)
    test_off = _years_to_offset(test_years)
    step_off = _years_to_offset(step_years)

    start = ohlcv.index[0]
    end = ohlcv.index[-1]
    windows: list[WindowResult] = []

    cursor = start
    simulator = _simulate_vectorbt if use_vectorbt else _simulate_pandas
    while True:
        train_start = cursor
        train_end = cursor + train_off
        test_start = train_end
        test_end = test_start + test_off
        if test_end > end:
            break

        train_slice = ohlcv.loc[train_start:train_end]
        test_slice = ohlcv.loc[test_start:test_end]
        if len(test_slice) < 2:
            cursor = cursor + step_off
            continue

        # Signal fn sees the FULL pre-test history so it can train on the train
        # segment + emit signals only for the test segment. This is the typical
        # pattern; if you don't need train data, just slice test in your fn.
        full_history = ohlcv.loc[:test_end]
        signals = signal_fn(full_history, params)
        # Only evaluate on the test segment.
        sig_slice = signals.reindex(test_slice.index).fillna(False)

        equity, returns, trade_pnls = simulator(
            test_slice, sig_slice, initial_cash=initial_cash,
        )
        windows.append(
            WindowResult(
                train_period=(train_start, train_end),
                test_period=(test_start, test_end),
                sharpe=stats.sharpe(returns),
                sortino=stats.sortino(returns),
                max_dd=stats.max_drawdown(equity),
                expectancy=stats.expectancy(trade_pnls),
                win_rate=stats.win_rate(trade_pnls),
                num_trades=int(len(trade_pnls)),
            )
        )
        cursor = cursor + step_off

    return windows


def run_full_backtest(
    signal_fn: SignalFn,  # type: ignore[valid-type]
    ohlcv: pd.DataFrame,
    *,
    name: str = "strategy",
    params: dict[str, Any] | None = None,
    initial_cash: float = 10_000.0,
    train_years: float = 2.0,
    test_years: float = 0.5,
    step_years: float = 0.5,
    use_vectorbt: bool = True,
    regimes: pd.Series | None = None,
) -> BacktestResult:
    """Run signal_fn over the full history + walk-forward windows. Returns BacktestResult."""
    params = params or {}
    signals = signal_fn(ohlcv, params)
    simulator = _simulate_vectorbt if use_vectorbt else _simulate_pandas
    full_equity, full_returns, full_trade_pnls = simulator(
        ohlcv, signals, initial_cash=initial_cash,
    )
    windows = walk_forward(
        signal_fn,
        ohlcv,
        params=params,
        train_years=train_years,
        test_years=test_years,
        step_years=step_years,
        initial_cash=initial_cash,
        use_vectorbt=use_vectorbt,
    )
    return BacktestResult(
        name=name,
        windows=windows,
        full_equity=full_equity,
        full_returns=full_returns,
        full_trade_pnls=full_trade_pnls,
        params=params,
        regimes=regimes,
    )
