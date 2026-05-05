/**
 * Vol-targeted portfolio sizing — turns a portfolio annualized-vol target
 * (default 14%) into per-strategy USD risk budgets.
 *
 * Hot-path consumers (Phase D2 sizing) call `getStrategyVolBudget(strategy)`
 * on every signal. We cache portfolio + strategy budgets in-memory for 15
 * minutes to avoid hammering the memory DB.
 *
 * Failure modes (all degrade gracefully — never throw to callers):
 *   - MEMORY_DB_URL unset           → return defaults (scalar=1, equal-budget)
 *   - < 30 days of P&L data         → realizedVol = target (scalar = 1.0)
 *   - per-strategy < 20 trades      → inherit portfolio realized vol
 *   - DB query throws               → log warn + return last cached values
 *                                     (or defaults if no cache yet)
 */

import { logger } from '../../lib/logger.js';
import { getPool } from '../memory/db.js';
import { getBanditWeight } from './bandit-runner.js';
import { KNOWN_STRATEGIES } from './bandit-types.js';
import type {
  DailyPnlBucket,
  PortfolioVolBudget,
  StrategyVolBudget,
  VolTargetConfig,
} from './vol-target-types.js';

// ── defaults ───────────────────────────────────────────────────────────

const DEFAULT_TARGET_VOL_PCT = 14;
const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_MIN_DAYS_FOR_VOL_CALC = 30;
const DEFAULT_MIN_TRADES_FOR_STRATEGY_VOL = 20;
const DEFAULT_SCALAR_MIN = 0.25;
const DEFAULT_SCALAR_MAX = 2.0;
const DEFAULT_TOTAL_EQUITY_USD = 100_000;
const TRADING_DAYS_PER_YEAR = 252;
const CACHE_TTL_MS = 15 * 60 * 1000;

// ── module state (cache) ───────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

let portfolioCache: CacheEntry<PortfolioVolBudget> | null = null;
const strategyCache = new Map<string, CacheEntry<StrategyVolBudget>>();

// ── public API ─────────────────────────────────────────────────────────

/**
 * Compute (or return cached) the portfolio-level vol budget. Cheap-cached for
 * 15 minutes. Never throws — degrades to defaults under any failure.
 */
