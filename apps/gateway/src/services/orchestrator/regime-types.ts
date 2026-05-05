/**
 * Market Regime Detection — type definitions.
 *
 * The regime classifier produces a single tag per evaluation that downstream
 * consumers (TradeVisor reasoner, bandit allocator, sizing module, heat
 * tracker) use to gate / scale risk. This is the v2 APEX port of
 * `research/research/lib/regimes.py`.
 *
 * Regimes are mutually exclusive — exactly one is in effect at any time:
 *
 *   calm       — VIX low, SPY above 200 MA but no decisive move. Default.
 *                Favors mean-reversion, range, vol-selling strategies.
 *   trending   — SPY > 200 MA AND |20d return| > 3%, VIX subdued.
 *                Favors trend-following, breakouts, momentum.
 *   volatile   — VIX > 22 OR realized vol > 25% (annualized).
 *                Smaller sizes, tighter stops, fewer entries.
 *   crisis     — VIX > 35, OR (SPY < 200 MA AND VIX > 25), OR 20d return < -10%.
 *                Hard sizing gate — D2 returns zero quantity for new trades.
 *                D3 heat budget scales by HEAT_REGIME_VOLATILE_SCALAR.
 */

export type RegimeTag = 'calm' | 'trending' | 'volatile' | 'crisis';

/**
 * Raw signal values that fed into the classification. All numbers are the
 * latest available reading; nulls indicate the data source was unreachable
 * and a fallback default was used.
 */
export interface RegimeSignals {
  /** SPY closing price for the asOf date. */
  spyClose: number;
  /** 200-day simple moving average of SPY close. */
  spy200ma: number;
  /** 50-day simple moving average of SPY close. */
  spy50ma: number;
  /** CBOE VIX index level (^VIX close). */
  vix: number;
  /** BTC dominance %  (CoinGecko global). null if fetch failed. */
  btcDominance: number | null;
  /** US Dollar Index level. null if fetch failed (free source unreliable). */
  dxy: number | null;
  /** SPY rolling 20d simple return (e.g. 0.021 = +2.1%). */
  spy20dReturn: number;
  /** SPY 20d realized volatility, annualized (e.g. 0.18 = 18%). */
  spy20dRealizedVol: number;
}

/**
 * Single canonical regime snapshot. Cached for 30 minutes by `getCurrentRegime`
 * and persisted to `data/last-regime.json` so cold starts (no internet) can
 * still serve a previous reading instead of falling back to default-calm.
 */
export interface MarketRegime {
  tag: RegimeTag;
  /**
   * 0..1 — how decisively the rule's thresholds were crossed. Computed from
   * the dominant rule's normalised distance from boundary (e.g. VIX=24 just
   * over 22 → 0.6; VIX=40 → 0.95). Useful for the reasoner to soften vetoes
   * on borderline classifications.
   */
  confidence: number;
  /** ISO-8601 timestamp of when this regime was computed. */
  asOf: string;
  signals: RegimeSignals;
  /** Human-readable one-liner explaining why this regime was chosen. */
  rationale: string;
}

/** Persisted shape of `data/last-regime.json`. */
export interface LastRegimeFile {
  schemaVersion: 1;
  regime: MarketRegime;
  /** Epoch ms — used to detect when the cached value is stale on cold start. */
  cachedAt: number;
}
