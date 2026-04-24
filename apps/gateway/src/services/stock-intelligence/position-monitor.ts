/**
 * Stock Position Monitor
 *
 * 30-second interval loop that:
 *   1. Refreshes currentPrice / currentMid on every open equity & option
 *      position in the TradeVisor paper ledger (so the dashboard actually
 *      shows movement).
 *   2. Evaluates the exit stack per position:
 *        - Hard stop  (-5% equity, -50% option)
 *        - Trailing TP (arm at +3%, close on 1% retracement from high)
 *        - Time stop  (5 trading days ≈ 7 calendar days for equity;
 *                      1 trading day before expiry for options)
 *      Exits call into `closeEquityPosition` / `closeOptionPosition` in
 *      stock-agent.ts so all P&L accounting stays in one place.
 *
 * Only runs when ENABLE_STOCKS === 'true'. When the US market is closed,
 * snapshots still refresh (quotes don't change much but lastPriceAt ticks),
 * but exit triggers other than the time stop are skipped — we don't want to
 * fire a hard stop on a stale after-hours print.
 */

import { logger } from '../../lib/logger.js';
import type { EquityPosition, OptionPosition } from './stock-models.js';
import { loadPaperLedger } from './stock-orchestrator.js';
import { getSnapshots, isMarketOpen } from '../stocks/alpaca-client.js';
import { getOptionQuote } from '../stocks/robinhood-options.js';
import { closeEquityPosition, closeOptionPosition } from './stock-agent.js';

const TICK_INTERVAL_MS = 30_000;

// Equity exit thresholds
const EQUITY_HARD_STOP_PCT = -5;      // close at -5% unrealized
const EQUITY_TRAIL_ARM_PCT = 3;       // arm trailing TP at +3%
const EQUITY_TRAIL_GIVEBACK_PCT = 1;  // close if we give back 1% from high
const EQUITY_TIME_STOP_DAYS = 7;      // ~5 trading days

// Option exit thresholds (options halve quickly)
const OPTION_HARD_STOP_PCT = -50;
const OPTION_TRAIL_ARM_PCT = 25;      // arm trailing at +25% (options swing harder)
const OPTION_TRAIL_GIVEBACK_PCT = 10; // close on 10% retracement from high

// Close 1 trading day before expiry (options decay hard on final day)
const OPTION_DAYS_BEFORE_EXPIRY = 1;

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startStockPositionMonitor(): void {
  if (process.env.ENABLE_STOCKS !== 'true') {
    logger.info('[PositionMonitor] ENABLE_STOCKS != true — not starting');
    return;
  }
  if (monitorInterval) {
    logger.info('[PositionMonitor] already running');
    return;
  }

  logger.info({ intervalMs: TICK_INTERVAL_MS }, '[PositionMonitor] starting');
  // Fire one tick immediately, then on the interval.
  void tick();
  monitorInterval = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}

export function stopStockPositionMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('[PositionMonitor] stopped');
  }
}

// ── Tick ────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  try {
    const ledger = loadPaperLedger();
    const equityCount = ledger.equityPositions.length;
    const optionCount = ledger.optionPositions.length;

    if (equityCount === 0 && optionCount === 0) {
      return;
    }

    const marketOpen = isMarketOpen();
    let exits = 0;

    // ── Equity refresh + exits ──────────────────────────────────────────
    if (equityCount > 0) {
      const symbols = Array.from(new Set(ledger.equityPositions.map(p => p.symbol)));
      let snapshots: Record<string, { latestTrade?: { p: number } }> = {};
      try {
        snapshots = await getSnapshots(symbols) as unknown as Record<string, { latestTrade?: { p: number } }>;
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : err, symbols: symbols.length },
          '[PositionMonitor] getSnapshots failed — skipping equity refresh this tick',
        );
      }

      // Snapshot: copy the array so we can iterate while closeEquityPosition
      // mutates the underlying ledger.
      const positions = [...ledger.equityPositions];
      for (const pos of positions) {
        const snap = snapshots[pos.symbol];
        const latestPx = snap?.latestTrade?.p;
        if (latestPx && latestPx > 0) {
          pos.currentPrice = latestPx;
          pos.lastPriceAt = new Date().toISOString();
        }

        const exitReason = evaluateEquityExits(pos, marketOpen);
        if (exitReason) {
          try {
            await closeEquityPosition(pos, pos.currentPrice, exitReason);
            exits++;
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : err, symbol: pos.symbol },
              '[PositionMonitor] closeEquityPosition failed',
            );
          }
        }
      }

      // After evaluation, persist the price refreshes for any position that
      // didn't exit. closeEquityPosition already persists for exits, but
      // price-only updates still need to hit disk.
      // Re-load the current ledger (in case closes mutated it) and reuse
      // the mutated pos references — they still point into the current
      // ledger's equityPositions for the survivors.
      //
      // NOTE: closeEquityPosition removes from the ledger in-memory and
      // persists; our `pos` references are stale for closed ones, but the
      // survivors were mutated by reference so their updates are already
      // in the ledger object that got saved during any subsequent close.
      // To cover the no-exit case, we persist once here.
      if (exits === 0) {
        // import lazily to avoid circular concerns
        const { savePaperLedger } = await import('./stock-orchestrator.js');
        savePaperLedger(ledger);
      }
    }

    // ── Option refresh + exits ──────────────────────────────────────────
    if (optionCount > 0) {
      const optionPositions = [...ledger.optionPositions];
      for (const pos of optionPositions) {
        let latestMid = 0;
        let latestIV = 0;
        try {
          const quote = await getOptionQuote(pos.occSymbol);
          if (quote?.mid && quote.mid > 0) {
            latestMid = quote.mid;
          }
          if (typeof quote?.iv === 'number' && quote.iv > 0) {
            latestIV = quote.iv;
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : err, occ: pos.occSymbol },
            '[PositionMonitor] getOptionQuote failed — skipping this option this tick',
          );
        }

        if (latestMid > 0) {
          pos.currentMid = latestMid;
          pos.lastPriceAt = new Date().toISOString();
        }

        const exitReason = evaluateOptionExits(pos, marketOpen, latestIV);
        if (exitReason) {
          try {
            await closeOptionPosition(pos, pos.currentMid, exitReason);
            exits++;
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : err, occ: pos.occSymbol },
              '[PositionMonitor] closeOptionPosition failed',
            );
          }
        }
      }

      // Persist option-side price refreshes if no exits fired (close
      // helpers persist on their own).
      if (ledger.optionPositions.length === optionPositions.length) {
        const { savePaperLedger } = await import('./stock-orchestrator.js');
        savePaperLedger(ledger);
      }
    }

    logger.info(
      { equity: equityCount, options: optionCount, exits, marketOpen },
      `[PositionMonitor] tick: refreshed ${equityCount} equity + ${optionCount} options, fired ${exits} exits`,
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[PositionMonitor] tick failed',
    );
  }
}

