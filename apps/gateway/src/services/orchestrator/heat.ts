/**
 * Portfolio Heat Tracker.
 *
 * "Heat" = the dollar amount the portfolio would lose if every open position
 * hit its hard stop simultaneously. This module:
 *
 *   1. Enumerates open positions across all books (equity + options + CEX).
 *   2. Computes each position's risk dollars from `qty × |entry - stop|`.
 *   3. Aggregates risk by sector + factor.
 *   4. Compares to env-configurable budgets (total / sector / factor).
 *
 * The pre-trade gate (`checkHeatBudget`) is invoked from the TradeVisor
 * webhook AFTER agent approval but BEFORE executor dispatch. A budget breach
 * coerces the verdict to 'veto' so the offending signal never reaches the
 * paper or live ledger.
 *
 * Routes that surface this:
 *   GET /api/v1/heat            → current PortfolioHeat snapshot
 *   GET /api/v1/heat/positions  → flat OpenRiskItem[] for the cockpit UI
 */

import { logger } from '../../lib/logger.js';
import { getFactorMeta } from './factor-map.js';
import { getCurrentRegime, getHeatBudgetScalar } from './regime.js';
import type {
  HeatCheckResult,
  OpenRiskItem,
  PortfolioHeat,
} from './heat-types.js';
import type { RegimeTag } from './regime-types.js';

// ── Budgets ────────────────────────────────────────────────────────────

/**
 * Parse a percentage env var with a default fallback. Accepts values as
 * percent (e.g. "6" → 6%) and converts to a 0-1 fraction.
 */
function pctEnv(name: string, defaultPct: number): number {
  const raw = process.env[name];
  if (!raw) return defaultPct / 100;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      { name, raw, defaultPct },
      `[heat] invalid env var — falling back to default`,
    );
    return defaultPct / 100;
  }
  return parsed / 100;
}

function readBudgets(): {
  totalOpenRiskMaxPct: number;
  perSectorMaxPct: number;
  perFactorMaxPct: number;
} {
  return {
    totalOpenRiskMaxPct: pctEnv('HEAT_TOTAL_MAX_PCT', 6),
    perSectorMaxPct: pctEnv('HEAT_SECTOR_MAX_PCT', 2),
    perFactorMaxPct: pctEnv('HEAT_FACTOR_MAX_PCT', 3),
  };
}

// ── Cache ──────────────────────────────────────────────────────────────

interface HeatCache {
  computedAt: number;
  snapshot: PortfolioHeat;
  positions: OpenRiskItem[];
}

let cache: HeatCache | null = null;
const CACHE_TTL_MS = 60 * 1000;

/** Test-only: drop the cache so each test starts clean. */
export function _resetHeatCache(): void {
  cache = null;
}

/**
 * Test-only: warm the cache with a synthetic snapshot so `checkHeatBudget`
 * can be exercised against known-shape state without booting any ledgers.
 * The `positions` arg is optional — pass `[]` if your test doesn't care
 * about the flat list.
 */
export function _setHeatCacheForTests(snapshot: PortfolioHeat, positions: OpenRiskItem[] = []): void {
  cache = { computedAt: Date.now(), snapshot, positions };
}

// ── Position Enumeration ───────────────────────────────────────────────

/**
 * Default stop fallback when a position has no recorded stop price. Mirrors
 * the 5% flat fallback used by `sizing.ts::computePositionSize` so heat
 * estimates don't silently underestimate risk on legacy ledger rows.
 */
const FALLBACK_STOP_DISTANCE_PCT = 0.05;

/**
 * Compute risk dollars for a long position. For shorts and puts the maths
 * inverts (entry < stop) but we keep the absolute-value form so the result
 * is always non-negative.
 */
function computeRiskUsd(entryPrice: number, stopPrice: number, qty: number): number {
  if (entryPrice <= 0 || stopPrice <= 0 || qty <= 0) return 0;
  return Math.abs(entryPrice - stopPrice) * qty;
}

/**
 * Pull open equity positions from the stock-agent paper ledger. Loaded lazily
 * so this module stays importable even when the stock engine is disabled.
 */
