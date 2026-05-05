"""Data layer for Strategy B5: spot+perp OHLCV plus per-pair funding-rate history.

Two paths:

1. **Fixture path** (default; used by tests + run.py without API keys): a seeded,
   regime-aware synthetic generator. Funding rate is sampled from a regime-dependent
   mixture so the back-test sees a realistic alternation of bull (rich funding),
   calm (neutral funding) and bear (occasionally negative funding) periods.

2. **Live path** (deferred): would pull funding history from Coinbase International
   or Bybit + spot OHLCV from Coinbase Advanced. Stub raises if called without
   the relevant env vars.

Public surface:

    PairKey      = str             # e.g. "BTC/USD"
    PriceFrame   = pd.DataFrame    # cols: spot_open, spot_close, perp_open, perp_close
    FundingFrame = pd.DataFrame    # cols: funding_rate (per 8h period)
    FundingBasisFixture: dataclass holding both, keyed by pair.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import numpy as np
import pandas as pd

FIXTURES_DIR: Final[Path] = Path(__file__).resolve().parent / "fixtures"

# ----- Fixture-generation knobs -----------------------------------------------
PERIODS_PER_DAY: Final[int] = 3              # 8h funding cadence
TRADING_DAYS_PER_YEAR: Final[int] = 365
PERIODS_PER_YEAR: Final[int] = PERIODS_PER_DAY * TRADING_DAYS_PER_YEAR

# Mean / sigma of funding distribution per regime, expressed as fraction per 8h.
# Source: Skew + Galaxy + Pantera periodic reports across 2021-2025; calibrated
# so that calm ≈ 11% APR, bull ≈ 55% APR, bear ≈ -3% APR on average.
_REGIME_FUNDING: Final[dict[str, tuple[float, float]]] = {
    "calm":   (0.0001,  0.00010),   # ~11%/yr mean, low vol
    "bull":   (0.0005,  0.00020),   # ~55%/yr mean
    "bear":   (-0.00003, 0.00015),  # slightly negative on average
}

# Approximate transition probabilities between regimes per 8h period. Calibrated so
# regimes persist ~30 days on average.
_REGIME_PERSIST: Final[float] = 1.0 - 1.0 / (30.0 * PERIODS_PER_DAY)

# Per-pair price drift / vol (annualized). BTC/ETH less volatile than SOL.
_PAIR_VOL: Final[dict[str, tuple[float, float]]] = {
    "BTC/USD": (0.0006, 0.65),
    "ETH/USD": (0.0007, 0.75),
    "SOL/USD": (0.0008, 1.10),
}

# Scaling factor: bull regime in price space coincides (loosely) with bull funding.
_BULL_PRICE_BIAS: Final[float] = 1.5
_BEAR_PRICE_BIAS: Final[float] = 0.4


@dataclass(frozen=True, slots=True)
class FundingBasisFixture:
    """Bundle of spot+perp OHLCV + funding history per pair, all on the same 8h grid."""

    prices: dict[str, pd.DataFrame]       # PairKey -> spot_open/spot_close/perp_open/perp_close
    funding: dict[str, pd.DataFrame]      # PairKey -> funding_rate (per 8h)
    regimes: pd.Series                    # series of regime label per 8h timestamp
    index: pd.DatetimeIndex = field(repr=False)

    def pair_keys(self) -> list[str]:
        """Stable list of pairs in the fixture."""
        return sorted(self.prices.keys())


def _simulate_regime_path(n_periods: int, *, seed: int) -> np.ndarray:
    """Return an array of regime labels (length n_periods) from a 3-state Markov chain."""
    rng = np.random.default_rng(seed)
    regimes = np.empty(n_periods, dtype=object)
    states = ("calm", "bull", "bear")
    # Stationary-ish initial distribution: calm 0.5, bull 0.3, bear 0.2.
    init_idx = rng.choice(3, p=(0.5, 0.3, 0.2))
    current = states[init_idx]
    for i in range(n_periods):
        regimes[i] = current
        if rng.random() > _REGIME_PERSIST:
            # Transition: weighted toward neighboring regimes.
            if current == "calm":
                current = str(rng.choice(("bull", "bear"), p=(0.65, 0.35)))
            elif current == "bull":
                current = str(rng.choice(("calm", "bear"), p=(0.85, 0.15)))
            else:  # bear
                current = str(rng.choice(("calm", "bull"), p=(0.85, 0.15)))
    return regimes


def _simulate_funding_for_regimes(
    regimes: np.ndarray,
    *,
    seed: int,
    pair_offset: float = 0.0,
) -> np.ndarray:
    """Sample per-period funding rate from regime-conditional Gaussians.

    `pair_offset` lets each pair shift its funding mean slightly so BTC/ETH/SOL
    are not perfectly correlated. SOL tends to run hotter (higher mean) in bull
    regimes — that's the empirical pattern.
    """
    rng = np.random.default_rng(seed)
    out = np.empty(regimes.size, dtype=np.float64)
    for i, r in enumerate(regimes):
        mean, sigma = _REGIME_FUNDING[r]
        out[i] = rng.normal(loc=mean + pair_offset, scale=sigma)
    return out


def _simulate_pair_prices(
    regimes: np.ndarray,
    *,
    drift_per_period: float,
    annual_vol: float,
    seed: int,
    base_price: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (spot_close, perp_close) arrays of length len(regimes).

    Perp tracks spot tightly (basis < 1% under normal regimes). Tracking error
    is sampled per-period from a small Gaussian; widens slightly in bear regimes.
    """
    rng = np.random.default_rng(seed)
    n = regimes.size
    sigma = annual_vol / np.sqrt(PERIODS_PER_YEAR)
    bias = np.where(
        regimes == "bull",
        drift_per_period * _BULL_PRICE_BIAS,
        np.where(regimes == "bear", drift_per_period * _BEAR_PRICE_BIAS, drift_per_period),
    )
    log_returns = rng.normal(loc=bias, scale=sigma, size=n)
    spot_close = base_price * np.exp(np.cumsum(log_returns))

    # Perp tracks spot with a tiny basis. Wider in bear regimes (de-leveraging).
    track_sigma = np.where(regimes == "bear", 0.0025, 0.0008)
    track_err = rng.normal(loc=0.0, scale=track_sigma)
    perp_close = spot_close * (1.0 + track_err)
    return spot_close, perp_close


