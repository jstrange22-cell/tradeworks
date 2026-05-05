"""Strategy B6 — Range-Grid on Stablecoin Pairs.

Mechanical market-making strategy that places a symmetric grid of bids below
and asks above an anchor (rolling 7-day median, defaults to 1.0). Each fill
auto-replenishes a replacement order on the opposite side at the symmetric
level. Designed for stablecoin pairs (USDC/USDT, USDC/USDP, USDC/DAI) which
trade in tight bands around 1.0000.

Submodules
----------
- :mod:`signal`     — Pure-functional grid construction + risk decisions.
- :mod:`grid`       — ``GridOrderbook`` resting-order container + fill matcher.
- :mod:`simulator`  — Tick-driven event simulator with inventory caps + depeg
                      pause/resume + volume guard.
- :mod:`run`        — End-to-end backtest entry point and CLI.

This package is intentionally pure-Python (no APEX/Claude dependency) — it is
deterministic, reproducible, and cheap enough to run in CI on every PR.

See ``README.md`` for edge thesis, references, and depeg risk discussion.
"""

from __future__ import annotations
