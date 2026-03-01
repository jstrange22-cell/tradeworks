import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: Number(process.env['PG_POOL_MAX'] ?? 20),
  idleTimeoutMillis: Number(process.env['PG_IDLE_TIMEOUT'] ?? 30_000),
  connectionTimeoutMillis: Number(process.env['PG_CONNECT_TIMEOUT'] ?? 5_000),
});

pool.on('error', (err) => {
  console.error('[postgres] Unexpected pool error:', err);
});

export const db = drizzle(pool, { schema });

export { pool };

export type Database = typeof db;
