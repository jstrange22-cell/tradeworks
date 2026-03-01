import { createClient, type ClickHouseClient } from '@clickhouse/client';

let _client: ClickHouseClient | null = null;

/**
 * Returns a singleton ClickHouse client.
 * Connection parameters are read from environment variables.
 */
export function getClickHouseClient(): ClickHouseClient {
  if (!_client) {
    _client = createClient({
      url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
      username: process.env['CLICKHOUSE_USER'] ?? 'default',
      password: process.env['CLICKHOUSE_PASSWORD'] ?? '',
      database: process.env['CLICKHOUSE_DATABASE'] ?? 'tradeworks',
      request_timeout: Number(process.env['CLICKHOUSE_TIMEOUT'] ?? 30_000),
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 0,
      },
    });
  }

  return _client;
}

/**
 * Gracefully close the ClickHouse connection.
 */
export async function closeClickHouseClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}

export type { ClickHouseClient };
