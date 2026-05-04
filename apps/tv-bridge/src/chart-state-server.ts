/**
 * tv-bridge HTTP server — exposes the current TradingView chart state to the
 * gateway's reasoning agent.
 *
 * Why this exists: the TradingView MCP runs in a Claude Code session, NOT in
 * the gateway process. Without this bridge, the reasoner can't see chart
 * state at signal time. This adds a thin HTTP wrapper around the same CDP
 * Runtime.evaluate calls the bridge already uses for label reading.
 *
 * Bound to localhost only by default. Gateway tunnels via SSH if running
 * on the VPS, or hits localhost directly if running on the same machine.
 *
 *   GET /chart-state?symbol=AAPL    — switch chart to symbol, return state
 *   GET /chart-state                — return state of currently-loaded chart
 *   GET /health                     — alive check
 */
import { createServer } from 'http';
import type { Logger } from 'pino';
import { evaluate } from './cdp.js';

const PORT = Number(process.env['BRIDGE_HTTP_PORT'] ?? 9223);
const HOST = process.env['BRIDGE_HTTP_HOST'] ?? '127.0.0.1';

interface StudyValue {
  name: string;
  values: Record<string, string | number>;
}

interface ChartStateResponse {
  symbol: string;
  resolution: string;
  studies: StudyValue[];
  pineLines: number[];
  pineLabels: Array<{ text: string; price: number }>;
  timestamp: string;
  error?: string;
}

function buildChartStateJS(): string {
  return `
    (function() {
      try {
        var w = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
        var model = w.model();
        var sources = model.model().dataSources();
        var seriesId = '_seriesId';
        var seriesSource = sources.find(function(s){return s.id && s.id() === seriesId;});
        var symbolInfo = seriesSource && seriesSource.symbolInfo ? seriesSource.symbolInfo() : null;
        var symbol = symbolInfo ? (symbolInfo.full_name || symbolInfo.name || '') : '';
        var resolution = (w.activeResolution && w.activeResolution()) || '';
        if (!resolution) {
          try { resolution = model.model().mainSeries().properties().interval.value(); } catch(e) {}
        }
        // Studies + their visible values from the data window.
        var studies = [];
        for (var si = 0; si < sources.length; si++) {
          var s = sources[si];
          if (!s.metaInfo || !s._graphics) continue;
          try {
            var meta = s.metaInfo();
            var name = meta.description || meta.shortDescription || '';
            if (!name) continue;
            var values = {};
            // Try _lastValues if present (set by the data window)
            if (s._lastValues) {
              for (var k in s._lastValues) {
                if (Object.prototype.hasOwnProperty.call(s._lastValues, k)) {
                  values[k] = s._lastValues[k];
                }
              }
            }
            studies.push({ name: name, values: values });
          } catch(e) {}
        }
        // Pine lines (horizontal price levels) — dedup + sort
        var pineLines = [];
        var seenLines = {};
        for (var li = 0; li < sources.length; li++) {
          var ls = sources[li];
          var lg = ls && ls._graphics && ls._graphics._primitivesCollection;
          if (!lg || !lg.dwglines) continue;
          try {
            var lineColl = lg.dwglines.get('lines');
            if (!lineColl) continue;
            var lc = lineColl.get(false);
            if (!lc || !lc._primitivesDataById) continue;
            lc._primitivesDataById.forEach(function(v) {
              var y = v && v.y;
              if (typeof y === 'number' && !seenLines[y]) {
                seenLines[y] = true;
                pineLines.push(Math.round(y * 100) / 100);
              }
            });
          } catch(e) {}
        }
        pineLines.sort(function(a, b) { return b - a; });
        // Pine labels (text+price markers) — last 10
        var pineLabels = [];
        for (var lbi = 0; lbi < sources.length; lbi++) {
          var lbs = sources[lbi];
          var lbg = lbs && lbs._graphics && lbs._graphics._primitivesCollection;
          if (!lbg || !lbg.dwglabels) continue;
          try {
            var lblColl = lbg.dwglabels.get('labels');
            if (!lblColl) continue;
            var bc = lblColl.get(false);
            if (!bc || !bc._primitivesDataById) continue;
            var entries = [];
            bc._primitivesDataById.forEach(function(v, id) {
              if (v && v.t && typeof v.y === 'number') {
                entries.push({ id: id, text: String(v.t), price: Math.round(v.y * 100) / 100 });
              }
            });
            entries.sort(function(a, b) { return a.id - b.id; });
            entries = entries.slice(-10);
            for (var ei = 0; ei < entries.length; ei++) {
              pineLabels.push({ text: entries[ei].text, price: entries[ei].price });
            }
          } catch(e) {}
        }
        return { symbol: symbol, resolution: String(resolution || ''), studies: studies, pineLines: pineLines, pineLabels: pineLabels };
      } catch(e) {
        return { error: (e && e.message) ? e.message : String(e) };
      }
    })()
  `;
}

function buildSetSymbolJS(symbol: string): string {
  return `
    (function() {
      try {
        var w = window.TradingViewApi._activeChartWidgetWV.value();
        if (!w || !w._chartWidget) return { ok: false, error: 'no chart' };
        if (typeof w._chartWidget.setSymbol === 'function') {
          w._chartWidget.setSymbol(${JSON.stringify(symbol)});
          return { ok: true };
        }
        var cwc = window.TradingViewApi._chartWidgetCollection;
        if (cwc && typeof cwc.setSymbol === 'function') {
          cwc.setSymbol(${JSON.stringify(symbol)});
          return { ok: true };
        }
        return { ok: false, error: 'no setSymbol' };
      } catch(e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
    })()
  `;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function startChartStateServer(log: Logger): void {
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'no url' }));
        return;
      }
      const url = new URL(req.url, `http://${HOST}:${PORT}`);
      if (url.pathname === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
        return;
      }
      if (url.pathname === '/chart-state') {
        const targetSymbol = url.searchParams.get('symbol');
        // If the caller asked for a specific symbol, switch to it first.
        if (targetSymbol) {
          await evaluate<{ ok: boolean; error?: string }>(buildSetSymbolJS(targetSymbol));
          // Wait for chart load + indicator recompute. 5s matches the bridge's
          // existing rotation SETTLE_MS.
          await sleep(5000);
        }
        const state = await evaluate<ChartStateResponse>(buildChartStateJS());
        state.timestamp = new Date().toISOString();
        res.writeHead(200);
        res.end(JSON.stringify({ data: state }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'chart-state HTTP error');
      res.writeHead(500);
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });
  server.listen(PORT, HOST, () => {
    log.info({ host: HOST, port: PORT }, 'chart-state HTTP server listening');
  });
}
