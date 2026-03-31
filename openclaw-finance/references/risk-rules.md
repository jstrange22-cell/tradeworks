# APEX Risk Management Rules

## Hard Limits (Non-Negotiable)

| Rule | Value | Enforcement |
|------|-------|-------------|
| Per-trade risk | 1.0% of portfolio (1.5% high conviction) | Position sizing |
| Daily loss limit | 3.0% of portfolio | Circuit breaker auto-trip |
| Portfolio heat limit | 6.0% | Reduce position sizes linearly above 60% |
| Max drawdown | 10.0% | Circuit breaker auto-trip, alert Jason |
| Max position concentration | 10% of portfolio | Block trade if exceeded |
| Max sector concentration | 25% of portfolio | Alert + require confirmation |
| Max correlated positions | 3 | Block new entry if exceeded |
| Max daily trades | 50 | Prevent overtrading |
| Max leverage (crypto) | 2x | Hard block |
| Max leverage (equities) | 1x | Paper trades only |
| Max leverage (predictions) | 1x | No margin |

## Position Sizing — Half-Kelly

Formula: `f* = (b×p - q) / b` where:
- p = probability of winning
- q = 1 - p (probability of losing)
- b = average win / average loss ratio

APEX uses **Half-Kelly (f*/2)** to reduce variance.

### Quality Multipliers
| Signal Quality | Kelly Multiplier |
|---------------|-----------------|
| PRIME (confidence >80) | 1.0 × Half-Kelly |
| STANDARD (confidence 60-80) | 0.6 × Half-Kelly |
| SPECULATIVE (confidence 40-60) | 0.3 × Half-Kelly |
| REJECTED (confidence <40) | 0 (skip trade) |

### Portfolio Heat Reduction
When portfolio heat exceeds 60%, reduce all new position sizes:
- Heat 60%: 100% of calculated size
- Heat 70%: 80% of calculated size
- Heat 80%: 60% of calculated size
- Heat 90%+: 20% of calculated size (minimum)

## Circuit Breaker Triggers

| Trigger | Action | Duration |
|---------|--------|----------|
| Daily loss >3% | Pause all new entries | Until next trading day |
| Max drawdown >10% | Pause all trading, alert Jason | Until manual reset |
| 5 consecutive losses | Pause 10 minutes | Auto-resume |
| Exchange API auth error | Stop all trading on that exchange | Until manually verified |
| Wallet unauthorized tx | Stop all trading, alert immediately | Until manual investigation |

## Market-Specific Rules

### Crypto
- Always run rug check before buying any Solana token
- Never buy tokens with mint authority still active
- Maximum 10 concurrent meme coin positions
- Bonding curve tokens: use quick scalp or graduation hold strategies only

### Equities
- Paper mode by default — live mode requires explicit ALPACA_PAPER=false
- Reduce position size 50% within 24 hours of earnings
- Respect PDT rules: track day trade count if under $25K equity
- No penny stocks (price < $1)

### Prediction Markets
- Maximum $1,000 per single market position without Jason's confirmation
- Diversify across at least 3 uncorrelated markets
- Exit positions with <2 weeks to resolution at >80% confidence

### Sports Betting
- Maximum $1,000 per single bet without Jason's confirmation
- Only bet on +EV opportunities (edge >3%)
- Maximum 5 active bets at any time
- Never chase losses — same bankroll management as trading
