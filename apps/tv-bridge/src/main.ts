/**
 * TradingView → TradeWorks Webhook Bridge
 * --------------------------------------
 * Reads pine_labels drawn by the APEX Webhook Bridge indicator and POSTs each
 * new BUY/SELL label to the gateway webhook.
 *
 * Two modes:
 *
 *   AUTO_ROTATE=true (default):  pulls the AI scout's watchlist from the
 *     gateway, programmatically switches the chart through every ticker in
 *     turn (chart_set_symbol → settle → read labels → next), per-ticker
 *     baselined so nothing replays.
 *
 *   AUTO_ROTATE=false:  legacy mode — only monitors whatever symbol is
 *     currently loaded on the chart. The user picks tickers manually.
 *
 * REQUIRES: TradingView Desktop launched with --remote-debugging-port=9222
 * (the TradeWorks-TV-Debug-Launch scheduled task handles that automatically
 * at every Windows logon).
 */
import 'dotenv/config';
import { resolve } from 'path';
import pino from 'pino';
import { evaluate, disconnect } from './cdp.js';
import { loadState, saveState, key, type BridgeState } from './state.js';
import { postSignal, type WebhookSignal } from './webhook.js';
import { getWatchlist, type WatchlistEntry } from './watchlist.js';

// ── Config ──────────────────────────────────────────────────────────────
const WEBHOOK_URL = process.env['TRADINGVIEW_WEBHOOK_URL'];
const WATCHLIST_URL =
  process.env['SCOUT_WATCHLIST_URL'] ?? 'https://ai.pulsiq.ai/api/v1/scout/watchlist';
const AUTO_ROTATE = (process.env['AUTO_ROTATE'] ?? 'true') === 'true';
// Cycle pacing. SETTLE_MS = how long after switching symbol before reading
// labels — TV needs this for the indicator to recompute on the new ticker.
// CYCLE_GAP_MS = brief pause between tickers to avoid hammering CDP.
const SETTLE_MS = Number(process.env['SETTLE_MS'] ?? 5_000);
const CYCLE_GAP_MS = Number(process.env['CYCLE_GAP_MS'] ?? 500);
// Sleep between full watchlist cycles. With 50 tickers × ~5.5s = ~5min sweep,
// then idle for FULL_CYCLE_REST_MS before starting again.
const FULL_CYCLE_REST_MS = Number(process.env['FULL_CYCLE_REST_MS'] ?? 30_000);
// Single-chart legacy mode poll interval.
const SINGLE_POLL_MS = Number(process.env['POLL_INTERVAL_MS'] ?? 30_000);
// The Pine indicator whose labels we read.
const INDICATOR_NAME = process.env['BRIDGE_INDICATOR_NAME'] ?? 'APEX Webhook Bridge';
const STATE_FILE = resolve(process.env['BRIDGE_STATE_FILE'] ?? './data/state.json');
const DRY_RUN = process.env['DRY_RUN'] === 'true';

