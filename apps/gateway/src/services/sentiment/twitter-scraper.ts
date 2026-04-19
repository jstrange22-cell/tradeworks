/**
 * Twitter/X Scraper — Multi-Market Social Intelligence
 *
 * Monitors Twitter/X for signals across 4 markets:
 *   1. Crypto — whale alerts, trending coins, momentum
 *   2. Sports — odds movements, injury news, picks
 *   3. Predictions — event outcomes, market catalysts
 *   4. Stocks — unusual activity, earnings, macro
 *
 * Uses multiple free data sources:
 *   - Nitter RSS feeds (public Twitter mirrors, no API key)
 *   - CryptoPanic API (free tier, crypto news aggregator)
 *   - Backup: direct fetch with parsing
 *
 * Runs every 5 minutes. Feeds signals to:
 *   - sentiment-aggregator.ts (as 4th sentiment source)
 *   - kalshi-intelligence.ts (event-based prediction signals)
 *   - coin-discovery-service.ts (discovered tickers)
 */

import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TweetSignal {
  source: string;           // account handle or search query
  text: string;             // tweet content (truncated)
  sentiment: number;        // -100 to +100
  category: 'crypto' | 'sports' | 'predictions' | 'stocks';
  tickers: string[];        // extracted $TICKERS
  url: string;
  timestamp: string;
  engagementScore: number;  // 0-100 based on likes/retweets
}

export interface TwitterSentiment {
  category: string;
  score: number;            // -100 to +100
  tweetCount: number;
  bullishCount: number;
  bearishCount: number;
  topTickers: string[];
  lastUpdated: string;
}

// ── State ────────────────────────────────────────────────────────────────

const twitterSignals: TweetSignal[] = [];
const MAX_SIGNALS = 200;
const categorySentiment = new Map<string, TwitterSentiment>();
let lastScrapeAt: string | null = null;
let scrapeCount = 0;

// ── Nitter RSS Feeds (free, no API key) ─────────────────────────────────

const NITTER_INSTANCES = [
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.1d4.us',
];

// Accounts to monitor per category
const CRYPTO_ACCOUNTS = ['WatcherGuru', 'lookonchain', 'whale_alert', 'DefiLlama', 'caborinhomemes'];
const SPORTS_ACCOUNTS = ['ActionNetworkHQ', 'OddsShark', 'BetMGM'];
const PREDICTIONS_ACCOUNTS = ['Kalaborinhomeshi', 'Polymarket', 'MetaculusHQ'];
const STOCKS_ACCOUNTS = ['unusual_whales', 'DeItaone', 'Zaborinhosky'];

// ── CryptoPanic API (free tier, 200 req/day) ────────────────────────────

