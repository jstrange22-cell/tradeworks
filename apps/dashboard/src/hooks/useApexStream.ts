/**
 * APEX SSE — single-subscription stream of gateway events.
 *
 * Mounted once at the App root. Subscribes to `/api/v1/events/stream`,
 * dispatches each event to TanStack Query (invalidate / setQueryData) so the
 * cockpit, decisions feed, kill-switch panel, etc. update without polling.
 *
 * Reconnect strategy: exponential backoff with jitter (1s → 2s → 4s → … →
 * 30s ceiling). The browser's EventSource has its own retry, but we wrap it
 * so we can also reset on visibility-change and surface connection state to
 * the UI if a future agent wants it.
 *
 * Polling note: query-level `refetchInterval` stays as a fallback. Once SSE
 * reports `connected`, callers can read `useApexStreamStatus()` and switch
 * their refetch to `Infinity` if they want pure-SSE behaviour. The default
 * here is "belt + suspenders" — polling AND SSE — so a stream drop never
 * leaves the cockpit silently stale.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

const STREAM_PATH = '/api/v1/events/stream';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000; // 3x server interval

// Cockpit query keys this hook cares about. Keep in sync with
// `components/cockpit/hooks.ts`. Hard-coded over re-exporting because the
// cockpit hooks file imports from query-client too — a circular import would
// be a footgun later.
const QK_PORTFOLIO = ['cockpit', 'portfolio'] as const;
const QK_DECISIONS_PREFIX = ['cockpit', 'tradevisor-decisions'] as const;
const QK_REGIME = ['cockpit', 'regime'] as const;
const QK_HEAT = ['cockpit', 'heat'] as const;
const QK_BANDIT = ['cockpit', 'bandit-weights'] as const;
const QK_KILL_SWITCHES = ['cockpit', 'kill-switches'] as const;
const QK_EXITS_STATUS = ['cockpit', 'exits-status'] as const;
const QK_EXITS_POSITIONS = ['cockpit', 'exits-positions'] as const;
// Explorer (E4) — list + aggregate
const QK_EXPLORER = ['explorer'] as const;

export type StreamConnectionState =
  | { status: 'connecting' }
  | { status: 'connected'; sinceMs: number }
  | { status: 'disconnected'; reason?: string }
  | { status: 'error'; lastError: string };

// ── Module-scoped subscription guard ───────────────────────────────────
// Prevents StrictMode double-mount in dev from opening two streams.
let activeMounts = 0;

// ── SSE event payload contracts (mirror gateway/lib/events-bus.ts) ─────

interface DecisionCreatedPayload {
  decision: { id?: string } & Record<string, unknown>;
}

interface DecisionResolvedPayload {
  decisionId: string;
  resolution: 'approved' | 'vetoed';
  resolvedBy?: 'human' | 'auto-timeout';
}

interface ExecutionFilledPayload {
  execution: Record<string, unknown>;
}

interface OutcomeWrittenPayload {
  outcome: Record<string, unknown>;
}

interface RegimeChangedPayload {
  regime: Record<string, unknown>;
}

interface BanditRecomputedPayload {
  weights: Record<string, unknown>;
}

interface KillSwitchChangedPayload {
  status: Record<string, unknown>;
}

// ── Dispatcher ────────────────────────────────────────────────────────

/**
 * Convert one event into the right TanStack Query mutation. Pure function
 * over (queryClient, name, payload) so we can unit-test the dispatch table
 * independently of the SSE transport.
 */