async function getEquityOpenRisk(): Promise<OpenRiskItem[]> {
  try {
    const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
    const ledger = loadPaperLedger();
    const out: OpenRiskItem[] = [];
    for (const pos of ledger.equityPositions) {
      const stopPrice = pos.stopLossPrice && pos.stopLossPrice > 0
        ? pos.stopLossPrice
        : pos.entryPrice * (1 - FALLBACK_STOP_DISTANCE_PCT);
      const meta = getFactorMeta(pos.symbol);
      out.push({
        decisionId: pos.decisionId ?? pos.id,
        symbol: pos.symbol.toUpperCase(),
        side: 'buy',
        qty: pos.shares,
        entryPrice: pos.entryPrice,
        stopPrice,
        riskUsd: computeRiskUsd(pos.entryPrice, stopPrice, pos.shares),
        sector: meta.sector,
        factorTags: [...meta.factorTags],
      });
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[heat] failed to load equity ledger — treating as empty',
    );
    return [];
  }
}

/**
 * Pull open option positions. Each contract represents 100 underlying shares;
 * we use the option premium itself (mid × 100 × contracts) as the dollar risk
 * cap because long premium can go to zero. The hard stop on options is
 * `stopLossMid` (entryMid × 0.5 by default), so risk = |entryMid - stopMid| × 100 × contracts.
 *
 * Sector + factor classification uses the underlying ticker so a long AAPL
 * call counts toward Technology sector heat just like the underlying stock.
 */
async function getOptionsOpenRisk(): Promise<OpenRiskItem[]> {
  try {
    const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
    const ledger = loadPaperLedger();
    const out: OpenRiskItem[] = [];
    for (const pos of ledger.optionPositions) {
      const stopMid = pos.stopLossMid && pos.stopLossMid > 0
        ? pos.stopLossMid
        : pos.entryMid * 0.5;
      // Per-contract risk × contracts × 100 shares-per-contract.
      const riskUsd = Math.abs(pos.entryMid - stopMid) * pos.contracts * 100;
      const meta = getFactorMeta(pos.symbol);
      // Calls = long-side; puts = short-equivalent for sector exposure but we
      // record the literal trade direction so the cockpit UI can display it.
      const side: OpenRiskItem['side'] = pos.type === 'call' ? 'buy' : 'short';
      out.push({
        decisionId: pos.decisionId ?? pos.id,
        symbol: pos.symbol.toUpperCase(),
        side,
        qty: pos.contracts,
        entryPrice: pos.entryMid,
        stopPrice: stopMid,
        riskUsd,
        sector: meta.sector,
        factorTags: [...meta.factorTags],
      });
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[heat] failed to load options ledger — treating as empty',
    );
    return [];
  }
}

/**
 * Pull open CEX (crypto blue-chip) positions. Crypto positions live in a
 * separate paper portfolio inside the crypto-agent route file. They're NOT
 * factor-mapped (Bitcoin isn't a GICS sector) so they go to the 'Crypto'
 * synthetic bucket. This still feeds total heat — even though sector caps
 * don't bind on crypto, the total budget does.
 */
async function getCryptoOpenRisk(): Promise<OpenRiskItem[]> {
  try {
    const mod = await import('../../routes/crypto-agent.js');
    // The CEX portfolio accessor returns a snapshot with live prices, but
    // the module also exports executeCEXTradeFromTV which consumes positions
    // from the same in-memory map. We call getCEXPortfolio() so we don't
    // depend on private state.
    const cex = mod.getCEXPortfolio?.();
    if (!cex || !Array.isArray(cex.openPositions)) return [];

    const out: OpenRiskItem[] = [];
    for (const pos of cex.openPositions) {
      // Crypto positions don't carry a stop in the CEX portfolio (they're
      // managed by FreqTrade or per-symbol exit logic). Use the standard 5%
      // fallback so they still contribute reasonable heat estimates.
      const entry = pos.avgEntry ?? 0;
      const stop = entry * (1 - FALLBACK_STOP_DISTANCE_PCT);
      const qty = pos.qty ?? 0;
      const riskUsd = computeRiskUsd(entry, stop, qty);
      out.push({
        decisionId: pos.symbol, // crypto-agent CEX positions don't expose decisionId on the public surface
        symbol: pos.symbol.toUpperCase(),
        side: 'buy',
        qty,
        entryPrice: entry,
        stopPrice: stop,
        riskUsd,
        sector: 'Crypto',
        factorTags: ['high_beta'],
      });
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[heat] failed to load crypto positions — treating as empty',
    );
    return [];
  }
}

/**
 * Equity-only equity-USD basis. The stock-agent ledger tracks paper cash +
 * mark-to-market on open positions; for budget enforcement we use
 * `paperCashUsd + Σ(shares × entryPrice)` as a stable equity figure that
 * doesn't bounce on intraday quotes.
 */