const log = pino({
  ...(process.stdout.isTTY && process.env['PINO_PRETTY'] !== 'false'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
  level: process.env['LOG_LEVEL'] ?? 'info',
});

if (!WEBHOOK_URL) {
  log.fatal('TRADINGVIEW_WEBHOOK_URL not set in .env. Aborting.');
  process.exit(1);
}

// ── Pine label fetcher ──────────────────────────────────────────────────
function buildPineLabelsJS(filter: string): string {
  const filterLit = JSON.stringify(filter);
  return `
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
        var model = chart.model();
        var sources = model.model().dataSources();
        var seriesId = '_seriesId';
        var seriesSource = sources.find(function(s){return s.id && s.id() === seriesId;});
        var symbolInfo = seriesSource && seriesSource.symbolInfo ? seriesSource.symbolInfo() : null;
        var symbol = symbolInfo ? (symbolInfo.full_name || symbolInfo.name || '') : '';
        var resolution = (chart.activeResolution && chart.activeResolution()) || (chart.resolution && chart.resolution.value && chart.resolution.value()) || '';
        if (!resolution && model.model && model.model().mainSeries) {
          try { resolution = model.model().mainSeries().properties().interval.value(); } catch(e) {}
        }
        var filter = ${filterLit};
        var matched = null;
        for (var si = 0; si < sources.length; si++) {
          var s = sources[si];
          if (!s.metaInfo) continue;
          var meta = null;
          try { meta = s.metaInfo(); } catch(e) { continue; }
          if (!meta) continue;
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.dwglabels;
            if (outer) {
              var inner = outer.get('labels');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length > 0) {
            matched = { studyName: name, items: items };
            break;
          }
        }
        return { symbol: symbol, resolution: String(resolution || ''), matched: matched };
      } catch(e) {
        return { error: (e && e.message) ? e.message : String(e) };
      }
    })()
  `;
}

interface RawLabel {
  id: number;
  raw: { t?: string; y?: number; x?: number };
}

interface PollResult {
  symbol: string;
  resolution: string;
  matched: { studyName: string; items: RawLabel[] } | null;
  error?: string;
}

async function readPineLabels(filter: string): Promise<PollResult> {
  return evaluate<PollResult>(buildPineLabelsJS(filter));
}

/**
 * Programmatically switch the active chart's symbol via TV's exposed widget API.
 * Equivalent to typing a ticker in the symbol search box.
 */
async function setChartSymbol(tvSymbol: string): Promise<{ ok: boolean; error?: string }> {
  const expr = `
    (function() {
      try {
        var w = window.TradingViewApi._activeChartWidgetWV.value();
        if (!w || !w._chartWidget) return { ok: false, error: 'no chart widget' };
        var chart = w._chartWidget;
        // chart.setSymbol(symbol, opts?, callback?) — we fire-and-forget; the
        // poll waits SETTLE_MS for indicator recompute regardless.
        if (typeof chart.setSymbol === 'function') {
          chart.setSymbol(${JSON.stringify(tvSymbol)});
          return { ok: true };
        }
        // Fallback path: chartWidgetCollection.setSymbol applies to active chart
        var cwc = window.TradingViewApi._chartWidgetCollection;
        if (cwc && typeof cwc.setSymbol === 'function') {
          cwc.setSymbol(${JSON.stringify(tvSymbol)});
          return { ok: true };
        }
        return { ok: false, error: 'no setSymbol method found' };
      } catch(e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
      }
    })()
  `;
  return evaluate<{ ok: boolean; error?: string }>(expr);
}

// ── Signal classification ──────────────────────────────────────────────
function classifyLabel(text: string): { action: 'buy' | 'sell'; grade: 'standard' | 'strong'; score: number } | null {
  const t = (text ?? '').trim().toUpperCase();
  if (!t) return null;
  const isBuy = t.startsWith('BUY');
  const isSell = t.startsWith('SELL');
  if (!isBuy && !isSell) return null;
  const isStrong = / A\b/.test(t);
  return {
    action: isBuy ? 'buy' : 'sell',
    grade: isStrong ? 'strong' : 'standard',
    score: isStrong ? 5 : 4,
  };
}

function normalizeSymbol(rawSymbol: string): { symbol: string; exchange: string } {
  if (!rawSymbol) return { symbol: '', exchange: '' };
  const colonIdx = rawSymbol.indexOf(':');
  if (colonIdx === -1) return { symbol: rawSymbol.toUpperCase(), exchange: '' };
  return {
    symbol: rawSymbol.slice(colonIdx + 1).toUpperCase(),
    exchange: rawSymbol.slice(0, colonIdx).toUpperCase(),
  };
}

// ── Per-ticker label processing ────────────────────────────────────────
// Reads the current chart, fires webhooks for any new BUY/SELL labels.
// On first sight of a (symbol|timeframe) it baselines the highest id without
// firing — prevents historical replay.
async function processCurrentChart(state: BridgeState): Promise<void> {
  const result = await readPineLabels(INDICATOR_NAME);
  if (result.error) {
    log.warn({ err: result.error }, 'CDP read failed (TV closed? chart not ready?)');
    return;
  }
  if (!result.matched) {
    log.debug({ filter: INDICATOR_NAME, symbol: result.symbol }, 'indicator not on chart');
    return;
  }
  const { symbol: rawSymbol, resolution, matched } = result;
  const { symbol, exchange } = normalizeSymbol(rawSymbol);
  if (!symbol) {
    log.warn('chart symbol is empty — TV may be loading');
    return;
  }
  const k = key(rawSymbol, resolution);
  const lastSeen = state.lastSeenIdByKey[k] ?? -1;
  const sorted = [...matched.items].sort((a, b) => a.id - b.id);
  const fresh = sorted.filter((l) => l.id > lastSeen);

  if (lastSeen === -1) {
    const maxId = sorted.length > 0 ? sorted[sorted.length - 1]!.id : 0;
    state.lastSeenIdByKey[k] = maxId;
    saveState(STATE_FILE, state);
    log.info(
      { symbol, exchange, resolution, study: matched.studyName, baseline: maxId, totalLabels: sorted.length },
      'first-run baseline captured (no signals fired)',
    );
    return;
  }

  if (fresh.length === 0) {
    log.debug({ symbol, resolution, lastSeen, total: sorted.length }, 'no new labels');
    return;
  }

  log.info({ symbol, exchange, resolution, fresh: fresh.length, lastSeen }, 'new labels detected');

  for (const lbl of fresh) {
    const text = lbl.raw.t ?? '';
    const cls = classifyLabel(text);
    if (!cls) {
      state.lastSeenIdByKey[k] = lbl.id;
      continue;
    }
    const price = lbl.raw.y ?? 0;
    if (price <= 0) {
      log.warn({ id: lbl.id, text, price }, 'label missing price — skipping');
      state.lastSeenIdByKey[k] = lbl.id;
      continue;
    }

    const signal: WebhookSignal = {
      symbol,
      action: cls.action,
      price: Math.round(price * 100) / 100,
      score: cls.score,
      grade: cls.grade,
      time: new Date().toISOString(),
      exchange,
      timeframe: resolution,
      source_label: text,
    };

    if (DRY_RUN) {
      log.info({ signal }, '[DRY-RUN] would post webhook');
    } else {
      try {
        await postSignal(WEBHOOK_URL!, signal, log);
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : err, signal }, 'webhook POST threw');
        return;
      }
    }
    state.lastSeenIdByKey[k] = lbl.id;
    saveState(STATE_FILE, state);
  }
}

