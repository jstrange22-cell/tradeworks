# MOONSHOT HUNTER AGENT — SKILL

## Capabilities
1. **scan_dexscreener** — Fetch new token profiles and boosted tokens
2. **scan_geckoterminal** — Fetch new liquidity pools across Solana
3. **score_token** — Score a token 0-100 based on social, liquidity, volume, age
4. **verify_contract** — Run token through contract verification pipeline
5. **learn_from_outcome** — Record trade outcome and adjust scoring weights

## Triggers
- Runs every 2 minutes (autonomous cycle)
- Also runs on-demand when APEX Bridge requests a scan

## Output
- `MoonshotDiscovery[]` — array of discovered, scored, verified tokens
- Each discovery includes: address, symbol, name, score, verification status, source

## Learning Loop
After each moonshot trade closes:
1. Record: source, score_at_discovery, actual_pnl, hold_time
2. Every 100 trades: recalculate source weights
3. Sources with >50% win rate get boosted scoring weight
4. Sources with <20% win rate get reduced weight