function dispatch(
  qc: QueryClient,
  name: string,
  raw: string,
): void {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed event — log via console so an error appears in the network
    // tab next to the bad frame. Don't throw; one bad frame must not kill
    // the stream.
    if (typeof console !== 'undefined') {
      console.warn('[apex-stream] failed to parse event', { name, raw });
    }
    return;
  }

  switch (name) {
    case 'decision-created': {
      // Refetch the decisions feed so the new row appears at the top, and the
      // explorer (which also feeds off `decisions`) stays consistent.
      void qc.invalidateQueries({ queryKey: QK_DECISIONS_PREFIX });
      void qc.invalidateQueries({ queryKey: QK_EXPLORER });
      // Mirror onto portfolio — a new decision changes pending-risk math.
      void qc.invalidateQueries({ queryKey: QK_PORTFOLIO });
      // Surface the raw payload to a "live decisions" cache that the cockpit
      // can read for optimistic UI updates without waiting for the refetch
      // to land. Best-effort — receivers shape-check.
      qc.setQueryData<unknown>(['apex-stream', 'last-decision'], payload as DecisionCreatedPayload);
      return;
    }
    case 'decision-resolved': {
      void qc.invalidateQueries({ queryKey: QK_DECISIONS_PREFIX });
      void qc.invalidateQueries({ queryKey: QK_EXPLORER });
      qc.setQueryData<unknown>(['apex-stream', 'last-resolution'], payload as DecisionResolvedPayload);
      return;
    }
    case 'execution-filled': {
      // Fills change open-position list AND total exposure / heat.
      void qc.invalidateQueries({ queryKey: QK_PORTFOLIO });
      void qc.invalidateQueries({ queryKey: QK_HEAT });
      void qc.invalidateQueries({ queryKey: QK_EXITS_POSITIONS });
      qc.setQueryData<unknown>(['apex-stream', 'last-execution'], payload as ExecutionFilledPayload);
      return;
    }
    case 'outcome-written': {
      // Outcome row → realised P&L changes everywhere.
      void qc.invalidateQueries({ queryKey: QK_PORTFOLIO });
      void qc.invalidateQueries({ queryKey: QK_DECISIONS_PREFIX });
      void qc.invalidateQueries({ queryKey: QK_EXPLORER });
      void qc.invalidateQueries({ queryKey: QK_HEAT });
      qc.setQueryData<unknown>(['apex-stream', 'last-outcome'], payload as OutcomeWrittenPayload);
      return;
    }
    case 'regime-changed': {
      // Regime change cascades into bandit weights + heat budget multiplier.
      const p = payload as RegimeChangedPayload;
      qc.setQueryData(QK_REGIME, { data: p.regime });
      void qc.invalidateQueries({ queryKey: QK_REGIME });
      void qc.invalidateQueries({ queryKey: QK_BANDIT });
      void qc.invalidateQueries({ queryKey: QK_HEAT });
      return;
    }
    case 'bandit-recomputed': {
      const p = payload as BanditRecomputedPayload;
      qc.setQueryData(QK_BANDIT, { data: p.weights });
      void qc.invalidateQueries({ queryKey: QK_BANDIT });
      return;
    }
    case 'kill-switch-changed': {
      const p = payload as KillSwitchChangedPayload;
      qc.setQueryData(QK_KILL_SWITCHES, { data: p.status });
      void qc.invalidateQueries({ queryKey: QK_KILL_SWITCHES });
      // Master / portfolio kills also halt entries — keep the exits monitor
      // status fresh so the cockpit reflects the gate.
      void qc.invalidateQueries({ queryKey: QK_EXITS_STATUS });
      return;
    }
    case 'heartbeat': {
      // Server keep-alive. No query work; the connection-state effect bumps
      // its lastHeartbeat timestamp via the message handler scope.
      return;
    }
    default: {
      // Unknown event — ignore. Gateway/dashboard versions may drift.
      if (typeof console !== 'undefined') {
        console.debug('[apex-stream] unknown event', name);
      }
    }
  }
}

// ── Hook ──────────────────────────────────────────────────────────────

export interface UseApexStreamOptions {
  /** Disable the stream (e.g. on the login page). Default: true. */
  enabled?: boolean;
}

/**
 * Mount once near the App root. Returns the live connection state for
 * optional UI use (e.g. a "stream offline" pill). When the stream is up,
 * page-level queries can disable their `refetchInterval` to save bandwidth.
 */
