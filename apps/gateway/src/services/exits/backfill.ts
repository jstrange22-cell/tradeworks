/**
 * One-shot backfill for trade_outcomes.
 *
 * Reads existing JSONL/JSON ledgers on disk, joins by `decisionId` against the
 * TradeVisor decisions store, and writes one outcome row per closed trade.
 *
 * Run on demand:
 *   pnpm --filter @tradeworks/gateway backfill-outcomes
 *
 * Sources scanned:
 *   - data/tradevisor-decisions.jsonl  (decision UUIDs + signals)
 *   - data/stocks/paper-ledger.json    (equityClosed[], optionClosed[])
 *   - data/cex/paper-state.json        (trades[] — sells with decisionId)
 *   - data/dex/paper-state.json        (closedTrades[] — pre-A6 lacks decisionId, skip)
 *
 * Pre-A6 trades that lack `decisionId` are SKIPPED — we do not generate
 * synthetic decision rows because the decision context (verdict, reasoning,
 * confidence, news, chart state) is gone, so the row would be useless for
 * learning.
 *
 * Idempotent: `upsertOutcome` is ON CONFLICT DO UPDATE keyed on decision_id,
 * so re-running this script just refreshes the same set of rows.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { logger } from '../../lib/logger.js';
import { closeMemoryPool, getPool } from '../memory/index.js';
import { writeOutcome } from './outcome-writer.js';
import type { ExitReason } from '../memory/types.js';
import type {
  EquityClosedTrade,
  OptionClosedTrade,
  PaperLedgerState,
} from '../stock-intelligence/stock-models.js';
import { mapReasonToExitReason, computeRMultiple } from './outcome-writer.js';

interface BackfillCounts {
  equityWritten: number;
  equitySkipped: number;
  optionWritten: number;
  optionSkipped: number;
  cexWritten: number;
  cexSkipped: number;
  dexSkipped: number;
}

const TRADEVISOR_DECISIONS_FILE = resolve(
  process.env['TRADEVISOR_DECISIONS_FILE'] ?? './data/tradevisor-decisions.jsonl',
);
const STOCK_LEDGER_FILE = resolve('./data/stocks/paper-ledger.json');
const CEX_STATE_FILE = resolve('./data/cex/paper-state.json');
const DEX_STATE_FILE = resolve('./data/dex/paper-state.json');

/** Loads decision IDs known to TradeVisor — backfill only attributes to these. */
function loadKnownDecisionIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(TRADEVISOR_DECISIONS_FILE)) return ids;
  try {
    const lines = readFileSync(TRADEVISOR_DECISIONS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const d = JSON.parse(line) as { id?: string };
        if (d.id) ids.add(d.id);
      } catch { /* skip corrupt line */ }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, file: TRADEVISOR_DECISIONS_FILE },
      '[exits.backfill] failed to read decisions JSONL',
    );
  }
  return ids;
}

async function backfillEquityClosed(
  closed: EquityClosedTrade[],
  knownDecisionIds: Set<string>,
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const trade of closed) {
    if (!trade.decisionId || !knownDecisionIds.has(trade.decisionId)) {
      skipped++;
      continue;
    }
    const exitReason: ExitReason = 'apex_close'; // EquityCloseReason → ExitReason approximation
    const rMultiple = computeRMultiple(
      trade.pnlUsd,
      trade.entryPrice,
      trade.stopLossPrice ?? null,
      trade.shares,
    );
    const openMs = new Date(trade.entryAt).getTime();
    const closeMs = new Date(trade.exitAt).getTime();
    const holdingMinutes = Number.isFinite(openMs) && Number.isFinite(closeMs)
      ? Math.max(0, (closeMs - openMs) / 60_000)
      : null;

    const row = await writeOutcome({
      decisionId: trade.decisionId,
      realizedPnlUsd: trade.pnlUsd,
      rMultiple,
      wasStopHit: false,    // close reason not preserved on EquityClosedTrade — best-effort
      wasTargetHit: trade.pnlUsd > 0,
      holdingMinutes,
      exitReason,
      notes: `backfill equity ${trade.symbol} score=${trade.signalScore}`,
      closedAt: trade.exitAt,
    });
    if (row) written++;
    else skipped++;
  }
  return { written, skipped };
}

async function backfillOptionClosed(
  closed: OptionClosedTrade[],
  knownDecisionIds: Set<string>,
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const trade of closed) {
    if (!trade.decisionId || !knownDecisionIds.has(trade.decisionId)) {
      skipped++;
      continue;
    }
    const exitReason: ExitReason = 'apex_close';
    const qty = trade.contracts * 100;
    const rMultiple = computeRMultiple(
      trade.pnlUsd,
      trade.entryMid,
      trade.stopLossMid ?? null,
      qty,
    );
    const openMs = new Date(trade.entryAt).getTime();
    const closeMs = new Date(trade.exitAt).getTime();
    const holdingMinutes = Number.isFinite(openMs) && Number.isFinite(closeMs)
      ? Math.max(0, (closeMs - openMs) / 60_000)
      : null;

    const row = await writeOutcome({
      decisionId: trade.decisionId,
      realizedPnlUsd: trade.pnlUsd,
      rMultiple,
      wasStopHit: false,
      wasTargetHit: trade.pnlUsd > 0,
      holdingMinutes,
      exitReason,
      notes: `backfill option ${trade.symbol} occ=${trade.occSymbol}`,
      closedAt: trade.exitAt,
    });
    if (row) written++;
    else skipped++;
  }
  return { written, skipped };
}

