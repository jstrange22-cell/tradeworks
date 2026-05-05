/**
 * Memory DB client — singleton `pg.Pool` keyed on `MEMORY_DB_URL`.
 *
 * Critical: this module must never throw at import time and must never
 * crash gateway boot when MEMORY_DB_URL is unset. All callers should
 * use `getPool()` which returns `null` in that case; helper functions
 * in the rest of the memory module degrade to warn-and-return-empty.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { logger } from '../../lib/logger.js';

const { Pool } = pg;

let poolSingleton: pg.Pool | null = null;
let initialised = false;

/**
 * Returns the shared `pg.Pool` for the memory DB, or `null` if
 * `MEMORY_DB_URL` is not set. Callers must handle the null case.
 */
export function getPool(): pg.Pool | null {
  if (initialised) return poolSingleton;
  initialised = true;

  const url = process.env['MEMORY_DB_URL'];
  if (!url) {
    logger.warn(
      '[memory] MEMORY_DB_URL not set — memory module will no-op until configured.',
    );
    poolSingleton = null;
    return null;
  }

  poolSingleton = new Pool({
    connectionString: url,
    max: Number(process.env['MEMORY_PG_POOL_MAX'] ?? 10),
    idleTimeoutMillis: Number(process.env['MEMORY_PG_IDLE_TIMEOUT'] ?? 30_000),
    connectionTimeoutMillis: Number(process.env['MEMORY_PG_CONNECT_TIMEOUT'] ?? 5_000),
  });

  poolSingleton.on('error', (err) => {
    logger.error({ err: err.message }, '[memory] pg pool error');
  });

  return poolSingleton;
}

/**
 * Returns true if the memory DB is configured and reachable.
 * Cheap probe — runs `SELECT 1`.
 */
export async function isAvailable(): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[memory] availability probe failed',
    );
    return false;
  }
}

/**
 * Loads and executes the v2 memory schema migration.
 * Idempotent — safe to call repeatedly.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    logger.warn('[memory] runMigrations skipped — MEMORY_DB_URL unset');
    return;
  }

  const migrationPath = resolveMigrationPath();
  if (!existsSync(migrationPath)) {
    logger.error(
      { migrationPath },
      '[memory] migration file missing — skipping',
    );
    return;
  }

  const sql = readFileSync(migrationPath, 'utf8');
  await pool.query(sql);
  logger.info({ migrationPath }, '[memory] migrations applied');
}

/**
 * Optional bootstrap helper. Call from gateway startup to auto-run
 * migrations when MEMORY_AUTO_MIGRATE=true. Safe to call when env is unset.
 */
export async function initializeMemory(): Promise<void> {
  if (!process.env['MEMORY_DB_URL']) return;
  if (process.env['MEMORY_AUTO_MIGRATE'] !== 'true') return;
  try {
    await runMigrations();
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[memory] initializeMemory failed — gateway will still boot',
    );
  }
}

/**
 * Closes the pool. Use during graceful shutdown / tests.
 */
export async function closeMemoryPool(): Promise<void> {
  if (poolSingleton) {
    await poolSingleton.end();
    poolSingleton = null;
    initialised = false;
  }
}

// ── internal helpers ───────────────────────────────────────────────────

function resolveMigrationPath(): string {
  // Repo layout: apps/gateway/migrations/2026_v2_memory_schema.sql
  // This file at runtime: apps/gateway/{src or dist}/services/memory/db.{ts,js}
  // Walk up to apps/gateway then into migrations/.
  const thisFile = fileURLToPath(import.meta.url);
  const here = dirname(thisFile);                     // .../memory
  const services = dirname(here);                     // .../services
  const srcOrDist = dirname(services);                // .../src OR .../dist
  const gatewayRoot = dirname(srcOrDist);             // .../apps/gateway
  return resolve(gatewayRoot, 'migrations', '2026_v2_memory_schema.sql');
}
