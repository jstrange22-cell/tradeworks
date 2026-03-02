import { Router, type Router as RouterType } from 'express';

/**
 * Instrument discovery routes.
 * GET /api/v1/market/instruments?market=crypto&search=BTC
 *
 * Returns available tradable instruments from connected exchanges.
 * Caches results in-memory to avoid excessive API calls.
 */

export const instrumentsRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstrumentInfo {
  symbol: string;
  displayName: string;
  market: 'crypto' | 'equities' | 'prediction';
  exchange: string;
  tradable: boolean;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: InstrumentInfo[];
  timestamp: number;
}

const cache: Record<string, CacheEntry> = {};
const CRYPTO_CACHE_TTL = 5 * 60 * 1000;   // 5 min
const EQUITY_CACHE_TTL = 15 * 60 * 1000;   // 15 min
const PREDICTION_CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached(key: string, ttl: number): InstrumentInfo[] | null {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data;
  }
  return null;
}

function setCache(key: string, data: InstrumentInfo[]): void {
  cache[key] = { data, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// Crypto instruments — Crypto.com public API
// ---------------------------------------------------------------------------

async function fetchCryptoInstruments(): Promise<InstrumentInfo[]> {
  const cached = getCached('crypto', CRYPTO_CACHE_TTL);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.crypto.com/exchange/v1/public/get-instruments');
    if (!res.ok) throw new Error(`Crypto.com API error: ${res.status}`);

    const json = (await res.json()) as { result?: { data?: unknown[]; instruments?: unknown[] } };
    const instruments: InstrumentInfo[] = [];

    // The Crypto.com API returns instruments in result.data
    const rawInstruments = json?.result?.data ?? json?.result?.instruments ?? [];

    for (const inst of rawInstruments) {
      const rec = inst as Record<string, string>;
      const name = rec.instrument_name ?? rec.symbol ?? '';
      if (!name) continue;

      // Convert USDT pairs to display format: BTC_USDT -> BTC-USD
      const display = name.replace('_USDT', '-USD').replace('_USD', '-USD').replace('_', '-');
      const base = rec.base_currency ?? display.split(/[-_]/)[0] ?? '';

      instruments.push({
        symbol: display,
        displayName: `${base} / USD`,
        market: 'crypto',
        exchange: 'crypto.com',
        tradable: true,
      });
    }

    setCache('crypto', instruments);
    return instruments;
  } catch (error) {
    console.warn('[Instruments] Failed to fetch crypto instruments:', error);
    // Return commonly traded pairs as fallback
    return CRYPTO_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Equity instruments — Alpaca API or fallback
// ---------------------------------------------------------------------------

async function fetchEquityInstruments(): Promise<InstrumentInfo[]> {
  const cached = getCached('equities', EQUITY_CACHE_TTL);
  if (cached) return cached;

  // Try Alpaca if we have keys (check env vars)
  const alpacaKey = process.env.ALPACA_API_KEY;
  const alpacaSecret = process.env.ALPACA_API_SECRET;

  if (alpacaKey && alpacaSecret) {
    try {
      const baseUrl = process.env.ALPACA_PAPER === 'true'
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets';

      const res = await fetch(`${baseUrl}/v2/assets?status=active&asset_class=us_equity`, {
        headers: {
          'APCA-API-KEY-ID': alpacaKey,
          'APCA-API-SECRET-KEY': alpacaSecret,
        },
      });

      if (res.ok) {
        const assets = (await res.json()) as Array<{ symbol: string; name: string; tradable: boolean }>;
        const instruments: InstrumentInfo[] = assets
          .filter((a) => a.tradable)
          .map((a: { symbol: string; name: string }) => ({
            symbol: a.symbol,
            displayName: a.name || a.symbol,
            market: 'equities' as const,
            exchange: 'alpaca',
            tradable: true,
          }));

        setCache('equities', instruments);
        return instruments;
      }
    } catch (error) {
      console.warn('[Instruments] Failed to fetch Alpaca assets:', error);
    }
  }

  // Return the extended equity fallback list
  setCache('equities', EQUITY_FALLBACK);
  return EQUITY_FALLBACK;
}

// ---------------------------------------------------------------------------
// Prediction market instruments — Polymarket Gamma API
// ---------------------------------------------------------------------------

async function fetchPredictionInstruments(): Promise<InstrumentInfo[]> {
  const cached = getCached('prediction', PREDICTION_CACHE_TTL);
  if (cached) return cached;

  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?limit=200&active=true&closed=false');
    if (!res.ok) throw new Error(`Polymarket Gamma API error: ${res.status}`);

    const markets = (await res.json()) as Array<{ question?: string; conditionId?: string; id?: string; slug?: string; active?: boolean }>;
    const instruments: InstrumentInfo[] = [];

    for (const m of markets) {
      if (!m.question) continue;
      instruments.push({
        symbol: m.conditionId || m.id || m.slug || '',
        displayName: m.question,
        market: 'prediction',
        exchange: 'polymarket',
        tradable: m.active !== false,
      });
    }

    setCache('prediction', instruments);
    return instruments;
  } catch (error) {
    console.warn('[Instruments] Failed to fetch Polymarket markets:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/market/instruments
// ---------------------------------------------------------------------------

instrumentsRouter.get('/', async (req, res) => {
  try {
    const market = req.query.market as string | undefined;
    const search = (req.query.search as string ?? '').trim().toLowerCase();
    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);

    let allInstruments: InstrumentInfo[] = [];

    // Fetch instruments based on market filter
    if (!market || market === 'crypto') {
      allInstruments.push(...await fetchCryptoInstruments());
    }
    if (!market || market === 'equities') {
      allInstruments.push(...await fetchEquityInstruments());
    }
    if (!market || market === 'prediction') {
      allInstruments.push(...await fetchPredictionInstruments());
    }

    // Apply search filter
    if (search) {
      allInstruments = allInstruments.filter((inst) =>
        inst.symbol.toLowerCase().includes(search) ||
        inst.displayName.toLowerCase().includes(search)
      );
    }

    // Limit results
    const results = allInstruments.slice(0, limit);

    res.json({
      data: results,
      total: allInstruments.length,
      cached: true,
    });
  } catch (error) {
    console.error('[Instruments] Error:', error);
    res.status(500).json({ error: 'Failed to fetch instruments' });
  }
});

// ---------------------------------------------------------------------------
// Fallback instrument lists
// ---------------------------------------------------------------------------

const CRYPTO_FALLBACK: InstrumentInfo[] = [
  'BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOGE', 'ADA', 'DOT', 'CRO', 'MATIC',
  'XRP', 'UNI', 'AAVE', 'ATOM', 'NEAR', 'LTC', 'BCH', 'FIL', 'APT', 'ARB',
  'OP', 'SHIB', 'PEPE', 'FET', 'RENDER', 'INJ', 'TIA', 'SUI', 'SEI', 'JUP',
  'WIF', 'BONK', 'ONDO', 'PYTH', 'JTO', 'STRK', 'MANTA', 'DYM', 'PIXEL', 'PORTAL',
].map((ticker) => ({
  symbol: `${ticker}-USD`,
  displayName: `${ticker} / USD`,
  market: 'crypto' as const,
  exchange: 'crypto.com',
  tradable: true,
}));

const EQUITY_FALLBACK: InstrumentInfo[] = [
  // Mega-cap tech
  { s: 'AAPL', n: 'Apple Inc.' }, { s: 'MSFT', n: 'Microsoft Corp.' }, { s: 'NVDA', n: 'NVIDIA Corp.' },
  { s: 'GOOGL', n: 'Alphabet Inc.' }, { s: 'AMZN', n: 'Amazon.com Inc.' }, { s: 'META', n: 'Meta Platforms Inc.' },
  { s: 'TSLA', n: 'Tesla Inc.' }, { s: 'AVGO', n: 'Broadcom Inc.' }, { s: 'NFLX', n: 'Netflix Inc.' },
  { s: 'CRM', n: 'Salesforce Inc.' },
  // Semiconductors
  { s: 'AMD', n: 'Advanced Micro Devices' }, { s: 'INTC', n: 'Intel Corp.' }, { s: 'TSM', n: 'Taiwan Semiconductor' },
  { s: 'QCOM', n: 'Qualcomm Inc.' }, { s: 'MU', n: 'Micron Technology' },
  // Finance
  { s: 'JPM', n: 'JPMorgan Chase' }, { s: 'V', n: 'Visa Inc.' }, { s: 'MA', n: 'Mastercard Inc.' },
  { s: 'BAC', n: 'Bank of America' }, { s: 'GS', n: 'Goldman Sachs' },
  // Healthcare
  { s: 'UNH', n: 'UnitedHealth Group' }, { s: 'JNJ', n: 'Johnson & Johnson' }, { s: 'LLY', n: 'Eli Lilly & Co.' },
  { s: 'PFE', n: 'Pfizer Inc.' }, { s: 'ABBV', n: 'AbbVie Inc.' }, { s: 'MRK', n: 'Merck & Co.' },
  // Consumer
  { s: 'WMT', n: 'Walmart Inc.' }, { s: 'COST', n: 'Costco Wholesale' }, { s: 'HD', n: 'Home Depot Inc.' },
  { s: 'PG', n: 'Procter & Gamble' }, { s: 'KO', n: 'Coca-Cola Co.' }, { s: 'PEP', n: 'PepsiCo Inc.' },
  { s: 'MCD', n: "McDonald's Corp." }, { s: 'NKE', n: 'Nike Inc.' }, { s: 'SBUX', n: 'Starbucks Corp.' },
  // Industrial
  { s: 'CAT', n: 'Caterpillar Inc.' }, { s: 'BA', n: 'Boeing Co.' }, { s: 'GE', n: 'GE Aerospace' },
  { s: 'UPS', n: 'United Parcel Service' }, { s: 'RTX', n: 'RTX Corp.' },
  // Energy
  { s: 'XOM', n: 'Exxon Mobil' }, { s: 'CVX', n: 'Chevron Corp.' },
  // ETFs
  { s: 'SPY', n: 'SPDR S&P 500 ETF' }, { s: 'QQQ', n: 'Invesco QQQ Trust' },
  { s: 'IWM', n: 'iShares Russell 2000' }, { s: 'DIA', n: 'SPDR Dow Jones ETF' },
  { s: 'VTI', n: 'Vanguard Total Stock' }, { s: 'VOO', n: 'Vanguard S&P 500' },
  { s: 'ARKK', n: 'ARK Innovation ETF' }, { s: 'XLF', n: 'Financial Select Sector' },
  { s: 'XLE', n: 'Energy Select Sector' }, { s: 'XLK', n: 'Technology Select Sector' },
  // High-momentum / popular
  { s: 'PLTR', n: 'Palantir Technologies' }, { s: 'COIN', n: 'Coinbase Global' },
  { s: 'SNOW', n: 'Snowflake Inc.' }, { s: 'SQ', n: 'Block Inc.' },
  { s: 'SHOP', n: 'Shopify Inc.' }, { s: 'UBER', n: 'Uber Technologies' },
  { s: 'ABNB', n: 'Airbnb Inc.' }, { s: 'RBLX', n: 'Roblox Corp.' },
  { s: 'DKNG', n: 'DraftKings Inc.' }, { s: 'RIVN', n: 'Rivian Automotive' },
  { s: 'LCID', n: 'Lucid Group' }, { s: 'SOFI', n: 'SoFi Technologies' },
  { s: 'HOOD', n: 'Robinhood Markets' }, { s: 'AI', n: 'C3.ai Inc.' },
  { s: 'SMCI', n: 'Super Micro Computer' }, { s: 'ARM', n: 'Arm Holdings' },
].map((item) => ({
  symbol: item.s,
  displayName: item.n,
  market: 'equities' as const,
  exchange: 'alpaca',
  tradable: true,
}));