interface CexTradeOnDisk {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  pnlUsd: number;
  reason: string;
  timestamp: string;
  decisionId?: string | null;
}

async function backfillCex(knownDecisionIds: Set<string>): Promise<{ written: number; skipped: number }> {
  if (!existsSync(CEX_STATE_FILE)) return { written: 0, skipped: 0 };
  let raw: { trades?: CexTradeOnDisk[] };
  try {
    raw = JSON.parse(readFileSync(CEX_STATE_FILE, 'utf8'));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, file: CEX_STATE_FILE },
      '[exits.backfill] failed to parse CEX state',
    );
    return { written: 0, skipped: 0 };
  }
  if (!Array.isArray(raw.trades)) return { written: 0, skipped: 0 };

  let written = 0;
  let skipped = 0;
  // Only SELL legs realise P&L. The BUY leg is on the entry side.
  for (const trade of raw.trades) {
    if (trade.side !== 'sell') continue;
    if (!trade.decisionId || !knownDecisionIds.has(trade.decisionId)) {
      skipped++;
      continue;
    }
    const exitReason = mapReasonToExitReason(trade.reason ?? 'manual');
    const row = await writeOutcome({
      decisionId: trade.decisionId,
      realizedPnlUsd: trade.pnlUsd,
      rMultiple: null,            // entry/stop not preserved on CEX trade rows
      wasStopHit: exitReason === 'stop',
      wasTargetHit: exitReason === 'target' || exitReason === 'trail',
      holdingMinutes: null,       // openedAt not preserved on the trade row
      exitReason,
      notes: `backfill cex ${trade.symbol} ${trade.reason}`,
      closedAt: trade.timestamp,
    });
    if (row) written++;
    else skipped++;
  }
  return { written, skipped };
}

function countDexSkipped(): number {
  // DEX path didn't carry decisionId pre-A6 wire-up. No useful rows to backfill.
  if (!existsSync(DEX_STATE_FILE)) return 0;
  try {
    const raw = JSON.parse(readFileSync(DEX_STATE_FILE, 'utf8')) as {
      closedTrades?: unknown[];
    };
    return Array.isArray(raw.closedTrades) ? raw.closedTrades.length : 0;
  } catch {
    return 0;
  }
}

export async function runBackfill(): Promise<BackfillCounts> {
  const counts: BackfillCounts = {
    equityWritten: 0, equitySkipped: 0,
    optionWritten: 0, optionSkipped: 0,
    cexWritten: 0,    cexSkipped: 0,
    dexSkipped: 0,
  };

  // Bail early if memory DB is offline — backfill needs real writes.
  if (!getPool()) {
    logger.error('[exits.backfill] MEMORY_DB_URL not set — cannot backfill outcomes');
    return counts;
  }

  const knownDecisionIds = loadKnownDecisionIds();
  logger.info({ decisions: knownDecisionIds.size }, '[exits.backfill] loaded TradeVisor decisions');

  // Stocks (equity + options) — both ledgers live in paper-ledger.json.
  if (existsSync(STOCK_LEDGER_FILE)) {
    try {
      const ledger = JSON.parse(readFileSync(STOCK_LEDGER_FILE, 'utf8')) as PaperLedgerState;
      const equityClosed = Array.isArray(ledger.equityClosed) ? ledger.equityClosed : [];
      const optionClosed = Array.isArray(ledger.optionClosed) ? ledger.optionClosed : [];

      const eq = await backfillEquityClosed(equityClosed, knownDecisionIds);
      counts.equityWritten = eq.written;
      counts.equitySkipped = eq.skipped;

      const op = await backfillOptionClosed(optionClosed, knownDecisionIds);
      counts.optionWritten = op.written;
      counts.optionSkipped = op.skipped;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, file: STOCK_LEDGER_FILE },
        '[exits.backfill] failed to read stock ledger',
      );
    }
  }

  // CEX — sells with decisionId.
  const cex = await backfillCex(knownDecisionIds);
  counts.cexWritten = cex.written;
  counts.cexSkipped = cex.skipped;

  // DEX — counted for visibility, never backfilled.
  counts.dexSkipped = countDexSkipped();

  return counts;
}

// ── CLI entry ──────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    // ESM main detection
    const url = new URL(`file://${process.argv[1].replace(/\\/g, '/')}`);
    return url.href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isMain) {
  void (async (): Promise<void> => {
    try {
      const counts = await runBackfill();
      logger.info(counts, '[exits.backfill] done');
      // Use stderr-friendly summary so CI captures it.
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(counts, null, 2));
      await closeMemoryPool();
      process.exit(0);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        '[exits.backfill] fatal',
      );
      await closeMemoryPool();
      process.exit(1);
    }
  })();
}
