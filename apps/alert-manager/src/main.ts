/**
 * TradeWorks Alert Manager — server-side TradingView alert batch creator.
 *
 * Drives TradingView Desktop's UI via Chrome DevTools Protocol to create
 * BUY + SELL webhook alerts for every ticker in the AI scout's watchlist.
 * Once these alerts exist, TradingView runs the TradeVisor Pine Script on
 * its own servers and fires webhooks 24/7 — even with TV closed and your
 * machine off. The tv-bridge polling daemon becomes redundant after this.
 *
 * STATUS: experimental. Real CDP mouse events are reliable; React UI shape
 * changes between TV releases will require selector/coordinate updates.
 * Tracks per-(ticker, direction) success in data/alert-state.json so
 * re-runs only retry what failed.
 *
 *   pnpm install && pnpm build
 *   ALERT_DRY_RUN=true node dist/main.js   # plan only — no UI clicks
 *   node dist/main.js                      # actually create alerts
 *   node dist/main.js --reset              # clear state, retry everything
 *
 * REQUIRES:
 *   - TradingView Desktop running with --remote-debugging-port=9222
 *     (the TradeWorks-TV-Debug-Launch scheduled task handles that)
 *   - TradingView Pro+ or higher (free tier doesn't support webhook alerts)
 *   - The scout's watchlist endpoint live at SCOUT_WATCHLIST_URL
 *   - Tradevisor V2 indicator applied to TradingView (any chart)
 *
 * QUOTA: Pro+ = 100 alerts. Premium = 400. We create 2 alerts per ticker;
 * stay under your plan's quota by adjusting watchlist size.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import pino from 'pino';
import CDP from 'chrome-remote-interface';

// ── Config ──────────────────────────────────────────────────────────────
const WEBHOOK_URL = process.env['TRADINGVIEW_WEBHOOK_URL'];
const WATCHLIST_URL = process.env['SCOUT_WATCHLIST_URL'] ?? 'https://ai.pulsiq.ai/api/v1/scout/watchlist';
const CDP_HOST = process.env['CDP_HOST'] ?? 'localhost';
const CDP_PORT = Number(process.env['CDP_PORT'] ?? 9222);
const DRY_RUN = process.env['ALERT_DRY_RUN'] === 'true';
const STATE_FILE = resolve(process.env['ALERT_STATE_FILE'] ?? './data/alert-state.json');
const SCREENSHOT_DIR = resolve(process.env['ALERT_SCREENSHOT_DIR'] ?? './data/screenshots');
const SETTLE_AFTER_SYMBOL_MS = Number(process.env['SETTLE_AFTER_SYMBOL_MS'] ?? 5_000);
const STEP_DELAY_MS = Number(process.env['STEP_DELAY_MS'] ?? 600);
const INDICATOR_FILTER = process.env['INDICATOR_FILTER'] ?? 'Tradevisor';
const RESET = process.argv.includes('--reset');

const log = pino({
  ...(process.stdout.isTTY ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
  level: process.env['LOG_LEVEL'] ?? 'info',
});

if (!WEBHOOK_URL) {
  log.fatal('TRADINGVIEW_WEBHOOK_URL not set in .env. Aborting.');
  process.exit(1);
}

// ── Types ──────────────────────────────────────────────────────────────
interface WatchlistEntry { ticker: string; tvSymbol: string; kind: 'stock' | 'crypto' }
interface State { succeeded: Record<string, true>; failures: Record<string, string>; updatedAt: string }

// ── State load/save ────────────────────────────────────────────────────
function loadState(): State {
  if (RESET || !existsSync(STATE_FILE)) return { succeeded: {}, failures: {}, updatedAt: new Date().toISOString() };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State; }
  catch { return { succeeded: {}, failures: {}, updatedAt: new Date().toISOString() }; }
}
function saveState(s: State): void {
  s.updatedAt = new Date().toISOString();
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
const stateKey = (ticker: string, action: 'buy' | 'sell'): string => `${ticker}_${action}`;

// ── CDP helpers ────────────────────────────────────────────────────────
type CDPClient = Awaited<ReturnType<typeof CDP>>;

async function connect(): Promise<CDPClient> {
  const list = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  if (!list.ok) throw new Error(`CDP list returned ${list.status}`);
  const targets = (await list.json()) as Array<{ id: string; type: string; url: string }>;
  const target = targets.find((t) => t.type === 'page' && t.url.includes('tradingview.com'));
  if (!target) throw new Error('no TradingView chart target found — is TV running with --remote-debugging-port=9222?');
  const client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  await client.Runtime.enable();
  await client.Page.enable();
  await client.DOM.enable();
  await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: 100, y: 100, button: 'none', buttons: 0 });
  return client;
}

async function evalJs<T>(client: CDPClient, expression: string): Promise<T> {
  const r = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value as T;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Real CDP click sequence at coordinates. Hovers first to trigger CSS-based
// reveals (TV hides action buttons until hover), then presses + releases.
async function clickAt(client: CDPClient, x: number, y: number): Promise<void> {
  await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(150);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(STEP_DELAY_MS);
}

async function rightClickAt(client: CDPClient, x: number, y: number): Promise<void> {
  await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(150);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await sleep(40);
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(STEP_DELAY_MS);
}

async function typeText(client: CDPClient, text: string): Promise<void> {
  for (const ch of text) {
    await client.Input.dispatchKeyEvent({ type: 'char', text: ch });
    await sleep(15);
  }
}

async function pressKey(client: CDPClient, key: string, code: string, vk: number): Promise<void> {
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
  await sleep(30);
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  await sleep(STEP_DELAY_MS);
}

// Take a screenshot to disk for debugging.
async function screenshot(client: CDPClient, label: string): Promise<string> {
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    // Page.captureScreenshot returns base64 PNG.
    const r = await (client as unknown as { send: (m: string, p: object) => Promise<{ data: string }> }).send(
      'Page.captureScreenshot',
      { format: 'png' },
    );
    const path = resolve(SCREENSHOT_DIR, `${label.replace(/[^a-z0-9_-]/gi, '_')}-${Date.now()}.png`);
    writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  } catch (err) {
    log.debug({ err: err instanceof Error ? err.message : err }, 'screenshot failed');
    return '';
  }
}

// ── Watchlist fetch ────────────────────────────────────────────────────
async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const res = await fetch(WATCHLIST_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`watchlist endpoint returned ${res.status}`);
  const json = (await res.json()) as { data: { entries: WatchlistEntry[] } };
  return json.data.entries;
}

// ── TV automation primitives ────────────────────────────────────────────
async function setSymbol(client: CDPClient, tvSymbol: string): Promise<void> {
  await evalJs(client, `
    (function() {
      var w = window.TradingViewApi._activeChartWidgetWV.value();
      if (w && w._chartWidget && typeof w._chartWidget.setSymbol === 'function') {
        w._chartWidget.setSymbol(${JSON.stringify(tvSymbol)});
      } else {
        var cwc = window.TradingViewApi._chartWidgetCollection;
        if (cwc && typeof cwc.setSymbol === 'function') cwc.setSymbol(${JSON.stringify(tvSymbol)});
      }
    })()
  `);
  await sleep(SETTLE_AFTER_SYMBOL_MS);
}

interface IndicatorLegend { entityId: string; rect: { x: number; y: number; w: number; h: number }; moreBtnRect: { x: number; y: number; w: number; h: number } | null }

async function findIndicatorLegend(client: CDPClient, nameFilter: string): Promise<IndicatorLegend | null> {
  return evalJs<IndicatorLegend | null>(client, `
    (function() {
      var items = document.querySelectorAll('[data-qa-id="legend-source-item"]');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var title = el.querySelector('[data-qa-id="legend-source-title"]') || el.querySelector('.title-l31H9iuA');
        var text = title ? title.textContent.trim() : '';
        if (text.indexOf(${JSON.stringify(nameFilter)}) !== -1) {
          var r = el.getBoundingClientRect();
          var moreBtn = el.querySelector('[data-name="legend-more-action"] button, button[aria-label="More"]');
          var mb = moreBtn ? (function() { var br = moreBtn.getBoundingClientRect(); return { x: br.left|0, y: br.top|0, w: br.width|0, h: br.height|0 }; })() : null;
          return {
            entityId: el.getAttribute('data-entity-id') || '',
            rect: { x: r.left|0, y: r.top|0, w: r.width|0, h: r.height|0 },
            moreBtnRect: mb,
          };
        }
      }
      return null;
    })()
  `);
}

interface MenuItem { text: string; rect: { x: number; y: number; w: number; h: number } }

async function listVisibleMenuItems(client: CDPClient): Promise<MenuItem[]> {
  return evalJs<MenuItem[]>(client, `
    (function() {
      var menus = document.querySelectorAll('[class*="menuWrap"], [class*="menu-"], [class*="popupBody"]');
      var items = [];
      for (var i = 0; i < menus.length; i++) {
        var m = menus[i];
        var mRect = m.getBoundingClientRect();
        if (mRect.width < 80 || mRect.height < 60) continue;
        // Find clickable rows
        var rows = m.querySelectorAll('[role="menuitem"], [class*="item-"], [class*="label"]');
        for (var j = 0; j < rows.length; j++) {
          var row = rows[j];
          var txt = (row.textContent || '').trim();
          if (!txt || txt.length > 80) continue;
          var rr = row.getBoundingClientRect();
          if (rr.width < 30 || rr.height < 14) continue;
          items.push({ text: txt, rect: { x: rr.left|0, y: rr.top|0, w: rr.width|0, h: rr.height|0 } });
        }
      }
      return items;
    })()
  `);
}

async function findVisibleDialog(client: CDPClient): Promise<{ rect: { x: number; y: number; w: number; h: number } } | null> {
  return evalJs<{ rect: { x: number; y: number; w: number; h: number } } | null>(client, `
    (function() {
      var dialogs = document.querySelectorAll('[role="dialog"], [class*="dialog"]');
      for (var i = 0; i < dialogs.length; i++) {
        var d = dialogs[i];
        var r = d.getBoundingClientRect();
        if (r.width > 300 && r.height > 200) {
          return { rect: { x: r.left|0, y: r.top|0, w: r.width|0, h: r.height|0 } };
        }
      }
      return null;
    })()
  `);
}

// Composite: hover the legend item, then click its "More" button.
async function openIndicatorMoreMenu(client: CDPClient, legend: IndicatorLegend): Promise<MenuItem[]> {
  if (!legend.moreBtnRect) {
    // Hover the legend item to surface the More button.
    await client.Input.dispatchMouseEvent({
      type: 'mouseMoved',
      x: legend.rect.x + 10,
      y: legend.rect.y + legend.rect.h / 2,
      button: 'none', buttons: 0,
    });
    await sleep(400);
    // Re-query to pick up the now-visible button
    const refreshed = await findIndicatorLegend(client, INDICATOR_FILTER);
    if (refreshed?.moreBtnRect) legend = refreshed;
    if (!legend.moreBtnRect) throw new Error('More button never appeared on hover');
  }
  await clickAt(client, legend.moreBtnRect.x + legend.moreBtnRect.w / 2, legend.moreBtnRect.y + legend.moreBtnRect.h / 2);
  await sleep(800);
  return listVisibleMenuItems(client);
}

async function clickMenuItem(client: CDPClient, items: MenuItem[], pattern: string | RegExp): Promise<boolean> {
  const re = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
  const target = items.find((it) => re.test(it.text));
  if (!target) return false;
  await clickAt(client, target.rect.x + target.rect.w / 2, target.rect.y + target.rect.h / 2);
  return true;
}

// ── Build the alert message body ────────────────────────────────────────
function buildAlertMessage(ticker: string, action: 'buy' | 'sell'): string {
  return JSON.stringify({
    symbol: '{{ticker}}',
    action,
    price: '{{close}}',
    score: 4,
    grade: 'standard',
    time: '{{time}}',
    exchange: '{{exchange}}',
    timeframe: '{{interval}}',
    source_label: `server-${ticker}-${action}`,
  });
}

// ── Per-(ticker, action) flow ──────────────────────────────────────────
async function createOneAlert(client: CDPClient, entry: WatchlistEntry, action: 'buy' | 'sell'): Promise<{ ok: boolean; reason?: string }> {
  const tag = `${entry.ticker}_${action}`;

  // 1. Switch chart symbol
  log.info({ tag, tvSymbol: entry.tvSymbol }, 'set symbol');
  await setSymbol(client, entry.tvSymbol);

  // 2. Find Tradevisor V2 legend item
  const legend = await findIndicatorLegend(client, INDICATOR_FILTER);
  if (!legend) {
    const ssPath = await screenshot(client, `${tag}_no-legend`);
    return { ok: false, reason: `Tradevisor V2 not on chart (apply it as default for ${entry.tvSymbol}). screenshot=${ssPath}` };
  }

  // 3. Open the More menu on that legend item
  let menuItems: MenuItem[];
  try {
    menuItems = await openIndicatorMoreMenu(client, legend);
  } catch (err) {
    const ssPath = await screenshot(client, `${tag}_more-menu-failed`);
    return { ok: false, reason: `couldn't open indicator More menu: ${err instanceof Error ? err.message : err}. screenshot=${ssPath}` };
  }

  // 4. Click "Add alert"
  const clicked = await clickMenuItem(client, menuItems, /add\s*alert|create\s*alert/i);
  if (!clicked) {
    const ssPath = await screenshot(client, `${tag}_no-add-alert`);
    return {
      ok: false,
      reason: `"Add alert" not in indicator menu. items: [${menuItems.map((m) => m.text).slice(0, 8).join(', ')}]. screenshot=${ssPath}`,
    };
  }
  await sleep(1500);

  // 5. Confirm alert dialog opened
  const dialog = await findVisibleDialog(client);
  if (!dialog) {
    const ssPath = await screenshot(client, `${tag}_no-dialog`);
    return { ok: false, reason: `alert dialog didn't open. screenshot=${ssPath}` };
  }

  // 6. Set Trigger to "Once Per Bar Close"
  // Heuristic: click the "Once Per Bar Close" radio if visible.
  await evalJs(client, `
    (function() {
      var labels = document.querySelectorAll('label, span');
      for (var i = 0; i < labels.length; i++) {
        if (labels[i].textContent && labels[i].textContent.indexOf('Once Per Bar Close') !== -1) {
          labels[i].click();
          return true;
        }
      }
      return false;
    })()
  `);
  await sleep(STEP_DELAY_MS);

  // 7. Set the BUY/SELL condition. The condition dropdown depends on TV's
  // current selection of the indicator's plot. Heuristic: type the action
  // name into the condition search if there's a search input. Otherwise,
  // we trust TV's default condition (which is usually the indicator's
  // first alert plot). The user may need to manually adjust if the wrong
  // plot is selected.
  // For Tradevisor V2 plots: plot_8 = "Buy", plot_9 = "Sell".

  // 8. Open Notifications tab + fill webhook URL
  // TV's tabs: "Settings" (default), "Notifications", "Description".
  // Find and click "Notifications".
  const notifClicked = await evalJs<boolean>(client, `
    (function() {
      var tabs = document.querySelectorAll('[role="tab"], [class*="tab"]');
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].textContent && tabs[i].textContent.trim().toLowerCase() === 'notifications') {
          tabs[i].click();
          return true;
        }
      }
      return false;
    })()
  `);
  await sleep(800);

  if (notifClicked) {
    // 9. Toggle "Webhook URL" checkbox + fill input
    const webhookFilled = await evalJs<boolean>(client, `
      (function() {
        var labels = document.querySelectorAll('label, span');
        var wh = null;
        for (var i = 0; i < labels.length; i++) {
          if (labels[i].textContent && labels[i].textContent.toLowerCase().indexOf('webhook') !== -1) {
            wh = labels[i];
            break;
          }
        }
        if (!wh) return false;
        // Find associated checkbox sibling and click
        var cb = wh.parentElement.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
        // Find the URL input
        var urlInput = wh.parentElement.parentElement.querySelector('input[type="text"], input[type="url"]');
        if (urlInput) {
          var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(urlInput, ${JSON.stringify(WEBHOOK_URL)});
          urlInput.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
        return false;
      })()
    `);
    if (!webhookFilled) {
      log.warn({ tag }, 'webhook URL field not found in Notifications tab');
    }
  }

  // 10. Set the Message body
  const messageBody = buildAlertMessage(entry.ticker, action);
  await evalJs(client, `
    (function() {
      var ta = document.querySelector('textarea[name="message"], textarea[placeholder*="message" i], textarea[placeholder*="Message" i]');
      if (!ta) {
        var tas = document.querySelectorAll('textarea');
        if (tas.length > 0) ta = tas[tas.length - 1]; // last textarea is usually the message
      }
      if (ta) {
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(ta, ${JSON.stringify(messageBody)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()
  `);
  await sleep(STEP_DELAY_MS);

  if (DRY_RUN) {
    const ssPath = await screenshot(client, `${tag}_dry-run-final`);
    log.info({ tag, ssPath }, '[DRY-RUN] dialog filled, NOT clicking Create');
    // Cancel the dialog so we don't accumulate junk.
    await pressKey(client, 'Escape', 'Escape', 27);
    return { ok: true };
  }

  // 11. Click Create / Save
  const created = await evalJs<boolean>(client, `
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var t = (b.textContent || '').trim().toLowerCase();
        if (t === 'create' || t === 'save' || t === 'create alert') {
          b.click();
          return true;
        }
      }
      return false;
    })()
  `);
  await sleep(2000);

  if (!created) {
    const ssPath = await screenshot(client, `${tag}_no-create-btn`);
    await pressKey(client, 'Escape', 'Escape', 27);
    return { ok: false, reason: `Create button not found. screenshot=${ssPath}` };
  }

  // 12. Verify dialog closed (success indicator)
  const stillOpen = await findVisibleDialog(client);
  if (stillOpen) {
    const ssPath = await screenshot(client, `${tag}_dialog-stuck`);
    await pressKey(client, 'Escape', 'Escape', 27);
    return { ok: false, reason: `dialog didn't close after Create — likely validation error. screenshot=${ssPath}` };
  }

  return { ok: true };
}

// ── Main ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  log.info({ dryRun: DRY_RUN, watchlistUrl: WATCHLIST_URL, webhookUrl: WEBHOOK_URL!.replace(/secret=[^&]+/, 'secret=***'), reset: RESET }, 'alert-manager starting');

  const watchlist = await fetchWatchlist();
  log.info({ count: watchlist.length, totalAlerts: watchlist.length * 2 }, 'watchlist fetched');

  const client = await connect();
  log.info('connected to TradingView CDP');

  const state = loadState();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of watchlist) {
    for (const action of ['buy', 'sell'] as const) {
      const k = stateKey(entry.ticker, action);
      if (state.succeeded[k] && !RESET) {
        skipped++;
        continue;
      }
      log.info({ ticker: entry.ticker, action, tvSymbol: entry.tvSymbol }, 'creating alert');
      try {
        const result = await createOneAlert(client, entry, action);
        if (result.ok) {
          state.succeeded[k] = true;
          delete state.failures[k];
          succeeded++;
        } else {
          state.failures[k] = result.reason ?? 'unknown';
          failed++;
          log.warn({ ticker: entry.ticker, action, reason: result.reason }, 'alert create FAILED');
        }
      } catch (err) {
        state.failures[k] = err instanceof Error ? err.message : String(err);
        failed++;
        log.error({ ticker: entry.ticker, action, err: err instanceof Error ? err.message : err }, 'alert create THREW');
      }
      saveState(state);
      await sleep(1500); // breathing room between alerts
    }
  }

  log.info({ succeeded, failed, skipped, total: watchlist.length * 2 }, 'alert-manager done');
  await client.close();
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : err }, 'fatal');
  process.exit(1);
});
