/**
 * Bandit runner — wires the pure `computeWeights()` math to:
 *   - the memory module (decisions x trade_outcomes join, last 90d)
 *   - the on-disk weights file (`apps/gateway/data/bandit-weights.json`)
 *   - the public `getBanditWeight(strategy)` accessor used by Phase D sizing
 *   - cron + boot triggers
 *
 * Failure modes:
 *   - MEMORY_DB_URL unset           → degrade to equal weights, log warn
 *   - weights file missing on boot  → cold-start, write equal weights
 *   - recompute called within 1 hr  → skipped (rate-limited)
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../lib/logger.js';
import { emitAppEvent } from '../../lib/events-bus.js';
import { getPool } from '../memory/db.js';
import { computeWeights } from './bandit.js';
import { getCurrentRegime } from './regime.js';
import type { RegimeTag } from './regime-types.js';
import {
  KNOWN_STRATEGIES,
  type BanditInput,
  type BanditTradeOutcome,
  type BanditWeightsFile,
  type StrategyWeightEntry,
} from './bandit-types.js';

// ── module state ───────────────────────────────────────────────────────

let cachedWeights: BanditWeightsFile | null = null;
let lastRecomputeTs = 0;
const MIN_RECOMPUTE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TEMP_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface TempOverride {
  weight: number;
  expiresAt: number;
}
const tempOverrides = new Map<string, TempOverride>();

// ── path resolution ────────────────────────────────────────────────────

function weightsFilePath(): string {
  // src/services/orchestrator/bandit-runner.ts → apps/gateway/data/bandit-weights.json
  const here = dirname(fileURLToPath(import.meta.url));
  const orchestrator = here;
  const services = dirname(orchestrator);
  const srcOrDist = dirname(services);
  const gatewayRoot = dirname(srcOrDist);
  return resolve(gatewayRoot, 'data', 'bandit-weights.json');
}

// ── public API ─────────────────────────────────────────────────────────

/**
 * Synchronous, hot-path-safe accessor. Returns the current weight for a
 * strategy, or 1/N (equal weight) if weights aren't loaded.
 *
 * Phase D sizing module calls this on every signal — must be cheap and
 * never throw.
 */
export function getBanditWeight(strategy: string): number {
  // Temp override (24h TTL) wins over file weights.
  const override = tempOverrides.get(strategy);
  if (override && override.expiresAt > Date.now()) {
    return override.weight;
  }
  if (override && override.expiresAt <= Date.now()) {
    tempOverrides.delete(strategy);
  }

  if (!cachedWeights) {
    return 1 / KNOWN_STRATEGIES.length;
  }
  const entry = cachedWeights.strategies[strategy];
  if (!entry) {
    return 1 / Math.max(Object.keys(cachedWeights.strategies).length, 1);
  }
  return entry.weight;
}

/**
 * Returns a snapshot of the current weights file (or null if not loaded).
 * Used by `GET /api/v1/bandit/weights`.
 */
export function getCurrentWeights(): BanditWeightsFile | null {
  return cachedWeights;
}

/**
 * Set a temporary 24h override for a single strategy. Used by
 * `POST /api/v1/bandit/override`.
 */
export function setTempOverride(strategy: string, weight: number): void {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error(`bandit override weight must be in [0,1], got ${weight}`);
  }
  tempOverrides.set(strategy, {
    weight,
    expiresAt: Date.now() + TEMP_OVERRIDE_TTL_MS,
  });
  logger.info({ strategy, weight }, '[bandit] temp override set (24h TTL)');
}

/**
 * Clear all temporary overrides (admin / test helper).
 */
export function clearTempOverrides(): void {
  tempOverrides.clear();
}

/**
 * Returns true if at least MIN_RECOMPUTE_INTERVAL_MS has elapsed since
 * the last successful recompute.
 */
export function canRecomputeNow(): boolean {
  return Date.now() - lastRecomputeTs >= MIN_RECOMPUTE_INTERVAL_MS;
}

/**
 * Trigger an immediate recompute. Rate-limited to once per hour unless
 * `force=true`. Returns the new weights or null if rate-limited / failed.
 */
export async function recomputeNow(opts: { force?: boolean } = {}): Promise<BanditWeightsFile | null> {
  if (!opts.force && !canRecomputeNow()) {
    logger.info('[bandit] recompute skipped — rate-limited (last run < 1h ago)');
    return null;
  }
  try {
    const weights = await runBanditRecompute();
    lastRecomputeTs = Date.now();
    return weights;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[bandit] recompute failed',
    );
    return null;
  }
}

