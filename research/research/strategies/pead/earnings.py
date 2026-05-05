"""Earnings calendar + per-symbol OHLCV data layer for PEAD.

Two paths:

1. **Fixture path** (default, used by tests + run.py without API keys): a seeded
   synthetic earnings calendar + matching synthetic OHLCV. Deterministic via
   `numpy.random.default_rng(seed)`. Produces ~5y x 100 symbols of realistic-ish
   beats/misses with correlated price drift around announcements.

2. **Live path** (requires POLYGON_API_KEY env var): pulls real fundamentals +
   prices via `research.lib.data`. Stub today — wire-in is intentionally trivial
   so we never accidentally hit a paid API in tests.

Fixture-only contracts the rest of the strategy depends on:

    EarningsEvent  — one row per (symbol, announcement_date) with surprise data.
    PriceFrame     — pd.DataFrame indexed by date with columns
                     [symbol, open, high, low, close, volume].

Use `load_fixture(seed=...)` for deterministic test data.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

FIXTURES_DIR: Path = Path(__file__).resolve().parent / "fixtures"
EARNINGS_FIXTURE: Path = FIXTURES_DIR / "earnings_sample.csv"

# Fixture defaults — these are intentionally large enough that walk-forward windows
# can split a meaningful number of trades into each test segment.
DEFAULT_NUM_SYMBOLS: int = 100
DEFAULT_YEARS: int = 10
TRADING_DAYS_PER_YEAR: int = 252
EARNINGS_PER_YEAR: int = 4


@dataclass(frozen=True, slots=True)
class EarningsEvent:
    """One earnings announcement with the fundamentals PEAD cares about."""

    symbol: str
    announcement_date: pd.Timestamp
    actual_eps: float
    consensus_eps: float
    surprise_pct: float
    revenue_beat: bool   # True if actual revenue >= consensus
    guidance: str        # one of: "raise" | "maintain" | "lower"
    has_exdiv_within_30d: bool
    next_earnings_date: pd.Timestamp | None


def _build_synthetic_universe(
    *,
    n_symbols: int,
    years: int,
    seed: int,
) -> tuple[pd.DataFrame, list[EarningsEvent]]:
    """Build seeded synthetic price + earnings data.

    Each symbol gets a geometric random walk with mild drift. Around each
    earnings event we inject a directional jump correlated with the EPS
    surprise sign so beats tend to drift up post-announcement. Magnitude is
    bounded so we don't hand the strategy free alpha — quality filters still
    have to do work.
    """
    rng = np.random.default_rng(seed)

    end_date = pd.Timestamp("2026-01-01")
    n_bars = years * TRADING_DAYS_PER_YEAR
    dates = pd.date_range(end=end_date, periods=n_bars, freq="B")

    symbols = [f"SYN{i:04d}" for i in range(n_symbols)]
    frames: list[pd.DataFrame] = []
    events: list[EarningsEvent] = []

    # Earnings cadence: ~4/year, jittered so different symbols don't all report
    # on the same day. Each symbol gets `n_events` announcements roughly evenly
    # spaced across history.
    n_events = years * EARNINGS_PER_YEAR

    for sym_idx, symbol in enumerate(symbols):
        # Per-symbol drift / vol. Some have positive drift, some flat — keeps
        # things realistic.
        drift = float(rng.normal(loc=0.0003, scale=0.0003))
        sigma = float(rng.uniform(0.012, 0.025))
        log_returns = rng.normal(loc=drift, scale=sigma, size=n_bars)

        # Pick announcement bar indices, evenly spaced + jittered.
        spacing = max(n_bars // (n_events + 1), 5)
        ann_indices = np.array([
            int(np.clip((i + 1) * spacing + rng.integers(-3, 4), 5, n_bars - 70))
            for i in range(n_events)
        ])
        ann_indices = np.unique(ann_indices)

        # Pre-create event-driven per-bar drift modifiers.
        event_drift = np.zeros(n_bars)

        sym_events: list[EarningsEvent] = []
        for ann_i in ann_indices:
            # Surprise sampled from a wide distribution: mostly small beats/misses
            # with a fat tail for big surprises. Mean ~0 so universe is not biased.
            surprise_pct = float(rng.normal(loc=0.0, scale=8.0))
            # Revenue beat correlated with EPS surprise (sign-correlated, not perfect).
            rev_beat = bool(surprise_pct > -2.0 and rng.random() > 0.2)
            # Guidance: raise/maintain/lower with surprise correlation.
            if surprise_pct > 5.0:
                g_probs = [0.55, 0.35, 0.10]
            elif surprise_pct < -5.0:
                g_probs = [0.05, 0.25, 0.70]
            else:
                g_probs = [0.20, 0.55, 0.25]
            guidance = str(rng.choice(["raise", "maintain", "lower"], p=g_probs))

            # Inject post-announcement drift. The "drift" is a persistent
            # adjustment applied to log-return drift over the next 40-65 bars.
            # Magnitude is calibrated to match Bernard-Thomas (1989) — top
            # surprise quintile shows ~4-6% cumulative drift over 60 days, so
            # we target ~0.0015 daily * 50 days ≈ 7.5% cum for max-tanh surprises.
            # Stronger filters in the strategy still have to do work because
            # noise (sigma ≈ 1.5%/day) dominates on any single day.
            drift_strength = np.tanh(surprise_pct / 12.0) * 0.0020
            drift_window = int(rng.integers(40, 65))
            end_drift_i = min(ann_i + drift_window, n_bars)
            event_drift[ann_i + 1 : end_drift_i] += drift_strength

            # Inject the announcement-day gap into log_returns at ann_i.
            # Big surprises get bigger gaps. Independent noise layered in.
            gap = np.tanh(surprise_pct / 10.0) * 0.04 + float(rng.normal(0.0, 0.01))
            log_returns[ann_i] += gap

            actual_eps = float(rng.uniform(0.5, 3.0))
            consensus_eps = actual_eps / (1.0 + surprise_pct / 100.0)

            sym_events.append(
                EarningsEvent(
                    symbol=symbol,
                    announcement_date=dates[ann_i],
                    actual_eps=actual_eps,
                    consensus_eps=consensus_eps,
                    surprise_pct=surprise_pct,
                    revenue_beat=rev_beat,
                    guidance=guidance,
                    has_exdiv_within_30d=bool(rng.random() < 0.05),  # ~5% blocked
                    next_earnings_date=None,  # filled in below
                )
            )

        # Backfill next_earnings_date for each event so the engine can exit-before-earnings.
        sym_events_sorted = sorted(sym_events, key=lambda e: e.announcement_date)
        for i, ev in enumerate(sym_events_sorted):
            next_d = (
                sym_events_sorted[i + 1].announcement_date
                if i + 1 < len(sym_events_sorted)
                else None
            )
            sym_events_sorted[i] = EarningsEvent(
                symbol=ev.symbol,
                announcement_date=ev.announcement_date,
                actual_eps=ev.actual_eps,
                consensus_eps=ev.consensus_eps,
                surprise_pct=ev.surprise_pct,
                revenue_beat=ev.revenue_beat,
                guidance=ev.guidance,
                has_exdiv_within_30d=ev.has_exdiv_within_30d,
                next_earnings_date=next_d,
            )
        events.extend(sym_events_sorted)

        # Apply event drift on top of base drift.
        full_log_returns = log_returns + event_drift
        # Build the price series.
        base_price = float(rng.uniform(20.0, 200.0))
        close = base_price * np.exp(np.cumsum(full_log_returns))

        # Open = previous close (no overnight gap baked-in to the open since
        # the gap is in the close-to-close return); we explicitly open at
        # prior_close so gap_up_pct = (today_open - prev_close) / prev_close
        # equals zero in the synthetic data. To make the entry-day gap
        # signal meaningful, force the announcement-day open above prev_close
        # by the magnitude of the gap injected above.
        open_ = np.r_[close[0], close[:-1]]
        for ev in sym_events_sorted:
            ann_i = int(np.searchsorted(dates, ev.announcement_date))
            if 0 < ann_i < n_bars:
                # The "next-day gap" PEAD trades is the open of (ann_i + 1) vs
                # close of ann_i. We synthesize that gap by overwriting the
                # next bar's open above/below the prior close in proportion to
                # the surprise.
                next_i = ann_i + 1
                if next_i < n_bars:
                    gap_pct = np.tanh(ev.surprise_pct / 10.0) * 0.04
                    open_[next_i] = close[ann_i] * (1.0 + gap_pct)

        daily_range = np.abs(rng.normal(0.0, sigma, size=n_bars)) * close
        high = np.maximum(open_, close) + daily_range / 2.0
        low = np.minimum(open_, close) - daily_range / 2.0
        # Volume — average dollar volume implicitly large enough to pass liquidity filter.
        volume = rng.integers(2_000_000, 15_000_000, size=n_bars).astype(float)

        df = pd.DataFrame(
            {
                "symbol": symbol,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            },
            index=dates,
        )
        df.index.name = "date"
        frames.append(df)
        # Sort_index stability across symbols.
        del sym_events

    prices = pd.concat(frames, axis=0)
    prices = prices.sort_index(kind="mergesort")
    return prices, events


def events_to_df(events: list[EarningsEvent]) -> pd.DataFrame:
    """Convert a list of EarningsEvent to a tidy DataFrame for fixture writing."""
    rows = [
        {
            "symbol": e.symbol,
            "announcement_date": e.announcement_date.strftime("%Y-%m-%d"),
            "actual_eps": e.actual_eps,
            "consensus_eps": e.consensus_eps,
            "surprise_pct": e.surprise_pct,
            "revenue_beat": e.revenue_beat,
            "guidance": e.guidance,
            "has_exdiv_within_30d": e.has_exdiv_within_30d,
            "next_earnings_date": (
                e.next_earnings_date.strftime("%Y-%m-%d")
                if e.next_earnings_date is not None
                else ""
            ),
        }
        for e in events
    ]
    return pd.DataFrame(rows)


def write_fixture(
    *,
    n_symbols: int = DEFAULT_NUM_SYMBOLS,
    years: int = DEFAULT_YEARS,
    seed: int = 42,
) -> Path:
    """Generate and persist the earnings_sample.csv fixture. Returns the path."""
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    _, events = _build_synthetic_universe(n_symbols=n_symbols, years=years, seed=seed)
    df = events_to_df(events)
    df.to_csv(EARNINGS_FIXTURE, index=False)
    return EARNINGS_FIXTURE


def load_fixture(
    *,
    n_symbols: int = DEFAULT_NUM_SYMBOLS,
    years: int = DEFAULT_YEARS,
    seed: int = 42,
) -> tuple[pd.DataFrame, list[EarningsEvent]]:
    """Load (or regenerate) the synthetic universe fixture.

    The earnings CSV is persisted on disk so callers can inspect it; prices are
    deterministic from the same seed, so we regenerate them in-memory each run
    (avoids a multi-MB CSV in git).
    """
    prices, events = _build_synthetic_universe(
        n_symbols=n_symbols,
        years=years,
        seed=seed,
    )
    # Regenerate the on-disk earnings CSV every load so it stays in sync with
    # the in-memory events. Cheap (a few hundred kb at most).
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    events_to_df(events).to_csv(EARNINGS_FIXTURE, index=False)
    return prices, events


def load_live() -> tuple[pd.DataFrame, list[EarningsEvent]]:
    """Real-data path (Polygon). Stub: refuses without POLYGON_API_KEY."""
    if not os.environ.get("POLYGON_API_KEY"):
        raise RuntimeError(
            "POLYGON_API_KEY not set. Use load_fixture() for offline runs, or set "
            "the API key + implement the live fetch in research.lib.data."
        )
    # Live path is intentionally unimplemented in this scaffold — wiring would
    # call lib.data.fetch_polygon_* for fundamentals + prices and reshape into
    # the same (PriceFrame, list[EarningsEvent]) tuple shape.
    raise NotImplementedError(
        "Live earnings fetch not implemented yet. See lib.data for the price-side "
        "stub; fundamentals will need a separate Polygon call."
    )
