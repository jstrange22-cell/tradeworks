# 7 Arbitrage Types Reference

## Type 1: Single-Condition Rebalancing (1-3¢)
YES + NO < $1.00 on same market, same platform. Buy both = guaranteed profit.
Risk: Very low. Frequency: Common in thin/new markets.

## Type 2: Dutch Book / Multi-Outcome (3-8¢)
N mutually exclusive outcomes sum < $1.00. Buy ALL = guaranteed profit.
Risk: Low. Found chronically per IMDEA paper.

## Type 3: Cross-Platform (3-6¢)
Same event priced differently on Kalshi vs Polymarket.
Risk: Medium (settlement rule mismatch possible).

## Type 4: Combinatorial / Logical Dependency (5-15¢)
Logically related markets are inconsistently priced. LLM detects dependency.
Example: "Trump wins" at 55% but "Republican wins" at 50% = impossible.
Risk: Medium-high (LLM could be wrong). Requires >80% confidence.

## Type 5: Settlement Race (5-20¢)
Event effectively determined but market hasn't repriced.
Risk: Low if data source is reliable. Speed is everything.

## Type 6: Latency (2-5¢)
Same event on two platforms, one updates faster. Buy on slow platform.
Risk: Medium (requires sub-second execution for best edge).

## Type 7: Options-Implied Probability (5-10%)
Options chains encode implied probability via Black-Scholes d2.
When options say 62% and prediction market says 55%, trade the gap.
Risk: Medium-high (model assumptions may be wrong).
Nobody else does this — 2026 frontier strategy.
