/**
 * Type 7 Detector: Options-Implied Probability — 2026 FRONTIER
 *
 * Options chains encode implied probability distributions.
 * When options say 62% and prediction market says 55%, someone's wrong.
 * Nobody else does this yet. Edge: 5-10%.
 *
 * Implementation: Fetch Deribit BTC/ETH options, calculate implied probability
 * via simplified Black-Scholes d2, compare to Kalshi crypto markets.
 */

import { randomUUID } from 'crypto';
import type { ArbOpportunity, NormalizedMarket, DetectorResult } from '../models.js';

const DETECTOR_TYPE = 'type7_options_implied' as const;

// ── Black-Scholes Helpers ───────────────────────────────────────────────

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate implied probability that asset will be above strike at expiry.
 * Uses Black-Scholes d2 term: P(S > K) ≈ N(d2)
 *
 * d2 = [ln(S/K) + (r - σ²/2)T] / (σ√T)
 */
function impliedProbAboveStrike(
  spot: number,
  strike: number,
  volatility: number,  // annualized, e.g., 0.60 = 60%
  timeToExpiry: number, // in years, e.g., 0.25 = 3 months
  riskFreeRate = 0.045, // 4.5% US treasury
): number {
  if (timeToExpiry <= 0) return spot > strike ? 1.0 : 0.0;
  if (spot <= 0 || strike <= 0) return 0;

  const sqrtT = Math.sqrt(timeToExpiry);
  const d2 = (Math.log(spot / strike) + (riskFreeRate - (volatility * volatility) / 2) * timeToExpiry) / (volatility * sqrtT);
  return normCdf(d2);
}

// ── Deribit Options Data ────────────────────────────────────────────────

interface DeribitInstrument {
  instrument_name: string;
  strike: number;
  expiration_timestamp: number;
  option_type: 'call' | 'put';
  underlying_price?: number;
}

interface DeribitTicker {
  instrument_name: string;
  mark_iv: number; // implied volatility as percentage
  underlying_price: number;
}

