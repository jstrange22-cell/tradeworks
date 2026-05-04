/**
 * Context gathering for the TradeVisor reasoning agent.
 *
 * Pulls all the data the reasoner needs in parallel — chart state from TV
 * MCP, news headlines from Finnhub, portfolio snapshot from the in-memory
 * stock-agent ledger, scout watchlist position, and macro regime.
 *
 * Each gatherer is fault-tolerant: a failure returns null/empty for that
 * slice so the reasoner can still decide on partial information. This is
 * deliberate — we don't want a Finnhub outage to silently veto every signal.
 */
import { logger } from '../../../lib/logger.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getSector } from '../../stock-intelligence/sector-map.js';
import type {
  IncomingSignal,
  SignalContext,
  ChartContext,
  NewsHeadline,
  PortfolioSnapshot,
  ScoutContext,
  MacroContext,
} from './types.js';

// ── News (Finnhub) ─────────────────────────────────────────────────────
async function fetchNews(symbol: string): Promise<NewsHeadline[]> {
  const apiKey = process.env['FINNHUB_API_KEY'];
  if (!apiKey) return [];
  const today = new Date();
  const from = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from.toISOString().slice(0, 10)}&to=${today.toISOString().slice(0, 10)}&token=${apiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return [];
    const arr = (await res.json()) as Array<{
      datetime: number;
      headline?: string;
      summary?: string;
      source?: string;
    }>;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((n) => typeof n.headline === 'string' && n.headline.length > 0)
      .slice(0, 5)
      .map((n) => ({
        datetime: n.datetime ?? 0,
        headline: (n.headline ?? '').slice(0, 200),
        summary: (n.summary ?? '').slice(0, 300),
        source: n.source ?? '',
        ageHours: Math.max(0, (Date.now() / 1000 - (n.datetime ?? 0)) / 3600),
      }));
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err, symbol }, '[TVAgent] news fetch failed');
    return [];
  }
}

// ── Portfolio ──────────────────────────────────────────────────────────
async function fetchPortfolio(targetSymbol: string): Promise<PortfolioSnapshot> {
  // Direct in-memory access via the stock-agent's ledger module — avoids an
  // HTTP round-trip back to ourselves.
  try {
    const orchestrator = await import('../../stock-intelligence/stock-orchestrator.js');
    const ledger = orchestrator.loadPaperLedger();
    const positions = ledger.equityPositions ?? [];
    const sectorCount: Record<string, number> = {};
    for (const p of positions) {
      const sector = getSector(p.symbol);
      sectorCount[sector] = (sectorCount[sector] ?? 0) + 1;
    }
    return {
      cashUsd: ledger.paperCashUsd ?? 0,
      equityPositions: positions.map((p) => ({
        symbol: p.symbol,
        shares: p.shares,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice ?? p.entryPrice,
        unrealizedPnl: ((p.currentPrice ?? p.entryPrice) - p.entryPrice) * p.shares,
        sector: getSector(p.symbol),
      })),
      totalPositions: positions.length,
      maxPositions: 10,
      sectorCount,
      sectorCap: 2,
      alreadyHolding: positions.some((p) => p.symbol === targetSymbol),
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[TVAgent] portfolio fetch failed');
    return {
      cashUsd: 0,
      equityPositions: [],
      totalPositions: 0,
      maxPositions: 10,
      sectorCount: {},
      sectorCap: 2,
      alreadyHolding: false,
    };
  }
}

// ── Scout (watchlist position) ─────────────────────────────────────────
const SCOUT_FILE = resolve(process.env['SCOUT_WATCHLIST_FILE'] ?? './apps/scout/data/watchlist.json');

function fetchScout(symbol: string): ScoutContext | null {
  if (!existsSync(SCOUT_FILE)) return null;
  try {
    const wl = JSON.parse(readFileSync(SCOUT_FILE, 'utf8')) as {
      refreshSource: 'deterministic' | 'claude-reranked';
      rationale?: string;
      entries: Array<{
        ticker: string;
        kind: 'stock' | 'crypto';
        score?: number;
        rs5d?: number;
        rs20d?: number;
        atrExpansion?: number;
        reason?: string;
      }>;
    };
    const stocks = wl.entries.filter((e) => e.kind === 'stock');
    const idx = stocks.findIndex((e) => e.ticker.toUpperCase() === symbol.toUpperCase());
    if (idx === -1) return null;
    const entry = stocks[idx]!;
    return {
      rank: idx + 1,
      totalStocks: stocks.length,
      rs5d: entry.rs5d ?? 0,
      rs20d: entry.rs20d ?? 0,
      atrExpansion: entry.atrExpansion ?? 1,
      reason: entry.reason ?? '',
      refreshSource: wl.refreshSource,
      rationale: wl.rationale ?? '',
    };
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, '[TVAgent] scout fetch failed');
    return null;
  }
}

