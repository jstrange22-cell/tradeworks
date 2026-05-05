"""PEAD signal generation + multi-symbol event-driven simulator.

Why this strategy doesn't use the generic walk_forward signal_fn directly:
PEAD operates on a UNIVERSE of stocks simultaneously — there can be 5-15
concurrent positions across different symbols. The generic walk_forward
engine simulates one OHLCV series at a time. So we:

1. Run a custom multi-symbol simulator (`run_pead_simulation`) that processes
   every earnings event across the whole universe and produces a single
   portfolio-level equity curve.
2. Feed that equity curve back into the standard report machinery via a
   pre-built `BacktestResult` so we get the same artifacts (equity-curve.png,
   walkforward.csv, monte-carlo CI, etc.) without duplicating that logic.

Pure-Python, no external services. Deterministic given the same fixture seed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from research.lib import stats
from research.lib.walkforward import BacktestResult, WindowResult

from .earnings import EarningsEvent


@dataclass(frozen=True, slots=True)
class PeadEntry:
    """A qualified PEAD entry candidate emitted by the screener."""

    symbol: str
    entry_date: pd.Timestamp           # the bar we OPEN the position on
    announcement_date: pd.Timestamp    # the prior bar where earnings hit
    surprise_pct: float
    gap_pct: float                     # entry-day open vs prev close
    momentum_20d: float                # pre-announce 20d return
    side: str                          # "long" or "short"
    entry_price: float                 # the entry-day open
    atr: float                         # ATR(14) at the close of announcement day
    stop_price: float                  # initial hard-stop price
    next_earnings_date: pd.Timestamp | None


@dataclass(slots=True)
class _OpenPosition:
    """Live position state used by the simulator."""

    symbol: str
    side: str
    entry_date: pd.Timestamp
    entry_price: float
    units: float                       # original share count
    units_remaining: float             # after partial scale-outs
    initial_value: float               # entry_price * units (for cap math later)
    atr_at_entry: float
    hard_stop_pct: float
    trail_atr_mult: float
    time_stop_date: pd.Timestamp
    next_earnings_date: pd.Timestamp | None
    highest_close: float = 0.0
    lowest_close: float = float("inf")
    realized_pnl: float = 0.0
    profit_ladder_remaining: list[tuple[float, float]] = field(default_factory=list)


def _compute_atr(prices: pd.DataFrame, *, period: int = 14) -> pd.Series:
    """ATR(period) using Wilder smoothing on a single-symbol price slice."""
    high = prices["high"].astype(float)
    low = prices["low"].astype(float)
    close = prices["close"].astype(float)
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def _eligible_long(event: EarningsEvent, params: dict[str, Any]) -> bool:
    """Apply the LONG-side fundamentals filters.

    Price-based gates (gap, momentum, no-earnings-within-30d) are applied
    later by the screener which has access to prices.
    """
    if event.surprise_pct <= float(params["surprise_min_pct"]):
        return False
    if bool(params["revenue_must_not_miss"]) and not event.revenue_beat:
        return False
    g_required = str(params["guidance_required"])
    if g_required == "raise_only" and event.guidance != "raise":
        return False
    if g_required == "maintain_or_raise" and event.guidance not in {"raise", "maintain"}:
        return False
    if event.has_exdiv_within_30d:
        return False
    return True


def _eligible_short(event: EarningsEvent, params: dict[str, Any]) -> bool:
    """SHORT side filter mirror. Default OFF — gated by short_enabled param."""
    if not bool(params.get("short_enabled", False)):
        return False
    if event.surprise_pct >= float(params["short_surprise_max_pct"]):
        return False
    if bool(params["revenue_must_not_miss"]) and event.revenue_beat:
        return False
    if str(params["short_guidance_required"]) == "lower" and event.guidance != "lower":
        return False
    if event.has_exdiv_within_30d:
        return False
    return True


def generate_long_entries(
    prices: pd.DataFrame,
    events: list[EarningsEvent],
    params: dict[str, Any],
) -> list[PeadEntry]:
    """Screen earnings events into qualified PEAD entry candidates.

    Pure function — no I/O, no global state. `prices` is a multi-symbol long-form
    frame (columns include `symbol`); `events` is the full earnings list.
    """
    momentum_days = int(params["pre_announce_momentum_days"])
    gap_min_pct = float(params["gap_min_pct"]) / 100.0
    short_gap_max_pct = float(params.get("short_gap_max_pct", -1.0)) / 100.0
    no_earn_window = int(params["no_earnings_within_days"])
    atr_period = int(params["atr_period"])
    atr_stop_mult = float(params["atr_stop_mult"])
    hard_stop_pct = float(params["hard_stop_pct"]) / 100.0
    short_enabled = bool(params.get("short_enabled", False))

    # Pre-group events by symbol for the no-earnings-within-N-days gate.
    events_by_symbol: dict[str, list[EarningsEvent]] = {}
    for ev in events:
        events_by_symbol.setdefault(ev.symbol, []).append(ev)
    for sym in events_by_symbol:
        events_by_symbol[sym].sort(key=lambda e: e.announcement_date)

    # Pre-compute ATR per symbol once.
    atrs: dict[str, pd.Series] = {}
    closes_by_symbol: dict[str, pd.Series] = {}
    opens_by_symbol: dict[str, pd.Series] = {}
    for sym, sym_df in prices.groupby("symbol", sort=False):
        ohlc = sym_df.sort_index()
        atrs[sym] = _compute_atr(ohlc, period=atr_period)
        closes_by_symbol[sym] = ohlc["close"]
        opens_by_symbol[sym] = ohlc["open"]

    entries: list[PeadEntry] = []
    for ev in events:
        sym_atr = atrs.get(ev.symbol)
        sym_close = closes_by_symbol.get(ev.symbol)
        sym_open = opens_by_symbol.get(ev.symbol)
        if sym_atr is None or sym_close is None or sym_open is None:
            continue

        # Locate the announcement bar in the symbol's price index.
        idx = sym_close.index
        try:
            ann_loc = idx.get_loc(ev.announcement_date)
        except KeyError:
            # Announcement date not on a trading day — find the next.
            ann_loc = int(idx.searchsorted(ev.announcement_date))
            if ann_loc >= len(idx):
                continue

        # Need at least one bar AFTER the announcement to enter on.
        if ann_loc + 1 >= len(sym_close):
            continue

        entry_loc = ann_loc + 1
        entry_date = idx[entry_loc]
        prev_close = float(sym_close.iloc[ann_loc])
        entry_open = float(sym_open.iloc[entry_loc])
        if prev_close <= 0.0:
            continue
        gap_pct = (entry_open - prev_close) / prev_close

        # Pre-announcement momentum: from N bars before announcement to announcement close.
        if ann_loc - momentum_days < 0:
            continue
        ref_close = float(sym_close.iloc[ann_loc - momentum_days])
        if ref_close <= 0.0:
            continue
        momentum_20d = (prev_close - ref_close) / ref_close

        # Block if another earnings event within N days *forward* (we'd be holding
        # into the next reporting date which the exit-at-next-earnings rule covers,
        # but we also block the entry if next earnings is too close).
        next_d = ev.next_earnings_date
        if next_d is not None and (next_d - entry_date).days < no_earn_window:
            continue

        atr_value = float(sym_atr.iloc[ann_loc]) if not np.isnan(sym_atr.iloc[ann_loc]) else 0.0
        if atr_value <= 0.0:
            continue

        # LONG attempt
        if _eligible_long(ev, params) and gap_pct > gap_min_pct and momentum_20d >= 0.0:
            stop_distance = max(atr_value * atr_stop_mult, entry_open * hard_stop_pct)
            stop_price = entry_open - stop_distance
            entries.append(
                PeadEntry(
                    symbol=ev.symbol,
                    entry_date=entry_date,
                    announcement_date=ev.announcement_date,
                    surprise_pct=ev.surprise_pct,
                    gap_pct=gap_pct,
                    momentum_20d=momentum_20d,
                    side="long",
                    entry_price=entry_open,
                    atr=atr_value,
                    stop_price=stop_price,
                    next_earnings_date=next_d,
                )
            )
            continue

        # SHORT attempt (only if enabled)
        if (
            short_enabled
            and _eligible_short(ev, params)
            and gap_pct < short_gap_max_pct
            and momentum_20d <= 0.0
        ):
            stop_distance = max(atr_value * atr_stop_mult, entry_open * hard_stop_pct)
            stop_price = entry_open + stop_distance
            entries.append(
                PeadEntry(
                    symbol=ev.symbol,
                    entry_date=entry_date,
                    announcement_date=ev.announcement_date,
                    surprise_pct=ev.surprise_pct,
                    gap_pct=gap_pct,
                    momentum_20d=momentum_20d,
                    side="short",
                    entry_price=entry_open,
                    atr=atr_value,
                    stop_price=stop_price,
                    next_earnings_date=next_d,
                )
            )

    entries.sort(key=lambda e: e.entry_date)
    return entries


def _atr_position_size(
    *,
    equity: float,
    risk_pct: float,
    atr_value: float,
    atr_stop_mult: float,
    entry_price: float,
    max_position_pct: float,
) -> float:
    """Compute share count using ATR-based risk model. Caps at max_position_pct."""
    if atr_value <= 0.0 or entry_price <= 0.0 or equity <= 0.0:
        return 0.0
    risk_dollars = equity * risk_pct
    stop_distance = atr_value * atr_stop_mult
    units = risk_dollars / stop_distance
    # Position-value cap.
    cap_value = equity * max_position_pct
    cap_units = cap_value / entry_price
    return float(min(units, cap_units))


def run_pead_simulation(
    prices: pd.DataFrame,
    events: list[EarningsEvent],
    params: dict[str, Any],
) -> BacktestResult:
    """Multi-symbol event-driven PEAD simulator.

    Returns a `BacktestResult` whose equity curve is the daily portfolio NAV
    and whose `full_trade_pnls` is one $-pnl per closed PEAD trade. Walk-forward
    windows are computed AFTER the simulation by slicing the full equity curve
    into train/test segments and computing per-window stats — this is correct
    for an event-driven strategy where we don't refit anything per window.
    """
    initial_cash = float(params["initial_cash"])
    fee_bps = float(params["fee_bps"]) / 10_000.0
    slip_bps = float(params["slippage_bps"]) / 10_000.0
    risk_pct = float(params["risk_pct_per_trade"])
    atr_stop_mult = float(params["atr_stop_mult"])
    max_position_pct = float(params["max_position_pct"])
    hard_stop_pct = float(params["hard_stop_pct"]) / 100.0
    trail_atr_mult = float(params["trail_atr_mult"])
    time_stop_days = int(params["time_stop_days"])
    profit_ladder = list(params["profit_ladder"])
    exit_at_next_earnings = bool(params["exit_at_next_earnings"])

    # 1. Generate all qualified entry candidates upfront.
    candidates = generate_long_entries(prices, events, params)

    # 2. Build the daily timeline. The portfolio equity curve is sampled at
    #    daily close on every trading day in the universe.
    all_dates = pd.DatetimeIndex(sorted(prices.index.unique()))
    if len(all_dates) == 0:
        return BacktestResult(name="pead", windows=[], params=params)

    # Symbol-keyed daily close lookup for fast position MTM.
    closes_pivot = prices.pivot(columns="symbol", values="close")
    closes_pivot = closes_pivot.reindex(all_dates).ffill()
    opens_pivot = prices.pivot(columns="symbol", values="open").reindex(all_dates).ffill()

    # 3. Walk forward day-by-day, opening + managing + closing positions.
    cash = initial_cash
    open_positions: list[_OpenPosition] = []
    trade_pnls: list[float] = []
    equity_series = pd.Series(index=all_dates, dtype=float)

    # Index the candidates by entry date for O(1) lookup per bar.
    candidates_by_date: dict[pd.Timestamp, list[PeadEntry]] = {}
    for c in candidates:
        candidates_by_date.setdefault(c.entry_date, []).append(c)

    for current_date in all_dates:
        # 3a. Open new positions on today's bar (event-day open).
        todays_candidates = candidates_by_date.get(current_date, [])
        for cand in todays_candidates:
            if cand.symbol not in closes_pivot.columns:
                continue
            equity_now = cash + sum(
                pos.units_remaining * float(closes_pivot.loc[current_date, pos.symbol])
                for pos in open_positions
                if pos.symbol in closes_pivot.columns
                and not np.isnan(closes_pivot.loc[current_date, pos.symbol])
            )
            units = _atr_position_size(
                equity=equity_now,
                risk_pct=risk_pct,
                atr_value=cand.atr,
                atr_stop_mult=atr_stop_mult,
                entry_price=cand.entry_price,
                max_position_pct=max_position_pct,
            )
            if units <= 0.0:
                continue
            cost = units * cand.entry_price * (1.0 + fee_bps + slip_bps)
            if cost > cash:
                # Scale down or skip if cash insufficient (long-only constraint).
                if cand.side == "long":
                    units = cash / (cand.entry_price * (1.0 + fee_bps + slip_bps))
                    if units <= 0.0:
                        continue
                    cost = units * cand.entry_price * (1.0 + fee_bps + slip_bps)
                # Short side reserves margin not modeled here — skip if cash short for now.

            time_stop = current_date + pd.Timedelta(days=time_stop_days)

            # Initialize remaining profit-ladder triggers (mutable per-position).
            ladder_local = [
                (float(step["trigger_pct"]) / 100.0, float(step["size_pct"]) / 100.0)
                for step in profit_ladder
            ]

            if cand.side == "long":
                cash -= cost
                pos = _OpenPosition(
                    symbol=cand.symbol,
                    side="long",
                    entry_date=current_date,
                    entry_price=cand.entry_price,
                    units=units,
                    units_remaining=units,
                    initial_value=units * cand.entry_price,
                    atr_at_entry=cand.atr,
                    hard_stop_pct=hard_stop_pct,
                    trail_atr_mult=trail_atr_mult,
                    time_stop_date=time_stop,
                    next_earnings_date=cand.next_earnings_date,
                    highest_close=cand.entry_price,
                    lowest_close=cand.entry_price,
                    profit_ladder_remaining=ladder_local,
                )
                open_positions.append(pos)
            else:
                # Short: receive proceeds, owe shares; we model PnL as inverse.
                proceeds = units * cand.entry_price * (1.0 - fee_bps - slip_bps)
                cash += proceeds
                pos = _OpenPosition(
                    symbol=cand.symbol,
                    side="short",
                    entry_date=current_date,
                    entry_price=cand.entry_price,
                    units=units,
                    units_remaining=units,
                    initial_value=units * cand.entry_price,
                    atr_at_entry=cand.atr,
                    hard_stop_pct=hard_stop_pct,
                    trail_atr_mult=trail_atr_mult,
                    time_stop_date=time_stop,
                    next_earnings_date=cand.next_earnings_date,
                    highest_close=cand.entry_price,
                    lowest_close=cand.entry_price,
                    profit_ladder_remaining=ladder_local,
                )
                open_positions.append(pos)

        # 3b. Mark-to-market + exit checks for each open position.
        still_open: list[_OpenPosition] = []
        for pos in open_positions:
            if pos.symbol not in closes_pivot.columns:
                still_open.append(pos)
                continue
            close_today = float(closes_pivot.loc[current_date, pos.symbol])
            if np.isnan(close_today):
                still_open.append(pos)
                continue

            # Update high/low trackers used by the trail.
            if pos.side == "long":
                if close_today > pos.highest_close:
                    pos.highest_close = close_today
            else:
                if close_today < pos.lowest_close:
                    pos.lowest_close = close_today

            # Compute the unrealized return of the remaining position.
            if pos.side == "long":
                ret_pct = (close_today - pos.entry_price) / pos.entry_price
            else:
                ret_pct = (pos.entry_price - close_today) / pos.entry_price

            # --- Profit ladder: scale out tranches as triggers hit. ---
            ladder_kept: list[tuple[float, float]] = []
            for trigger_pct, scale_pct in pos.profit_ladder_remaining:
                if ret_pct >= trigger_pct:
                    # Scale out `scale_pct` of the original units.
                    scale_units = pos.units * scale_pct
                    scale_units = min(scale_units, pos.units_remaining)
                    if scale_units > 0.0:
                        if pos.side == "long":
                            proceeds = scale_units * close_today * (1.0 - fee_bps - slip_bps)
                            cost_basis = scale_units * pos.entry_price * (1.0 + fee_bps + slip_bps)
                            cash += proceeds
                            tranche_pnl = proceeds - cost_basis
                        else:
                            # Short: cover scale_units at close.
                            cover_cost = scale_units * close_today * (1.0 + fee_bps + slip_bps)
                            entry_proceeds = scale_units * pos.entry_price * (1.0 - fee_bps - slip_bps)
                            cash -= cover_cost
                            tranche_pnl = entry_proceeds - cover_cost
                        pos.units_remaining -= scale_units
                        pos.realized_pnl += tranche_pnl
                else:
                    ladder_kept.append((trigger_pct, scale_pct))
            pos.profit_ladder_remaining = ladder_kept

            if pos.units_remaining <= 1e-9:
                # Fully scaled out via ladder. Record total PnL as one trade.
                trade_pnls.append(pos.realized_pnl)
                continue

            # --- Exit checks on the remaining tranche ---
            should_exit = False
            exit_reason = ""
            # Hard stop.
            if pos.side == "long" and close_today <= pos.entry_price * (1.0 - pos.hard_stop_pct):
                should_exit = True
                exit_reason = "hard_stop"
            elif pos.side == "short" and close_today >= pos.entry_price * (1.0 + pos.hard_stop_pct):
                should_exit = True
                exit_reason = "hard_stop"
            # Trailing stop (ATR-based, off the highest/lowest close since entry).
            # Only activates once the position is sufficiently in profit so the
            # trail doesn't act as a tighter shadow hard-stop on entry-day noise.
            # Activation threshold: position must have moved at least 1x ATR
            # in our favor (≈ first profit-ladder rung is in sight).
            if not should_exit:
                trail_arm_threshold = pos.atr_at_entry * 1.0
                if pos.side == "long":
                    favorable_move = pos.highest_close - pos.entry_price
                    if favorable_move >= trail_arm_threshold:
                        trail_level = (
                            pos.highest_close - pos.atr_at_entry * pos.trail_atr_mult
                        )
                        if close_today <= trail_level:
                            should_exit = True
                            exit_reason = "trail_stop"
                else:
                    favorable_move = pos.entry_price - pos.lowest_close
                    if favorable_move >= trail_arm_threshold:
                        trail_level = (
                            pos.lowest_close + pos.atr_at_entry * pos.trail_atr_mult
                        )
                        if close_today >= trail_level:
                            should_exit = True
                            exit_reason = "trail_stop"
            # Time stop.
            if not should_exit and current_date >= pos.time_stop_date:
                should_exit = True
                exit_reason = "time_stop"
            # Exit-before-next-earnings: close on the bar BEFORE next earnings.
            if (
                not should_exit
                and exit_at_next_earnings
                and pos.next_earnings_date is not None
                and current_date >= pos.next_earnings_date - pd.Timedelta(days=1)
            ):
                should_exit = True
                exit_reason = "next_earnings"

            if should_exit:
                if pos.side == "long":
                    proceeds = pos.units_remaining * close_today * (1.0 - fee_bps - slip_bps)
                    cost_basis = pos.units_remaining * pos.entry_price * (1.0 + fee_bps + slip_bps)
                    cash += proceeds
                    final_pnl = proceeds - cost_basis
                else:
                    cover_cost = pos.units_remaining * close_today * (1.0 + fee_bps + slip_bps)
                    entry_proceeds = pos.units_remaining * pos.entry_price * (1.0 - fee_bps - slip_bps)
                    cash -= cover_cost
                    final_pnl = entry_proceeds - cover_cost
                pos.realized_pnl += final_pnl
                pos.units_remaining = 0.0
                trade_pnls.append(pos.realized_pnl)
                # Mark exit_reason on the position for potential downstream use.
                _ = exit_reason
            else:
                still_open.append(pos)
        open_positions = still_open

        # 3c. Compute equity at end-of-day = cash + MTM of remaining positions.
        mtm = 0.0
        for pos in open_positions:
            if pos.symbol not in closes_pivot.columns:
                continue
            cls = float(closes_pivot.loc[current_date, pos.symbol])
            if np.isnan(cls):
                continue
            if pos.side == "long":
                mtm += pos.units_remaining * cls
            else:
                # For shorts: cash already credited at entry, unrealized loss = (current - entry) * units
                mtm -= pos.units_remaining * (cls - pos.entry_price)
        equity_series.loc[current_date] = cash + mtm

    # 4. Close any positions still open at end-of-history at the last close.
    final_date = all_dates[-1]
    for pos in open_positions:
        if pos.symbol not in closes_pivot.columns:
            continue
        cls = float(closes_pivot.loc[final_date, pos.symbol])
        if np.isnan(cls):
            continue
        if pos.side == "long":
            proceeds = pos.units_remaining * cls * (1.0 - fee_bps - slip_bps)
            cost_basis = pos.units_remaining * pos.entry_price * (1.0 + fee_bps + slip_bps)
            cash += proceeds
            final_pnl = proceeds - cost_basis
        else:
            cover_cost = pos.units_remaining * cls * (1.0 + fee_bps + slip_bps)
            entry_proceeds = pos.units_remaining * pos.entry_price * (1.0 - fee_bps - slip_bps)
            cash -= cover_cost
            final_pnl = entry_proceeds - cover_cost
        pos.realized_pnl += final_pnl
        trade_pnls.append(pos.realized_pnl)
    open_positions.clear()
    equity_series.iloc[-1] = cash

    equity_series = equity_series.ffill().fillna(initial_cash)
    returns_series = equity_series.pct_change().fillna(0.0)
    pnl_series = pd.Series(trade_pnls, name="trade_pnl") if trade_pnls else pd.Series(dtype=float, name="trade_pnl")

    # 5. Build walk-forward window stats by slicing the equity curve.
    windows = _walk_forward_on_equity(
        equity=equity_series,
        returns=returns_series,
        candidates=candidates,
        train_years=float(params["train_years"]),
        test_years=float(params["test_years"]),
        step_years=float(params["step_years"]),
    )

    return BacktestResult(
        name="pead (long-only) - synthetic fixture",
        windows=windows,
        full_equity=equity_series,
        full_returns=returns_series,
        full_trade_pnls=pnl_series,
        params=params,
    )


def _walk_forward_on_equity(
    *,
    equity: pd.Series,
    returns: pd.Series,
    candidates: list[PeadEntry],
    train_years: float,
    test_years: float,
    step_years: float,
) -> list[WindowResult]:
    """Slice the portfolio equity curve into walk-forward windows and stat each.

    Trades are attributed to the window containing their entry date. We don't
    refit any params per window — PEAD is rule-based on fundamental thresholds.
    """
    if len(equity) == 0:
        return []
    train_off = pd.DateOffset(days=int(train_years * 365.25))
    test_off = pd.DateOffset(days=int(test_years * 365.25))
    step_off = pd.DateOffset(days=int(step_years * 365.25))

    start = equity.index[0]
    end = equity.index[-1]

    windows: list[WindowResult] = []
    cursor = start
    while True:
        train_start = cursor
        train_end = cursor + train_off
        test_start = train_end
        test_end = test_start + test_off
        if test_end > end:
            break

        test_returns = returns.loc[test_start:test_end]
        test_equity = equity.loc[test_start:test_end]
        if len(test_equity) < 2:
            cursor = cursor + step_off
            continue

        # Rebuild trade pnls scoped to this test window by re-running the
        # final tranche for each candidate that entered inside the window.
        # Cheaper proxy: count entries whose entry_date falls in window; we
        # don't have per-candidate realized pnl here, so report num_trades only
        # for the window and use returns-based stats for the rest.
        num_in_window = sum(
            1 for c in candidates if test_start <= c.entry_date <= test_end
        )

        windows.append(
            WindowResult(
                train_period=(train_start, train_end),
                test_period=(test_start, test_end),
                sharpe=stats.sharpe(test_returns),
                sortino=stats.sortino(test_returns),
                max_dd=stats.max_drawdown(test_equity),
                expectancy=0.0,  # not computed at window-level (would need tagged trades)
                win_rate=0.0,
                num_trades=num_in_window,
            )
        )
        cursor = cursor + step_off

    return windows
