# Risk Rules

1. Kill switch: `data/STOP` file exists → halt ALL trading immediately
2. Max daily drawdown: 10% of starting capital
3. Max single trade: $200 (5% of $5000)
4. Max simultaneous positions: 5
5. Consecutive loss pause: 5 losses on same arb type → pause 1 hour
6. Stale opportunity: >60 seconds old → skip
7. Category block: CPI, FED, ECON_MACRO are never traded (score <30)
8. LLM confidence: Type 4 requires >80%, else skip
9. Settlement risk: Known divergences → skip cross-platform arb
10. Capital rotation: Exit at 70%+ edge captured or 50% underwater
