"""Regime-Filtered Trend Following strategy (Strategy B2).

Long-only trend following on broad-market and sector ETFs, gated by the
regime classifier. Entries fire only during `calm` or `trending` regimes.
"""

from __future__ import annotations
