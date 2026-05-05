# Template Strategy (SMA Crossover)

A trivial fast-vs-slow simple-moving-average crossover. **Not a serious strategy** —
it exists to demonstrate the strategy-folder contract and provide an end-to-end
synthetic-data smoke test for the research scaffold.

## Edge thesis

None. SMA crossovers are the "hello world" of systematic trading; they have no
persistent edge after costs in liquid markets. We use this strategy because it
is simple enough to verify the engine end-to-end without any data dependencies.

## Files

- `signal.py` — `generate_signals(ohlcv, params)` returns the entry/exit/size DataFrame.
- `run.py` — `run(years=10)` builds synthetic OHLCV, runs the backtest, writes a report.
- `params.yaml` — fast/slow SMA periods, warmup, sizing, engine knobs.

## How to copy this for a new strategy

```bash
cp -r research/strategies/_template research/strategies/<your_name>
# edit signal.py, params.yaml, README.md, and remove the synthetic-data path in run.py
# (point run.py at real OHLCV via lib/data.py)
```

## How to run

```bash
uv run python -m research.strategies._template.run
# or
uv run python -m research.strategies._template.run --years 5
```

Output lands in `research/strategies/_template/reports/`.
