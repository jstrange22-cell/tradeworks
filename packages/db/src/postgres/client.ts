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
  if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
    console.warn('[postgres] Not available — API routes requiring DB will return errors');
  } else {
    console.error('[postgres] Pool error:', err.message);
  }
});

export const db = drizzle(pool, { schema });

export { pool };

export type Database = typeof db;
