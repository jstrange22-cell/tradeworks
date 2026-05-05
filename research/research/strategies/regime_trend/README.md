# Strategy B2 — Regime-Filtered Trend Following

Long-only trend following on broad-market and sector ETFs, **gated by the
market regime classifier**. The strategy holds risk only when the regime is
`calm` or `trending`; it goes flat the moment the regime flips to `volatile`
or `crisis`.

## Edge thesis

Trend following has a 100+ year track record on liquid equities and futures,
but its biggest drawdowns concentrate in choppy / vol-shock regimes where
moving-average crossovers whipsaw repeatedly. By overlaying a regime filter,
we cut the strategy's exposure during exactly the periods where its core
edge does not work.

### Key references

- **Faber, M. T. (2007).** *A Quantitative Approach to Tactical Asset
  Allocation.* The Journal of Wealth Management. The canonical 200-day SMA
  filter — buy when price > 200d SMA, sell when below. Faber showed this
  single rule reduces drawdowns by 50%+ on US equities, REITs, commodities,
  and international stocks while preserving most of the upside.
- **Antonacci, G. (2014).** *Dual Momentum Investing.* Combines absolute
  momentum (12-month return > T-bills) with relative momentum (rotate to the
  best of two indices). Our `roc_period=21` is a faster relative-momentum
  proxy for sector strength inside a 200-day trend regime.
- **Hurst, B., Ooi, Y. H., Pedersen, L. H. (2017).** *A Century of Evidence
  on Trend-Following Investing.* AQR Capital. Demonstrates trend following
  generates positive returns across a century of data on every asset class
  tested, with strongest performance during sustained bull/bear regimes and
  weakest performance during regime transitions (i.e. the "volatile" tag).
- **Moskowitz, T., Ooi, Y. H., Pedersen, L. H. (2012).** *Time Series
  Momentum.* Journal of Financial Economics. The 12-month time-series
  momentum signal, of which our 21-day ROC is a fast variant.

## Universe

**14 ETFs** — the broadest liquid US-equity ETFs Strange Digital Group
already supports, with deep options chains and tight spreads:

- Index: `SPY`, `QQQ`, `IWM`
- Sector: `XLK`, `XLF`, `XLE`, `XLV`, `XLY`, `XLI`, `XLP`, `XLU`, `XLB`, `XLRE`, `XLC`

## Entry rules (LONG only)

On the close of each trading day, **buy `<symbol>` if all hold**:

1. `close > SMA(close, 200)` — canonical Faber trend filter
2. `ROC(close, 21) > 0%` — positive 1-month momentum
3. `ATR%(14)` is between the 25th and 75th percentile of its trailing
   252-day distribution — skip both dead-vol churn and high-vol whipsaw
4. Current regime label (from `lib.regimes.classify_regimes`) is `calm` or
   `trending`
5. (Optional, default ON) `SPY > SMA(SPY, 200)` — broad-market trend
   confluence; sector ETFs only fire when the broad market is also up

## Exit rules

Whichever fires first:

- **Trailing stop**: `1.5 * ATR(14)` below the highest close since entry
- **Regime exit**: regime flips to `volatile` or `crisis` -> close at next
  bar's open
- **Time stop**: 90 calendar days max hold (configurable, can be disabled)

## Position sizing

ATR-based risk units:

```
size_frac = min(risk_per_trade / (atr/close * trail_atr_multiple), max_position_pct)
units = size_frac * equity / entry_price
```

- `risk_per_trade = 0.004` (0.4% of equity at risk on the trailing-stop distance)
- `max_position_pct = 0.15` (single ETF capped at 15% of equity)
- `max_concurrent_positions = 8` (portfolio-level FIFO admission)

## Files

- [`signal.py`](signal.py) — `generate_signals(ohlcv, params)` (engine path)
  + `generate_trades(ohlcv_dict, spy, vix, params)` (portfolio path).
- [`run.py`](run.py) — synthesizes 14-ETF universe + SPY proxy + VIX proxy,
  classifies regimes, runs walk-forward, writes report.
- [`params.yaml`](params.yaml) — all knobs.
- [`fixtures/universe_ohlcv.csv`](fixtures/) — generated on first run.
- [`reports/report.md`](reports/) — main artifact (regenerated each run).
- [`test_signal.py`](test_signal.py) — pytest unit + smoke tests.

## How to run

```bash
cd research
uv run python -m research.strategies.regime_trend.run --years 10 \
    --report-dir research/strategies/regime_trend/reports
```

Run the test suite:

```bash
cd research
uv run pytest research/strategies/regime_trend/ -v
```

## Pine v6 source for visual sanity-check

A TradingView Pine v6 strategy mirroring the Python logic lives at:
[`apps/dashboard/public/strategies/regime_trend.pine`](../../../../apps/dashboard/public/strategies/regime_trend.pine).
Inputs match `params.yaml` defaults; load on any sector ETF with SPY confluence
to visually verify entries fire in trending regimes only.

## Parameter sensitivity

| Param | Default | Sensitive? | Notes |
| --- | --- | --- | --- |
| `ma_period` | 200 | Low | Anywhere in 150-250 produces similar Faber-like results. |
| `roc_period` | 21 | Medium | 12-month is canonical; 21d is the fast variant. Try 63d / 126d for longer-horizon variants. |
| `atr_period` | 14 | Low | Wilder default; 10-20 are functionally equivalent. |
| `vol_pctile_lo`/`hi` | 25/75 | High | Tighter band (40/60) cuts trade count by ~30% but improves expectancy; wider band (10/90) increases trades but degrades win-rate. |
| `trail_atr_multiple` | 1.5 | High | 1.0-3.0 range. Tighter = more whipsaws, looser = larger drawdowns per trade. |
| `time_stop_days` | 90 | Medium | Disabling produces a few longer-running trades; doesn't materially change Sharpe. |
| `risk_per_trade` | 0.4% | Linear | Scales drawdown/return linearly. |
| `max_position_pct` | 15% | Medium | Cap binds during low-vol entries; raising to 20% increases concentration. |
| `max_concurrent` | 8 | Medium | 14 universe / 8 cap leaves room for sector rotation. |

## What this strategy does NOT do

- **No shorting.** Crisis regimes flatten the book, not invert it.
- **No options overlay.** Pure equity ETFs only — options tier is parked
  per the v2 backlog.
- **No earnings/news avoidance.** ETFs aren't earnings-sensitive enough to
  warrant the complexity, but consider for single-stock variants.
- **No leverage.** `max_position_pct * max_concurrent = 1.20`, so the cap
  already implies up to 20% notional leverage in deep-trend phases. Treat
  that as the ceiling.

---

_This is research output, not financial advice. Test on paper before live
capital._
