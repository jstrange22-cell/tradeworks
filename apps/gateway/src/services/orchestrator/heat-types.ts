/**
 * Portfolio Heat Tracker — Type definitions.
 *
 * "Heat" is the sum of *open risk* on the table — the dollar amount the
 * portfolio would lose if every open position hit its hard stop simultaneously.
 *
 * Three budgets gate new signals:
 *   - total open risk      ≤ HEAT_TOTAL_MAX_PCT   of equity (default 6%)
 *   - per-sector exposure  ≤ HEAT_SECTOR_MAX_PCT  of equity (default 2%)
 *   - per-factor exposure  ≤ HEAT_FACTOR_MAX_PCT  of equity (default 3%)
 *
 * The pre-trade gate (`checkHeatBudget`) is invoked from the TradeVisor
 * webhook AFTER agent approval but BEFORE executor dispatch. This catches
 * sneaky concentration risk (e.g. five 1%-risk longs all in tech stacking
 * up to 5% sector heat) before it ever hits the ledger.
 */

/**
 * GICS-aligned 11-sector taxonomy plus an `Unknown` bucket for symbols not
 * yet in the static factor map. ETFs are mapped to their dominant sector
 * (XLK → Technology, GLD → Materials, etc.).
 */
export type GICSSector =
  | 'Technology'
  | 'Financials'
  | 'Health Care'
  | 'Consumer Discretionary'
  | 'Consumer Staples'
  | 'Industrials'
  | 'Energy'
  | 'Utilities'
  | 'Materials'
  | 'Communication Services'
  | 'Real Estate'
  | 'Unknown';

/**
 * Factor tags applied to each tradeable symbol. A given symbol can carry
 * multiple tags (e.g. NVDA → ['momentum', 'large_cap', 'high_beta', 'growth']).
 *
 * Tags drive the per-factor heat budget — if total open risk across all
 * positions tagged 'momentum' exceeds HEAT_FACTOR_MAX_PCT, new momentum
 * signals are vetoed even if no individual sector is at cap.
 */
export type FactorTag =
  | 'momentum'
  | 'value'
  | 'small_cap'
  | 'large_cap'
  | 'high_beta'
  | 'low_vol'
  | 'growth'
  | 'dividend';

/**
 * Static metadata for a symbol. The v2 factor-map ships hand-curated entries
 * for ~200 liquid US equities + sector ETFs. v3 should replace this with an
 * ETL job pulling live sector + beta from Polygon / FMP / Alpaca asset
 * metadata.
 */
export interface FactorMeta {
  sector: GICSSector;
  betaToSpy?: number;
  factorTags: FactorTag[];
}

/**
 * One row in the open-risk enumeration. The risk dollar amount equals
 * `qty × |entry − stop|`. For shorts the calculation flips so we still get
 * a positive risk figure.
 */
export interface OpenRiskItem {
  decisionId: string;
  symbol: string;
  side: 'buy' | 'sell' | 'short';
  qty: number;
  entryPrice: number;
  stopPrice: number;
  riskUsd: number;
  sector: string;
  factorTags: string[];
}

/**
 * Aggregated heat snapshot returned by `getPortfolioHeat()`. All percentages
 * are expressed as a 0-1 fraction of equity (0.025 = 2.5%) — the cockpit UI
 * multiplies by 100 for display.
 */
export interface PortfolioHeat {
  totalEquityUsd: number;
  totalOpenRiskUsd: number;
  /** % of equity, on a 0-1 scale (e.g. 0.04 = 4%). */
  totalOpenRiskPct: number;
  bySector: Record<string, { riskUsd: number; pct: number }>;
  byFactor: Record<string, { riskUsd: number; pct: number }>;
  budgets: {
    totalOpenRiskMaxPct: number;
    perSectorMaxPct: number;
    perFactorMaxPct: number;
  };
  utilization: {
    /** totalOpenRiskPct / totalOpenRiskMaxPct (0..1+; >1 means over budget). */
    total: number;
    worstSector: { sector: string; utilization: number };
    worstFactor: { factor: string; utilization: number };
  };
}

/**
 * Heat-budget check result. `ok: false` carries the offending budget name
 * and the cap so the caller can stamp an audit trail and reject the signal.
 */
export type HeatCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      offendingBudget: 'total' | 'sector' | 'factor';
      /** Current utilization fraction (current pct / cap pct). */
      current: number;
      /** Cap as a 0-1 fraction. */
      cap: number;
    };
