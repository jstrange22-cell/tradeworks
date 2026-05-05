# TradeWorks Research

Python research environment for rigorous walk-forward backtesting and Monte Carlo
analysis of stock + crypto strategies. Strategies live in `research/strategies/<name>/`
and follow the contract demonstrated by `research/strategies/_template/`.

## Stack

| Concern | Library | Why |
| --- | --- | --- |
| Vectorized backtest | `vectorbt` (free) | Fast NumPy-backed engine, free tier sufficient. **Not** vectorbtpro. |
| Frames | `pandas`, `polars` | pandas for vectorbt interop, polars for fast group-bys on large universes. |
| Math | `numpy`, `scipy` | Stats, stats, more stats. |
| Charts | `matplotlib`, `plotly` | matplotlib for static reports, plotly for interactive notebooks. |
| OHLCV | `yfinance` | Free fallback. Polygon/Alpaca fetchers are stubbed for later wiring. |
| HTTP | `requests` | Plain REST clients. |
| Tests | `pytest` | Synthetic-data unit tests. No live calls in tests. |
| Deps | `uv` | Faster than poetry, lockfile is `uv.lock`. |

## Quickstart

```bash
cd research
uv venv                              # create .venv
uv pip install -e ".[dev]"           # install package + dev deps editable
uv run pytest research/tests/ -v     # run the tests
uv run python -m research.strategies._template.run   # run the example strategy end-to-end
```

The template run writes `research/strategies/_template/reports/report.md` plus
`equity-curve.png`, `drawdown.png`, and `walkforward.csv`.

## Layout

```
research/
  research/
    lib/
      data.py          # OHLCV fetchers (yfinance + Polygon/Coinbase stubs)
      walkforward.py   # walk-forward windowing + per-window stats
      regimes.py       # SPY 200MA + VIX -> {calm, trending, volatile, crisis}
      report.py        # report.md + equity / drawdown PNGs + CSV
      sizing.py        # ATR sizing + fractional Kelly
      stats.py         # sharpe, sortino, max_dd, expectancy, calmar, MC max-DD CI
    strategies/
      _template/       # contract example. Copy this folder to start a new strategy.
        signal.py      # generate_signals(ohlcv, params) -> DataFrame[entry, exit, size]
        run.py         # run(years=10) -> BacktestResult
        params.yaml
        README.md
    tests/
      test_walkforward.py
      test_regimes.py
      test_stats.py
```

## Strategy contract

Every strategy folder must export from `signal.py`:

```python
def generate_signals(
    ohlcv: pd.DataFrame,    # columns: open, high, low, close, volume; DatetimeIndex
    params: dict,           # parsed params.yaml
) -> pd.DataFrame:           # columns: entry (bool), exit (bool), size (float)
    ...
```

And from `run.py`:

```python
def run(years: int = 10) -> BacktestResult: ...
```

The walk-forward engine + report writer take it from there.

## Strategy roster (planned, not yet built)

| Strategy | Asset class | Edge thesis |
| --- | --- | --- |
| `pead` | US equities | Post-earnings announcement drift. |
| `regime_trend` | US equities | Trend-following filtered by regime classifier. |
| `vol_rank_options` | US equity options | Sell vol when IV rank high, buy when low. |
| `sector_rotation` | US sector ETFs | Rotate into top-momentum sectors. |
| `funding_basis` | Crypto perps + spot | Capture funding rate when |basis| > threshold. |
| `range_grid_stables` | Crypto stable pairs | Grid trade USDC/USDT-style mean reverters. |

## Windows gotchas

- **Use Python 3.11 or 3.12.** Numba (a vectorbt dep) does not yet have wheels for 3.13
  on Windows as of 2026-05. `pyproject.toml` pins to `>=3.11,<3.13`.
  If you only have 3.13, install 3.12 with `uv python install 3.12` then
  `uv venv --python 3.12`.
- **vectorbt + numba on first run** triggers JIT compilation that prints warnings
  (e.g. `NumbaPerformanceWarning`). Safe to ignore — they go away after first cache.
- **yfinance rate limits** silently. The `data.py` fetcher retries with backoff;
  add a Polygon key for production-grade fetches.
- **Long path support** must be enabled in Windows for vectorbt's cache. If you see
  `OSError: [WinError 3]`, run as admin:
  `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`
- **plotly kaleido** (PNG export of plotly figs) is *not* installed. Reports use
  matplotlib for PNGs to avoid the kaleido Windows install pain. Use plotly only
  for interactive notebook exploration.

## Running a single strategy

```bash
uv run python -m research.strategies._template.run --years 5
```

Or programmatically:

```python
from research.strategies._template.run import run
result = run(years=5)
print(result.summary())
```

## Testing

```bash
uv run pytest research/tests/ -v          # all tests
uv run pytest research/tests/test_stats.py -v   # one file
uv run pytest research/tests/ --cov=research/lib --cov-report=term-missing
```

Tests use synthetic OHLC only. **Do not** call live APIs in tests.

## Disclaimer

This is research code. Backtest results are not predictive of future returns.
Walk-forward + Monte Carlo are tools for *avoiding overfitting*, not guarantees.
Live trading decisions are the user's responsibility.
