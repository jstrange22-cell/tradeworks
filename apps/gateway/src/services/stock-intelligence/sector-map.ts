/**
 * Sector Map — Ticker → Sector classification + per-sector position cap gate.
 *
 * Used by stock-agent.ts to enforce "max N positions per sector" diversification
 * rule before opening a new equity position. Keeps the portfolio from becoming
 * concentrated in one slice of the market (e.g. 8 tech longs during a rally).
 *
 * The map covers the 50-ticker Phase 2 universe defined in tradevisor-watchlist.ts.
 * Unknown symbols fall through to 'unknown' and are allowed through the gate —
 * better to let a manually-added ticker trade than to reject it outright.
 */

export type Sector =
  | 'tech'
  | 'finance'
  | 'health'
  | 'energy'
  | 'consumer'
  | 'industrial'
  | 'utilities'
  | 'materials'
  | 'telecom'
  | 'realestate'
  | 'etf';

/**
 * 50-name Russell 1000 universe → sector classification.
 * Keep this in sync with TOP_STOCKS in tradevisor-watchlist.ts.
 */
export const TICKER_TO_SECTOR: Record<string, Sector> = {
  // ── Tech (10) ───────────────────────────────────────────────────────
  AAPL: 'tech',
  MSFT: 'tech',
  NVDA: 'tech',
  GOOGL: 'tech',
  META: 'tech',
  AMZN: 'tech',
  AMD: 'tech',
  CRM: 'tech',
  ORCL: 'tech',
  AVGO: 'tech',

  // ── Finance (7) ─────────────────────────────────────────────────────
  JPM: 'finance',
  BAC: 'finance',
  GS: 'finance',
  MS: 'finance',
  WFC: 'finance',
  V: 'finance',
  MA: 'finance',

  // ── Health (7) ──────────────────────────────────────────────────────
  UNH: 'health',
  JNJ: 'health',
  PFE: 'health',
  MRK: 'health',
  LLY: 'health',
  ABBV: 'health',
  TMO: 'health',

  // ── Consumer (7) ────────────────────────────────────────────────────
  WMT: 'consumer',
  COST: 'consumer',
  HD: 'consumer',
  NKE: 'consumer',
  MCD: 'consumer',
  SBUX: 'consumer',
  TGT: 'consumer',

  // ── Industrial (5) ──────────────────────────────────────────────────
  BA: 'industrial',
  CAT: 'industrial',
  GE: 'industrial',
  UPS: 'industrial',
  RTX: 'industrial',

  // ── Energy (4) ──────────────────────────────────────────────────────
  XOM: 'energy',
  CVX: 'energy',
  COP: 'energy',
  SLB: 'energy',

  // ── ETFs (5) ────────────────────────────────────────────────────────
  SPY: 'etf',
  QQQ: 'etf',
  IWM: 'etf',
  DIA: 'etf',
  XLK: 'etf',

  // ── Other (5) — bucketed to sector of principal business ────────────
  TSLA: 'consumer',    // Discretionary (autos)
  DIS: 'consumer',     // Discretionary (media/parks)
  NFLX: 'tech',        // Communication services / software
  PYPL: 'finance',     // Fintech
  UBER: 'tech',        // Software-platform (rideshare/delivery)
};

/**
 * Look up the sector for a symbol. Returns 'unknown' if not mapped so callers
 * can distinguish "uncategorised" from a real sector without throwing.
 */
export function getSector(symbol: string): Sector | 'unknown' {
  return TICKER_TO_SECTOR[symbol.toUpperCase()] ?? 'unknown';
}

/**
 * Decide whether a new position in `symbol` would exceed the per-sector cap.
 *
 * `currentPositions` is any array of objects that carry a `symbol` field —
 * works directly against `PaperLedgerState.equityPositions`. We count by
 * sector and reject when the proposed symbol's sector is already at or above
 * `maxPerSector`.
 *
 * Unknown-sector symbols are always allowed (can't cap what we can't classify).
 * ETFs also share a bucket; treat that the same way — the user typically
 * wants broad-market exposure gated separately from single-stock exposure,
 * but for now we use the same cap across all sectors.
 */
export function canOpenPosition(
  symbol: string,
  currentPositions: Array<{ symbol: string }>,
  maxPerSector: number = 2,
): { allowed: boolean; reason?: string } {
  const sector = getSector(symbol);
  if (sector === 'unknown') {
    return { allowed: true };
  }

  let count = 0;
  for (const pos of currentPositions) {
    if (getSector(pos.symbol) === sector) count++;
  }

  if (count >= maxPerSector) {
    return { allowed: false, reason: 'sector_cap_reached' };
  }

  return { allowed: true };
}
