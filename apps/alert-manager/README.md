# Alert Manager — Server-Side TradingView Alert Creator

**Status: SCAFFOLD only.** Skeleton + connection layer working. The UI driver
that creates alerts inside TradingView is a TODO and the most fragile part
of the system. Tracked for next focused session.

## Why this exists

Today, the bot needs **TradingView Desktop running on your machine** for the
tv-bridge to read TradeVisor signals. Server-side TradingView alerts run on
TV's own infrastructure 24/7 — even with TV closed and your computer off.
This tool batch-creates 100 alerts (50 watchlist tickers × BUY/SELL each)
in one go, after which the bridge is no longer needed.

## What's done

- Fetches the watchlist from the gateway scout endpoint
- Connects to TV Desktop via CDP (port 9222)
- Generates the proper alert message body for each (ticker, direction) pair
- Loops over the watchlist with rate limiting
- DRY_RUN mode for plan-only walkthroughs
- Quota awareness — Pro+ = 100 alerts, Premium = 400

## What's TODO (the actual UI driver)

The function `createAlert(client, entry, action)` in `src/main.ts` currently
returns false with a warning. The real implementation needs to drive TV's
alert dialog:

1. setSymbol(entry.tvSymbol) — switch the chart to the ticker
2. wait for chart load
3. find TradeVisor V2 legend item (`[data-qa-id="legend-source-item"]` filtered
   by indicator name)
4. click the "More" button (aria-label="More") on the legend
5. select "Add Alert" from the dropdown
6. fill the dialog:
   - Condition dropdown 1: TradeVisor V2
   - Condition dropdown 2: Buy or Sell (the alertcondition plot ids 8 / 9)
   - Trigger: Once Per Bar Close
   - Notifications → Webhook URL: $TRADINGVIEW_WEBHOOK_URL
   - Message: `buildAlertMessage(entry, action)` JSON
   - Alert name: `TradeWorks ${ticker} ${action.toUpperCase()}`
7. click Create

The gotcha: TradingView's React rejects synthetic events. We've already
proven that real CDP `Input.dispatchMouseEvent` works for clicks if the
cursor is moved to the element first (the bridge uses `chart_set_symbol`
which is the same widget API). The pattern that works is mouseMoved →
mousePressed → mouseReleased on real coordinates.

## Run

```bash
cd apps/alert-manager
cp .env.example .env  # set the webhook secret
pnpm install && pnpm build
ALERT_MANAGER_DRY_RUN=true node dist/main.js  # dry-run first
node dist/main.js                              # actually create
```

Run only AFTER the scout has populated the watchlist and you have TV running
with the debug port open.

## Re-run when watchlist changes

The scout refreshes its picks every 4h. New tickers won't have alerts until
this tool is re-run. A scheduled task or pm2 cron-restart could automate
this; for now it's manual.

A future enhancement would be: detect alerts that exist for tickers no
longer on the watchlist, delete those, then create alerts for new entries
— so we always stay at exactly the watchlist's set of names.
