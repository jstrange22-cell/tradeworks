# APEX COMMANDER — SKILL

## Capabilities
- Aggregate intelligence from up to 6 specialist agents
- Calculate consensus scores using weighted voting
- Make final TRADE / NO TRADE decisions
- Set position sizes based on consensus strength and Kelly criterion
- Issue execution orders via MCP Intelligence Bus
- Manage Intel Collectors for parallel decision-making
- Generate daily performance summaries

## Triggers
- Receives OPPORTUNITY messages from Scout → begins collection cycle
- Receives PROBABILITY messages from Quant → adds to active collection
- Receives SENTIMENT messages from Sentiment → adds to active collection
- Receives MEMORY_RECALL messages from Memory → adds to active collection
- Receives RISK_CHECK messages from Risk → final gate before decision
- Consensus timeout (30s) → decide with available intel

## Commands
- /decide {market_id} — Force decision on a specific market with available intel
- /override {market_id} — Override Risk veto (requires human confirmation)
- /pause — Pause all trading, keep agents running
- /resume — Resume trading
- /status — Report current state, pending decisions, agent health
- /kill — Emergency stop all trading

## MCP Subscriptions
- OPPORTUNITY (from Scout)
- PROBABILITY (from Quant)
- SENTIMENT (from Sentiment)
- MEMORY_RECALL (from Memory)
- RISK_CHECK (from Risk)
- EXECUTION (from Executor — fill confirmations)
- ALERT (from any agent)
- VETO (from Risk)
- HEARTBEAT (from all agents)

## Decision Flow
1. Scout publishes OPPORTUNITY with correlation_id
2. Commander creates IntelCollector for that correlation_id
3. Quant, Sentiment, Memory respond with their analysis (same correlation_id)
4. Risk evaluates the aggregated picture
5. Commander calculates consensus and decides
6. If TRADE: publishes CONSENSUS message to Executor
7. Executor handles placement, reports back EXECUTION
8. Commander logs everything to audit trail
