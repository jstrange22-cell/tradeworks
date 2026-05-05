# Strategy B3 — Vol-Rank Mean Reversion (Options)

**Edge:** Sell put credit spreads on liquid underlyings when implied volatility
is rich (IV-rank > 70) AND price is stretched 2σ below its 20-day mean. Two
forces work in our favor:

1. **Variance Risk Premium (VRP)** — IV systematically prices in more vol than
   actually realizes. Carr & Wu (2009) document a -10% to -15% annualized VRP
   on S&P 500 options. We pocket that premium decay.
2. **Mean reversion** — Liquid large-caps don't trend perpetually. A 2σ
   stretch below the 20d SMA is a high-probability bounce zone, especially
   when the broader trend (200d SMA) is still up.

## Entry signal (all must fire)

| Filter | Threshold |
|---|---|
| IV-rank | > 70 (top 30% of trailing 252d) |
| Price stretch | close < SMA(20) - 2 × stdev(close, 20) |
| Long-bias filter | close > SMA(200) |
| Earnings blackout | no earnings within next 14 calendar days |
| Regime | `calm` or `trending` (not `crisis` / `volatile`) |

## Spread structure

- Sell the 30-delta put (high premium decay rate)
- Buy the 15-delta put (defines max risk; cheap insurance)
- Same expiry, 30-45 DTE
- Width scales with underlying price (handled by `pricing.select_spread_strikes`)

## Exits (any triggers a close)

| Rule | Threshold |
|---|---|
| Profit target | spread value ≤ 50% of credit received |
| Loss stop | spread value ≥ 200% of credit received (i.e. lose 1× credit) |
| Time stop (DTE) | ≤ 21 DTE remaining |
| Hard close (calendar) | ≥ 21 days since entry |

These are the canonical tasty trade rules popularized by Sosnoff/CMC; see
*Tom Sosnoff & Tony Battista, "tasty live: 21 DTE, 50% profit target"*.

## Position sizing

- Risk per trade: 0.5% of equity at max-loss
- Max concurrent open spreads: 6
- Per-underlying cap: 1 spread at a time

## Universe

15 liquid options names: SPY, QQQ, IWM, AAPL, NVDA, MSFT, GOOGL, AMZN, META,
TSLA, AMD, NFLX, TLT, GLD, USO.

## Running

```bash
.venv/Scripts/python.exe -m research.strategies.vol_rank_options.run --years 8
```

Writes `reports/report.md`, `equity-curve.png`, `drawdown.png`,
`pnl-histogram.png`, `trades.csv`, `summary.json`. Pass/Fail bar:
**win rate ≥ 60% AND avg loss / avg win ≤ 2.0** (typical credit-spread economics).

## Files

- `signal.py` — `find_entries(ohlcv, iv_history, earnings_calendar, ...) -> list[Setup]`
- `pricing.py` — Black-Scholes put price/delta + put-credit-spread quoter
- `run.py` — fixture generator + portfolio simulator + report writer
- `params.yaml` — all knobs
- `fixtures/options_universe.csv` — synthetic OHLCV+IV time series (auto-generated)
- `reports/` — output bundle

## Real data sources (for live deployment, not in fixture)

- **OHLCV:** Polygon.io, IEX Cloud, yfinance (free)
- **IV / IV-rank:** CBOE DataShop (paid), ORATS (paid), Tradier (free with API key),
  IV calculated from listed option chain via Polygon
- **Earnings calendar:** Polygon.io (`/v3/reference/earnings`), Finnhub, Earnings Whispers
- **VIX (regime classifier):** CBOE direct, yfinance `^VIX`

The `signal.find_entries` function is data-source-agnostic — it accepts
pandas series, so swapping fixtures for a Polygon adapter is a one-day job.

## References

- Carr, Peter & Liuren Wu (2009). "Variance Risk Premiums."
  *Review of Financial Studies* 22(3), 1311-1341.
- Coval, Joshua D. & Tyler Shumway (2001). "Expected Option Returns."
  *Journal of Finance* 56(3), 983-1009.
- Bakshi, Gurdip & Nikunj Kapadia (2003). "Delta-Hedged Gains and the Negative
  Market Volatility Risk Premium." *Review of Financial Studies* 16(2), 527-566.
- Bondarenko, Oleg (2014). "Why Are Put Options So Expensive?"
  *Quarterly Journal of Finance* 4(3).
- Sosnoff, Tom & Tony Battista. tasty live research on the 21-DTE rule + 50%
  profit-take (CMC Markets / tastytrade research, 2015-2024 series).
- Hull, John C. *Options, Futures, and Other Derivatives* (10e), Ch. 15
  (Black-Scholes).
- Natenberg, Sheldon. *Option Volatility & Pricing*, Ch. 18 (vertical spreads).

---

_Research output. Not financial advice._
