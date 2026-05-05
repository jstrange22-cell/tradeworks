"""OHLCV data fetchers.

Hierarchy:
  1. yfinance (free, default fallback) — used in dev / open-source path.
  2. Polygon.io REST (stub) — to be wired when POLYGON_API_KEY is set.
  3. Coinbase Advanced Trade REST (stub) — for crypto OHLCV.

All fetchers return a `pd.DataFrame` with columns
`['open', 'high', 'low', 'close', 'volume']` and a `pd.DatetimeIndex` (UTC).
Tests **do not** call these — use synthetic OHLC fixtures instead.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Literal

import pandas as pd
import requests

OHLCV_COLUMNS: tuple[str, ...] = ("open", "high", "low", "close", "volume")

Interval = Literal["1d", "1h", "30m", "15m", "5m", "1m"]


def _ensure_ohlcv_shape(df: pd.DataFrame) -> pd.DataFrame:
    """Validate + normalize a DataFrame to the canonical OHLCV shape."""
    rename = {c: c.lower() for c in df.columns if c.lower() in OHLCV_COLUMNS}
    df = df.rename(columns=rename)
    missing = [c for c in OHLCV_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"OHLCV frame missing columns: {missing}")
    df = df[list(OHLCV_COLUMNS)].astype(float)
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index, utc=True)
    elif df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")
    df.index.name = "timestamp"
    return df.sort_index()


def fetch_yfinance(
    symbol: str,
    *,
    start: str | pd.Timestamp,
    end: str | pd.Timestamp | None = None,
    interval: Interval = "1d",
    max_retries: int = 3,
    retry_backoff_seconds: float = 2.0,
) -> pd.DataFrame:
    """Fetch OHLCV from yfinance with retry-on-rate-limit.

    yfinance silently rate-limits; we retry with exponential backoff. Tests
    must NOT call this. Use synthetic data for unit tests.
    """
    # Local import so the module imports cleanly even if yfinance has install issues.
    import yfinance as yf

    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(
                start=start,
                end=end,
                interval=interval,
                auto_adjust=True,
                actions=False,
            )
            if df.empty:
                raise RuntimeError(f"yfinance returned empty frame for {symbol}")
            return _ensure_ohlcv_shape(df)
        except Exception as exc:  # noqa: BLE001 — yfinance raises various
            last_err = exc
            if attempt < max_retries - 1:
                time.sleep(retry_backoff_seconds * (2**attempt))
    raise RuntimeError(f"yfinance fetch failed for {symbol} after {max_retries} attempts") from last_err


def fetch_polygon_aggregates(  # noqa: PLR0913 — REST API needs many args
    symbol: str,
    *,
    start: str | pd.Timestamp,
    end: str | pd.Timestamp,
    multiplier: int = 1,
    timespan: Literal["minute", "hour", "day"] = "day",
    api_key: str | None = None,
    timeout: float = 30.0,
) -> pd.DataFrame:
    """Polygon.io aggregates v2. STUB — wired when POLYGON_API_KEY is set.

    Free tier is rate-limited to 5 calls/min; paid tier required for full
    historical equities. Returns empty DataFrame if no API key configured.
    """
    api_key = api_key or os.environ.get("POLYGON_API_KEY")
    if not api_key:
        # Stub return for the no-key dev path. Caller falls back to yfinance.
        return pd.DataFrame(columns=list(OHLCV_COLUMNS))

    start_ts = pd.Timestamp(start).strftime("%Y-%m-%d")
    end_ts = pd.Timestamp(end).strftime("%Y-%m-%d")
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{symbol.upper()}"
        f"/range/{multiplier}/{timespan}/{start_ts}/{end_ts}"
    )
    resp = requests.get(
        url,
        params={"adjusted": "true", "sort": "asc", "limit": 50_000, "apiKey": api_key},
        timeout=timeout,
    )
    resp.raise_for_status()
    payload = resp.json()
    results = payload.get("results", []) or []
    if not results:
        return pd.DataFrame(columns=list(OHLCV_COLUMNS))

    df = pd.DataFrame(results)
    df = df.rename(
        columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "t": "timestamp"}
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.set_index("timestamp")
    return _ensure_ohlcv_shape(df)


def fetch_coinbase_candles(
    product_id: str,
    *,
    start: pd.Timestamp,
    end: pd.Timestamp,
    granularity: Literal[
        "ONE_MINUTE", "FIVE_MINUTE", "FIFTEEN_MINUTE", "ONE_HOUR", "SIX_HOUR", "ONE_DAY"
    ] = "ONE_DAY",
    timeout: float = 30.0,
) -> pd.DataFrame:
    """Coinbase Advanced Trade REST candles. STUB — public endpoint, no auth needed.

    Coinbase caps to 350 candles per call. For large ranges, the caller must page.
    This stub does a single call and returns whatever it gets — wire pagination
    when actually used.
    """
    start_unix = int(pd.Timestamp(start).timestamp())
    end_unix = int(pd.Timestamp(end).timestamp())
    url = f"https://api.exchange.coinbase.com/products/{product_id}/candles"
    # Coinbase legacy public endpoint accepts ISO dates + integer granularity.
    granularity_map = {
        "ONE_MINUTE": 60,
        "FIVE_MINUTE": 300,
        "FIFTEEN_MINUTE": 900,
        "ONE_HOUR": 3600,
        "SIX_HOUR": 21600,
        "ONE_DAY": 86400,
    }
    resp = requests.get(
        url,
        params={
            "start": pd.Timestamp(start_unix, unit="s", tz="UTC").isoformat(),
            "end": pd.Timestamp(end_unix, unit="s", tz="UTC").isoformat(),
            "granularity": granularity_map[granularity],
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        return pd.DataFrame(columns=list(OHLCV_COLUMNS))
    # Coinbase candle: [time, low, high, open, close, volume]
    df = pd.DataFrame(rows, columns=["timestamp", "low", "high", "open", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df = df.set_index("timestamp")
    return _ensure_ohlcv_shape(df)


def cache_path(symbol: str, interval: str, root: Path | None = None) -> Path:
    """Local parquet cache path. Caller manages cache invalidation."""
    root = root or Path(__file__).resolve().parents[2] / "data" / "cache"
    root.mkdir(parents=True, exist_ok=True)
    safe_symbol = symbol.replace("/", "_").replace(":", "_")
    return root / f"{safe_symbol}_{interval}.parquet"


def load_cached(path: Path) -> pd.DataFrame | None:
    """Read a parquet cache. Returns None if missing or corrupt."""
    if not path.exists():
        return None
    try:
        df = pd.read_parquet(path)
        return _ensure_ohlcv_shape(df)
    except (OSError, ValueError):
        return None


def save_cached(df: pd.DataFrame, path: Path) -> None:
    """Write a parquet cache. Caller is responsible for shape validation."""
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path)