async function getEquityUsd(): Promise<number> {
  try {
    const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
    const ledger = loadPaperLedger();
    const equityValue = ledger.equityPositions.reduce(
      (sum, p) => sum + p.shares * p.entryPrice,
      0,
    );
    const optionValue = ledger.optionPositions.reduce(
      (sum, p) => sum + p.contracts * p.entryMid * 100,
      0,
    );
    return ledger.paperCashUsd + equityValue + optionValue;
  } catch {
    // Fall back to a $10k assumption so budgets still produce sensible numbers
    // when the ledger isn't readable. This matches DEFAULT_PAPER_LEDGER.
    return 10_000;
  }
}

/** Flatten all books into a single OpenRiskItem[]. */
async function enumerateOpenRisk(): Promise<OpenRiskItem[]> {
  const [equity, options, crypto] = await Promise.all([
    getEquityOpenRisk(),
    getOptionsOpenRisk(),
    getCryptoOpenRisk(),
  ]);
  return [...equity, ...options, ...crypto];
}

// ── Aggregation ────────────────────────────────────────────────────────

/**
 * Aggregate a list of OpenRiskItems into a PortfolioHeat snapshot. Pure
 * function — no I/O, easy to unit-test against synthetic inputs.
 */
export function aggregateHeat(
  positions: OpenRiskItem[],
  totalEquityUsd: number,
): PortfolioHeat {
  const budgets = readBudgets();
  const safeEquity = totalEquityUsd > 0 ? totalEquityUsd : 1; // avoid div-by-zero

  const totalOpenRiskUsd = positions.reduce((sum, p) => sum + p.riskUsd, 0);
  const totalOpenRiskPct = totalOpenRiskUsd / safeEquity;

  const bySector: Record<string, { riskUsd: number; pct: number }> = {};
  const byFactor: Record<string, { riskUsd: number; pct: number }> = {};

  for (const pos of positions) {
    // Sector aggregation
    const s = pos.sector || 'Unknown';
    if (!bySector[s]) bySector[s] = { riskUsd: 0, pct: 0 };
    bySector[s].riskUsd += pos.riskUsd;

    // Factor aggregation — one position can have multiple tags, each tag gets
    // the *full* riskUsd (a $100-risk momentum-large_cap-growth position
    // contributes $100 to each of those three factor buckets).
    for (const tag of pos.factorTags) {
      if (!byFactor[tag]) byFactor[tag] = { riskUsd: 0, pct: 0 };
      byFactor[tag].riskUsd += pos.riskUsd;
    }
  }

  // Backfill pct now that totals are known.
  for (const k of Object.keys(bySector)) {
    bySector[k].pct = bySector[k].riskUsd / safeEquity;
  }
  for (const k of Object.keys(byFactor)) {
    byFactor[k].pct = byFactor[k].riskUsd / safeEquity;
  }

  // Worst-case sector + factor (highest utilization fraction).
  let worstSector = { sector: '', utilization: 0 };
  for (const [sector, agg] of Object.entries(bySector)) {
    const util = agg.pct / budgets.perSectorMaxPct;
    if (util > worstSector.utilization) {
      worstSector = { sector, utilization: util };
    }
  }
  let worstFactor = { factor: '', utilization: 0 };
  for (const [factor, agg] of Object.entries(byFactor)) {
    const util = agg.pct / budgets.perFactorMaxPct;
    if (util > worstFactor.utilization) {
      worstFactor = { factor, utilization: util };
    }
  }

  return {
    totalEquityUsd,
    totalOpenRiskUsd,
    totalOpenRiskPct,
    bySector,
    byFactor,
    budgets,
    utilization: {
      total: totalOpenRiskPct / budgets.totalOpenRiskMaxPct,
      worstSector,
      worstFactor,
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the current portfolio heat snapshot. 60-second cache: positions
 * don't change second-by-second and this can be called from both the
 * webhook hot-path and the cockpit UI without straining the ledger I/O.
 */
export async function getPortfolioHeat(): Promise<PortfolioHeat> {
  if (cache && Date.now() - cache.computedAt < CACHE_TTL_MS) {
    return cache.snapshot;
  }
  const [positions, totalEquityUsd] = await Promise.all([
    enumerateOpenRisk(),
    getEquityUsd(),
  ]);
  const snapshot = aggregateHeat(positions, totalEquityUsd);
  cache = { computedAt: Date.now(), snapshot, positions };
  return snapshot;
}

/** Same cache-aware flow as getPortfolioHeat but returns the flat positions list. */
export async function getOpenRiskPositions(): Promise<OpenRiskItem[]> {
  if (cache && Date.now() - cache.computedAt < CACHE_TTL_MS) {
    return cache.positions;
  }
  const [positions, totalEquityUsd] = await Promise.all([
    enumerateOpenRisk(),
    getEquityUsd(),
  ]);
  const snapshot = aggregateHeat(positions, totalEquityUsd);
  cache = { computedAt: Date.now(), snapshot, positions };
  return positions;
}

/**
 * Pre-trade gate. Returns `{ ok: true }` if adding `prospective` would keep
 * total / sector / factor heat under budget. Otherwise returns the offending
 * budget + cap so the caller can stamp the audit trail and veto.
 *
 * Usage from the TradeVisor webhook:
 *   const verdict = await checkHeatBudget({ symbol, riskUsd: sizing.recommendedRiskUsd });
 *   if (!verdict.ok) {
 *     decision.verdict = 'veto';
 *     decision.reasoning += ` | heat-veto: ${verdict.reason}`;
 *   }
 */
export async function checkHeatBudget(prospective: {
  symbol: string;
  riskUsd: number;
  sector?: string;
}): Promise<HeatCheckResult> {
  const riskUsd = Number(prospective.riskUsd);
  if (!Number.isFinite(riskUsd) || riskUsd <= 0) {
    // No risk implied → trivially OK. (e.g. zero-cost spreads, or callers
    // who didn't compute risk yet.) The downstream sizer will still cap.
    return { ok: true };
  }

  const heat = await getPortfolioHeat();

  // Regime-adjusted budgets: in volatile/crisis the heat budget compresses
  // by HEAT_REGIME_VOLATILE_SCALAR (default 0.6) so a 6% total cap becomes
  // 3.6% during crisis. Falls back gracefully when regime is unavailable.
  let regimeTag: RegimeTag = 'calm';
  try {
    const r = await getCurrentRegime();
    regimeTag = r.tag;
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[heat] regime unavailable for budget scaling — using 1.0',
    );
  }
  const scalar = getHeatBudgetScalar(regimeTag);
  const budgets = {
    totalOpenRiskMaxPct: heat.budgets.totalOpenRiskMaxPct * scalar,
    perSectorMaxPct: heat.budgets.perSectorMaxPct * scalar,
    perFactorMaxPct: heat.budgets.perFactorMaxPct * scalar,
  };
  const equity = heat.totalEquityUsd > 0 ? heat.totalEquityUsd : 1;

  // ── Total budget ──
  const projectedTotalUsd = heat.totalOpenRiskUsd + riskUsd;
  const projectedTotalPct = projectedTotalUsd / equity;
  if (projectedTotalPct > budgets.totalOpenRiskMaxPct) {
    return {
      ok: false,
      reason: `total open risk ${(projectedTotalPct * 100).toFixed(2)}% would exceed regime-adjusted cap ${(budgets.totalOpenRiskMaxPct * 100).toFixed(2)}% (regime=${regimeTag}, scalar=${scalar})`,
      offendingBudget: 'total',
      current: projectedTotalPct,
      cap: budgets.totalOpenRiskMaxPct,
    };
  }

  // ── Sector budget ──
  const meta = prospective.sector
    ? { sector: prospective.sector, factorTags: getFactorMeta(prospective.symbol).factorTags }
    : getFactorMeta(prospective.symbol);
  const sector = meta.sector;
  const sectorCurrentUsd = heat.bySector[sector]?.riskUsd ?? 0;
  const projectedSectorPct = (sectorCurrentUsd + riskUsd) / equity;
  if (projectedSectorPct > budgets.perSectorMaxPct) {
    return {
      ok: false,
      reason: `sector "${sector}" risk ${(projectedSectorPct * 100).toFixed(2)}% would exceed regime-adjusted cap ${(budgets.perSectorMaxPct * 100).toFixed(2)}% (regime=${regimeTag}, scalar=${scalar})`,
      offendingBudget: 'sector',
      current: projectedSectorPct,
      cap: budgets.perSectorMaxPct,
    };
  }

  // ── Factor budget ──
  for (const tag of meta.factorTags) {
    const factorCurrentUsd = heat.byFactor[tag]?.riskUsd ?? 0;
    const projectedFactorPct = (factorCurrentUsd + riskUsd) / equity;
    if (projectedFactorPct > budgets.perFactorMaxPct) {
      return {
        ok: false,
        reason: `factor "${tag}" risk ${(projectedFactorPct * 100).toFixed(2)}% would exceed regime-adjusted cap ${(budgets.perFactorMaxPct * 100).toFixed(2)}% (regime=${regimeTag}, scalar=${scalar})`,
        offendingBudget: 'factor',
        current: projectedFactorPct,
        cap: budgets.perFactorMaxPct,
      };
    }
  }

  return { ok: true };
}