// ── Exit Evaluation ─────────────────────────────────────────────────────

type EquityExitReason = 'hard_stop' | 'trailing_tp' | 'time_stop';

function evaluateEquityExits(
  pos: EquityPosition,
  marketOpen: boolean,
): EquityExitReason | null {
  if (pos.entryPrice <= 0) return null;

  const pnlPct = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

  // Update high-water mark even when market is closed — it's just bookkeeping.
  const prevHigh = pos.highWaterPct ?? 0;
  if (pnlPct > prevHigh) pos.highWaterPct = pnlPct;

  // Arm trailing TP when we cross +3%.
  if (!pos.trailingArmed && pnlPct >= EQUITY_TRAIL_ARM_PCT) {
    pos.trailingArmed = true;
  }

  // Time stop: fires regardless of market state. Prevents positions from
  // living forever during a long weekend or holiday.
  const ageMs = Date.now() - new Date(pos.entryAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays >= EQUITY_TIME_STOP_DAYS) return 'time_stop';

  // Price-based exits only fire during market hours (avoid acting on
  // stale after-hours prints).
  if (!marketOpen) return null;

  if (pnlPct <= EQUITY_HARD_STOP_PCT) return 'hard_stop';

  if (pos.trailingArmed) {
    const high = pos.highWaterPct ?? pnlPct;
    if (pnlPct <= high - EQUITY_TRAIL_GIVEBACK_PCT) return 'trailing_tp';
  }

  return null;
}

type OptionExitReason = 'hard_stop' | 'trailing_tp' | 'time_stop' | 'iv_crush';

// Phase 4.2: IV expansion trigger. If current IV has expanded >= 20% relative
// to entry IV (e.g. 30% → 36%), close the position regardless of P&L. Elevated
// IV often precedes adverse moves and inflates premium decay risk on any
// mean-reversion pullback.
const OPTION_IV_EXPANSION_PCT = 0.20;

function evaluateOptionExits(
  pos: OptionPosition,
  marketOpen: boolean,
  latestIV: number,
): OptionExitReason | null {
  if (pos.entryMid <= 0) return null;

  const pnlPct = ((pos.currentMid - pos.entryMid) / pos.entryMid) * 100;

  const prevHigh = pos.highWaterPct ?? 0;
  if (pnlPct > prevHigh) pos.highWaterPct = pnlPct;

  if (!pos.trailingArmed && pnlPct >= OPTION_TRAIL_ARM_PCT) {
    pos.trailingArmed = true;
  }

  // Time stop: close N trading days before expiry.
  // We approximate "trading days" as calendar days minus weekend adjustment:
  //   if expiry - now <= 1 calendar day (and not closed already), exit.
  // This is the dumb-but-safe version; Phase 4 will refine.
  if (pos.expiry) {
    const expiryMs = new Date(pos.expiry + 'T16:00:00Z').getTime();
    const daysToExpiry = (expiryMs - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysToExpiry <= OPTION_DAYS_BEFORE_EXPIRY) return 'time_stop';
  }

  if (!marketOpen) return null;

  if (pnlPct <= OPTION_HARD_STOP_PCT) return 'hard_stop';

  // Phase 4.2: IV-expansion exit. Only runs if we have both a valid entryIV
  // and a valid latestIV; otherwise skip gracefully (synthetic-chain paper
  // fills often record entryIV=0, in which case this is a no-op).
  if (pos.entryIV > 0 && latestIV > 0) {
    const ivChangeRel = (latestIV - pos.entryIV) / pos.entryIV;
    if (ivChangeRel >= OPTION_IV_EXPANSION_PCT) {
      return 'iv_crush';
    }
  }

  if (pos.trailingArmed) {
    const high = pos.highWaterPct ?? pnlPct;
    if (pnlPct <= high - OPTION_TRAIL_GIVEBACK_PCT) return 'trailing_tp';
  }

  return null;
}
