"""Template strategy. Copy this folder to start a new strategy.

Contract reminder:
  - `signal.py` exports `generate_signals(ohlcv, params) -> DataFrame[entry, exit, size]`
  - `run.py` exports `run(years: int = 10) -> BacktestResult`
  - `params.yaml` holds tunable parameters with sensible defaults
  - `README.md` explains the edge thesis
"""

from __future__ import annotations
