# Strategy B5 — Funding-Rate Cash-and-Carry Basis Trade

A delta-neutral crypto basis trade. Long spot + short corresponding perpetual
future when the realized funding rate is rich; collect the funding payment every
8h while the directional exposure cancels (long spot offsets short perp 1:1).

## Edge thesis

Crypto perpetual futures pay/receive funding every 8 hours based on the perp-vs-spot
price gap. Long-biased traders levering up perps drive funding positive (longs pay
shorts). Going **long spot + short perp** captures that funding without taking
directional risk.

Documented APR ranges:

- Bull markets (sustained positive funding on majors): **8–15% APR** on BTC/ETH,
  occasionally 30–60% during euphoric stretches.
- Calm markets: **3–8% APR** mean — still positive on majors most of the time.
- Bear markets: occasionally negative (you'd pay funding); strategy must be able
  to step out.

Used by Galaxy Digital, Pantera, and (pre-collapse) FTX as a foundational
basis-fund strategy. Risk is operational + execution: spread blow-out (tracking
error between spot venue and perp venue), exchange counterparty, and the
basis flipping negative for sustained periods (which we exit on).

## References

- Hull, *Options, Futures, and Other Derivatives* (cash-and-carry on FX +
  commodity futures — same arithmetic, different funding mechanism).
- Skew Analytics: periodic perp-funding aggregator dashboards (2020–2023, now
  acquired by Coinbase).
- Galaxy Digital research: *"Crypto basis trade quarterly"* report series.
- Pantera Capital blog: *"Cash-and-carry on perpetuals"* deep-dive.
- Coinbase International Exchange: funding-rate API docs (perp settlement
  every 8h: 00:00, 08:00, 16:00 UTC).

## Files

- `data.py` — fixture loader. Generates regime-aware synthetic spot+perp OHLCV +
  funding history per pair with `numpy.random.default_rng(seed)`. Live path
  stubbed (refuses without `COINBASE_INTL_API_KEY`).
- `signal.py` — pure decision logic: `decide_position(state, funding_rate, ...)`
  returns one of `enter | hold | exit`. Exit triggers: funding flip negative for
  N consecutive periods, spread blow-out, macro kill-switch.
- `run.py` — event-loop backtester (per 8h period). Books funding PnL +
  tracking-error PnL + entry/exit fees, walks forward 2y/0.5y, writes report
  with funding histogram + per-pair cumulative PnL.
- `params.yaml` — entry threshold, exit thresholds, sizing caps, fee model,
  pass/fail bars.
- `fixtures/` — persisted CSVs:
  - `btc_funding_history.csv`, `eth_funding_history.csv`, `sol_funding_history.csv`
  - `spot_perp_ohlcv.csv` (long-form: pair, spot_open, spot_close, perp_open, perp_close)
- `reports/` — `report.md`, `equity-curve.png`, `drawdown.png`,
  `funding-distribution.png`, `cumulative-pnl-per-pair.png`, `walkforward.csv`,
  `summary.json`.

## How to run

```bash
uv run python -m research.strategies.funding_basis.run --years 4
# or with explicit report dir:
uv run python -m research.strategies.funding_basis.run \
    --years 4 \
    --report-dir research/strategies/funding_basis/reports
```

## Pass/fail bars

The strategy passes only if both:

- Annualized return >= **8%** APR after costs
- Max drawdown <= **5%** of equity (basis trades should be very low DD)

Both annualizations use the crypto cadence (3 funding periods × 365 days = 1095
periods/year), not the equity 252-day cadence. Backtest fees: 4 fills per
basis (spot taker + perp taker × 2) + slippage_per_side.

## Execution risks (real-world, not in fixture)

- **Tracking error**: spot venue (Coinbase Advanced) vs perp venue (Coinbase
  International / Bybit) prices can diverge in fast markets. The fixture
  injects ~8 bps tracking error in calm regimes, ~25 bps in bear regimes,
  but real exchanges can spike to 50–100 bps in stressed conditions.
- **Funding flip**: bear markets can run negative funding for weeks. Exit
  trigger (3 consecutive negative periods) gets us out within 24 hours.
- **Exchange counterparty**: short perp on Coinbase International is a claim
  against the exchange. Hold capital limits per venue accordingly.
- **Liquidations**: even at low leverage, a fast spot pump can wick the
  short-perp leg into liquidation if margin is too tight. Use isolated
  margin with a cushion (default `prefer_isolated_margin: true`).
- **Funding rate is paid in the perp's quote currency** (USDT/USD). Short perp
  notional drift slightly between settlements; the runner approximates with
  a per-period mark.
- **Withdrawal/settlement latency**: rotating capital between venues can take
  minutes to hours; the strategy assumes capital is pre-positioned on both
  venues.

## FreqTrade port (deferred)

A follow-up wave will produce
`infra/freqtrade/user_data/strategies/FundingBasis.py`. That strategy will:

1. Subscribe to the funding-rate websocket on the perp venue (Coinbase
   International or Bybit).
2. On each settlement, evaluate the same `decide_position` logic.
3. Open the basis as two simultaneous orders (atomic) via the gateway:
   spot buy on Coinbase Advanced, perp short on the perp venue.
4. Hedge ratio = 1:1 in coin units (not USD) to maintain delta-neutrality.

The current research run produces backtest stats only; FreqTrade integration
is a planned follow-up implementation.
