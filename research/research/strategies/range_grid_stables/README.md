# Strategy B6 - Range-Grid on Stablecoin Pairs

A pure mechanical market-making strategy on stablecoin-stablecoin pairs
(USDC/USDT, USDC/USDP, USDC/DAI). Places a symmetric ladder of bids below and
asks above a rolling 7-day-median anchor (defaults to 1.0000 during warmup);
harvests the small persistent oscillations around peg.

## Edge thesis

Stablecoin pairs trade in a tight band around 1.0000 with a near-stationary
distribution: deviations are mean-reverting, driven by short-term liquidity
imbalances (redemption flows, bridge mints, exchange demand spikes) rather than
directional information. A grid trader who sits between flow-driven taker
imbalances earns the bid-ask spread plus a fraction of the deviation amplitude
on every reversion.

The edge is real but small (~5-15 bps per round-trip gross, before fees), and
it is *capacity constrained* — the more grids quoting, the thinner the spread
becomes. It also has a sharp left tail: a true depeg (USDC during the SVB
weekend in March 2023, or UST in May 2022) turns the grid inside-out, with
bids filling all the way down on a one-way move. The depeg circuit breaker is
the most important risk control in the entire stack.

This strategy is **not** intended to be a primary alpha driver. It is included
in TradeWorks v2 as a near-zero-drawdown yield sleeve so the bandit allocator
has something to lean into during chaotic regimes for the directional crypto
and equity strategies.

### References

- Avellaneda, M. & Stoikov, S. (2008). *High-frequency trading in a limit order
  book*. Quantitative Finance, 8(3), 217-224. — The formal market-making model;
  our grid is a coarse discretization of the optimal-quote framework.
- Glosten, L. & Milgrom, P. (1985). *Bid, ask, and transaction prices in a
  specialist market with heterogeneously informed traders*. Journal of
  Financial Economics. — Adverse selection theory; the reason depeg unwind
  matters.
- Jansen, S. (2020). *Machine Learning for Algorithmic Trading*, Chapter 9 on
  pairs trading and statistical arbitrage. — The class of strategies this one
  belongs to.
- Hummingbot Foundation, *Pure Market Making* and *Inventory Skew Strategy*
  documentation. — Practitioner-side reference for grid sizing and rebalancing.
- Coinbase Advanced Trade fee schedule (maker 0 bps / taker 10 bps at the
  default tier as of mid-2025). Verify before live deployment.

## Universe

| Pair       | Production exchange       | Fixture pricing source notes                      |
| ---------- | ------------------------- | ------------------------------------------------- |
| USDC/USDT  | Coinbase Advanced (US)    | Coinbase quotes USDT-USD; synthesized inverse.    |
| USDC/USDP  | Kraken (fallback)         | Coinbase Advanced does not list USDP as of 2025.  |
| USDC/DAI   | Kraken / Binance (fallback)| Coinbase delisted USDC/DAI in 2024.              |

Production deployment must verify pair availability against the active
exchange API; if a pair isn't quoteable on Coinbase Advanced the FreqTrade
config falls back to Kraken (US-compliant) before Binance.

## Files

- `signal.py` — Pure-functional helpers: `generate_grid`, `compute_anchor`,
  `is_depegged`, `is_volume_dead`, and `decide_action` returning
  `HOLD` / `REPLACE_GRID` / `FLATTEN_AND_PAUSE` / `RESUME`. Exposes the
  `generate_signals` shim for walk-forward engine compatibility.
- `grid.py` — `GridOrderbook` class with `place_grid`,
  `place_grid_from_orders`, `crossings`, `fill_event_handler`, `flatten`,
  inventory cap. Pure (no I/O, no time concept).
- `simulator.py` — `simulate_grid(prices, params)` event-driven tick
  simulator. Handles fills, replenishment, inventory caps, depeg
  pause/resume (sustained >=24h), volume guard, daily loss limit.
