/**
 * Trade outcome attribution writer.
 *
 * Closes the learning loop: when a position exits (TradeVisor SELL, hard stop,
 * trailing TP, time stop, or any other reason), this module computes the
 * realized-P&L attribution row and writes it to `trade_outcomes` keyed by
 * `decision_id`.
 *
 * Without this, we cannot answer "of the 207 BUY signals APEX approved last
 * month, what was the realized P&L?" — and without that, no learning loop is
 * possible.
 *
 * Design notes:
 *   - All math is done here (not at the call sites) so the same formulae apply
 *     for equity, options, and CEX trades.
 *   - The underlying memory.upsertOutcome already no-ops when MEMORY_DB_URL is
 *     unset, so this whole path is silent off-prod.
 *   - We never throw to callers — exit logic must keep running even if the
 *     memory DB is unreachable.
 */
import { logger } from '../../lib/logger.js';
import { upsertOutcome } from '../memory/index.js';
import type { ExitReason, OutcomeRow } from '../memory/types.js';
import { emitAppEvent } from '../../lib/events-bus.js';

// ── Public input shapes ────────────────────────────────────────────────

/**
 * Pre-computed outcome — the caller already did the math (e.g. it had access
 * to qty, fees, exit price as part of its existing close logic).
 */
export interface DirectOutcomeInput {
  decisionId: string | null | undefined;
  realizedPnlUsd: number;
  rMultiple?: number | null;
  wasStopHit?: boolean | null;
  wasTargetHit?: boolean | null;
  holdingMinutes?: number | null;
  exitReason: ExitReason;
  notes?: string | null;
  closedAt?: Date | string;
}

/**
 * Compute-from-fields input — let this module do the math. Use this from the
 * close handlers that have entry/exit/qty etc. handy. `side` defaults to
 * `'long'`; pass `'short'` for short positions so the P&L sign flips.
 */
export interface ComputeOutcomeInput {
  decisionId: string | null | undefined;
  side?: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  /** Per-share fees (or per-contract fees for options). Optional, default 0. */
  fees?: number;
  /** Stop-loss price the trade was opened with. Used to compute R-multiple.
   *  Pass null/undefined for stopless trades — rMultiple will be null. */
  stopPrice?: number | null;
  /** ISO timestamp or Date when the position was opened. */
  openedAt: string | Date;
  /** ISO timestamp or Date when the position closed. Defaults to now. */
  closedAt?: string | Date;
  /** Existing exit reason from the close handler. Mapped to ExitReason below. */
  exitReason: ExitReason | string;
  notes?: string | null;
}

// ── Internal helpers ───────────────────────────────────────────────────

/**
 * Map every callsite's existing `reason` string into a canonical ExitReason.
 * The schema only accepts: 'stop' | 'target' | 'trail' | 'time' | 'apex_close'
 * | 'manual'. Anything we don't recognise falls back to 'manual' so the row
 * still writes — better to capture an under-classified outcome than drop it.
 */
export function mapReasonToExitReason(raw: string): ExitReason {
  const r = raw.toLowerCase();
  if (r === 'stop' || r === 'hard_stop' || r.includes('stop_loss')) return 'stop';
  if (r === 'target' || r === 'profit_target' || r === 'take_profit' || r === 'tp') return 'target';
  if (r === 'trail' || r === 'trailing_tp' || r === 'trailing') return 'trail';
  if (r === 'time' || r === 'time_stop' || r === 'expiry' || r === 'iv_crush') return 'time';
  if (r === 'apex_close' || r === 'tv_sell' || r === 'kill_switch') return 'apex_close';
  if (r === 'manual' || r === 'legacy') return 'manual';
  return 'manual';
}

/**
 * Compute realized P&L in USD.
 *   long:  pnl = (exit - entry) * qty - fees
 *   short: pnl = (entry - exit) * qty - fees
 */
export function computePnlUsd(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  side: 'long' | 'short',
  fees = 0,
): number {
  const direction = side === 'short' ? -1 : 1;
  return (exitPrice - entryPrice) * qty * direction - fees;
}

/**
 * Compute R-multiple = realizedPnl / risk-per-trade-usd.
 * Risk-per-trade-usd = abs(entry - stop) * qty.
 *
 * Returns `null` for stopless trades (no risk basis to normalise against) or
 * if the inputs are malformed.
 */
