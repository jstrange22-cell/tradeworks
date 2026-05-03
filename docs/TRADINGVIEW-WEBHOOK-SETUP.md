# TradingView Webhook Setup — TradeVisor → TradeWorks

After this setup, every TradeVisor BUY/SELL alert that fires on your TradingView charts will execute as a paper trade in your bot. Replaces the JS reimplementation we've been running.

## Prerequisites

- **TradingView Pro+ subscription** (required for webhook alerts; Pro/free plans don't support them).
- TradeVisor Pine indicator already applied to your watchlist tickers.

## One-time bot config

The bot reads a shared secret from the env. Pick something random:

```bash
ssh root@76.13.120.114
echo 'TRADINGVIEW_WEBHOOK_SECRET=<paste-some-random-token-here>' >> /opt/tradeworks/.env
echo 'DISABLE_INTERNAL_STOCK_SCAN=true' >> /opt/tradeworks/.env
cd /opt/tradeworks && pm2 reload ecosystem.config.cjs --update-env
```

The bot will reject any webhook that doesn't include `?secret=<token>` matching.

## TradingView alert config (per ticker)

For each stock you want the bot to trade, do this once:

1. Open the chart in TradingView with TradeVisor applied
2. Right-click the indicator → **Add Alert**
3. **Condition:** TradeVisor → `BUY signal` (and create a separate alert for `SELL signal`)
4. **Options:** check **"Once Per Bar Close"** — critical, prevents repaints
5. **Notifications → Webhook URL:**
   ```
   https://ai.pulsiq.ai/api/v1/webhooks/tradingview?secret=<your-token>
   ```
6. **Message body** — paste this JSON, customize the `score` and `grade` fields per the alert type:

   For a standard BUY signal:
   ```json
   {
     "symbol": "{{ticker}}",
     "action": "buy",
     "price": {{close}},
     "score": 4,
     "grade": "standard",
     "time": "{{time}}",
     "exchange": "{{exchange}}",
     "timeframe": "{{interval}}"
   }
   ```

   For a strong BUY (5/6 confluence):
   ```json
   { "symbol": "{{ticker}}", "action": "buy", "price": {{close}}, "score": 5, "grade": "strong", "time": "{{time}}" }
   ```

   For a prime BUY (6/6 confluence):
   ```json
   { "symbol": "{{ticker}}", "action": "buy", "price": {{close}}, "score": 6, "grade": "prime", "time": "{{time}}" }
   ```

   For SELL (any grade — sells close existing positions regardless):
   ```json
   { "symbol": "{{ticker}}", "action": "sell", "price": {{close}}, "score": 4, "grade": "standard", "time": "{{time}}" }
   ```

7. **Expiration:** set as far out as TradingView allows (you'll need to renew alerts every 90 days on TV's free tier; paid tier extends this).
8. **Save**

## How sizing maps to grade

The bot sizes positions by grade (already configured):

| Grade | Position size | When TradeVisor fires this |
|---|---|---|
| `standard` | ~$100 | 4/6 confluence |
| `strong` | ~$250 | 5/6 confluence |
| `prime` | ~$500 | 6/6 confluence |

So setting the right `grade` in your alert message body matters — that's how the bot decides how much to risk.

## Verifying it works

Once you've set up at least one alert:

1. From TradingView, click the alert and use **"Test Alert"** (or wait for a real signal)
2. Check the bot logs — you'll see something like:
   ```
   [TradingView→Stock] BUY AAPL (standard/4) — EXECUTED
   ```
3. Hit `https://ai.pulsiq.ai/api/v1/stocks/portfolio` — the position should be there
4. Open the dashboard `/stocks` page — same position visible

## What stops working after this setup

- The internal JS TradeVisor scanner stops scanning stocks (set via `DISABLE_INTERNAL_STOCK_SCAN=true`)
- `TRADEVISOR_ACTION_THRESHOLD` and `TRADEVISOR_STOCK_MIN_SCORE` env vars no longer affect stocks. Quality is now controlled by which TradeVisor alerts you choose to wire up.

## Troubleshooting

**Webhook returns 401:** the `?secret=` token doesn't match. Recheck.

**Webhook returns 400:** payload didn't validate. Make sure your message body is valid JSON (no trailing commas, double quotes for strings).

**Alert fires but no trade:** check log for `rejected by gates` — usually sector cap (max 2 per sector), already-holding (dedup), or 15-min cooldown after a recent signal on the same symbol. These are intentional safeguards.

**Multiple duplicate trades:** make sure you set "Once Per Bar Close" — without it, alerts can fire repeatedly intra-bar.
