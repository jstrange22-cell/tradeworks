# TradeWorks APEX — OpenClaw Finance Agent

## Architecture
This directory follows the PulsIQ Aria (RE-Assistant) agent architecture exactly.
See: `../re-assistant/openclaw-config/` for the source pattern.

APEX is the trading intelligence brain for the TradeWorks platform. It operates across 4 markets (crypto, stocks, prediction markets, sports betting) with unified risk management and cross-market intelligence.

## Files
- `SOUL.md` — Agent identity, guardrails, security rules (184 lines, mirrors Aria exactly)
- `SKILL.md` — 14 skill definitions with triggers, tools, and output schemas
- `openclaw-config.json` — Agent manifest (skills, permissions, model config)
- `policy.yaml` — Sandbox security (deny-by-default filesystem/network)
- `scripts/apex.sh` — CLI bridge to TradeWorks gateway (HMAC-signed)
- `references/` — Market data APIs, risk rules, regulations, market context
- `.env.example` — Required environment variables

## Setup
1. Copy `.env.example` to `.env` and fill in API keys
2. Ensure TradeWorks gateway is running on port 4000
3. `chmod +x scripts/apex.sh`
4. Test: `./scripts/apex.sh status`

## Quick Start
```bash
./scripts/apex.sh status          # Portfolio overview
./scripts/apex.sh sniper          # Sniper bot status
./scripts/apex.sh risk            # Risk dashboard
./scripts/apex.sh scan crypto     # Scan for crypto opportunities
./scripts/apex.sh brief           # Market intelligence briefing
```

## All Commands
```
Portfolio:  status | positions | pnl | portfolio | watchlist
Trading:    close <id> | signal | scan [market]
Sniper:     sniper [start|stop|config|history] | whale | clean
Analysis:   risk | regime | backtest | arb | brief
Markets:    predict | sports
System:     config | journal | alert | circuit-breaker | help
```

## Security Model
- Deny-by-default filesystem and network (see policy.yaml)
- HMAC-signed bridge calls to gateway
- API key isolation — credentials never in SOUL.md or agent memory
- Circuit breaker auto-trip on loss limits
- Escalation to human operator for trades >$50K
- All guardrails from RE-Assistant preserved and translated to finance domain

## Model Config
- **Primary**: Claude Opus 4.5 (best reasoning for multi-market analysis)
- **Fallback**: DeepSeek (rate limit or error failover)
- Temperature: 0.2 (precise, data-driven)
- Max tokens: 8192

## Reference Architecture
Built by Strange Digital Group following the PulsIQ RE-Assistant pattern.
See: https://github.com/jstrange22-cell/re-assistant
