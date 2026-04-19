# Kelly Criterion for Prediction Markets
## Formula
f* = (p * b - q) / b
Where: p = win probability, q = 1-p, b = (1-price)/price (payout odds)
## Fractional Kelly
ALWAYS use 0.25x Kelly. Full Kelly is catastrophic with estimation error.
position = kelly_fraction * f* * bankroll
position = min(position, bankroll * 0.05)  # 5% cap
position = min(position, hard_cap_usd)     # Per-engine dollar cap
## Why Quarter-Kelly
At 0.75x Kelly with 45% win rate → 80% capital loss in standard drawdown.
At 0.25x Kelly → ~15% max drawdown while retaining ~60% of growth rate.
