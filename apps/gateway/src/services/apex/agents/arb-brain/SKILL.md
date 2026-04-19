# ARB BRAIN — SKILL

## Capabilities
1. **validate_arb** — Fee-adjusted profitability check for any arb opportunity
2. **reason_dependency** — LLM-powered logical dependency detection (Type 4)
3. **check_settlement** — Cross-venue settlement risk assessment (Type 3/6)
4. **verify_options** — Options-implied probability validation (Type 7)
5. **decide_rotation** — Capital rotation: exit when 70%+ edge captured
6. **adjust_params** — Auto-tune thresholds based on win rate history

## Automatic Triggers
- Detector publishes opportunity → `evaluate()`
- Position age > 1 hour → `checkRotation()`
- Every 50 cycles → `updateThresholds()`
- Kill switch file detected → halt all trading

## On-Demand Commands
- `/scan` — Force scan all 7 detectors
- `/status` — Engine status + detector stats
- `/portfolio` — Paper portfolio P&L
- `/learner` — Win rate and threshold adjustment report
- `/start` — Start arb engine
- `/stop` — Stop arb engine

## 6-Step Evaluation Pipeline
1. **Quick Kill** — Kill switch? Stale? Blocked category? Non-positive profit?
2. **Fee Validation** — Calculate exact fees (Kalshi + Polymarket) + slippage
3. **Type-Specific** — Type 4→LLM verify, Type 3/6→settlement check, Type 7→options model
4. **Memory Check** — Historical win rate for this arb type → size adjustment
5. **Final Sizing** — Quantity based on profitability × memory multiplier × config limits
6. **Approve/Skip/Investigate** — Final decision with reasoning

## Subscriptions
- OPPORTUNITY from all 7 detectors
- MARKET_TICK for latency detection
- SETTLEMENT events for race detection
- OPTIONS_CHAIN for Type 7