def build_synthetic_fixture(
    *,
    pairs: list[str],
    years: int,
    funding_seed: int = 17,
    price_seed: int = 42,
    regime_seed: int = 99,
) -> FundingBasisFixture:
    """Generate a deterministic synthetic basis fixture for `pairs` × `years`.

    Returned frames share a common 8h DatetimeIndex.
    """
    n_periods = int(years * PERIODS_PER_YEAR)
    end = pd.Timestamp("2026-01-01", tz="UTC")
    # 8h cadence backwards from end.
    index = pd.date_range(end=end, periods=n_periods, freq="8h")

    regimes = _simulate_regime_path(n_periods, seed=regime_seed)
    regime_series = pd.Series(regimes, index=index, name="regime")

    prices: dict[str, pd.DataFrame] = {}
    funding: dict[str, pd.DataFrame] = {}

    # Each pair gets its own seed-derived RNG to keep them de-correlated.
    for i, pair in enumerate(pairs):
        if pair not in _PAIR_VOL:
            raise ValueError(f"unknown pair {pair!r}; supported: {sorted(_PAIR_VOL)}")
        drift_per_period, annual_vol = _PAIR_VOL[pair]
        # SOL gets a small +offset in funding so the pair-level distributions differ.
        pair_offset = {"BTC/USD": 0.0, "ETH/USD": 0.00002, "SOL/USD": 0.00005}[pair]
        funding_arr = _simulate_funding_for_regimes(
            regimes,
            seed=funding_seed + i * 1000,
            pair_offset=pair_offset,
        )
        spot_close, perp_close = _simulate_pair_prices(
            regimes,
            drift_per_period=drift_per_period,
            annual_vol=annual_vol,
            seed=price_seed + i * 1000,
            base_price={"BTC/USD": 30_000.0, "ETH/USD": 2_000.0, "SOL/USD": 50.0}[pair],
        )
        # Open = previous close (closes are end-of-period marks).
        spot_open = np.r_[spot_close[0], spot_close[:-1]]
        perp_open = np.r_[perp_close[0], perp_close[:-1]]

        prices[pair] = pd.DataFrame(
            {
                "spot_open": spot_open,
                "spot_close": spot_close,
                "perp_open": perp_open,
                "perp_close": perp_close,
            },
            index=index,
        )
        funding[pair] = pd.DataFrame({"funding_rate": funding_arr}, index=index)

    return FundingBasisFixture(
        prices=prices,
        funding=funding,
        regimes=regime_series,
        index=index,
    )


# ----- Persistence ------------------------------------------------------------

def write_fixture_csvs(fixture: FundingBasisFixture) -> dict[str, Path]:
    """Persist the fixture as CSV files in `fixtures/`. Returns the paths written."""
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    # Per-pair funding history. Use short asset prefix to match the brief
    # (btc_funding_history.csv, eth_funding_history.csv, sol_funding_history.csv).
    for pair, fdf in fixture.funding.items():
        # "BTC/USD" -> "btc"
        slug = pair.split("/")[0].lower()
        fp = FIXTURES_DIR / f"{slug}_funding_history.csv"
        fdf.to_csv(fp, index_label="timestamp")
        written[f"{pair}/funding"] = fp
    # Combined OHLCV file: long-form with a `pair` column so we keep the
    # number of files manageable.
    long_rows: list[pd.DataFrame] = []
    for pair, pdf in fixture.prices.items():
        copy = pdf.copy()
        copy["pair"] = pair
        long_rows.append(copy)
    combined = pd.concat(long_rows, axis=0).reset_index(names="timestamp")
    combined_fp = FIXTURES_DIR / "spot_perp_ohlcv.csv"
    combined.to_csv(combined_fp, index=False)
    written["ohlcv"] = combined_fp
    return written


def load_fixture(
    *,
    pairs: list[str],
    years: int = 4,
    funding_seed: int = 17,
    price_seed: int = 42,
    regime_seed: int = 99,
    persist: bool = True,
) -> FundingBasisFixture:
    """Build (and optionally persist) the synthetic fixture. Always deterministic."""
    fixture = build_synthetic_fixture(
        pairs=pairs,
        years=years,
        funding_seed=funding_seed,
        price_seed=price_seed,
        regime_seed=regime_seed,
    )
    if persist:
        write_fixture_csvs(fixture)
    return fixture


def load_live() -> FundingBasisFixture:
    """Live data path. Stub: refuses without COINBASE_INTL_API_KEY."""
    if not os.environ.get("COINBASE_INTL_API_KEY"):
        raise RuntimeError(
            "COINBASE_INTL_API_KEY not set. Use load_fixture() for offline runs, or "
            "set the API key + implement the live fetch."
        )
    raise NotImplementedError(
        "Live funding/spot fetch not implemented yet. See README — FreqTrade "
        "integration is the planned execution layer."
    )
