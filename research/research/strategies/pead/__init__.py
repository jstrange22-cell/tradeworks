"""Strategy B1: Post-Earnings Announcement Drift (PEAD).

Long stocks that beat EPS + maintain/raise guidance + gap up at the open after
earnings. Hold up to 60 calendar days with ATR-based trailing stop, hard stop,
and a profit-target ladder. Long-only by default; short side gated by param.

Edge thesis (well-documented since Bernard & Thomas 1989): post-announcement
drift persists for ~60-90 days because investors under-react to earnings news.
Quality filters (revenue beat, guidance, momentum confirmation) keep us away
from the "beat-but-the-stock-falls" trap.
"""

from __future__ import annotations
