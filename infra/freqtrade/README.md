# FreqTrade — CEX crypto execution layer (Phase 2 scaffold)

Replaces the in-house `crypto-agent.ts` paper engine for CEX trading.
TradeVisor signals continue to flow through the gateway webhook; the gateway
forwards them to FreqTrade's REST API which executes against Coinbase.

**Status:** scaffold only. Container is configured, strategy is a passthrough,
config is a template. The remaining work to make it live:

1. Generate a real Coinbase Cloud API key (CDP) with trade permissions
2. `cp config.example.json config.json` and replace the REPLACE_WITH_* placeholders
3. `docker compose up -d`
4. Wire the gateway to forward TradeVisor signals to FreqTrade's `/forceentry`
   endpoint (gateway code change — added in a follow-up commit)
5. Run a 2-week paper backtest to validate the bridge architecture
6. Sunset `crypto-agent.ts` in `apps/gateway/src/routes/` after 30 days clean

## How signal flow will work

```
TradingView (TradeVisor) → tv-bridge → POST /api/v1/webhooks/tradingview
   ↓                                          ↓
                                gateway routes by symbol
                                          ↓
                  CEX blue chip? → POST http://localhost:8080/api/v1/forceentry
                                          ↓
                           FreqTrade executes on Coinbase, applies stoploss,
                           ROI, trailing stop. Position closed when targets hit
                           or gateway sends force_exit.
```

## Key files

- `docker-compose.yml` — single-container FreqTrade with bind-mounted user_data
- `config.example.json` — Coinbase + 20 blue-chip whitelist + risk caps + REST API
- `user_data/strategies/TradeVisorBridge.py` — strategy that NEVER auto-enters,
  only executes gateway force_entry. Custom stake sizing by grade
  (standard $100 / strong $250 / prime $500) matching stock-agent's ladder.

## Why this architecture (vs FreqAI strategy)

The handoff considered a FreqAI walk-forward backtest to find a NEW edge. We
chose simpler: keep TradeVisor as the single signal source (it's the user's
paid edge), use FreqTrade only for execution + risk. This avoids running two
different strategies against each other and keeps stock and crypto sides
philosophically aligned.

## Open questions before going live

- **Coinbase Advanced Trade vs Coinbase Pro vs Coinbase Cloud (CDP)?** FreqTrade
  via ccxt supports Advanced Trade — needs the user's CDP keys with trade scope.
- **Position monitor migration:** the current `crypto-agent.ts` has a
  position-monitor that tracks ATR-stops, time-stops, etc. FreqTrade's
  built-in stops cover most of this; a shim may be needed for parity.
- **Dashboard rewire:** `dashboard/CryptoPage.tsx` reads
  `/api/v1/crypto/paper`. After cutover this needs to read FreqTrade's
  `/api/v1/profit` + `/api/v1/status` and translate the response shape.

## Deferred (Phase 2.5)

- **DEX rebuild** for Solana memecoin sniping. The in-house engine was
  deleted (18% WR / -91% drawdown). A new bot needs proper rate-limiting
  on Helius/Jupiter, validated strategy, and probably a different signal
  source (whale tracking? AI-driven scanning?). Tracked separately.
