# Risk Rules — Hard Limits
## Portfolio Level
- Max daily drawdown: 10% of starting capital ($5,000 on $50K)
- Max total drawdown: 15% from high-water mark ($7,500)
- Max concurrent positions: 50 across all engines
- Max sector concentration: 30% of portfolio in any one category
## Engine Level
- Arb: 40% allocation ($20K), max 20 positions
- BTC Sniper: 25% ($12.5K), max 15 positions
- AI Ensemble: 20% ($10K), max 10 positions
- Weather: 10% ($5K), max 10 positions
- Listing Sniper: 5% ($2.5K), max 10 positions
## Consecutive Loss Protection
- 5 consecutive losses per engine → pause 1 hour
- 3 consecutive losses per category → pause 24 hours
## Kill Switch
- data/STOP file → immediate halt, all engines
- data/RESUME file → required to restart after circuit breaker