export function computeRMultiple(
  realizedPnlUsd: number,
  entryPrice: number,
  stopPrice: number | null | undefined,
  qty: number,
): number | null {
  if (stopPrice == null || !Number.isFinite(stopPrice) || stopPrice <= 0) return null;
  if (!Number.isFinite(entryPrice) || !Number.isFinite(qty) || qty <= 0) return null;
  const riskPerTrade = Math.abs(entryPrice - stopPrice) * qty;
  if (riskPerTrade <= 0) return null;
  return realizedPnlUsd / riskPerTrade;
}

function holdingMinutesBetween(openedAt: string | Date, closedAt: string | Date): number {
  const openMs = openedAt instanceof Date ? openedAt.getTime() : new Date(openedAt).getTime();
  const closeMs = closedAt instanceof Date ? closedAt.getTime() : new Date(closedAt).getTime();
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) return 0;
  return Math.max(0, (closeMs - openMs) / 60_000);
}

// ── Public writer ──────────────────────────────────────────────────────

/**
 * Write a pre-computed outcome to the memory DB. Returns `null` and logs (no
 * throw) when:
 *   - decisionId is missing (legacy trade pre-A6 — nothing to attribute to)
 *   - the memory DB is unavailable (MEMORY_DB_URL unset)
 *   - the upsert errors out
 */
export async function writeOutcome(input: DirectOutcomeInput): Promise<OutcomeRow | null> {
  if (!input.decisionId) {
    // Pre-A6 trade — no decision to attribute to. Silent (logging here would
    // be noisy because every legacy position triggers this on close).
    return null;
  }

  try {
    const row = await upsertOutcome({
      decisionId: input.decisionId,
      realizedPnlUsd: input.realizedPnlUsd,
      rMultiple: input.rMultiple ?? null,
      wasStopHit: input.wasStopHit ?? null,
      wasTargetHit: input.wasTargetHit ?? null,
      holdingMinutes: input.holdingMinutes ?? null,
      exitReason: input.exitReason,
      notes: input.notes ?? null,
      closedAt: input.closedAt,
    });
    if (row) {
      logger.info(
        {
          decisionId: input.decisionId,
          pnlUsd: input.realizedPnlUsd.toFixed(2),
          rMultiple: input.rMultiple?.toFixed(2),
          exitReason: input.exitReason,
        },
        '[exits.outcome] wrote attribution',
      );
      // Fan out to SSE: dashboards refresh P&L queries off this event so
      // realized P&L tickers update the moment a position closes. Also emit
      // `decision-resolved` so any pending-decision UI can clear the row.
      emitAppEvent('outcome-written', { outcome: row });
      emitAppEvent('decision-resolved', {
        decisionId: input.decisionId,
        resolution: 'approved', // outcome rows only exist for approved trades
      });
    }
    return row;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, decisionId: input.decisionId },
      '[exits.outcome] writeOutcome failed — non-fatal',
    );
    return null;
  }
}

/**
 * Compute + write — the convenient one-shot API for close handlers. Use this
 * when you have entry/exit/qty handy and don't want to do the math yourself.
 *
 * Required: decisionId, entryPrice, exitPrice, qty, openedAt, exitReason.
 * Optional: side (default 'long'), fees (default 0), stopPrice, closedAt, notes.
 */
export async function writeOutcomeFromTrade(input: ComputeOutcomeInput): Promise<OutcomeRow | null> {
  if (!input.decisionId) return null;

  const side = input.side ?? 'long';
  const fees = input.fees ?? 0;
  const closedAt = input.closedAt ?? new Date().toISOString();

  const realizedPnlUsd = computePnlUsd(
    input.entryPrice,
    input.exitPrice,
    input.qty,
    side,
    fees,
  );
  const rMultiple = computeRMultiple(realizedPnlUsd, input.entryPrice, input.stopPrice, input.qty);
  const exitReason = mapReasonToExitReason(input.exitReason);
  const wasStopHit = exitReason === 'stop';
  const wasTargetHit = exitReason === 'target' || exitReason === 'trail';
  const holdingMinutes = holdingMinutesBetween(input.openedAt, closedAt);

  return writeOutcome({
    decisionId: input.decisionId,
    realizedPnlUsd,
    rMultiple,
    wasStopHit,
    wasTargetHit,
    holdingMinutes,
    exitReason,
    notes: input.notes ?? null,
    closedAt,
  });
}