async function fetchCryptoNews(): Promise<TweetSignal[]> {
  const signals: TweetSignal[] = [];

  // Source 1: CoinGecko trending search (what people are searching for)
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = await res.json() as {
        coins: Array<{ item: { id: string; symbol: string; name: string; data?: { price_change_percentage_24h?: { usd?: number } } } }>;
      };
      for (const coin of (data.coins ?? []).slice(0, 7)) {
        const chg = coin.item.data?.price_change_percentage_24h?.usd ?? 0;
        signals.push({
          source: 'CoinGecko Trending',
          text: `${coin.item.name} (${coin.item.symbol.toUpperCase()}) trending on CoinGecko. 24h: ${chg > 0 ? '+' : ''}${chg.toFixed(1)}%`,
          sentiment: scoreTweetSentiment(`${chg > 5 ? 'pump surge rally' : chg < -5 ? 'dump crash drop' : 'stable'} ${coin.item.symbol}`),
          category: 'crypto',
          tickers: [coin.item.symbol.toUpperCase()],
          url: `https://www.coingecko.com/en/coins/${coin.item.id}`,
          timestamp: new Date().toISOString(),
          engagementScore: 70, // Trending = high engagement
        });
      }
    }
  } catch { /* silent */ }

  // Source 2: Fear & Greed Index (market-wide sentiment)
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = await res.json() as { data: Array<{ value: string; value_classification: string }> };
      const fng = data.data?.[0];
      if (fng) {
        const value = parseInt(fng.value, 10);
        const sentiment = (value - 50) * 2; // 0-100 → -100 to +100
        signals.push({
          source: 'Fear & Greed Index',
          text: `Crypto Fear & Greed: ${fng.value} (${fng.value_classification})`,
          sentiment,
          category: 'crypto',
          tickers: ['BTC', 'ETH'],
          url: 'https://alternative.me/crypto/fear-and-greed-index/',
          timestamp: new Date().toISOString(),
          engagementScore: 90,
        });
      }
    }
  } catch { /* silent */ }

  // Source 3: Reddit crypto mentions via ApeWisdom
  try {
    const res = await fetch('https://apewisdom.io/api/v1.0/filter/all-crypto/page/1', {
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = await res.json() as { results: Array<{ ticker: string; name: string; mentions: number; rank: number; upvotes: number }> };
      for (const coin of (data.results ?? []).slice(0, 10)) {
        const sentiment = Math.min(100, coin.mentions * 2 + coin.upvotes);
        signals.push({
          source: `Reddit r/crypto (rank #${coin.rank})`,
          text: `${coin.name} ($${coin.ticker}) — ${coin.mentions} mentions, ${coin.upvotes} upvotes on Reddit`,
          sentiment: Math.min(80, sentiment),
          category: 'crypto',
          tickers: [coin.ticker.toUpperCase()],
          url: `https://apewisdom.io/cryptocurrency/${coin.ticker}`,
          timestamp: new Date().toISOString(),
          engagementScore: Math.min(100, coin.mentions * 3),
        });
      }
    }
  } catch { /* silent */ }

  return signals;
}

// ── Nitter RSS Scraper ──────────────────────────────────────────────────

async function fetchNitterFeed(account: string, category: TweetSignal['category']): Promise<TweetSignal[]> {
  const signals: TweetSignal[] = [];

  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${account}/rss`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradeWorksBot/1.0)' },
      });
      if (!res.ok) continue;

      const xml = await res.text();

      // Simple XML parsing for RSS items
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
      for (const item of items.slice(0, 5)) {
        const titleMatch = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
        const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

        const text = (titleMatch?.[1] ?? descMatch?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
        if (!text) continue;

        // Extract $TICKERS from text
        const tickerMatches = text.match(/\$[A-Z]{2,6}/g) ?? [];
        const tickers = tickerMatches.map(t => t.replace('$', ''));

        // Simple sentiment scoring
        const sentiment = scoreTweetSentiment(text);

        signals.push({
          source: `@${account}`,
          text: text.slice(0, 200),
          sentiment,
          category,
          tickers,
          url: linkMatch?.[1] ?? `https://x.com/${account}`,
          timestamp: dateMatch?.[1] ? new Date(dateMatch[1]).toISOString() : new Date().toISOString(),
          engagementScore: 50, // Can't get engagement from RSS
        });
      }

      break; // Success on this instance, no need to try others
    } catch {
      continue; // Try next Nitter instance
    }
  }

  return signals;
}

// ── Sentiment Scoring ───────────────────────────────────────────────────

const BULLISH_WORDS = ['bull', 'pump', 'moon', 'breakout', 'surge', 'rally', 'buy', 'long', 'profit', 'ath', 'bullish', 'green', 'higher', 'up', 'win', 'winning'];
const BEARISH_WORDS = ['bear', 'dump', 'crash', 'selloff', 'plunge', 'drop', 'sell', 'short', 'loss', 'bearish', 'red', 'lower', 'down', 'fail', 'losing', 'rug'];

function scoreTweetSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;

  for (const word of BULLISH_WORDS) {
    if (lower.includes(word)) score += 10;
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word)) score -= 10;
  }

  return Math.max(-100, Math.min(100, score));
}

// ── Main Scraper Loop ───────────────────────────────────────────────────

