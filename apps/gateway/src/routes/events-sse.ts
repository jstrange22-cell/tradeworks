/**
 * Server-Sent Events stream for the dashboard.
 *
 * GET /api/v1/events/stream
 *
 * One long-lived HTTP/1.1 response per browser tab. Server pushes:
 *   - decision-created     full Decision JSON
 *   - decision-resolved    { decisionId, resolution, resolvedBy? }
 *   - execution-filled     full Execution JSON
 *   - outcome-written      full Outcome JSON
 *   - regime-changed       full MarketRegime JSON
 *   - bandit-recomputed    full BanditWeightsFile JSON
 *   - kill-switch-changed  full KillSwitchStatus JSON
 *   - heartbeat            { ts } every 30s (proxy keep-alive)
 *
 * Concurrency cap: 50 concurrent connections. Above that, the next client
 * gets HTTP 429. Cap is well under Node's default fd limits and Express's
 * keep-alive socket pool — increase if a future ops change warrants it.
 *
 * Why SSE not WebSocket?
 *   - One-way push only; the client never sends back over this channel.
 *   - HTTP/1.1 friendly: works through nginx + corporate proxies without
 *     special config (just `proxy_buffering off`). The existing gateway
 *     already proxies a WS upgrade on `/ws` for legacy code; SSE coexists.
 *   - Native EventSource on the client — no library, no framing edge cases.
 */
import { Router, type Request, type Response, type IRouter } from 'express';
import { logger } from '../lib/logger.js';
import { appEventBus, type AppEventMap, type AppEventName } from '../lib/events-bus.js';

export const eventsSseRouter: IRouter = Router();

// ── Connection accounting ──────────────────────────────────────────────

const MAX_CONCURRENT_CLIENTS = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Set of currently open SSE responses. Used only for the cap; we don't
 *  iterate it for fan-out — the bus does that. */
const activeClients = new Set<Response>();

/** Event names to forward. Keep in sync with `AppEventMap`. */
const FORWARDED: AppEventName[] = [
  'decision-created',
  'decision-resolved',
  'execution-filled',
  'outcome-written',
  'regime-changed',
  'bandit-recomputed',
  'kill-switch-changed',
];

// ── SSE frame writer ───────────────────────────────────────────────────

function writeEvent<K extends AppEventName>(
  res: Response,
  name: K,
  payload: AppEventMap[K],
): void {
  if (res.writableEnded) return;
  let line: string;
  try {
    line = JSON.stringify(payload);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, name },
      '[sse] JSON.stringify failed for payload — dropping event',
    );
    return;
  }
  // SSE frame: event + data + double-newline terminator. Multi-line data
  // would need each line prefixed; we always emit one line so a single
  // `data:` is fine.
  res.write(`event: ${name}\n`);
  res.write(`data: ${line}\n\n`);
  // Force flush — needed for nginx + node:http when the response is
  // buffered. Cast required because Express types don't expose flush().
  type ResponseWithFlush = Response & { flush?: () => void };
  const flushable = res as ResponseWithFlush;
  if (typeof flushable.flush === 'function') {
    flushable.flush();
  }
}

// ── GET /stream ────────────────────────────────────────────────────────

eventsSseRouter.get('/stream', (req: Request, res: Response) => {
  if (activeClients.size >= MAX_CONCURRENT_CLIENTS) {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_SSE_CLIENTS',
        message: `SSE connection cap reached (${MAX_CONCURRENT_CLIENTS}). Try again later.`,
      },
    });
    return;
  }

  // SSE response headers. Critical:
  //   - Content-Type text/event-stream (browser EventSource demands it)
  //   - Cache-Control no-cache (proxies must not coalesce)
  //   - Connection keep-alive (HTTP/1.1)
  //   - X-Accel-Buffering no (nginx-specific; disables proxy_buffering for
  //     this response without needing nginx.conf changes)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // CORS: API gateway cors() middleware already permits dashboard origins,
  // but EventSource ignores some CORS preflights. Echo the origin header so
  // browsers accept the response.
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // 200 + flushHeaders so the client transitions out of "connecting" state.
  res.status(200);
  res.flushHeaders();

  // Initial comment line — confirms the stream is open and primes the proxy.
  res.write(': sse-stream-open\n\n');

  activeClients.add(res);
  logger.info(
    { clients: activeClients.size, ip: req.ip ?? 'unknown' },
    '[sse] client connected',
  );

  // ── Per-event-type listener subscriptions ────────────────────────────
  // Build typed handlers. Each one is a no-op once the response is closed;
  // we still call `unsub()` on close so the bus's listener list shrinks.
  const unsubs: Array<() => void> = [];
  for (const name of FORWARDED) {
    const unsub = appEventBus.on(name, (payload) => {
      writeEvent(res, name, payload as AppEventMap[typeof name]);
    });
    unsubs.push(unsub);
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────
  // Every 30s, push an event so dumb proxies don't sever the connection
  // for being "idle". Also detects half-open sockets — write throws if the
  // peer is gone, which triggers the close handler below.
  const heartbeat = setInterval(() => {
    writeEvent(res, 'heartbeat', { ts: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the event loop alive purely for this timer.
  heartbeat.unref?.();

  // ── Cleanup on disconnect ─────────────────────────────────────────────
  const cleanup = (): void => {
    clearInterval(heartbeat);
    for (const u of unsubs) {
      try { u(); } catch { /* unsub already detached */ }
    }
    activeClients.delete(res);
    logger.info({ clients: activeClients.size }, '[sse] client disconnected');
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);
});

// ── GET /stream/status ─────────────────────────────────────────────────
// Cheap admin probe so an operator can verify the bus is live without
// opening an EventSource. Returns the active client count + max.

eventsSseRouter.get('/stream/status', (_req, res) => {
  res.json({
    data: {
      activeClients: activeClients.size,
      maxClients: MAX_CONCURRENT_CLIENTS,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      forwardedEvents: FORWARDED,
    },
  });
});
