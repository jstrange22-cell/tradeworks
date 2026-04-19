/**
 * Macro Regime Engine — Cross-Market Intelligence
 *
 * Classifies the global macro environment by combining signals from multiple
 * markets. This drives position sizing and strategy selection across all
 * trading engines (crypto, stocks, prediction markets, sports).
 *
 * Regimes:
 *   risk_on       — VIX low, BTC rising, DXY falling, yields stable
 *   risk_off      — VIX elevated, BTC falling, DXY rising, yields spiking
 *   transitioning — Mixed signals, regime uncertainty
 *   crisis        — VIX extreme, correlation spike, liquidity drying up
 */

export type MacroRegime = 'risk_on' | 'risk_off' | 'transitioning' | 'crisis';

export interface MacroRegimeReport {
  regime: MacroRegime;
  confidence: number;       // 0-100
  signals: MacroSignal[];
  positionSizeMultiplier: number;  // 0.0-1.0 — multiply all position sizes by this
  summary: string;
  timestamp: string;
}

export interface MacroSignal {
  name: string;
  value: number;
  interpretation: 'bullish' | 'bearish' | 'neutral';
  weight: number;
  source: string;
}

// ── Data Fetchers ─────────────────────────────────────────────────────────

interface MarketDataPoint {
  price: number;
  change24h: number;
}

/**
 * Fetch key macro indicators from free public APIs.
 * All calls are fire-and-forget — if one fails, we use defaults.
 */
async function fetchMacroData(): Promise<{
  btc: MarketDataPoint;
  eth: MarketDataPoint;
  sol: MarketDataPoint;
  spy: MarketDataPoint;
  dxy: MarketDataPoint;
  vix: MarketDataPoint;
  btcDominance: number;
}> {
  const defaults = {
    btc: { price: 0, change24h: 0 },
    eth: { price: 0, change24h: 0 },
    sol: { price: 0, change24h: 0 },
    spy: { price: 0, change24h: 0 },
    dxy: { price: 104, change24h: 0 },
    vix: { price: 20, change24h: 0 },
    btcDominance: 55,
  };

  // Fetch crypto prices from CoinGecko (free, no key)
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json() as Record<string, { usd: number; usd_24h_change: number }>;
      if (data.bitcoin) defaults.btc = { price: data.bitcoin.usd, change24h: data.bitcoin.usd_24h_change ?? 0 };
      if (data.ethereum) defaults.eth = { price: data.ethereum.usd, change24h: data.ethereum.usd_24h_change ?? 0 };
      if (data.solana) defaults.sol = { price: data.solana.usd, change24h: data.solana.usd_24h_change ?? 0 };
    }
  } catch { /* use defaults */ }

  // Fetch BTC dominance
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/global',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json() as { data?: { market_cap_percentage?: { btc?: number } } };
      defaults.btcDominance = data.data?.market_cap_percentage?.btc ?? 55;
    }
  } catch { /* use defaults */ }

  // Fetch VIX and SPY from Alpaca or free proxy
  // Note: VIX and DXY require market data subscriptions for real-time.
  // For now, use approximations from crypto fear & greed index as proxy.
  try {
    const res = await fetch(
      'https://api.alternative.me/fng/?limit=1',
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ value: string }> };
      const fng = parseInt(data.data?.[0]?.value ?? '50', 10);
      // Fear & Greed Index: 0=Extreme Fear, 100=Extreme Greed
      // Map to approximate VIX: FNG 0 → VIX 40, FNG 50 → VIX 20, FNG 100 → VIX 12
      defaults.vix.price = Math.max(10, 40 - (fng * 0.3));
    }
  } catch { /* use defaults */ }

  return defaults;
}

// ── Regime Classification ─────────────────────────────────────────────────