async function scrapeAllSources(): Promise<void> {
  const start = Date.now();
  const newSignals: TweetSignal[] = [];

  // 1. Crypto news from CoinGecko + Fear&Greed + Reddit (reliable free sources)
  const cryptoNewsSignals = await fetchCryptoNews();
  newSignals.push(...cryptoNewsSignals);

  // 2. Crypto Twitter accounts
  for (const account of CRYPTO_ACCOUNTS.slice(0, 3)) { // Limit to avoid rate limits
    const signals = await fetchNitterFeed(account, 'crypto');
    newSignals.push(...signals);
  }

  // 3. Sports Twitter (1-2 accounts)
  for (const account of SPORTS_ACCOUNTS.slice(0, 2)) {
    const signals = await fetchNitterFeed(account, 'sports');
    newSignals.push(...signals);
  }

  // 4. Predictions Twitter
  for (const account of PREDICTIONS_ACCOUNTS.slice(0, 2)) {
    const signals = await fetchNitterFeed(account, 'predictions');
    newSignals.push(...signals);
  }

  // 5. Stocks Twitter
  for (const account of STOCKS_ACCOUNTS.slice(0, 2)) {
    const signals = await fetchNitterFeed(account, 'stocks');
    newSignals.push(...signals);
  }

  // Store signals
  for (const sig of newSignals) {
    twitterSignals.push(sig);
    if (twitterSignals.length > MAX_SIGNALS) twitterSignals.shift();
  }

  // Update category sentiment aggregates
  for (const cat of ['crypto', 'sports', 'predictions', 'stocks'] as const) {
    const catSignals = newSignals.filter(s => s.category === cat);
    if (catSignals.length === 0) continue;

    const avgSentiment = catSignals.reduce((s, t) => s + t.sentiment, 0) / catSignals.length;
    const bullish = catSignals.filter(t => t.sentiment > 0).length;
    const bearish = catSignals.filter(t => t.sentiment < 0).length;
    const allTickers = catSignals.flatMap(t => t.tickers);
    const tickerCounts = new Map<string, number>();
    for (const t of allTickers) tickerCounts.set(t, (tickerCounts.get(t) ?? 0) + 1);
    const topTickers = [...tickerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);

    categorySentiment.set(cat, {
      category: cat,
      score: Math.round(avgSentiment),
      tweetCount: catSignals.length,
      bullishCount: bullish,
      bearishCount: bearish,
      topTickers,
      lastUpdated: new Date().toISOString(),
    });
  }

  // Extract Solana contract addresses from tweet text
  const solanaAddressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const extractedAddresses: string[] = [];
  for (const sig of newSignals.filter(s => s.category === 'crypto' && s.sentiment > 10)) {
    const matches = sig.text.match(solanaAddressRegex) ?? [];
    for (const addr of matches) {
      // Basic validation: Solana addresses are 32-44 chars, not common English words
      if (addr.length >= 32 && addr.length <= 44 && !/^[A-Za-z]+$/.test(addr)) {
        extractedAddresses.push(addr);
      }
    }
  }

  // Verify extracted contract addresses
  if (extractedAddresses.length > 0) {
    try {
      const { verifyContract } = await import('../contract-verifier.js');
      const unique = [...new Set(extractedAddresses)].slice(0, 3); // Max 3 per cycle
      for (const addr of unique) {
        const result = await verifyContract(addr);
        if (result.status === 'SAFE' || result.status === 'RISKY') {
          logger.info(
            { address: addr.slice(0, 8), status: result.status, score: result.score },
            `[TwitterScraper] Verified CA from tweet: ${result.status}`,
          );
          // Feed to moonshot hunter
          try {
            const { injectTradingViewDiscovery } = await import('../coin-discovery-service.js');
            injectTradingViewDiscovery(addr.slice(0, 6), result.dexData?.priceUsd ?? 0);
          } catch { /* silent */ }
        }
      }
    } catch { /* verifier not loaded */ }
  }

  // ALL crypto tickers from Twitter → Watchlist for Tradevisor analysis
  // Not just BTC/ETH — any coin mentioned on crypto Twitter gets watched
  const cryptoTickers = newSignals
    .filter(s => s.category === 'crypto' && s.tickers.length > 0 && s.sentiment > 10)
    .flatMap(s => s.tickers.map(t => ({ ticker: t.replace('.X', '').replace('$', ''), sentiment: s.sentiment, source: s.source })));

  if (cryptoTickers.length > 0) {
    // Take up to 15 unique tickers per scan (not 3)
    const uniqueTickers = [...new Map(cryptoTickers.map(t => [t.ticker, t])).values()].slice(0, 15);
    try {
      const { addToWatchlist } = await import('../ai/tradevisor-watchlist.js');
      for (const { ticker, source } of uniqueTickers) {
        // Any crypto ticker with positive sentiment → watchlist
        addToWatchlist(ticker, `twitter:${source}`, 'crypto');
      }
      if (uniqueTickers.length > 0) {
        logger.info(
          { count: uniqueTickers.length, tickers: uniqueTickers.map(t => t.ticker).join(', ') },
          `[TwitterScraper] Added ${uniqueTickers.length} crypto tickers to Tradevisor watchlist`,
        );
      }
    } catch { /* watchlist not available */ }

    // Also inject into discovery
    try {
      const { injectTradingViewDiscovery } = await import('../coin-discovery-service.js');
      for (const { ticker } of uniqueTickers) {
        injectTradingViewDiscovery(ticker, 0);
      }
    } catch { /* silent */ }
  }

  // NOTE: Twitter signals previously injected TWITTER_* tickers into Kalshi trading,
  // but those tickers don't exist on Kalshi's API (always 404). Disabled to prevent
  // ghost positions. Twitter sentiment is still available via getTwitterSentiment()
  // for other consumers (sentiment aggregator, dashboard display).
  // To re-enable: map twitter crypto signals to REAL Kalshi tickers before injecting.

  scrapeCount++;
  lastScrapeAt = new Date().toISOString();

  logger.info(
    { signals: newSignals.length, crypto: cryptoNewsSignals.length, categories: categorySentiment.size, durationMs: Date.now() - start },
    `[TwitterScraper] Scraped ${newSignals.length} signals from ${CRYPTO_ACCOUNTS.length + SPORTS_ACCOUNTS.length + PREDICTIONS_ACCOUNTS.length + STOCKS_ACCOUNTS.length} sources`,
  );
}

