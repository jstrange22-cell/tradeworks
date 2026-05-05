/**
 * Market Regime Classifier — TS port of `research/research/lib/regimes.py`.
 *
 * One regime tag is produced per call (`calm` | `trending` | `volatile` |
 * `crisis`). The tag is consumed by:
 *
 *   - TradeVisor reasoner context (ai/tradevisor-agent/context.ts → ctx.macro.regime)
 *   - Bandit allocator (orchestrator/bandit-runner.ts → byRegime weights tag)
 *   - Sizing (D2)            → returns 0 qty when regime === 'crisis'
 *   - Heat tracker (D3)      → scales budget by HEAT_REGIME_VOLATILE_SCALAR
 *
 * Data flow (cold path, every 30 min):
 *
 *   1. Pull last ~250 SPY daily bars from Alpaca (already wired in stocks/).
 *   2. Pull current VIX level from Yahoo Finance v8 chart endpoint (free, no key).
 *   3. Pull BTC dominance from CoinGecko /global (free, no key, best-effort).
 *   4. Compute SMA(200), SMA(50), 20d return, 20d realised vol on SPY closes.
 *   5. Apply detection rules (most-restrictive first) → tag + confidence.
 *   6. Persist to data/last-regime.json so cold starts have a fallback.
 *
 * Failure modes:
 *   - Alpaca fails → fall back to last persisted regime if recent (< 12h);
 *     otherwise return 'calm' default with confidence 0.1 and warn-log.
 *   - VIX fetch fails → use VIX from last persisted regime if available;
 *     otherwise default to 18 (long-run median) and reduce confidence.
 *   - All fetches fail → 'calm' default, confidence 0.1.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../lib/logger.js';
import { emitAppEvent } from '../../lib/events-bus.js';
import type {
  LastRegimeFile,
  MarketRegime,
  RegimeSignals,
  RegimeTag,
} from './regime-types.js';

// ── Thresholds (mirrors regimes.py) ────────────────────────────────────

const VIX_CRISIS = 35.0;
const VIX_CRISIS_BELOW_MA = 25.0;
const VIX_VOLATILE = 22.0;
const TREND_RETURN_THRESHOLD = 0.03;
const CRISIS_DRAWDOWN_THRESHOLD = -0.10;
const VOLATILE_REALIZED_VOL_THRESHOLD = 0.25;
const SMA_LOOKBACK = 200;
const MOMENTUM_LOOKBACK = 20;

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;          // 30 min
const STALE_PERSIST_MAX_MS = 12 * 60 * 60_000; // 12 h

let memoryCache: { regime: MarketRegime; computedAt: number } | null = null;

// ── Path resolution (apps/gateway/data/last-regime.json) ───────────────

function lastRegimeFilePath(): string {
  // src/services/orchestrator/regime.ts → apps/gateway/data/last-regime.json
  const here = dirname(fileURLToPath(import.meta.url));
  const orchestrator = here;
  const services = dirname(orchestrator);
  const srcOrDist = dirname(services);
  const gatewayRoot = dirname(srcOrDist);
  return resolve(gatewayRoot, 'data', 'last-regime.json');
}

function loadPersisted(): LastRegimeFile | null {
  try {
    const path = lastRegimeFilePath();
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as LastRegimeFile;
    if (raw.schemaVersion !== 1 || !raw.regime) return null;
    return raw;
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[regime] failed to load persisted regime',
    );
    return null;
  }
}

function persist(regime: MarketRegime): void {
  try {
    const path = lastRegimeFilePath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file: LastRegimeFile = {
      schemaVersion: 1,
      regime,
      cachedAt: Date.now(),
    };
    writeFileSync(path, JSON.stringify(file, null, 2), 'utf8');
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[regime] failed to persist regime',
    );
  }
}

// ── Data fetchers ──────────────────────────────────────────────────────

interface SpyHistory {
  closes: number[];
  asOfIso: string;
}

async function fetchSpyHistory(targetDateIso?: string): Promise<SpyHistory | null> {
  // Alpaca getBars wants ~400 calendar days to reliably get 250 trading days.
  try {
    const { getBars } = await import('../stocks/alpaca-client.js');
    const end = targetDateIso ? new Date(targetDateIso) : new Date();
    const start = new Date(end.getTime() - 400 * 86_400_000);
    const resp = await getBars({
      symbols: ['SPY'],
      timeframe: '1Day',
      start: start.toISOString(),
      end: end.toISOString(),
      limit: 300,
    });
    const bars = resp.bars['SPY'];
    if (!bars || bars.length < SMA_LOOKBACK + MOMENTUM_LOOKBACK) {
      logger.debug({ returned: bars?.length ?? 0 }, '[regime] SPY history insufficient');
      return null;
    }
    return {
      closes: bars.map((b) => b.c),
      asOfIso: bars[bars.length - 1]!.t,
    };
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[regime] SPY fetch failed',
    );
    return null;
  }
}

/**
 * Fetch latest VIX close from Yahoo Finance v8 chart endpoint (free, no key).
 * Returns null on failure so the caller can fall back.
 */
