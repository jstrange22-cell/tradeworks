# Strategy B4: Sector Rotation by Relative Strength

Cross-sectional momentum across the 11 SPDR sector ETFs. Each month-end:
rank by trailing 21-day ROC, hold the top-3 equal-weight, apply
Antonacci-style absolute-momentum filter, and exit to SHV (1-3mo
treasuries) on a portfolio-level drawdown breach.

## Edge

Two stacked momentum effects:

1. **Cross-sectional (relative)**: leading sectors continue leading on a
   1-12 month horizon (Jegadeesh & Titman 1993, Asness 1994). The top-N
   ETFs by trailing return outperform the bottom-N in nearly every
   rolling decade since the 1970s.
2. **Time-series (absolute)**: only owning sectors with positive trailing
   return avoids structurally-broken sectors and severe bear regimes
   (Antonacci 2014). The dual-momentum filter is the single biggest
   drawdown-control lever in the design.

Sector rotation is also turnover-light by design — typical implementations
trade 30-70% one-way per month, not per day — which is why monthly
rebalance is the right cadence.

## Universe

11 SPDR sector ETFs:

- XLK (Technology), XLF (Financials), XLE (Energy), XLV (Health Care)
- XLY (Consumer Discretionary), XLI (Industrials), XLP (Consumer Staples)
- XLU (Utilities), XLB (Materials), XLRE (Real Estate), XLC (Communication)

Plus SHV (iShares 1-3 Year Treasury Bond) as the cash proxy when sectors
fail the absolute-momentum filter or the drawdown breaker fires.

## Signal

Stateless function in `signal.py`:

```python
rebalance(prices: dict[str, pd.DataFrame], date: pd.Timestamp, params) -> dict[str, float]
```

Logic on each month-end:

1. Compute trailing-`roc_lookback` (default 21d) ROC for each sector.
2. Sort descending; take top-`top_n` (default 3).
3. If `dual_momentum=true` (default), drop any whose ROC <= 0.
4. Equal-weight survivors at 1/`top_n` each.
5. Cash overflow allocated to SHV.

Returned dict sums to 1.0; tickers absent from the dict have weight 0.

## Risk Management

- **Drawdown circuit-breaker**: if portfolio DD > 12%, allocate 100% to
  SHV until next month-end rebalance. Disabled by setting
  `drawdown_breaker: 0` in params.yaml.
- **No stop-losses**: portfolio-level momentum strategies are harmed by
  intra-month stops (they cut the right tail of winners that drives the
  edge). Risk control happens at the rebalance, not intra-bar.
- **No leverage**: equal-weight means ~33% per holding when fully
  allocated; gross exposure is capped at 100%.

## Why no Pine source

Pine Script's `strategy.entry` is single-symbol; it cannot express a
multi-asset rebalance natively. The B4 design is event-driven:

> Cron job (1st trading day of each month, 09:30 ET):
> python -m research.strategies.sector_rotation.compute_weights
> -> POST target weights to gateway
> -> gateway dispatches Alpaca paper / live orders to rebalance.

There's no per-bar TradingView signal because the strategy doesn't react
to per-bar price changes — only to month-end relative-strength rankings.
This is a deliberate simplification: monthly turnover, no day-trading,
no intra-bar logic.

## Backtest design

- Synthetic 15-year fixture in `fixtures/sector_ohlcv.csv` (13 ETFs ×
  ~3,780 bars each, long format).
- Realistic sector dispersion via a 3-factor return model:
  market factor (cyclical bull/bear) + persistent AR(1) sector
  idiosyncratic factor + daily noise.
- Walk-forward: rolling 5-year-train / 1-year-test windows, sliding 1
  year. ~10 OOS windows on the 15-year fixture.
- Costs: 1 bp fee + 1 bp slippage per side, applied as a one-way charge
  on every dollar traded at rebalance.

## Acceptance criteria

PASS if **median window Sharpe >= 0.7** AND **max drawdown <= 25%**.

## References

1. Antonacci, Gary. *Dual Momentum Investing*. McGraw-Hill, 2014.
2. Jegadeesh, N. & Titman, S. "Returns to Buying Winners and Selling
   Losers: Implications for Stock Market Efficiency". *Journal of
   Finance*, 48(1), 1993.
3. Faber, Mebane. "A Quantitative Approach to Tactical Asset Allocation".
   *Journal of Wealth Management*, Spring 2007.
4. Asness, Cliff. "Variables that Explain Stock Returns". PhD thesis,
   University of Chicago, 1994.
5. Moskowitz, T., Ooi, Y. & Pedersen, L. "Time Series Momentum".
   *Journal of Financial Economics*, 104(2), 2012.

## Running

```bash
# Full 15-year backtest with default params:
uv run python -m research.strategies.sector_rotation.run --years 15

# Override report directory:
uv run python -m research.strategies.sector_rotation.run \
    --years 15 \
    --report-dir research/strategies/sector_rotation/reports

# Tests:
uv run pytest research/tests/test_sector_rotation.py -v
```

Outputs in `reports/`:

- `report.md` — summary table, walk-forward windows, MC drawdown CI,
  strategy-specific metrics, PASS/FAIL verdict
- `equity-curve.png`, `drawdown.png`
- `holdings-heatmap.png` — visual of which sectors held when
- `turnover.png` — turnover per rebalance
- `walkforward.csv`, `holdings.csv`, `turnover.csv`, `summary.json`

## Caveats

- The fixture is **synthetic**, not real SPDR price history. It's
  calibrated to give realistic cross-sectional dispersion so the
  strategy logic can be exercised — but the absolute Sharpe / DD
  numbers reflect the toy DGP, not real markets. Replace
  `load_or_build_fixture` with a real-data fetch (yfinance / Polygon)
  before live deployment.
- The 21-day ROC is the simplest momentum score; production should
  consider 6/12-month confluence (Antonacci's GEM uses 12-month).
- Survivorship bias: SPDR ETFs don't change much, but XLC was added
  in 2018 — backtests pre-2018 with XLC included are technically
  out-of-sample for that ticker.
