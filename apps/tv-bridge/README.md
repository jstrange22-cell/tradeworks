# TradingView → TradeWorks Webhook Bridge

A small daemon that watches your active TradingView Desktop chart for new
TradeVisor BUY/SELL signals and forwards each one to the TradeWorks gateway as
a webhook. Replaces the per-ticker TradingView alert UI setup with a single
process that follows whatever symbol you have open.

## How it works

```
TradingView Desktop (CDP :9222)
      │  reads pine labels from "APEX Webhook Bridge" study
      ▼
tv-bridge (this app, pm2-managed on your machine)
      │  detects label.id > lastSeen → classifies BUY B / SELL A → builds JSON
      ▼
POST https://ai.pulsiq.ai/api/v1/webhooks/tradingview?secret=…
      ▼
gateway → executeEquitySignal → paper position
```

State is kept per `(symbol|timeframe)` so switching tickers in TV picks up
where it left off without replaying old labels. Restart-safe — on first run
for any new symbol, the bridge captures the current max label id as a baseline
and only fires on labels with higher ids.

## Setup (Windows)

Done once per machine — it's already wired up. Re-run if migrating to a new box:

1. **Launch TradingView with CDP debug port.** TV must be running with
   `--remote-debugging-port=9222` for the bridge to attach.
   ```cmd
   "C:\Users\<you>\Desktop\Claude Desk\tradingview-mcp\scripts\launch_tv_debug.bat"
   ```
   Re-run after every reboot or any time you close TV. Idempotent.

2. **Bridge install** (already done):
   ```cmd
   pnpm install --filter @tradeworks/tv-bridge
   pnpm --filter @tradeworks/tv-bridge build
   ```

3. **Configure secrets.** Copy `.env.example` to `.env` and paste the real
   `TRADINGVIEW_WEBHOOK_SECRET` value into the URL.

4. **Start under pm2 + persist:**
   ```cmd
   cd apps\tv-bridge
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2-startup install   :: registers pm2 as Windows boot service (one-time)
   ```

After that, the bridge will auto-start every time you log in. You only need
to re-run the TV launch script.

## Operation

```cmd
pm2 list                    :: see status
pm2 logs tv-bridge          :: follow logs (JSON lines)
pm2 logs tv-bridge --lines 50 --nostream  :: dump last 50
pm2 restart tv-bridge
pm2 stop tv-bridge
pm2 delete tv-bridge
```

State file: `data/state.json` — the per-symbol bookmark of the highest label
id we've already fired on. Delete it to re-baseline on next start (won't fire
historical signals; the first poll captures the current max as the new
baseline).

## Configuration

All env vars live in `apps/tv-bridge/.env`:

| Var | Default | Notes |
|---|---|---|
| `TRADINGVIEW_WEBHOOK_URL` | — | The deployed gateway endpoint with `?secret=` |
| `CDP_HOST` | `localhost` | TV's debug host |
| `CDP_PORT` | `9222` | TV's `--remote-debugging-port` value |
| `POLL_INTERVAL_MS` | `30000` | How often to read pine labels |
| `BRIDGE_INDICATOR_NAME` | `APEX Webhook Bridge` | Pine indicator that draws BUY/SELL labels |
| `BRIDGE_STATE_FILE` | `./data/state.json` | Per-symbol bookmark file |
| `DRY_RUN` | `false` | Set `true` to log signals without POSTing |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` |

## Signal classification

The bridge maps APEX Webhook Bridge label text to `{action, grade, score}`:

| Label | Action | Grade | Score | Position size (per stock-agent) |
|---|---|---|---|---|
| `BUY B`, `BUY` (no suffix) | `buy` | `standard` | `4` | ~$100 |
| `BUY A` | `buy` | `strong` | `5` | ~$250 |
| `SELL B`, `SELL` (no suffix) | `sell` | `standard` | `4` | closes existing |
| `SELL A` | `sell` | `strong` | `5` | closes existing |

If your APEX setup uses different suffixes/text, adjust `classifyLabel()` in
`src/main.ts`.

## What this does NOT replace

- **TradingView server-side alerts.** Those run on TV's servers even when
  your desktop is closed. The bridge only fires while TV Desktop is open with
  the debug port. If you want 24/7 coverage during weekend testing or while
  travelling, set up native TV alerts in addition (right-click indicator →
  Add Alert → webhook URL with same secret).
- **Multi-chart simultaneous monitoring.** Today the bridge reads the
  *active* chart only. Multi-pane layouts work — but only the focused pane is
  read each tick. To monitor multiple tickers at once, either rotate them on
  the chart or upgrade the bridge to enumerate all panes (TODO).

## Troubleshooting

**`CDP read failed (TV closed?)`** — TradingView Desktop isn't running, or
isn't running with `--remote-debugging-port=9222`. Re-run
`scripts/launch_tv_debug.bat`.

**`indicator not on chart`** — The current chart doesn't have "APEX Webhook
Bridge" applied. Either add it to your favorites and apply to the chart, or
change `BRIDGE_INDICATOR_NAME` in `.env` to match a different Pine indicator
that draws BUY/SELL via `label.new()`.

**Webhook returns 401** — `TRADINGVIEW_WEBHOOK_SECRET` mismatch between the
bridge `.env` and `/opt/tradeworks/.env` on the VPS. Check both.

**Webhook returns 200 but no position appears** — Check the gateway logs
for `[TradingView→Stock] BUY <SYM> (…) — rejected by gates`. Common causes:
hit dedup (already holding), sector cap (≥2 in sector), 15-min cooldown,
global cap (≥10 positions), or below score threshold (`TRADEVISOR_STOCK_MIN_SCORE`).

**Bridge logs show `first-run baseline captured` repeatedly** — Either you
keep deleting the state file, or TV is reporting a different symbol/timeframe
each tick. Check `state.json` and your chart.