// ── Public API ──────────────────────────────────────────────────────────

let scrapeInterval: ReturnType<typeof setInterval> | null = null;

export function startTwitterScraper(): void {
  if (scrapeInterval) return;

  logger.info('[TwitterScraper] Starting Twitter/X social intelligence scraper (5 min cycle)');

  scrapeInterval = setInterval(scrapeAllSources, 5 * 60_000);

  // First scrape after 45s (let other services initialize)
  setTimeout(scrapeAllSources, 45_000);
}

export function stopTwitterScraper(): void {
  if (scrapeInterval) {
    clearInterval(scrapeInterval);
    scrapeInterval = null;
  }
}

export function getTwitterSignals(category?: string, limit = 50): TweetSignal[] {
  const filtered = category
    ? twitterSignals.filter(s => s.category === category)
    : twitterSignals;
  return filtered.slice(-limit);
}

export function getTwitterSentiment(): TwitterSentiment[] {
  return [...categorySentiment.values()];
}

export function getTwitterScraperStatus() {
  return {
    running: scrapeInterval !== null,
    scrapeCount,
    lastScrapeAt,
    totalSignals: twitterSignals.length,
    categorySentiment: [...categorySentiment.values()],
    sources: {
      crypto: CRYPTO_ACCOUNTS.length,
      sports: SPORTS_ACCOUNTS.length,
      predictions: PREDICTIONS_ACCOUNTS.length,
      stocks: STOCKS_ACCOUNTS.length,
    },
  };
}
