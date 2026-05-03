import type { Logger } from 'pino';

export interface WebhookSignal {
  symbol: string;
  action: 'buy' | 'sell';
  price: number;
  score: number;
  grade: 'standard' | 'strong' | 'prime';
  time: string;
  exchange: string;
  timeframe: string;
  source_label: string;
}

export async function postSignal(
  webhookUrl: string,
  signal: WebhookSignal,
  log: Logger,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  if (!res.ok) {
    log.warn({ status: res.status, body, signal }, 'webhook rejected');
  } else {
    log.info({ signal }, 'webhook sent');
  }
  return { ok: res.ok, status: res.status, body };
}
