/**
 * TradingView → TradeWorks Webhook Bridge
 * --------------------------------------
 * Reads pine_labels drawn by the APEX Webhook Bridge indicator on the user's
 * active chart via Chrome DevTools Protocol (port 9222) and POSTs each new
 * BUY/SELL label to the TradeWorks gateway webhook.
 *
 * This complements TradingView's server-side alert webhooks by letting the
 * user run real TradeVisor signals through the bot WITHOUT manually configuring
 * an alert per ticker. Whatever symbol the user has on their chart is what
 * gets monitored — switch tickers in TV, the bridge follows.
 *
 * REQUIRES: TradingView Desktop launched with --remote-debugging-port=9222
 * (use scripts/launch_tv_debug.bat or equivalent).
 */
import 'dotenv/config';
import { resolve } from 'path';
import pino from 'pino';
import { evaluate, disconnect } from './cdp.js';
import { loadState, saveState, key, type BridgeState } from './state.js';
import { postSignal, type WebhookSignal } from './webhook.js';

// ── Config ──────────────────────────────────────────────────────────────
const WEBHOOK_URL = process.env['TRADINGVIEW_WEBHOOK_URL'];
const POLL_INTERVAL_MS = Number(process.env['POLL_INTERVAL_MS'] ?? 30_000);
// The Pine indicator whose labels we read. Defaults to "APEX Webhook Bridge"
// because that's what the user has wired to draw "BUY B"/"SELL A" labels.
// To use TradeVisor V2 directly instead, point this at "Tradevisor V2" — but
// only if that script's signals are emitted as label.new() (they currently
// aren't; TradeVisor V2 uses alertcondition() + plotshape() which don't
// surface in pine_labels).
const INDICATOR_NAME = process.env['BRIDGE_INDICATOR_NAME'] ?? 'APEX Webhook Bridge';
const STATE_FILE = resolve(process.env['BRIDGE_STATE_FILE'] ?? './data/state.json');
const DRY_RUN = process.env['DRY_RUN'] === 'true';

const log = pino({
  // Pretty-print only when running interactively (TTY). Under pm2 the stdout
  // is piped, not a TTY — write plain JSON so pm2's log capture doesn't lose
  // anything to a transport worker.
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
// Mirrors the buildGraphicsJS pattern from tradingview-mcp/src/core/data.js
// so we don't need the MCP server running — we drive CDP directly.
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

// ── Signal classification ──────────────────────────────────────────────
// APEX Webhook Bridge labels look like "BUY B", "SELL A", "BUY A", "SELL B".
// Empirically: A-suffix is the higher-quality variant, B-suffix is standard.
// This matches TradeVisor's grade hierarchy where 5+/6 = strong, 4/6 = standard.
function classifyLabel(text: string): { action: 'buy' | 'sell'; grade: 'standard' | 'strong'; score: number } | null {
  const t = (text ?? '').trim().toUpperCase();
  if (!t) return null;
  const isBuy = t.startsWith('BUY');
  const isSell = t.startsWith('SELL');
  if (!isBuy && !isSell) return null;
  // Detect quality variant from trailing letter token. Default to standard.
  const isStrong = / A\b/.test(t);
  return {
    action: isBuy ? 'buy' : 'sell',
    grade: isStrong ? 'strong' : 'standard',
    score: isStrong ? 5 : 4,
  };
}

// Strip exchange prefix ("AMEX:SPY" → "SPY") to match the gateway's symbol shape.
function normalizeSymbol(rawSymbol: string): { symbol: string; exchange: string } {
  if (!rawSymbol) return { symbol: '', exchange: '' };
  const colonIdx = rawSymbol.indexOf(':');
  if (colonIdx === -1) return { symbol: rawSymbol.toUpperCase(), exchange: '' };
  return {
    symbol: rawSymbol.slice(colonIdx + 1).toUpperCase(),
    exchange: rawSymbol.slice(0, colonIdx).toUpperCase(),
  };
}

// ── Main poll loop ──────────────────────────────────────────────────────
async function poll(state: BridgeState): Promise<void> {
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

  // Sort by id ascending to fire in chronological order.
  const sorted = [...matched.items].sort((a, b) => a.id - b.id);
  const fresh = sorted.filter((l) => l.id > lastSeen);

  // First-run protection: if we've never tracked this symbol, capture the
  // current max id without firing — we don't want to replay the entire chart's
  // historical labels as fresh signals.
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
      log.debug({ text, id: lbl.id }, 'ignoring non-BUY/SELL label');
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
        // Don't update state on failure — retry on next tick.
        return;
      }
    }
    state.lastSeenIdByKey[k] = lbl.id;
    saveState(STATE_FILE, state);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const state = loadState(STATE_FILE);
  log.info(
    {
      webhookUrl: WEBHOOK_URL!.replace(/secret=[^&]+/, 'secret=***'),
      indicator: INDICATOR_NAME,
      pollMs: POLL_INTERVAL_MS,
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
      await poll(state);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, 'poll iteration failed');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : err }, 'fatal error');
  process.exit(1);
});