/**
 * Boot-time init. Called from gateway startup.
 * - Loads weights file if it exists.
 * - If missing, writes a cold-start equal-weight file.
 * - Schedules the weekly cron (Mondays 6:00 AM ET).
 */
export async function initBandit(): Promise<void> {
  const path = weightsFilePath();

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as BanditWeightsFile;
      if (parsed.schemaVersion !== 1 || !parsed.strategies) {
        throw new Error('invalid bandit-weights.json schema');
      }
      cachedWeights = parsed;
      logger.info(
        { updatedAt: parsed.updatedAt, strategies: Object.keys(parsed.strategies).length },
        '[bandit] weights loaded from disk',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        '[bandit] weights file unreadable — falling back to cold start',
      );
      cachedWeights = writeColdStart();
    }
  } else {
    cachedWeights = writeColdStart();
    logger.info('[bandit] cold start, equal weights initialized');
  }

  // Apply env override on boot (persistent until config changes).
  const envOverride = parseEnvOverride();
  if (envOverride && Object.keys(envOverride).length > 0) {
    logger.info({ overrides: envOverride }, '[bandit] BANDIT_OVERRIDE applied at boot');
  }

  scheduleWeeklyCron();
}

// ── internals ──────────────────────────────────────────────────────────

/**
 * Pull last 90d outcomes from the memory DB, run the bandit, persist.
 * Returns the new weights file. Throws on DB error.
 */
async function runBanditRecompute(): Promise<BanditWeightsFile> {
  const pool = getPool();
  const prevStrategies = cachedWeights?.strategies ?? {};

  let inputs: BanditInput[];

  if (!pool) {
    logger.warn('[bandit] MEMORY_DB_URL unset — equal weights');
    inputs = KNOWN_STRATEGIES.map((s) => ({
      strategy: s,
      outcomes: [],
      prevWeight: prevStrategies[s]?.weight,
    }));
  } else {
    const rows = await pool.query<{
      strategy: string;
      age_hours: number;
      realized_pnl_usd: number;
    }>(
      `
      SELECT
        d.strategy AS strategy,
        EXTRACT(EPOCH FROM (NOW() - o.closed_at)) / 3600.0 AS age_hours,
        o.realized_pnl_usd AS realized_pnl_usd
      FROM trade_outcomes o
      JOIN decisions d ON d.id = o.decision_id
      WHERE o.closed_at >= NOW() - INTERVAL '90 days'
      `,
    );

    const byStrategy = new Map<string, BanditTradeOutcome[]>();
    for (const s of KNOWN_STRATEGIES) byStrategy.set(s, []);
    for (const r of rows.rows) {
      // Coerce strings (pg numeric → string) safely.
      const ageHours = typeof r.age_hours === 'string' ? parseFloat(r.age_hours) : r.age_hours;
      const pnl = typeof r.realized_pnl_usd === 'string' ? parseFloat(r.realized_pnl_usd) : r.realized_pnl_usd;
      const list = byStrategy.get(r.strategy) ?? [];
      list.push({ ageHours, realizedPnlUsd: pnl });
      byStrategy.set(r.strategy, list);
    }

    inputs = [...byStrategy.entries()].map(([strategy, outcomes]) => ({
      strategy,
      outcomes,
      prevWeight: prevStrategies[strategy]?.weight,
    }));
  }

  const envOverride = parseEnvOverride();
  const result = computeWeights(inputs, {
    overrides: envOverride ?? {},
  });

  // Tag this recompute with the active market regime. Failure here is
  // non-fatal — bandit weights still ship, just without the regime stamp.
  let regimeStamp: BanditWeightsFile['regime'];
  let byRegime: BanditWeightsFile['byRegime'];
  try {
    const r = await getCurrentRegime();
    regimeStamp = {
      tag: r.tag,
      confidence: r.confidence,
      rationale: r.rationale,
    };
    byRegime = emptyRegimeBuckets();
    // Per-recompute snapshot: full weight goes to the regime active at
    // recompute time. Historical aggregation across recomputes is the
    // analytics job's responsibility.
    byRegime[r.tag] = 1.0;
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      '[bandit] regime tag unavailable for this recompute',
    );
  }

  const file: BanditWeightsFile = {
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
    strategies: {},
    ...(regimeStamp ? { regime: regimeStamp } : {}),
    ...(byRegime ? { byRegime } : {}),
  };
  for (let i = 0; i < inputs.length; i++) {
    file.strategies[inputs[i]!.strategy] = result.strategies[i]!;
  }

  writeFileAtomic(file);
  cachedWeights = file;

  logger.info(
    {
      updatedAt: file.updatedAt,
      totalSamples: result.totalSamples,
      coldStart: result.coldStartStrategies,
      regime: regimeStamp?.tag ?? 'unknown',
      weights: Object.fromEntries(
        Object.entries(file.strategies).map(([k, v]) => [k, +v.weight.toFixed(4)]),
      ),
    },
    '[bandit] recompute complete',
  );

  // Fan out to SSE — cockpit's StrategyBanditWeights card subscribes and
  // refetches its query, so the bars animate without polling.
  emitAppEvent('bandit-recomputed', { weights: file });

  return file;
}

