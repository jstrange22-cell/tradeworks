/**
 * Position adapters for the unified exit monitor.
 *
 * The monitor evaluates rules against a normalised `OpenPosition` shape so
 * rule code doesn't fork per-asset. These adapters pull the live position
 * arrays from each book (equity ledger, options ledger, CEX portfolio) and
 * normalise them into that shape.
 *
 * Each adapter is best-effort: a failure pulling one book never breaks the
 * tick — we log and skip.
 */
import { logger } from '../../lib/logger.js';
import type { OpenPosition, StrategyTag } from './types.js';

// ── helpers ────────────────────────────────────────────────────────────

function inferStrategyFromSignalSource(signalSource: string | undefined): StrategyTag {
  if (!signalSource) return 'tradevisor';
  const s = signalSource.toLowerCase();
  if (s.includes('pead')) return 'PEAD';
  if (s.includes('regime') || s.includes('trend')) return 'regime_trend';
  if (s.includes('vol_rank') || s.includes('vol-rank')) return 'vol_rank_options';
  if (s.includes('sector') || s.includes('rotation')) return 'sector_rotation';
  if (s.includes('funding') || s.includes('basis')) return 'funding_basis';
  if (s.includes('range') || s.includes('grid')) return 'range_grid';
  return 'tradevisor';
}

// ── Equity adapter ─────────────────────────────────────────────────────

/**
 * Pull equity positions from the TradeVisor paper ledger and normalise to
 * `OpenPosition`. Lazy-imports the orchestrator so this module can be
 * tree-shaken out of gateways that don't enable stocks.
 */
export async function loadEquityPositions(): Promise<OpenPosition[]> {
  try {
    const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
    const ledger = loadPaperLedger();
    return ledger.equityPositions.map((p): OpenPosition => ({
      decisionId: p.decisionId ?? null,
      trackerId: `equity:${p.id}`,
      assetClass: 'equity',
      symbol: p.symbol,
      side: 'long',
      qty: p.shares,
      qtyAtEntry: p.shares, // legacy ledger doesn't track entry qty separately
      entryPrice: p.entryPrice,
      // Default stop = entry × 0.95 if the ledger row pre-dates the field.
      stopPrice: p.stopLossPrice ?? p.entryPrice * 0.95,
      openedAt: p.entryAt,
      strategy: inferStrategyFromSignalSource(p.signalSource),
      atrAtEntry: null, // legacy ledger doesn't capture ATR
      expiry: null,
      ladderPartialDone: false, // ledger doesn't track this; tracker file does
    }));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[exits.adapters] loadEquityPositions failed',
    );
    return [];
  }
}

// ── Option adapter ─────────────────────────────────────────────────────

export async function loadOptionPositions(): Promise<OpenPosition[]> {
  try {
    const { loadPaperLedger } = await import('../stock-intelligence/stock-orchestrator.js');
    const ledger = loadPaperLedger();
    return ledger.optionPositions.map((p): OpenPosition => ({
      decisionId: p.decisionId ?? null,
      trackerId: `option:${p.id}`,
      assetClass: 'option',
      symbol: p.symbol,
      side: 'long', // long-premium only for now
      qty: p.contracts,
      qtyAtEntry: p.contracts,
      entryPrice: p.entryMid,
      stopPrice: p.stopLossMid ?? p.entryMid * 0.5,
      openedAt: p.entryAt,
      strategy: inferStrategyFromSignalSource(p.signalSource),
      atrAtEntry: null,
      expiry: p.expiry,
      ladderPartialDone: false,
    }));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[exits.adapters] loadOptionPositions failed',
    );
    return [];
  }
}

// ── CEX adapter ────────────────────────────────────────────────────────

/**
 * CEX positions live in `data/cex/paper-state.json` keyed by symbol. We
 * read the persisted file here rather than reaching into crypto-agent's
 * private cexPortfolio map — that keeps the monitor decoupled from the
 * agent's lifecycle (the agent might still be booting).
 */
export async function loadCexPositions(): Promise<OpenPosition[]> {
  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const { resolve, join } = await import('node:path');
    const file = join(resolve('data/cex'), 'paper-state.json');
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
      positions?: Array<[string, { symbol: string; qty: number; avgEntry: number; currentPrice: number; openedAt: string; decisionId?: string | null }]>;
    };
    if (!Array.isArray(raw.positions)) return [];

    return raw.positions
      .map(([_key, p]) => p)
      .filter((p): p is NonNullable<typeof p> => !!p && p.qty > 0)
      .map((p): OpenPosition => ({
        decisionId: p.decisionId ?? null,
        trackerId: `cex:${p.symbol}`,
        assetClass: 'crypto-cex',
        symbol: p.symbol,
        side: 'long',
        qty: p.qty,
        qtyAtEntry: p.qty,
        entryPrice: p.avgEntry,
        // CEX persistence doesn't track stops — synthesise a -5% stop so
        // the hard-stop rule still has a basis to fire on. v3 should
        // capture the stop at trade time and round-trip it via the JSON.
        stopPrice: p.avgEntry * 0.95,
        openedAt: p.openedAt,
        strategy: inferStrategyFromSignalSource(undefined),
        atrAtEntry: null,
        expiry: null,
        ladderPartialDone: false,
      }));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      '[exits.adapters] loadCexPositions failed',
    );
    return [];
  }
}

// ── Combined load ──────────────────────────────────────────────────────

export async function loadAllOpenPositions(): Promise<OpenPosition[]> {
  const [eq, op, cex] = await Promise.all([
    loadEquityPositions(),
    loadOptionPositions(),
    loadCexPositions(),
  ]);
  return [...eq, ...op, ...cex];
}