async function fetchVix(): Promise<number | null> {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'tradeworks-regime/1.0' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: {
        result?: Array<{
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          meta?: { regularMarketPrice?: number };
        }>;
      };
    };
    const result = data.chart?.result?.[0];
    if (!result) return null;
    // Prefer the last non-null close from the quote array; fall back to meta.
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      if (typeof c === 'number' && Number.isFinite(c)) return c;
    }
    const meta = result.meta?.regularMarketPrice;
    if (typeof meta === 'number' && Number.isFinite(meta)) return meta;
    return null;
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[regime] VIX fetch failed',
    );
    return null;
  }
}

async function fetchBtcDominance(): Promise<number | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global', {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { market_cap_percentage?: { btc?: number } };
    };
    const dom = data.data?.market_cap_percentage?.btc;
    return typeof dom === 'number' && Number.isFinite(dom) ? dom : null;
  } catch {
    return null;
  }
}

async function fetchDxy(): Promise<number | null> {
  // DXY via Yahoo (DX-Y.NYB). Free but unreliable — best effort, never blocks.
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'tradeworks-regime/1.0' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
    };
    const px = data.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof px === 'number' && Number.isFinite(px) ? px : null;
  } catch {
    return null;
  }
}

// ── Math helpers ───────────────────────────────────────────────────────

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/**
 * Annualised realised volatility from `lookback` daily closes.
 * stddev of daily log returns × sqrt(252).
 */
function realizedVolAnnualized(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) return 0;
  const window = closes.slice(-(lookback + 1));
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!;
    const curr = window[i]!;
    if (prev > 0 && curr > 0) {
      rets.push(Math.log(curr / prev));
    }
  }
  if (rets.length < 2) return 0;
  const mean = average(rets);
  let sumSq = 0;
  for (const r of rets) sumSq += (r - mean) * (r - mean);
  const variance = sumSq / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ── Classification ─────────────────────────────────────────────────────

/**
 * Apply the detection rules (most restrictive first) and produce a tag +
 * confidence score in [0, 1]. Confidence is computed from how decisively
 * the dominant rule's threshold was crossed.
 *
 * Exposed for testing — accepts already-computed signals so tests don't
 * need to mock fetchers.
 */
