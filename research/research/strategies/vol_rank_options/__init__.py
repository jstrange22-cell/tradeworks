"""Strategy B3: Vol-Rank Mean Reversion (Options).

Sell put credit spreads on liquid underlyings when implied volatility is rich
(IV-rank > 70) AND price has stretched 2+ standard deviations below its 20-day
mean. Edge comes from the variance risk premium (VRP — IV systematically
exceeds realized vol on average) plus mean-reversion in equity index/large-cap
prices.

Entry filters:
  - IV-rank > 70 (252-day percentile of IV)
  - Close is 2+ sigma below 20d SMA
  - No earnings within next 14 calendar days
  - Regime in {'calm', 'trending'} (no 'crisis')
  - Above 200d SMA (long-bias filter)

Spread structure:
  - Short 30-delta put, long 15-delta put, same expiry, 30-45 DTE
  - Profit target: 50% of credit
  - Loss stop: 100% of credit (loss = 1 x credit)
  - Time stop: 21 DTE remaining

References:
  - Coval, Joshua D. & Tyler Shumway (2001). "Expected Option Returns."
    Journal of Finance 56(3).
  - Bakshi, Gurdip & Nikunj Kapadia (2003). "Delta-Hedged Gains and the
    Negative Market Volatility Risk Premium." Review of Financial Studies.
  - Carr, Peter & Liuren Wu (2009). "Variance Risk Premiums."
    Review of Financial Studies 22(3).
  - Sosnoff/CMC tasty research: 50% profit-take + 21 DTE rules.
"""

from __future__ import annotations