export async function getPortfolioVolBudget(
  config: VolTargetConfig = {},
): Promise<PortfolioVolBudget> {
  const now = Date.now();
  if (portfolioCache && portfolioCache.expiresAt > now) {
    return portfolioCache.value;
  }

  const cfg = resolveConfig(config);
  const totalEquityUsd = cfg.totalEquityUsd;
  const targetVol = cfg.targetVolAnnualizedPct;

  let realizedVol = targetVol; // default = neutral (scalar = 1.0)

  try {
    const buckets = await fetchDailyPnl(cfg.lookbackDays);
    if (buckets.length >= cfg.minDaysForVolCalc) {
      const computed = computeAnnualizedVolPctFromDailyPnl(buckets, totalEquityUsd);
      if (Number.isFinite(computed) && computed > 0) {
        realizedVol = computed;
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[vol-target] portfolio realized-vol query failed — using defaults',
    );
    if (portfolioCache) return portfolioCache.value;
  }

  const scalar = clamp(targetVol / realizedVol, cfg.scalarMin, cfg.scalarMax);
  const budgetUsdAtFullSizing = totalEquityUsd * (targetVol / 100);

  const value: PortfolioVolBudget = {
    targetVolAnnualizedPct: targetVol,
    realizedVolAnnualizedPct: realizedVol,
    scalar,
    totalEquityUsd,
    budgetUsdAtFullSizing,
  };

  portfolioCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Compute (or return cached) the vol budget for one strategy. Falls back to
 * inheriting portfolio realized vol when the strategy has < 20 trades.
 */
export async function getStrategyVolBudget(
  strategy: string,
  config: VolTargetConfig = {},
): Promise<StrategyVolBudget> {
  const now = Date.now();
  const cached = strategyCache.get(strategy);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const cfg = resolveConfig(config);
  const portfolio = await getPortfolioVolBudget(config);
  const banditWeight = getBanditWeight(strategy);

  let realizedVol = portfolio.realizedVolAnnualizedPct;

  try {
    const buckets = await fetchDailyPnlForStrategy(strategy, cfg.lookbackDays);
    const tradeCount = await countStrategyTrades(strategy, cfg.lookbackDays);
    if (
      tradeCount >= cfg.minTradesForStrategyVolCalc &&
      buckets.length >= cfg.minDaysForVolCalc
    ) {
      const computed = computeAnnualizedVolPctFromDailyPnl(
        buckets,
        portfolio.totalEquityUsd,
      );
      if (Number.isFinite(computed) && computed > 0) {
        realizedVol = computed;
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, strategy },
      '[vol-target] strategy realized-vol query failed — inheriting portfolio vol',
    );
    if (cached) return cached.value;
  }

  const budgetUsd = Math.max(
    0,
    portfolio.budgetUsdAtFullSizing * banditWeight * portfolio.scalar,
  );

  const value: StrategyVolBudget = {
    strategy,
    banditWeight,
    realizedVolAnnualizedPct: realizedVol,
    budgetUsd,
  };

  strategyCache.set(strategy, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * Convenience — returns vol budgets for every known strategy.
 */
export async function getAllStrategyVolBudgets(
  config: VolTargetConfig = {},
): Promise<StrategyVolBudget[]> {
  const out: StrategyVolBudget[] = [];
  for (const s of KNOWN_STRATEGIES) {
    out.push(await getStrategyVolBudget(s, config));
  }
  return out;
}

/**
 * Test/admin helper — clears all cached values so the next call re-queries.
 */
export function clearVolTargetCache(): void {
  portfolioCache = null;
  strategyCache.clear();
}

/**
 * Pure helper — exposed for tests. Computes annualized vol percent from a
 * sequence of daily realized P&L buckets and a reference equity.
 *
 *   daily_return = pnl_usd / equity
 *   sigma_daily  = stddev(daily_returns)   (sample stddev, n-1)
 *   sigma_annual = sigma_daily * sqrt(252) * 100
 */
export function computeAnnualizedVolPctFromDailyPnl(
  buckets: DailyPnlBucket[],
  totalEquityUsd: number,
): number {
  if (buckets.length < 2 || totalEquityUsd <= 0) return 0;

  const returns: number[] = buckets.map((b) => b.realizedPnlUsd / totalEquityUsd);
  const mean = returns.reduce((a, x) => a + x, 0) / returns.length;
  let sqSum = 0;
  for (const r of returns) {
    const d = r - mean;
    sqSum += d * d;
  }
  // Sample stddev (n-1) — daily P&L is treated as a sample of the return-
  // generating process.
  const variance = sqSum / (returns.length - 1);
  const sigmaDaily = Math.sqrt(variance);
  return sigmaDaily * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

// ── internals ──────────────────────────────────────────────────────────

interface ResolvedConfig {
  targetVolAnnualizedPct: number;
  lookbackDays: number;
  minDaysForVolCalc: number;
  minTradesForStrategyVolCalc: number;
  scalarMin: number;
  scalarMax: number;
  totalEquityUsd: number;
}

function resolveConfig(config: VolTargetConfig): ResolvedConfig {
  const envEquity = process.env['PORTFOLIO_EQUITY_USD'];
  const envEquityNum = envEquity !== undefined ? Number(envEquity) : NaN;
  const envTarget = process.env['PORTFOLIO_VOL_TARGET_PCT'];
  const envTargetNum = envTarget !== undefined ? Number(envTarget) : NaN;

  return {
    targetVolAnnualizedPct:
      config.targetVolAnnualizedPct ??
      (Number.isFinite(envTargetNum) && envTargetNum > 0
        ? envTargetNum
        : DEFAULT_TARGET_VOL_PCT),
    lookbackDays: config.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    minDaysForVolCalc: config.minDaysForVolCalc ?? DEFAULT_MIN_DAYS_FOR_VOL_CALC,
    minTradesForStrategyVolCalc:
      config.minTradesForStrategyVolCalc ?? DEFAULT_MIN_TRADES_FOR_STRATEGY_VOL,
    scalarMin: config.scalarMin ?? DEFAULT_SCALAR_MIN,
    scalarMax: config.scalarMax ?? DEFAULT_SCALAR_MAX,
    totalEquityUsd:
      config.totalEquityUsd ??
      (Number.isFinite(envEquityNum) && envEquityNum > 0
        ? envEquityNum
        : DEFAULT_TOTAL_EQUITY_USD),
  };
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return 1;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Pull last `lookbackDays` of portfolio realized P&L grouped by UTC date.
 * Returns [] when DB is unavailable.
 */
async function fetchDailyPnl(lookbackDays: number): Promise<DailyPnlBucket[]> {
  const pool = getPool();
  if (!pool) return [];

  const rows = await pool.query<{ date: string; pnl: number | string }>(
    `
    SELECT
      to_char(date_trunc('day', closed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
      SUM(realized_pnl_usd) AS pnl
    FROM trade_outcomes
    WHERE closed_at >= NOW() - ($1::int * INTERVAL '1 day')
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [lookbackDays],
  );

  return rows.rows.map((r) => ({
    date: r.date,
    realizedPnlUsd: typeof r.pnl === 'string' ? parseFloat(r.pnl) : r.pnl,
  }));
}

/**
 * Pull last `lookbackDays` of realized P&L grouped by UTC date for one
 * strategy. Joins through `decisions.strategy`. Returns [] when DB unavailable.
 */
async function fetchDailyPnlForStrategy(
  strategy: string,
  lookbackDays: number,
): Promise<DailyPnlBucket[]> {
  const pool = getPool();
  if (!pool) return [];

  const rows = await pool.query<{ date: string; pnl: number | string }>(
    `
    SELECT
      to_char(date_trunc('day', o.closed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
      SUM(o.realized_pnl_usd) AS pnl
    FROM trade_outcomes o
    JOIN decisions d ON d.id = o.decision_id
    WHERE o.closed_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND d.strategy = $2
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    [lookbackDays, strategy],
  );

  return rows.rows.map((r) => ({
    date: r.date,
    realizedPnlUsd: typeof r.pnl === 'string' ? parseFloat(r.pnl) : r.pnl,
  }));
}

/**
 * Count closed trades for a strategy in the lookback window. Used to gate
 * the per-strategy realized-vol calc.
 */
async function countStrategyTrades(strategy: string, lookbackDays: number): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  const rows = await pool.query<{ n: number | string }>(
    `
    SELECT COUNT(*) AS n
    FROM trade_outcomes o
    JOIN decisions d ON d.id = o.decision_id
    WHERE o.closed_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND d.strategy = $2
    `,
    [lookbackDays, strategy],
  );

  const raw = rows.rows[0]?.n ?? 0;
  return typeof raw === 'string' ? parseInt(raw, 10) : raw;
}