export function classify(signals: RegimeSignals): { tag: RegimeTag; confidence: number; rationale: string } {
  const above200 = signals.spyClose > signals.spy200ma;
  const ret20Abs = Math.abs(signals.spy20dReturn);

  // ── Crisis ─────────────────────────────────────────────────────────
  // Three independent ways in. Take whichever fires *most* decisively.
  const crisisCandidates: Array<{ confidence: number; reason: string }> = [];

  if (signals.vix > VIX_CRISIS) {
    // VIX 35 → 0.6, VIX 50 → 1.0
    const conf = clampUnit(0.6 + (signals.vix - VIX_CRISIS) / 30);
    crisisCandidates.push({
      confidence: conf,
      reason: `VIX ${signals.vix.toFixed(1)} > ${VIX_CRISIS}`,
    });
  }
  if (!above200 && signals.vix > VIX_CRISIS_BELOW_MA) {
    // Both conditions binary; confidence = how far over VIX 25 we are.
    const conf = clampUnit(0.55 + (signals.vix - VIX_CRISIS_BELOW_MA) / 30);
    crisisCandidates.push({
      confidence: conf,
      reason: `SPY < 200 MA AND VIX ${signals.vix.toFixed(1)} > ${VIX_CRISIS_BELOW_MA}`,
    });
  }
  if (signals.spy20dReturn < CRISIS_DRAWDOWN_THRESHOLD) {
    // 20d return -10% → 0.6, -20% → 0.95
    const conf = clampUnit(0.6 + (CRISIS_DRAWDOWN_THRESHOLD - signals.spy20dReturn) * 3.5);
    crisisCandidates.push({
      confidence: conf,
      reason: `SPY 20d return ${(signals.spy20dReturn * 100).toFixed(1)}% < ${CRISIS_DRAWDOWN_THRESHOLD * 100}%`,
    });
  }
  if (crisisCandidates.length > 0) {
    const best = crisisCandidates.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    return {
      tag: 'crisis',
      confidence: best.confidence,
      rationale: `${best.reason} → crisis`,
    };
  }

  // ── Volatile ───────────────────────────────────────────────────────
  if (signals.vix > VIX_VOLATILE) {
    // VIX 22 → 0.5, VIX 30 → 0.85
    const conf = clampUnit(0.5 + (signals.vix - VIX_VOLATILE) / 16);
    return {
      tag: 'volatile',
      confidence: conf,
      rationale: `VIX ${signals.vix.toFixed(1)} > ${VIX_VOLATILE} → volatile`,
    };
  }
  if (signals.spy20dRealizedVol > VOLATILE_REALIZED_VOL_THRESHOLD) {
    // realized vol 25% → 0.55, 40% → 0.9
    const conf = clampUnit(
      0.55 + (signals.spy20dRealizedVol - VOLATILE_REALIZED_VOL_THRESHOLD) * 2.5,
    );
    return {
      tag: 'volatile',
      confidence: conf,
      rationale: `SPY 20d realized vol ${(signals.spy20dRealizedVol * 100).toFixed(1)}% > ${VOLATILE_REALIZED_VOL_THRESHOLD * 100}% → volatile`,
    };
  }

  // ── Trending ───────────────────────────────────────────────────────
  if (above200 && ret20Abs > TREND_RETURN_THRESHOLD && signals.vix < VIX_VOLATILE) {
    // |ret| 3% → 0.55, 8% → 0.9. Tighter VIX = more confident.
    const retConf = 0.5 + (ret20Abs - TREND_RETURN_THRESHOLD) * 8;
    const vixConf = (VIX_VOLATILE - signals.vix) / VIX_VOLATILE; // 0..1
    const conf = clampUnit((retConf + vixConf) / 2);
    return {
      tag: 'trending',
      confidence: conf,
      rationale: `SPY > 200 MA + 20d ret ${(signals.spy20dReturn * 100).toFixed(1)}% + VIX ${signals.vix.toFixed(1)} → trending`,
    };
  }

  // ── Calm (default) ─────────────────────────────────────────────────
  // Confidence reflects how clearly we're NOT near any boundary.
  const distToVixVol = Math.max(0, VIX_VOLATILE - signals.vix);
  const distToTrend = Math.max(0, TREND_RETURN_THRESHOLD - ret20Abs);
  const conf = clampUnit(0.4 + Math.min(distToVixVol / 22, 1) * 0.3 + Math.min(distToTrend * 30, 1) * 0.3);
  return {
    tag: 'calm',
    confidence: conf,
    rationale: `VIX ${signals.vix.toFixed(1)} + 20d ret ${(signals.spy20dReturn * 100).toFixed(1)}% (no rule fired) → calm`,
  };
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Compute (or return cached) market regime. Cached for 30 min in-memory.
 *
 * On cold start with no internet:
 *   - Tries the persisted last-regime.json (if < 12h old).
 *   - Otherwise returns 'calm' default with confidence 0.1.
 */
export async function getCurrentRegime(): Promise<MarketRegime> {
  if (memoryCache && Date.now() - memoryCache.computedAt < CACHE_TTL_MS) {
    return memoryCache.regime;
  }

  const persisted = loadPersisted();

  // Fetch SPY history (the one indispensable input).
  const history = await fetchSpyHistory();

  if (!history) {
    // No SPY data — try persisted, else default-calm.
    if (persisted && Date.now() - persisted.cachedAt < STALE_PERSIST_MAX_MS) {
      logger.warn(
        { cachedAt: new Date(persisted.cachedAt).toISOString() },
        '[regime] SPY fetch failed; serving last persisted regime',
      );
      memoryCache = { regime: persisted.regime, computedAt: Date.now() };
      return persisted.regime;
    }
    logger.warn('[regime] SPY unavailable + no recent persisted snapshot — default calm');
    const fallback: MarketRegime = {
      tag: 'calm',
      confidence: 0.1,
      asOf: new Date().toISOString(),
      signals: defaultSignals(),
      rationale: 'no SPY data available — default calm (low confidence)',
    };
    memoryCache = { regime: fallback, computedAt: Date.now() };
    return fallback;
  }

  // Fetch supplementary signals in parallel — never blocks classification.
  const [vixFetched, btcDominance, dxy] = await Promise.all([
    fetchVix(),
    fetchBtcDominance(),
    fetchDxy(),
  ]);

  // VIX fallback: persisted last-regime.signals.vix → long-run median 18.
  let vix = vixFetched;
  let vixIsFallback = false;
  if (vix === null) {
    if (persisted) {
      vix = persisted.regime.signals.vix;
      vixIsFallback = true;
      logger.warn({ vix }, '[regime] VIX fetch failed; using last persisted');
    } else {
      vix = 18;
      vixIsFallback = true;
      logger.warn('[regime] VIX fetch failed + no persisted history; using 18 (long-run median)');
    }
  }

  const closes = history.closes;
  const last = closes[closes.length - 1] ?? 0;
  const sma200 = average(closes.slice(-SMA_LOOKBACK));
  const sma50 = average(closes.slice(-50));
  const close20Ago = closes[closes.length - 1 - MOMENTUM_LOOKBACK] ?? last;
  const ret20 = close20Ago > 0 ? (last - close20Ago) / close20Ago : 0;
  const realizedVol = realizedVolAnnualized(closes, MOMENTUM_LOOKBACK);

  const signals: RegimeSignals = {
    spyClose: last,
    spy200ma: sma200,
    spy50ma: sma50,
    vix,
    btcDominance,
    dxy,
    spy20dReturn: ret20,
    spy20dRealizedVol: realizedVol,
  };

  const cls = classify(signals);
  // If VIX was a fallback, halve confidence — we don't really know.
  const confidence = vixIsFallback ? cls.confidence * 0.5 : cls.confidence;

  const regime: MarketRegime = {
    tag: cls.tag,
    confidence,
    asOf: new Date().toISOString(),
    signals,
    rationale: vixIsFallback ? `${cls.rationale} (VIX fallback)` : cls.rationale,
  };

  // Diff against the previous regime tag so we only fan out on actual
  // transitions. The 30-min recompute cadence would otherwise spam the
  // dashboard with no-op `regime-changed` events.
  const prevTag = memoryCache?.regime.tag ?? null;
  memoryCache = { regime, computedAt: Date.now() };
  persist(regime);

  logger.info(
    {
      tag: regime.tag,
      confidence: +regime.confidence.toFixed(2),
      vix: +vix.toFixed(2),
      ret20: +(ret20 * 100).toFixed(2),
      realizedVol: +(realizedVol * 100).toFixed(2),
    },
    `[regime] ${regime.tag} (${regime.rationale})`,
  );

  // Only emit when the tag flipped — confidence drift alone shouldn't kick
  // every dashboard into a refetch storm. Cockpit's RegimePill polls every
  // 30s as a fallback so the card still reflects confidence changes.
  if (prevTag !== regime.tag) {
    emitAppEvent('regime-changed', { regime });
  }

  return regime;
}

/**
 * Backtest helper: classify the regime as it would have been on a given date.
 * Cache is bypassed; result is NOT persisted (so we don't pollute live cache).
 */
export async function getRegimeForDate(date: string): Promise<MarketRegime> {
  const targetIso = new Date(date).toISOString();
  const history = await fetchSpyHistory(targetIso);
  if (!history || history.closes.length < SMA_LOOKBACK + MOMENTUM_LOOKBACK) {
    return {
      tag: 'calm',
      confidence: 0.1,
      asOf: targetIso,
      signals: defaultSignals(),
      rationale: `insufficient SPY history through ${date} — default calm`,
    };
  }

  // For backtest, we don't have historical VIX feed wired (free APIs are
  // present-day only). Use long-run median 18 unless caller plumbs VIX.
  const vix = 18;
  const closes = history.closes;
  const last = closes[closes.length - 1] ?? 0;
  const sma200 = average(closes.slice(-SMA_LOOKBACK));
  const sma50 = average(closes.slice(-50));
  const close20Ago = closes[closes.length - 1 - MOMENTUM_LOOKBACK] ?? last;
  const ret20 = close20Ago > 0 ? (last - close20Ago) / close20Ago : 0;
  const realizedVol = realizedVolAnnualized(closes, MOMENTUM_LOOKBACK);

  const signals: RegimeSignals = {
    spyClose: last,
    spy200ma: sma200,
    spy50ma: sma50,
    vix,
    btcDominance: null,
    dxy: null,
    spy20dReturn: ret20,
    spy20dRealizedVol: realizedVol,
  };

  const cls = classify(signals);
  return {
    tag: cls.tag,
    confidence: cls.confidence * 0.5, // halve — VIX is a placeholder
    asOf: history.asOfIso,
    signals,
    rationale: `${cls.rationale} (backtest, VIX placeholder=18)`,
  };
}

function defaultSignals(): RegimeSignals {
  return {
    spyClose: 0,
    spy200ma: 0,
    spy50ma: 0,
    vix: 18,
    btcDominance: null,
    dxy: null,
    spy20dReturn: 0,
    spy20dRealizedVol: 0,
  };
}

// ── Heat / sizing helpers ──────────────────────────────────────────────

/**
 * Heat-budget multiplier for the D3 portfolio-heat tracker.
 *
 *   regime === 'volatile' || 'crisis'   → HEAT_REGIME_VOLATILE_SCALAR (default 0.6)
 *   otherwise                           → 1.0
 *
 * E.g. with the default total open-risk cap of 6%, in `crisis` the effective
 * cap becomes 6% × 0.6 = 3.6%.
 */
export function getHeatBudgetScalar(tag: RegimeTag): number {
  if (tag === 'volatile' || tag === 'crisis') {
    const raw = process.env['HEAT_REGIME_VOLATILE_SCALAR'];
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
      return parsed;
    }
    return 0.6;
  }
  return 1.0;
}

/**
 * Hard regime gate for D2 sizing: crisis means do not open new trades.
 * Returns true when the sizing module should refuse a new entry.
 */
export function isCrisisGate(tag: RegimeTag): boolean {
  return tag === 'crisis';
}

/**
 * Synchronous accessor for the *currently cached* regime. Returns null if
 * `getCurrentRegime()` has never been called this process. Hot-path-safe
 * (e.g. for sync sizing functions that can't await).
 *
 * Sizing pattern:
 *   const cached = getCachedRegime();
 *   if (cached && isCrisisGate(cached.tag)) return { shares: 0 };
 */
export function getCachedRegime(): MarketRegime | null {
  return memoryCache?.regime ?? null;
}

/**
 * Test-only helper: clear in-memory cache so a fresh fetch happens. Real
 * callers should never need this (TTL handles it).
 */
export function _resetRegimeCacheForTests(): void {
  memoryCache = null;
}
