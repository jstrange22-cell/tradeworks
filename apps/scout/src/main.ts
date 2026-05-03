/**
 * AI Watchlist Scout
 * ------------------
 * Picks the watchlist of tickers the bot should actively monitor for
 * TradeVisor signals. Runs every 4 hours during market hours via cron.
 *
 *   Universe   : 100 stock candidates (S&P 100) + 20 fixed crypto blue chips
 *   Filtering  : liquidity gate ($50M/day average dollar volume)
 *   Scoring    : composite momentum (5d/20d/60d RS vs SPY) + ATR expansion
 *   Optional   : Claude rerank for qualitative diversification
 *   Output     : data/watchlist.json with 30 stocks + 20 crypto = 50 tickers
 *
 * The gateway exposes the persisted watchlist at /api/v1/scout/watchlist
 * so the tv-bridge can pull it and rotate the chart through the symbols.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import pino from 'pino';
import {
  SP100,
  CRYPTO_BLUE_CHIPS,
  STOCK_TARGET_COUNT,
  tvFormat,
} from './universe.js';
import {
  fetchCandles,
  scoreCandidate,
  liquidityFilter,
  rankAndTake,
  type ScoredTicker,
} from './scoring.js';
import { claudeRerank, buildMarketContext } from './claude-rerank.js';
import { fetchNewsForTickers, formatNewsForPrompt } from './news.js';

// ── Config ──────────────────────────────────────────────────────────────
const OUTPUT_FILE = resolve(process.env['SCOUT_OUTPUT_FILE'] ?? './data/watchlist.json');
const REFRESH_HOURS = Number(process.env['SCOUT_REFRESH_HOURS'] ?? 4);
const MARKET_HOURS_ONLY = (process.env['SCOUT_MARKET_HOURS_ONLY'] ?? 'true') === 'true';
const ONCE = process.argv.includes('--once');

const log = pino({
  ...(process.stdout.isTTY && process.env['PINO_PRETTY'] !== 'false'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
  level: process.env['LOG_LEVEL'] ?? 'info',
});

// ── Output shape ────────────────────────────────────────────────────────
interface WatchlistEntry {
  ticker: string;
  tvSymbol: string;
  kind: 'stock' | 'crypto';
  score?: number;
  rs5d?: number;
  rs20d?: number;
  atrExpansion?: number;
  reason?: string;
}

interface WatchlistFile {
  refreshedAt: string;
  refreshSource: 'deterministic' | 'claude-reranked';
  rationale?: string;
  marketContext: string;
  totalTickers: number;
  entries: WatchlistEntry[];
}

// ── Market hours guard ──────────────────────────────────────────────────
function isMarketHoursET(): boolean {
  // US equity markets: Mon-Fri 9:30am-4:00pm ET. Crypto trades 24/7 so we
  // could refresh anytime, but stocks dominate watchlist size — refresh
  // during stock hours only by default. Override via SCOUT_MARKET_HOURS_ONLY=false.
  const now = new Date();
  // ET = UTC-5 (EST) / UTC-4 (EDT). Use Intl to get ET hour without a tz lib.
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = etFormatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!weekday || isNaN(hour)) return true; // be permissive on parse failure
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  // 9:30am to 4:00pm ET — but we run the scout slightly outside (8am-5pm)
  // to capture pre-market positioning and last-hour rebalancing.
  const totalMin = hour * 60 + minute;
  return totalMin >= 8 * 60 && totalMin < 17 * 60;
}

// ── Build the watchlist ────────────────────────────────────────────────
async function refresh(): Promise<void> {
  log.info({ universe: SP100.length, target: STOCK_TARGET_COUNT, output: OUTPUT_FILE }, 'scout refresh starting');

  // 1. Fetch candles for all stock candidates concurrently (with throttle).
  const candles: NonNullable<Awaited<ReturnType<typeof fetchCandles>>>[] = [];
  const CONCURRENCY = 8;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < SP100.length) {
      const idx = cursor++;
      const ticker = SP100[idx]!;
      const set = await fetchCandles(ticker);
      if (set) candles.push(set);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log.info({ fetched: candles.length, total: SP100.length }, 'candle fetch complete');

  if (candles.length < 30) {
    log.error({ fetched: candles.length }, 'too few candle sets fetched — Yahoo throttling? Aborting refresh');
    return;
  }

  // 2. Score each candidate, using SPY as the relative-strength benchmark.
  const spySet = candles.find((c) => c.ticker === 'SPY') ?? null;
  const allScored: ScoredTicker[] = candles.map((c) => scoreCandidate(c, spySet));

  // 3. Apply liquidity filter.
  const liquid = liquidityFilter(allScored);
  log.info({ liquid: liquid.length, filtered: allScored.length - liquid.length }, 'liquidity filter applied');

  // 4. Take deterministic top by score (we'll either use this directly OR
  //    pass to Claude for rerank — Claude pool needs more than the target).
  const detTop = rankAndTake(liquid, STOCK_TARGET_COUNT);
  const claudePool = rankAndTake(liquid, Math.min(60, liquid.length));

  // 5. Optional Claude rerank for qualitative diversification.
  // News fetch is also optional (gated by FINNHUB_API_KEY). When both are
  // available, headlines feed the Claude prompt so Claude can weight
  // catalysts (earnings, FDA, M&A) alongside momentum/volatility.
  const marketContext = buildMarketContext(allScored);
  const news = await fetchNewsForTickers(claudePool.map((c) => c.ticker), log);
  const newsBlock = formatNewsForPrompt(news);
  const reranked = await claudeRerank(claudePool, STOCK_TARGET_COUNT, marketContext, newsBlock, log);

  let stockPicks: ScoredTicker[];
  let source: WatchlistFile['refreshSource'];
  let rationale: string | undefined;
  if (reranked) {
    const byTicker = new Map(allScored.map((s) => [s.ticker, s] as const));
    stockPicks = reranked.picks
      .map((t) => byTicker.get(t))
      .filter((s): s is ScoredTicker => !!s);
    source = 'claude-reranked';
    rationale = reranked.rationale;
    log.info({ picks: stockPicks.length, rationale }, 'claude rerank applied');
  } else {
    stockPicks = detTop;
    source = 'deterministic';
    log.info({ picks: stockPicks.length }, 'using deterministic top-N (claude unavailable or rejected)');
  }

  // 6. Build final watchlist: stocks (ranked) + crypto blue chips (fixed).
  const stockEntries: WatchlistEntry[] = stockPicks.map((s) => ({
    ticker: s.ticker,
    tvSymbol: tvFormat(s.ticker, 'stock'),
    kind: 'stock',
    score: s.score,
    rs5d: s.rs5d,
    rs20d: s.rs20d,
    atrExpansion: s.atrExpansion,
    reason: s.reason,
  }));

  const cryptoEntries: WatchlistEntry[] = CRYPTO_BLUE_CHIPS.map((c) => ({
    ticker: c,
    tvSymbol: tvFormat(c, 'crypto'),
    kind: 'crypto',
  }));

  const watchlist: WatchlistFile = {
    refreshedAt: new Date().toISOString(),
    refreshSource: source,
    rationale,
    marketContext,
    totalTickers: stockEntries.length + cryptoEntries.length,
    entries: [...stockEntries, ...cryptoEntries],
  };

  // 7. Persist atomically.
  mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
  const tmpFile = OUTPUT_FILE + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(watchlist, null, 2));
  // fs.rename is atomic on the same filesystem (POSIX guarantee, also Windows ReplaceFile)
  const { renameSync } = await import('fs');
  renameSync(tmpFile, OUTPUT_FILE);

  log.info(
    {
      stocks: stockEntries.length,
      crypto: cryptoEntries.length,
      total: watchlist.totalTickers,
      source,
      file: OUTPUT_FILE,
    },
    'watchlist persisted',
  );
}

// ── Main loop ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (ONCE) {
    log.info('one-shot mode (--once) — running single refresh and exiting');
    await refresh();
    return;
  }

  log.info({ refreshHours: REFRESH_HOURS, marketHoursOnly: MARKET_HOURS_ONLY }, 'scout daemon starting');

  // Run immediately on startup, then every REFRESH_HOURS.
  while (true) {
    if (!MARKET_HOURS_ONLY || isMarketHoursET()) {
      try {
        await refresh();
      } catch (err) {
        log.error({ err: err instanceof Error ? err.stack : err }, 'refresh threw');
      }
    } else {
      log.debug('outside market hours — skipping refresh tick');
    }
    await new Promise((r) => setTimeout(r, REFRESH_HOURS * 60 * 60 * 1000));
  }
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : err }, 'fatal');
  process.exit(1);
});