function emptyRegimeBuckets(): Record<RegimeTag, number> {
  return { calm: 0, trending: 0, volatile: 0, crisis: 0 };
}

/**
 * Build + persist a cold-start equal-weight file (used when no file exists
 * on boot, or on recovery from a corrupt file).
 */
function writeColdStart(): BanditWeightsFile {
  const equal = 1 / KNOWN_STRATEGIES.length;
  const file: BanditWeightsFile = {
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
    strategies: {},
  };
  for (const s of KNOWN_STRATEGIES) {
    const entry: StrategyWeightEntry = {
      weight: equal,
      prevWeight: equal,
      voteShare: 0,
      sampleSize90d: 0,
      winRate: 0.5,
      expectancy: 0,
      sharpeProxy: 0,
      source: 'cold_start',
    };
    file.strategies[s] = entry;
  }
  writeFileAtomic(file);
  return file;
}

/**
 * Atomic write: tmp file then rename. Creates parent dir if missing.
 */
function writeFileAtomic(file: BanditWeightsFile): void {
  const path = weightsFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf8');
  renameSync(tmpPath, path);
}

/**
 * Parse the BANDIT_OVERRIDE env var (JSON). Returns null if unset/invalid.
 */
function parseEnvOverride(): Record<string, number> | null {
  const raw = process.env['BANDIT_OVERRIDE'];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) {
        out[k] = v;
      }
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[bandit] BANDIT_OVERRIDE env var unparsable — ignoring',
    );
    return null;
  }
}

/**
 * Schedule a weekly recompute every Monday at 6:00 AM ET.
 *
 * Implementation note: we don't want a cron dependency, and node-cron's
 * timezone handling adds drift around DST. Instead we compute the ms until
 * the next Monday 6:00 AM ET ourselves (using -04:00 vs -05:00 lookup) and
 * setTimeout. After firing, re-schedule.
 */
function scheduleWeeklyCron(): void {
  const delayMs = msUntilNextMonday6amET();
  setTimeout(() => {
    void recomputeNow({ force: true }).finally(() => scheduleWeeklyCron());
  }, delayMs).unref?.();
  logger.info(
    { nextRunMs: delayMs, nextRun: new Date(Date.now() + delayMs).toISOString() },
    '[bandit] weekly cron scheduled',
  );
}

/**
 * ms from now until the next Monday 06:00 ET. Approximates ET as UTC-5 in
 * winter, UTC-4 in DST (Mar 2nd Sun → Nov 1st Sun). Good enough for a
 * weekly cron — drift of one hour twice a year is acceptable.
 */
function msUntilNextMonday6amET(): number {
  const now = new Date();
  // ET offset (negative because ET is behind UTC).
  const offsetHours = isUSDaylightSavings(now) ? -4 : -5;
  // "06:00 ET" expressed in UTC hours.
  const targetUtcHour = 6 - offsetHours;     // e.g. EDT(-4) → 10 UTC, EST(-5) → 11 UTC

  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    targetUtcHour, 0, 0, 0,
  ));

  // Advance to Monday (getUTCDay: 0=Sun ... 1=Mon ... 6=Sat).
  while (next.getUTCDay() !== 1 || next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return Math.max(60_000, next.getTime() - now.getTime()); // floor 1 minute
}

/**
 * US DST: 2nd Sunday of March → 1st Sunday of November.
 * Returns true if the given date falls in DST.
 */
function isUSDaylightSavings(d: Date): boolean {
  const year = d.getUTCFullYear();
  // 2nd Sunday of March
  const marchStart = new Date(Date.UTC(year, 2, 1));
  const dstStart = new Date(Date.UTC(
    year, 2, 1 + ((7 - marchStart.getUTCDay()) % 7) + 7, 7, 0, 0, // 2 AM local = 7 UTC ish
  ));
  // 1st Sunday of November
  const novStart = new Date(Date.UTC(year, 10, 1));
  const dstEnd = new Date(Date.UTC(
    year, 10, 1 + ((7 - novStart.getUTCDay()) % 7), 6, 0, 0,
  ));
  return d.getTime() >= dstStart.getTime() && d.getTime() < dstEnd.getTime();
}