export async function classifyMacroRegime(): Promise<MacroRegimeReport> {
  const data = await fetchMacroData();
  const signals: MacroSignal[] = [];
  let bullScore = 0;
  let bearScore = 0;

  // Signal 1: BTC 24h change (weight: 25)
  const btcInterp = data.btc.change24h > 3 ? 'bullish' : data.btc.change24h < -3 ? 'bearish' : 'neutral';
  signals.push({ name: 'BTC 24h', value: data.btc.change24h, interpretation: btcInterp, weight: 25, source: 'CoinGecko' });
  if (btcInterp === 'bullish') bullScore += 25;
  else if (btcInterp === 'bearish') bearScore += 25;

  // Signal 2: ETH 24h change (weight: 15)
  const ethInterp = data.eth.change24h > 3 ? 'bullish' : data.eth.change24h < -3 ? 'bearish' : 'neutral';
  signals.push({ name: 'ETH 24h', value: data.eth.change24h, interpretation: ethInterp, weight: 15, source: 'CoinGecko' });
  if (ethInterp === 'bullish') bullScore += 15;
  else if (ethInterp === 'bearish') bearScore += 15;

  // Signal 3: SOL 24h change (weight: 15)
  const solInterp = data.sol.change24h > 5 ? 'bullish' : data.sol.change24h < -5 ? 'bearish' : 'neutral';
  signals.push({ name: 'SOL 24h', value: data.sol.change24h, interpretation: solInterp, weight: 15, source: 'CoinGecko' });
  if (solInterp === 'bullish') bullScore += 15;
  else if (solInterp === 'bearish') bearScore += 15;

  // Signal 4: VIX proxy (weight: 25)
  const vixInterp = data.vix.price < 18 ? 'bullish' : data.vix.price > 30 ? 'bearish' : 'neutral';
  signals.push({ name: 'VIX (proxy)', value: data.vix.price, interpretation: vixInterp, weight: 25, source: 'Fear & Greed Index' });
  if (vixInterp === 'bullish') bullScore += 25;
  else if (vixInterp === 'bearish') bearScore += 25;

  // Signal 5: BTC Dominance (weight: 10)
  // Rising dominance = risk-off (money flowing to BTC from alts)
  const domInterp = data.btcDominance < 50 ? 'bullish' : data.btcDominance > 60 ? 'bearish' : 'neutral';
  signals.push({ name: 'BTC Dominance', value: data.btcDominance, interpretation: domInterp, weight: 10, source: 'CoinGecko' });
  if (domInterp === 'bullish') bullScore += 10;
  else if (domInterp === 'bearish') bearScore += 10;

  // Signal 6: Crypto correlation (weight: 10)
  // If BTC, ETH, SOL all moving same direction strongly = correlated = risk regime change
  const allUp = data.btc.change24h > 2 && data.eth.change24h > 2 && data.sol.change24h > 2;
  const allDown = data.btc.change24h < -2 && data.eth.change24h < -2 && data.sol.change24h < -2;
  const corrInterp = allUp ? 'bullish' : allDown ? 'bearish' : 'neutral';
  signals.push({ name: 'Crypto Correlation', value: allUp ? 1 : allDown ? -1 : 0, interpretation: corrInterp, weight: 10, source: 'Derived' });
  if (corrInterp === 'bullish') bullScore += 10;
  else if (corrInterp === 'bearish') bearScore += 10;

  // Classify regime
  const totalWeight = 100;
  const bullPct = (bullScore / totalWeight) * 100;
  const bearPct = (bearScore / totalWeight) * 100;
  const neutralPct = 100 - bullPct - bearPct;

  let regime: MacroRegime;
  let confidence: number;
  let positionSizeMultiplier: number;
  let summary: string;

  if (data.vix.price > 45 || (bearPct > 85 && allDown)) {
    // True crisis: only triggered by extreme VIX (45+) or nearly all signals bearish
    // Paper mode should still trade — this just reduces size dramatically
    regime = 'crisis';
    confidence = Math.min(95, bearPct + 20);
    positionSizeMultiplier = 0.25; // 25% size, not 10% (still trade, just smaller)
    summary = `CRISIS: VIX at ${data.vix.price.toFixed(0)}, extreme fear. Reduced position sizes, tighten stops, highest-conviction only.`;
  } else if (bearPct > 50) {
    regime = 'risk_off';
    confidence = bearPct;
    positionSizeMultiplier = 0.5;
    summary = `Risk-Off: BTC ${data.btc.change24h >= 0 ? '+' : ''}${data.btc.change24h.toFixed(1)}%, VIX ${data.vix.price.toFixed(0)}. Reduce positions, tighter stops.`;
  } else if (bullPct > 50) {
    regime = 'risk_on';
    confidence = bullPct;
    positionSizeMultiplier = 1.0;
    summary = `Risk-On: BTC ${data.btc.change24h >= 0 ? '+' : ''}${data.btc.change24h.toFixed(1)}%, VIX ${data.vix.price.toFixed(0)}. Full allocation, aggressive entries.`;
  } else {
    regime = 'transitioning';
    confidence = Math.max(neutralPct, 40);
    positionSizeMultiplier = 0.7;
    summary = `Transitioning: Mixed signals (bull ${bullPct.toFixed(0)}%, bear ${bearPct.toFixed(0)}%). Half positions, wider stops.`;
  }

  return {
    regime,
    confidence,
    signals,
    positionSizeMultiplier,
    summary,
    timestamp: new Date().toISOString(),
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────

let cachedRegime: MacroRegimeReport | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 300_000; // 5 minutes

export async function getMacroRegime(): Promise<MacroRegimeReport> {
  if (cachedRegime && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedRegime;
  }
  cachedRegime = await classifyMacroRegime();
  cachedAt = Date.now();
  return cachedRegime;
}
