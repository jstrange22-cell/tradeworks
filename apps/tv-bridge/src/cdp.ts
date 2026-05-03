import CDP from 'chrome-remote-interface';

export type CDPClient = Awaited<ReturnType<typeof CDP>>;

const CDP_HOST = process.env.CDP_HOST ?? 'localhost';
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);

let cached: CDPClient | null = null;

async function findChartTarget(): Promise<{ id: string; webSocketDebuggerUrl: string } | null> {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list returned ${res.status}`);
  const targets = (await res.json()) as Array<{
    id: string;
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
    title: string;
  }>;
  // Prefer a TradingView chart page over background workers/iframes
  const chart = targets.find(
    (t) => t.type === 'page' && (t.url.includes('tradingview.com/chart') || t.title.includes('TradingView')),
  );
  return chart ?? null;
}

export async function getCdpClient(): Promise<CDPClient> {
  if (cached) {
    try {
      await cached.Runtime.evaluate({ expression: '1', returnByValue: true });
      return cached;
    } catch {
      cached = null;
    }
  }
  const target = await findChartTarget();
  if (!target) {
    throw new Error(
      `No TradingView chart target found at ${CDP_HOST}:${CDP_PORT}. Is TradingView running with --remote-debugging-port=${CDP_PORT}?`,
    );
  }
  cached = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  await cached.Runtime.enable();
  return cached;
}

export async function evaluate<T>(expression: string): Promise<T> {
  const client = await getCdpClient();
  const result = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`CDP evaluate threw: ${result.exceptionDetails.text}`);
  }
  return result.result.value as T;
}

export function disconnect(): void {
  cached?.close();
  cached = null;
}