async function fetchDeribitOptions(currency: 'BTC' | 'ETH'): Promise<{
  instruments: DeribitInstrument[];
  tickers: Map<string, DeribitTicker>;
} | null> {
  try {
    // Fetch active options instruments
    const instRes = await fetch(
      `https://www.deribit.com/api/v2/public/get_instruments?currency=${currency}&kind=option&expired=false`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!instRes.ok) return null;

    const instData = await instRes.json() as { result: DeribitInstrument[] };
    const instruments = instData.result || [];

    // Get tickers for ATM options (near current price)
    const tickers = new Map<string, DeribitTicker>();

    // Fetch index price for reference
    const indexRes = await fetch(
      `https://www.deribit.com/api/v2/public/get_index_price?index_name=${currency.toLowerCase()}_usd`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (indexRes.ok) {
      const indexData = await indexRes.json() as { result: { index_price: number } };
      const spot = indexData.result?.index_price ?? 0;

      // Filter to relevant strikes (within ±30% of spot)
      const relevantInsts = instruments.filter(i =>
        i.strike > spot * 0.7 && i.strike < spot * 1.3 && i.option_type === 'call',
      ).slice(0, 10); // limit API calls

      // Fetch ticker data for each
      for (const inst of relevantInsts) {
        try {
          const tickerRes = await fetch(
            `https://www.deribit.com/api/v2/public/ticker?instrument_name=${inst.instrument_name}`,
            { signal: AbortSignal.timeout(5_000) },
          );
          if (tickerRes.ok) {
            const tickerData = await tickerRes.json() as { result: DeribitTicker };
            if (tickerData.result) {
              tickers.set(inst.instrument_name, {
                ...tickerData.result,
                underlying_price: spot,
              });
            }
          }
        } catch {
          // skip individual ticker failures
        }
      }
    }

    return { instruments, tickers };
  } catch {
    return null;
  }
}

export async function scanType7(
  cryptoMarkets: NormalizedMarket[],
  minEdgePct = 5.0,
): Promise<DetectorResult> {
  const start = Date.now();
  const opportunities: ArbOpportunity[] = [];

  // Only scan BTC and ETH options (most liquid)
  for (const currency of ['BTC', 'ETH'] as const) {
    const optionsData = await fetchDeribitOptions(currency);
    if (!optionsData || optionsData.tickers.size === 0) continue;

    // Find prediction markets for this currency
    const symLower = currency.toLowerCase();
    const relatedMarkets = cryptoMarkets.filter(m => {
      const title = m.title.toLowerCase();
      return title.includes(symLower) || title.includes(currency === 'BTC' ? 'bitcoin' : 'ethereum');
    });

    for (const market of relatedMarkets) {
      const title = market.title.toLowerCase();

      // Extract threshold from market title
      const aboveMatch = title.match(/above\s*\$?([\d,]+)/);
      if (!aboveMatch) continue;

      const strike = parseFloat(aboveMatch[1].replace(/,/g, ''));
      if (strike <= 0) continue;

      // Find closest expiry options data
      for (const [, ticker] of optionsData.tickers) {
        if (!ticker.mark_iv || !ticker.underlying_price) continue;

        const spot = ticker.underlying_price;
        const iv = ticker.mark_iv / 100; // Convert percentage to decimal

        // Parse expiry from instrument name (e.g., BTC-28MAR25-100000-C)
        const instParts = ticker.instrument_name.split('-');
        if (instParts.length < 3) continue;
        const instStrike = parseFloat(instParts[2]);

        // Only use options near the prediction market's strike
        if (Math.abs(instStrike - strike) / strike > 0.1) continue;

        // Calculate time to expiry — use options instrument expiry, not market expiry
        // (market expiry can be empty/invalid on Polymarket)
        const instExpiry = optionsData.instruments.find(
          i => i.instrument_name === ticker.instrument_name,
        );
        let timeToExpiry: number;
        if (instExpiry?.expiration_timestamp) {
          timeToExpiry = Math.max(0, (instExpiry.expiration_timestamp - Date.now()) / (365.25 * 24 * 60 * 60 * 1000));
        } else {
          // Fallback: parse from instrument name (e.g., BTC-4APR26-65000-C)
          const expiryStr = market.expiresAt;
          const expiryDate = new Date(expiryStr);
          if (isNaN(expiryDate.getTime())) continue; // skip if no valid expiry
          timeToExpiry = Math.max(0, (expiryDate.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000));
        }

        if (timeToExpiry <= 0 || !Number.isFinite(timeToExpiry)) continue;

        // Calculate options-implied probability
        const optionsProb = impliedProbAboveStrike(spot, strike, iv, timeToExpiry);
        if (!Number.isFinite(optionsProb) || optionsProb <= 0 || optionsProb >= 1) continue;

        const marketProb = market.yesPrice;
        if (marketProb <= 0.01 || marketProb >= 0.99) continue; // skip near-settled markets

        const edgePct = Math.abs(optionsProb - marketProb) * 100;

        if (edgePct < minEdgePct || !Number.isFinite(edgePct)) continue;

        const side = optionsProb > marketProb ? 'yes' : 'no';
        const buyPrice = side === 'yes' ? marketProb : (1.0 - marketProb);
        if (buyPrice <= 0 || buyPrice >= 1) continue; // sanity check

        opportunities.push({
          id: randomUUID(),
          arbType: DETECTOR_TYPE,
          venue_a: market.venue,
          ticker_a: market.ticker,
          title_a: market.title,
          side_a: side,
          price_a: buyPrice,
          venue_b: 'deribit',
          ticker_b: ticker.instrument_name,
          title_b: `${currency} options chain (IV: ${ticker.mark_iv.toFixed(0)}%)`,
          side_b: side,
          price_b: optionsProb,
          totalCost: buyPrice,
          grossProfitPerContract: Math.abs(optionsProb - marketProb),
          netProfitPerContract: Math.abs(optionsProb - marketProb) - 0.02,
          fillableQuantity: Math.min(50, Math.floor(200 / buyPrice)),
          confidence: edgePct > 15 ? 0.50 : edgePct > 10 ? 0.60 : 0.75,
          urgency: edgePct > 10 ? 'high' : 'medium',
          category: market.category,
          description: `Options-implied: ${currency} options say ${(optionsProb * 100).toFixed(0)}%, market says ${(marketProb * 100).toFixed(0)}%. Edge: ${edgePct.toFixed(1)}%.`,
          reasoning: `Deribit IV=${ticker.mark_iv.toFixed(0)}%, spot=$${spot.toLocaleString()}, strike=$${strike.toLocaleString()}, T=${(timeToExpiry * 365).toFixed(0)}d. B-S d2 → P(>${strike})=${(optionsProb * 100).toFixed(1)}%.`,
          detectedAt: new Date().toISOString(),
          sizeMultiplier: 1.0,
          legs: [
            { venue: market.venue, ticker: market.ticker, side, price: buyPrice, quantity: 50 },
          ],
          optionsImpliedProb: optionsProb,
          marketImpliedProb: marketProb,
        });

        break; // One options comparison per market is enough
      }
    }
  }

  return {
    detector: DETECTOR_TYPE,
    opportunities,
    marketsScanned: cryptoMarkets.length,
    durationMs: Date.now() - start,
  };
}
