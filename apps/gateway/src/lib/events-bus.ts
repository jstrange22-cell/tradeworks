/**
 * Process-local event bus for SSE fan-out.
 *
 * Producers (TradeVisor reasoner, outcome writer, bandit runner, regime
 * detector, kill-switch module, stock-/crypto-agent execution paths) call
 * `emitEvent(type, payload)` synchronously when something interesting
 * happens. The SSE route (`/api/v1/events/stream`) subscribes once per
 * connected client and writes each event out as a `text/event-stream` frame.
 *
 * Why a custom EventEmitter wrapper instead of node:events directly?
 *   1. We can keep a typed event-name → payload map so producers can't drift
 *      from consumers.
 *   2. We can centralise the "drop silently if no subscribers" behaviour —
 *      these events are advisory only; nothing in the trading hot path
 *      should ever block on them.
 *   3. We can install a single max-listeners cap (one SSE handler attaches
 *      seven listeners — clients × 7 must stay under EventEmitter's default
 *      10 warning threshold to avoid log spam).
 *
 * No external pub/sub. No Redis. Single-process gateway only — if we ever
 * scale horizontally, swap the impl for a Redis fan-out without touching
 * the producer/consumer call sites.
 */
import { EventEmitter } from 'node:events';

// ── Public event-name → payload contract ────────────────────────────────
// Keep each payload minimal and JSON-serialisable. Anything keyed off a
// specific decision/execution/outcome should pass the FULL row so the
// dashboard can update without an additional round-trip.

export interface AppEventMap {
  /** New TradeVisor decision was persisted (any verdict). */
  'decision-created': {
    /** Full Decision JSON. Type is `unknown` here to avoid pulling in the
     *  agent's heavy type tree from this lib module. The SSE route just
     *  JSON.stringifies whatever we get — receivers do their own typing. */
    decision: unknown;
  };
  /** An escalated decision was resolved (approve / veto). */
  'decision-resolved': {
    decisionId: string;
    resolution: 'approved' | 'vetoed';
    resolvedBy?: 'human' | 'auto-timeout';
  };
  /** A broker fill landed for an open position. */
  'execution-filled': {
    /** Full Execution JSON. See `decision-created` note above for typing. */
    execution: unknown;
  };
  /** A trade closed and an outcome row was written. */
  'outcome-written': {
    outcome: unknown;
  };
  /** Market regime tag flipped (e.g. calm → volatile). */
  'regime-changed': {
    regime: unknown;
  };
  /** Bandit allocator finished a recompute (weekly cron or manual). */
  'bandit-recomputed': {
    weights: unknown;
  };
  /** Master / portfolio / strategy kill switch state changed. */
  'kill-switch-changed': {
    status: unknown;
  };
  /** Heartbeat keep-alive — emitted by the SSE route, not by producers. */
  'heartbeat': {
    ts: number;
  };
}

export type AppEventName = keyof AppEventMap;

// ── The bus singleton ──────────────────────────────────────────────────

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Default 10 → can hit the warning at 2 connected dashboards x 7 channels.
    // Cap raised to a per-bus comfortable ceiling. Concurrent SSE clients are
    // capped separately at 50 in the route handler.
    this.emitter.setMaxListeners(500);
  }

  emit<K extends AppEventName>(name: K, payload: AppEventMap[K]): void {
    // Synchronous fan-out — no awaits inside producer hot paths. The SSE
    // route is the only listener and it never blocks.
    this.emitter.emit(name, payload);
  }

  on<K extends AppEventName>(
    name: K,
    handler: (payload: AppEventMap[K]) => void,
  ): () => void {
    this.emitter.on(name, handler as (...args: unknown[]) => void);
    return () => this.emitter.off(name, handler as (...args: unknown[]) => void);
  }
}

export const appEventBus: TypedEventBus = new TypedEventBus();

/**
 * Convenience helper for producers — single-line emit. Failures here MUST
 * never propagate; emitter errors are swallowed.
 */
export function emitAppEvent<K extends AppEventName>(
  name: K,
  payload: AppEventMap[K],
): void {
  try {
    appEventBus.emit(name, payload);
  } catch {
    // Intentionally silent — events are advisory.
  }
}
