import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/postgres/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  driver: 'pg',
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
});
