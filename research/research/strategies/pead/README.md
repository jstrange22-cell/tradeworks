# Strategy B1: Post-Earnings Announcement Drift (PEAD)

## Edge thesis

Stocks that beat consensus EPS and maintain or raise forward guidance tend to
drift in the direction of the surprise for **60-90 calendar days** after the
announcement. The drift is the market under-reacting to news that's then
absorbed slowly. The anomaly is one of the most-replicated in academic
finance:

- **Bernard, V. & Thomas, J. (1989).** "Post-Earnings-Announcement Drift:
  Delayed Price Response or Risk Premium?" *Journal of Accounting Research.*
  The seminal paper that named the effect.
- **Sloan, R. (1996).** "Do Stock Prices Fully Reflect Information in
  Accruals and Cash Flows About Future Earnings?" *Accounting Review.*
  Showed that the drift is amplified when the beat is driven by cash flow
  rather than accruals.
- **Chan, L., Jegadeesh, N., Lakonishok, J. (1996).** "Momentum Strategies."
  *Journal of Finance.* Documented PEAD-style momentum across earnings.

The edge has decayed since the late 90s as more capital chases it, but it
*persists with quality filters*. Without filters, you trade through plenty
of "beat-but-the-stock-falls" headfakes (revenue miss masked by an EPS beat
from a tax benefit; a beat with lowered guidance; a beat into bad pre-news
momentum). Our entry stack uses every standard filter from the literature.

## Entry criteria (long)

On the open of the day **after** earnings, BUY if **all** of the following:

1. Reported EPS surprise > **+5%** (actual vs consensus).
2. Revenue beat or in line (no revenue miss).
3. Forward guidance was **raised or maintained** (not lowered).
4. Pre-announcement 20-day momentum was **non-negative** (don't catch falling
   knives).
5. Gap up at open vs prior close is **> 1%** (price confirms the surprise).
6. No ex-div in the next 30 days.
7. No other earnings within 30 days.

## Entry criteria (short, default OFF)

Mirror image. Disabled by default — long-only PEAD is more reliable in
practice because shorts have asymmetric tail risk into squeezes.

## Exit stack

- **Hard time stop** at 60 calendar days.
- **Trailing stop**: -1.5x ATR(14) below the highest close since entry.
- **Hard stop**: -8% from entry.
- **Profit ladder**:
  - +5% → scale out 50%
  - +10% → scale out 25%
  - last 25% rides the trail.
- **Pre-earnings exit**: close before the next reporting date so we don't
  hold through earnings.

## Sizing

ATR-based: risk **0.5% of equity** per trade, sized via `equity * risk_pct /
(atr * atr_stop_mult)`. Capped at **5% of equity** in any one position. This
keeps a single bad print from blowing up the account.

## Files

- `signal.py` — `generate_long_entries(prices, events, params)` (pure
  screener) and `run_pead_simulation(prices, events, params)` (multi-symbol
  event-driven engine that returns a `BacktestResult`).
- `earnings.py` — fixture generator + a stub for live Polygon fetch.
- `run.py` — CLI: `uv run python -m research.strategies.pead.run [--years N]`.
- `params.yaml` — every threshold the strategy uses.
- `fixtures/earnings_sample.csv` — generated on every load (deterministic
  via seed). 5y x 100 symbols x 4 events/year ≈ 2k+ rows of synthetic
  beats/misses with realistic surprise/guidance distributions.

## Run it

```bash
cd research
uv run python -m research.strategies.pead.run --years 10 --report-dir research/strategies/pead/reports
```

Artifacts land in the report dir: `report.md`, `equity-curve.png`,
`drawdown.png`, `walkforward.csv`, `summary.json`.

## Tests

```bash
cd research
uv run pytest research/research/strategies/pead/ -v
```

Tests cover the signal screener, exit logic, and the end-to-end runner on
fixture data — no API access required.

## Why no Pine v6 source?

PEAD is **event-driven** off fundamental data (earnings surprise, guidance,
revenue) that isn't natively accessible inside TradingView Pine. Running this
on TV would require an external alert webhook fed by the Python research
engine. For the v2 deployment plan, the engine identifies setups and the
gateway calls Alpaca paper directly — no Pine middleman needed.

## Parameter sensitivity (what to tune)

The most impactful knobs, in order:

1. **`surprise_min_pct`** — raising from 5% → 8% improves win-rate but cuts
   trade count ~40%. We use 5% as the academic baseline.
2. **`gap_min_pct`** — the price-confirmation filter. 1% works in liquid
   names; smaller-caps benefit from 2%+.
3. **`time_stop_days`** — 60d is the academic mid-point. 30d misses the
   second half of the drift; 90d gives back gains to mean reversion.
4. **`trail_atr_mult`** — 1.5x is aggressive; 2.5x stays in trades longer at
   the cost of bigger giveback on reversals.
5. **`risk_pct_per_trade`** — inversely proportional to drawdown. 0.5% is
   conservative; full Kelly would be 1-2% but invites blowup risk.

## Known limitations

- Fixture data has no realistic correlation structure across symbols, so
  drawdown estimates are likely **understated** vs real-market PEAD.
- Real PEAD performance varies by market cap (better in mid-caps), sector
  (tech > utilities), and macro regime (worse in volatile/crisis regimes).
  None of those slices are modeled here yet — they belong in v2 Phase 2.
- The 60-day hold creates calendar overlap with the next quarter's
  announcement. The exit-at-next-earnings rule covers most of this; edge
  cases (early reporters, restated dates) are not modeled.

---

_Research output. Not financial advice._