// ── Macro regime ───────────────────────────────────────────────────────
async function fetchMacro(): Promise<MacroContext> {
  // Reuse existing macro-regime service when available; otherwise derive from
  // SPY's scout entry (which we already have RS data for).
  try {
    const macroSvc = await import('../macro-regime.js');
    if (typeof macroSvc.getMacroRegime === 'function') {
      const r = await macroSvc.getMacroRegime();
      const regime = (r?.regime ?? 'unknown').toString().toLowerCase();
      return {
        regime: regime.includes('risk-on') ? 'risk-on'
              : regime.includes('risk-off') ? 'risk-off'
              : regime.includes('transition') ? 'transitioning'
              : regime.includes('crisis') ? 'crisis'
              : 'unknown',
        spyRs5d: 0,
        spyRs20d: 0,
        notes: r?.summary ?? '',
      };
    }
  } catch { /* fallthrough */ }

  // Fallback: derive from scout's SPY entry
  const spy = fetchScout('SPY');
  if (spy) {
    const regime = spy.rs20d < -0.05 ? 'risk-off' : spy.rs20d > 0.05 ? 'risk-on' : 'transitioning';
    return {
      regime,
      spyRs5d: spy.rs5d,
      spyRs20d: spy.rs20d,
      notes: `derived from SPY rs20d=${(spy.rs20d * 100).toFixed(1)}%`,
    };
  }
  return { regime: 'unknown', spyRs5d: 0, spyRs20d: 0, notes: 'no macro source available' };
}

// ── Chart state via tv-bridge HTTP endpoint ───────────────────────────
// The TV MCP runs in the user's local Claude Code session, NOT in the
// gateway process. So tv-bridge exposes a small HTTP server (chart-state-
// server.ts) that the agent calls to get live chart state on demand.
//
// CHART_STATE_URL points at that endpoint. If TV/the bridge is offline,
// fetch fails fast and the reasoner just operates without chart context
// (it'll downweight the decision but still proceed via SOUL guidance).
async function fetchChart(symbol: string): Promise<ChartContext | null> {
  const baseUrl = process.env['CHART_STATE_URL'];
  if (!baseUrl) return null;
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/chart-state?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { symbol?: string; resolution?: string; studies?: Array<{ name: string; values: Record<string, string | number> }>; pineLines?: number[]; pineLabels?: Array<{ text: string; price: number }>; error?: string } };
    if (!json.data || json.data.error) return null;
    const studyValues: Record<string, string | number> = {};
    for (const s of json.data.studies ?? []) {
      for (const [k, v] of Object.entries(s.values ?? {})) {
        studyValues[`${s.name}.${k}`] = v;
      }
    }
    return {
      matchedSymbol: json.data.symbol ?? symbol,
      resolution: json.data.resolution ?? '',
      studyValues,
      pineLabels: json.data.pineLabels ?? [],
      pineLines: json.data.pineLines ?? [],
    };
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err, symbol }, '[TVAgent] chart-state fetch failed');
    return null;
  }
}

// ── Daily P&L vs limits ────────────────────────────────────────────────
async function fetchDailyPnl(): Promise<{ pct: number; limitPct: number; remaining: number }> {
  // Read from stock-orchestrator's stats. Fallback to zero if unavailable.
  try {
    const orchestrator = await import('../../stock-intelligence/stock-orchestrator.js');
    const ledger = orchestrator.loadPaperLedger();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayClosed = (ledger.equityClosed ?? []).filter((t) => {
      const closed = new Date(t.exitAt);
      return closed >= startOfDay;
    });
    const realizedToday = todayClosed.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
    const startEquity = (ledger.paperCashUsd ?? 0) + 0; // approximation; perfect would be SoD snapshot
    const pct = startEquity > 0 ? (realizedToday / startEquity) * 100 : 0;
    const limitPct = -3.0; // SOUL.md "Daily loss limit: 3.0% of portfolio"
    return { pct, limitPct, remaining: Math.max(0, Math.abs(limitPct) - Math.abs(Math.min(0, pct))) };
  } catch {
    return { pct: 0, limitPct: -3.0, remaining: 3.0 };
  }
}

// ── Main entry: gather everything in parallel ──────────────────────────
export async function gatherContext(signal: IncomingSignal): Promise<SignalContext> {
  const startedAt = Date.now();
  const [chart, news, portfolio, macro, dailyPnl] = await Promise.all([
    fetchChart(signal.symbol),
    fetchNews(signal.symbol),
    fetchPortfolio(signal.symbol),
    fetchMacro(),
    fetchDailyPnl(),
  ]);
  const scout = fetchScout(signal.symbol); // sync file read, no await needed
  const elapsedMs = Date.now() - startedAt;
  logger.debug(
    { symbol: signal.symbol, elapsedMs, news: news.length, scoutRank: scout?.rank },
    '[TVAgent] context gathered',
  );
  return { signal, chart, news, portfolio, scout, macro, dailyPnl };
}
