"""Strategy B4: Sector Rotation by Relative Strength.

Cross-sectional momentum across the 11 SPDR sector ETFs:
rank by trailing 21d ROC, hold the top-N (default 3) equal-weight,
rebalance monthly. Apply Antonacci-style absolute-momentum filter
(only sectors with positive ROC qualify) and a portfolio-level
drawdown circuit-breaker.
"""

from __future__ import annotations

from research.strategies.sector_rotation.signal import (
    SECTOR_TICKERS,
    rebalance,
)

__all__ = ["SECTOR_TICKERS", "rebalance"]