export function useApexStream(opts: UseApexStreamOptions = {}): StreamConnectionState {
  const enabled = opts.enabled ?? true;
  const qc = useQueryClient();
  const [state, setState] = useState<StreamConnectionState>({ status: 'connecting' });
  const reconnectAttemptRef = useRef<number>(0);
  const heartbeatTsRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      // Server-side or environment without EventSource — skip silently.
      return;
    }

    activeMounts += 1;
    if (activeMounts > 1) {
      // Dev StrictMode mounted us twice. Bail on the second mount so we
      // don't open a second long-lived connection. The first mount keeps
      // working; this effect just no-ops.
      return () => {
        activeMounts -= 1;
      };
    }

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    function streamUrl(): string {
      // Dashboard has API_BASE_URL configured at build time — derive the SSE
      // origin from the same source so prod (relative `/api/v1`) and dev
      // (`http://localhost:4000/api/v1`) both work.
      const apiBase =
        (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
      const trimmed = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
      // STREAM_PATH already starts with `/api/v1/events/stream`; if the env
      // points at a different base (e.g. `/v2`), respect that.
      if (apiBase.startsWith('http')) {
        // Absolute base — strip the `/api/v1` suffix only if STREAM_PATH
        // starts with the same prefix.
        const url = new URL(STREAM_PATH, trimmed.endsWith('/api/v1')
          ? trimmed.slice(0, -'/api/v1'.length) || '/'
          : trimmed);
        return url.toString();
      }
      return STREAM_PATH;
    }

    function backoffDelay(): number {
      const attempt = reconnectAttemptRef.current;
      const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
      // ±25% jitter so multiple tabs don't reconnect in lockstep.
      const jitter = base * (Math.random() * 0.5 - 0.25);
      return Math.max(RECONNECT_BASE_MS, base + jitter);
    }

    function scheduleReconnect(reason: string): void {
      if (cancelled) return;
      const delay = backoffDelay();
      reconnectAttemptRef.current += 1;
      setState({ status: 'disconnected', reason });
      reconnectTimer = setTimeout(connect, delay);
    }

    function connect(): void {
      if (cancelled) return;
      setState({ status: 'connecting' });
      try {
        es = new EventSource(streamUrl(), { withCredentials: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'EventSource init failed';
        scheduleReconnect(message);
        return;
      }

      es.onopen = () => {
        reconnectAttemptRef.current = 0;
        heartbeatTsRef.current = Date.now();
        setState({ status: 'connected', sinceMs: Date.now() });
      };

      es.onerror = () => {
        // EventSource auto-retries internally, but we want exponential backoff
        // and a clear "disconnected" UI state, so we force-close and re-open
        // ourselves.
        if (es) {
          try { es.close(); } catch { /* already closed */ }
          es = null;
        }
        scheduleReconnect('connection error');
      };

      // ── Per-event-name listeners ─────────────────────────────────────
      // EventSource fires `message` for unnamed events only. Named events
      // (`event: foo\n`) require addEventListener('foo', …). We register one
      // listener per known type so dispatch is cheap and no string parsing
      // is done on the hot path.
      const types = [
        'decision-created',
        'decision-resolved',
        'execution-filled',
        'outcome-written',
        'regime-changed',
        'bandit-recomputed',
        'kill-switch-changed',
        'heartbeat',
      ] as const;
      for (const t of types) {
        es.addEventListener(t, (ev) => {
          heartbeatTsRef.current = Date.now();
          const me = ev as MessageEvent<string>;
          dispatch(qc, t, me.data);
        });
      }
    }

    // ── Heartbeat watchdog ───────────────────────────────────────────────
    // If we haven't seen any event (data or keep-alive) in 90s, force a
    // reconnect. Catches half-open sockets that EventSource doesn't notice.
    heartbeatTimer = setInterval(() => {
      if (Date.now() - heartbeatTsRef.current > HEARTBEAT_TIMEOUT_MS) {
        if (es) {
          try { es.close(); } catch { /* already closed */ }
          es = null;
        }
        scheduleReconnect('heartbeat timeout');
      }
    }, 30_000);

    // ── Visibility recovery ──────────────────────────────────────────────
    // After a sleep/wake, browsers sometimes leave the EventSource frozen.
    // Reset our backoff counter and force a fresh connect on visibilitychange.
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - heartbeatTsRef.current > HEARTBEAT_TIMEOUT_MS / 2) {
        if (es) {
          try { es.close(); } catch { /* noop */ }
          es = null;
        }
        reconnectAttemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    connect();

    return () => {
      cancelled = true;
      activeMounts -= 1;
      document.removeEventListener('visibilitychange', onVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (es) {
        try { es.close(); } catch { /* noop */ }
      }
    };
  }, [enabled, qc]);

  return state;
}

// Re-export the dispatcher for unit tests. Not part of the public hook API.
export const __testDispatch = dispatch;