- `run.py` — Synthetic 1-min stable-pair generator (Ornstein-Uhlenbeck
  with injected depeg event), walk-forward orchestrator, portfolio
  aggregator, and report writer. Top-level CLI entry point.
- `params.yaml` — All knobs: spacing, levels, refresh interval, depeg
  threshold + pause hours, daily loss limit, fees, walk-forward windows,
  PASS/FAIL targets.
- `fixtures/usdc_usdt_ticks.csv`, `fixtures/usdc_usdp_ticks.csv`,
  `fixtures/usdc_dai_ticks.csv` — Hourly downsamples of the synthetic
  series (full 1-minute series regenerated in-memory; on-disk fixtures are
  for inspection / spot-checks).
- `reports/` — Output: `report.md`, per-pair PNGs, portfolio PNGs,
  `summary.json`.

## How to run

```bash
cd research

# Full 2-year backtest with walk-forward and report.
uv run python -m research.strategies.range_grid_stables.run --years 2 \
    --report-dir research/strategies/range_grid_stables/reports

# Single-pass (no walk-forward) for fast iteration.
uv run python -m research.strategies.range_grid_stables.run --no-walk-forward

# Tests
uv run pytest research/tests/test_range_grid_stables.py -v
```

Expected output: `report.md` with annualized return, max DD, total fills,
trades-per-day, average bps per trade, P&L during the depeg event window, and
explicit PASS/FAIL on the 5% return / 2% DD bars.

## Depeg risk discussion

The single largest tail risk for this strategy is a *one-way* depeg. Examples
the strategy must survive:

| Event                       | Date         | Pair          | Magnitude                     |
| --------------------------- | ------------ | ------------- | ----------------------------- |
| USDC SVB exposure scare     | 2023-03-11   | USDC/USDT     | USDC traded down to $0.879    |
| UST collapse contagion      | 2022-05-12   | USDT/DAI      | USDT briefly traded to $0.95  |
| FTX failure                 | 2022-11-09   | USDC/USDT     | ~30 bps wobble, recovered     |
| DAI USDC-collateral concern | 2023-03-12   | USDC/DAI      | DAI followed USDC down ~10%   |

**Mitigations encoded in this strategy:**

1. **Sustained depeg circuit breaker** at 1.5% deviation from the 7-day
   median anchor that *persists for >=24h*: flatten the grid, unwind open
   inventory at the current mark, stay flat until price returns inside the
   band. The "sustained" requirement avoids whipsaws during brief spikes
   that would otherwise produce churn.
2. **Volume guard** at 25% of the trailing 30-day median: pause when
   liquidity drops below this threshold (no edge in dead markets after
   fees).
3. **Daily loss limit** of 2% of allocated capital: defense in depth on top
   of the depeg breaker; caps the worst-case day's damage and forces a
   manual review.
4. **Inventory cap** at +/- 50% of allocated capital: prevents unbounded
   one-sided drift exposure.
5. **Rolling 7-day median anchor** (rather than literal 1.0000): lets the
   grid skew with any small persistent premium/discount (which is normal
   for USDT vs. USDC).

A depeg that crosses through the 1.5% band before the 24h window resolves
will still cause inventory accumulation; mitigation in production: run the
band check on every tick (already implemented) and add a separate
shorter-horizon EMA (e.g. 2 hours) as a faster trip wire for catastrophic
events.

The synthetic fixture explicitly injects a depeg event in the middle of the
2-year series (linear drop from 1.0 -> 0.95 over 24h, 12h trough, linear
recovery over 5 days, with volume halved through the event window) so the
backtest exercises the breaker under realistic stress.

## FreqTrade port (deferred)

Production deployment uses FreqTrade strategy
`infra/freqtrade/user_data/strategies/RangeGridStables.py` with grid
management via `populate_entry_trend` + custom `custom_exit` for partial
fills. The strategy will use a `custom_info` cache to mirror the
`GridOrderbook` state across bar calls. Port is a follow-up implementation;
this research run produces backtest stats only.
