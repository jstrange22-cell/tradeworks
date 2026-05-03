/**
 * TradeWorks Alert Manager
 * ------------------------
 * One-shot CLI tool: drives TradingView Desktop's UI via Chrome DevTools
 * Protocol to create server-side BUY/SELL alerts on every ticker in the
 * scout's watchlist. Once alerts are created, TradingView runs the
 * TradeVisor V2 Pine code on its own servers and fires webhooks 24/7 — even
 * with TV Desktop closed and the user's machine off.
 *
 * STATUS: SCAFFOLD — basic skeleton in place. The actual UI driving
 * (right-click indicator → Add Alert → fill dialog → Save) still needs
 * iteration to handle TradingView's React event dedup. The bridge already
 * uses CDP for symbol switching + label reading; this tool extends that
 * pattern to alert creation.
 *
 * USAGE:
 *   pnpm install && pnpm build
 *   ALERT_MANAGER_DRY_RUN=true node dist/main.js   # plan only, no creates
 *   node dist/main.js                              # actually create alerts
 *
 * REQUIRES:
 *   - TradingView Desktop running with --remote-debugging-port=9222
 *     (the TradeWorks-TV-Debug-Launch scheduled task handles this)
 *   - The scout's watchlist API live at TRADINGVIEW_WEBHOOK_URL's host
 *   - TradingView Pro+ or higher (for server-side alerts; free tier
 *     doesn't support webhook alerts at all)
 *
 * QUOTA AWARENESS: Pro+ has 100 alert quota. Premium has 400. We create
 *   2 alerts per ticker (BUY + SELL), so 50 tickers = 100 alerts on Pro+.
 *   Stay under your plan's quota.
 */
import 'dotenv/config';
import pino from 'pino';
import CDP from 'chrome-remote-interface';

const WEBHOOK_URL = process.env['TRADINGVIEW_WEBHOOK_URL'];
const WATCHLIST_URL =
  process.env['SCOUT_WATCHLIST_URL'] ?? 'https://ai.pulsiq.ai/api/v1/scout/watchlist';
const CDP_HOST = process.env['CDP_HOST'] ?? 'localhost';
const CDP_PORT = Number(process.env['CDP_PORT'] ?? 9222);
const DRY_RUN = process.env['ALERT_MANAGER_DRY_RUN'] === 'true';
const PER_ALERT_DELAY_MS = Number(process.env['PER_ALERT_DELAY_MS'] ?? 2000);

const log = pino({
  ...(process.stdout.isTTY
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
  level: process.env['LOG_LEVEL'] ?? 'info',
});

if (!WEBHOOK_URL) {
  log.fatal('TRADINGVIEW_WEBHOOK_URL not set. Aborting.');
  process.exit(1);
}

interface WatchlistEntry {
  ticker: string;
  tvSymbol: string;
  kind: 'stock' | 'crypto';
}

async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const res = await fetch(WATCHLIST_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`watchlist endpoint returned ${res.status}`);
  const json = (await res.json()) as { data: { entries: WatchlistEntry[] } };
  return json.data.entries;
}

/**
 * Connect to the running TradingView Desktop CDP.
 */
async function connect(): Promise<Awaited<ReturnType<typeof CDP>>> {
  const list = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  if (!list.ok) throw new Error(`CDP list returned ${list.status}`);
  const targets = (await list.json()) as Array<{ id: string; type: string; url: string }>;
  const target = targets.find(
    (t) => t.type === 'page' && t.url.includes('tradingview.com'),
  );
  if (!target) throw new Error('no TradingView chart target found — is TV running with --remote-debugging-port=9222?');
  const client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  await client.Runtime.enable();
  return client;
}

/**
 * Build the alert message body that the gateway expects. Mirrors what the
 * tv-bridge sends, plus a server-alert specific tag so we can distinguish
 * source in logs.
 */
function buildAlertMessage(entry: WatchlistEntry, action: 'buy' | 'sell'): string {
  return JSON.stringify({
    symbol: '{{ticker}}',
    action,
    price: '{{close}}',
    score: 4,
    grade: 'standard',
    time: '{{time}}',
    exchange: '{{exchange}}',
    timeframe: '{{interval}}',
    source_label: `server-side-${action}-${entry.ticker}`,
  });
}

/**
 * Create one alert for one (ticker, direction). Returns success/failure.
 *
 * IMPLEMENTATION TODO: This is the part that needs UI iteration. The flow:
 *   1. setSymbol(entry.tvSymbol) — same call the bridge uses
 *   2. wait for chart load
 *   3. find the TradeVisor V2 indicator legend item
 *   4. click "More" button on it
 *   5. select "Add Alert" from the popup menu
 *   6. in the alert dialog:
 *      - condition dropdown 1: TradeVisor V2
 *      - condition dropdown 2: Buy (or Sell)
 *      - trigger: Once Per Bar Close
 *      - notifications tab: webhook URL = WEBHOOK_URL, message = buildAlertMessage
 *      - alert name: `TradeWorks ${ticker} ${action.toUpperCase()}`
 *   7. click Create
 *
 * The gotcha we hit during the bridge build: TV's React event dedup rejects
 * synthetic events. Real CDP Input.dispatchMouseEvent works for click but
 * the cursor needs to be on the element first (TV's hover-only buttons).
 * Pattern: ui_hover-equivalent → ui_mouse_click pair, both via CDP Input.
 */
async function createAlert(
  client: Awaited<ReturnType<typeof CDP>>,
  entry: WatchlistEntry,
  action: 'buy' | 'sell',
): Promise<boolean> {
  const message = buildAlertMessage(entry, action);
  if (DRY_RUN) {
    log.info({ ticker: entry.ticker, action, message: JSON.parse(message) }, '[DRY-RUN] would create alert');
    return true;
  }

  log.warn(
    { ticker: entry.ticker, action },
    'createAlert NOT YET IMPLEMENTED — UI driver iteration pending. See TODO in src/main.ts.',
  );
  // TODO(phase2): implement the 7-step UI flow described in the function doc.
  // Use client.Input.dispatchMouseEvent for clicks (with prior hover via
  // mouseMoved) and client.Runtime.evaluate('document.querySelector(...)') to
  // locate React-rendered elements before each click.
  return false;
}

async function main(): Promise<void> {
  log.info(
    { dryRun: DRY_RUN, watchlistUrl: WATCHLIST_URL, webhookUrl: WEBHOOK_URL!.replace(/secret=[^&]+/, 'secret=***') },
    'alert-manager starting',
  );

  const watchlist = await fetchWatchlist();
  log.info({ count: watchlist.length }, 'fetched watchlist');

  const totalAlerts = watchlist.length * 2; // buy + sell each
  log.info({ tickers: watchlist.length, totalAlerts, quotaPlanReminder: 'Pro+ allows 100, Premium 400' }, 'plan');

  const client = await connect();
  log.info('connected to TradingView CDP');

  let succeeded = 0;
  let failed = 0;

  for (const entry of watchlist) {
    for (const action of ['buy', 'sell'] as const) {
      try {
        const ok = await createAlert(client, entry, action);
        if (ok) succeeded++;
        else failed++;
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : err, ticker: entry.ticker, action }, 'alert create threw');
        failed++;
      }
      await new Promise((r) => setTimeout(r, PER_ALERT_DELAY_MS));
    }
  }

  log.info({ succeeded, failed, total: totalAlerts }, 'alert-manager done');
  await client.close();
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : err }, 'fatal');
  process.exit(1);
});