// ── Auto-rotation cycle ─────────────────────────────────────────────────
// Pulls the watchlist, switches the chart through each ticker in turn,
// processes labels at each stop. ~5s per ticker → ~5min for a 50-name list.
async function autoRotateCycle(state: BridgeState): Promise<void> {
  const watchlist = await getWatchlist(WATCHLIST_URL, log);
  if (watchlist.length === 0) {
    log.warn(
      { endpoint: WATCHLIST_URL },
      'watchlist empty — falling back to current chart only this tick',
    );
    await processCurrentChart(state);
    return;
  }

  log.info({ tickers: watchlist.length }, 'starting auto-rotate sweep');
  const startedAt = Date.now();
  let processed = 0;

  for (const entry of watchlist) {
    try {
      const setRes = await setChartSymbol(entry.tvSymbol);
      if (!setRes.ok) {
        log.warn({ entry: entry.tvSymbol, err: setRes.error }, 'setSymbol failed — skipping');
        continue;
      }
      // Wait for indicator to recompute on the new ticker.
      await sleep(SETTLE_MS);
      await processCurrentChart(state);
      processed++;
      // Brief gap between tickers.
      await sleep(CYCLE_GAP_MS);
    } catch (err) {
      log.warn(
        { entry: entry.tvSymbol, err: err instanceof Error ? err.message : err },
        'cycle iteration failed',
      );
    }
  }

  const elapsedMs = Date.now() - startedAt;
  log.info(
    { processed, total: watchlist.length, elapsedSec: Math.round(elapsedMs / 1000) },
    'auto-rotate sweep complete',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Entry point ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const state = loadState(STATE_FILE);
  log.info(
    {
      mode: AUTO_ROTATE ? 'auto-rotate' : 'single-chart',
      webhookUrl: WEBHOOK_URL!.replace(/secret=[^&]+/, 'secret=***'),
      watchlistUrl: AUTO_ROTATE ? WATCHLIST_URL : undefined,
      indicator: INDICATOR_NAME,
      settleMs: SETTLE_MS,
      cycleGapMs: CYCLE_GAP_MS,
      fullCycleRestMs: FULL_CYCLE_REST_MS,
      stateFile: STATE_FILE,
      dryRun: DRY_RUN,
      symbolsTracked: Object.keys(state.lastSeenIdByKey).length,
    },
    'tv-bridge starting',
  );

  let stopping = false;
  const shutdown = (sig: string): void => {
    if (stopping) return;
    stopping = true;
    log.info({ sig }, 'shutting down');
    disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  while (!stopping) {
    try {
      if (AUTO_ROTATE) {
        await autoRotateCycle(state);
        await sleep(FULL_CYCLE_REST_MS);
      } else {
        await processCurrentChart(state);
        await sleep(SINGLE_POLL_MS);
      }
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, 'iteration failed');
      await sleep(10_000);
    }
  }
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : err }, 'fatal error');
  process.exit(1);
});
