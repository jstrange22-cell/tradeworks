/**
 * X1: Prediction Market → Equities Bridge — THE KEY ARB-TO-STOCKS ENGINE
 *
 * Translates Kalshi prediction market events into equity/ETF trades:
 *   Fed cut prob up    → long TLT/XLU, short XLF
 *   Recession prob up  → long TLT/GLD, short XLY/IWM
 *   CPI above expect   → long TIP/GLD/XLE
 *   Government shutdown → long GLD, short SPY
 *   Rising unemployment → long TLT/XLV, short XLY
 *
 * Fetches Kalshi events, classifies signal type, translates to stock trades.
 * Each signal type has a macro thesis backing the trade direction.
 */

import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger.js';
import { getBars } from '../../stocks/alpaca-client.js';
import type { StockOpportunity } from '../stock-models.js';

// ── Signal Definitions ──────────────────────────────────────────────────

interface TradeMapping {
  ticker: string;
  action: 'buy' | 'sell' | 'short';
  thesis: string;
  maxSize: number;
  baseConfidence: number;
}

interface SignalConfig {
  keywords: RegExp;
  label: string;
  trades: TradeMapping[];
}

const SIGNAL_CONFIGS: SignalConfig[] = [
  {
    keywords: /fed.*(cut|lower|decrease|reduction|ease)|rate.*cut|fomc.*(dovish|cut)/,
    label: 'Fed Rate Cut',
    trades: [
      { ticker: 'TLT', action: 'buy', thesis: 'Rate cuts drive long bond prices higher', maxSize: 5000, baseConfidence: 65 },
      { ticker: 'XLU', action: 'buy', thesis: 'Utilities benefit from lower rates as yield proxy', maxSize: 4000, baseConfidence: 60 },
      { ticker: 'XLRE', action: 'buy', thesis: 'Real estate benefits from falling mortgage rates', maxSize: 3000, baseConfidence: 55 },
      { ticker: 'XLF', action: 'short', thesis: 'Bank net interest margins compress on rate cuts', maxSize: 4000, baseConfidence: 58 },
    ],
  },
  {
    keywords: /fed.*(hike|raise|increase|tighten)|rate.*(hike|raise)|fomc.*(hawkish|hike)/,
    label: 'Fed Rate Hike',
    trades: [
      { ticker: 'TLT', action: 'short', thesis: 'Rate hikes drive long bond prices lower', maxSize: 5000, baseConfidence: 65 },
      { ticker: 'XLF', action: 'buy', thesis: 'Banks benefit from wider net interest margins', maxSize: 4000, baseConfidence: 60 },
      { ticker: 'XLRE', action: 'short', thesis: 'Real estate pressured by rising mortgage rates', maxSize: 3000, baseConfidence: 55 },
    ],
  },
  {
    keywords: /recession|gdp.*(contract|negative|decline)|economic.*(downturn|slump)/,
    label: 'Recession',
    trades: [
      { ticker: 'TLT', action: 'buy', thesis: 'Recession triggers flight to safety in long bonds', maxSize: 5000, baseConfidence: 68 },
      { ticker: 'GLD', action: 'buy', thesis: 'Gold is the ultimate safe haven in recessions', maxSize: 4000, baseConfidence: 65 },
      { ticker: 'XLP', action: 'buy', thesis: 'Consumer staples are recession-resistant', maxSize: 3000, baseConfidence: 58 },
      { ticker: 'XLY', action: 'short', thesis: 'Consumer discretionary collapses when spending drops', maxSize: 4000, baseConfidence: 62 },
      { ticker: 'IWM', action: 'short', thesis: 'Small caps suffer most — weaker balance sheets', maxSize: 4000, baseConfidence: 60 },
    ],
  },
  {
    keywords: /cpi.*(above|higher|exceed|hot|surprise)|inflation.*(rise|up|higher|hot|surge)/,
    label: 'CPI Above Expectations',
    trades: [
      { ticker: 'TIP', action: 'buy', thesis: 'TIPS protect against inflation', maxSize: 4000, baseConfidence: 62 },
      { ticker: 'GLD', action: 'buy', thesis: 'Gold hedges inflation', maxSize: 4000, baseConfidence: 60 },
      { ticker: 'XLE', action: 'buy', thesis: 'Energy benefits from inflationary environment', maxSize: 3000, baseConfidence: 58 },
      { ticker: 'TLT', action: 'short', thesis: 'Hot CPI means higher-for-longer rates pressuring bonds', maxSize: 4000, baseConfidence: 60 },
    ],
  },
  {
    keywords: /government.*shutdown|debt.*ceiling|default/,
    label: 'Government Shutdown / Debt Ceiling',
    trades: [
      { ticker: 'GLD', action: 'buy', thesis: 'Political instability drives safe haven demand', maxSize: 4000, baseConfidence: 55 },
      { ticker: 'SPY', action: 'short', thesis: 'Market sells off on shutdown uncertainty', maxSize: 3000, baseConfidence: 50 },
    ],
  },
  {
    keywords: /unemployment.*(rise|increase|spike|above)|jobless.*(rise|claim)/,
    label: 'Rising Unemployment',
    trades: [
      { ticker: 'TLT', action: 'buy', thesis: 'Weak jobs data pushes Fed toward cuts, bonds rally', maxSize: 5000, baseConfidence: 62 },
      { ticker: 'XLY', action: 'short', thesis: 'Rising unemployment crushes consumer spending', maxSize: 3000, baseConfidence: 58 },
      { ticker: 'XLV', action: 'buy', thesis: 'Healthcare is defensive in labor market weakness', maxSize: 3000, baseConfidence: 55 },
    ],
  },
];

// ── Kalshi Event Fetcher ────────────────────────────────────────────────

interface KalshiEvent {
  title: string;
  event_ticker: string;
  category: string;
  sub_title?: string;
}

async function fetchKalshiEvents(): Promise<KalshiEvent[]> {
  const res = await fetch('https://api.elections.kalshi.com/trade-api/v2/events/?limit=50&status=open', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Kalshi API ${res.status}`);

  const data = await res.json() as { events: KalshiEvent[] };
  return data.events ?? [];
}

// ── Signal Classification ───────────────────────────────────────────────

interface ClassifiedSignal {
  event: KalshiEvent;
  config: SignalConfig;
  matchStrength: number; // 0-1 based on how many events match this signal type
}

function classifyEvents(events: KalshiEvent[]): ClassifiedSignal[] {
  const signals: ClassifiedSignal[] = [];
  const seenLabels = new Set<string>();

  for (const event of events) {
    const titleLower = event.title.toLowerCase();
    const subTitleLower = (event.sub_title ?? '').toLowerCase();
    const combined = `${titleLower} ${subTitleLower}`;

    for (const config of SIGNAL_CONFIGS) {
      if (!config.keywords.test(combined)) continue;

      // Avoid duplicate signal types — boost existing instead
      if (seenLabels.has(config.label)) {
        const existing = signals.find(s => s.config.label === config.label);
        if (existing) {
          existing.matchStrength = Math.min(1.0, existing.matchStrength + 0.10);
        }
        continue;
      }

      seenLabels.add(config.label);
      signals.push({ event, config, matchStrength: 0.50 });
    }
  }

  return signals;
}

// ── Trend Confirmation ──────────────────────────────────────────────────

async function getTrendConfirmation(ticker: string): Promise<{
  aligned: boolean;
  momentum20d: number;
}> {
  try {
    const barsResp = await getBars({ symbols: [ticker], timeframe: '1Day', limit: 30 });
    const symbolBars = barsResp.bars[ticker];
    if (!symbolBars || symbolBars.length < 20) return { aligned: false, momentum20d: 0 };

    const current = symbolBars[symbolBars.length - 1].c;
    const price20dAgo = symbolBars[Math.max(0, symbolBars.length - 20)].c;
    const momentum20d = (current - price20dAgo) / price20dAgo;

    const ma10 = symbolBars.slice(-10).reduce((s, b) => s + b.c, 0) / 10;
    const ma20 = symbolBars.slice(-20).reduce((s, b) => s + b.c, 0) / 20;

    return { aligned: ma10 > ma20, momentum20d };
  } catch {
    return { aligned: false, momentum20d: 0 };
  }
}

// ── Main Scanner ────────────────────────────────────────────────────────

export async function scanPredictionBridge(): Promise<StockOpportunity[]> {
  const opps: StockOpportunity[] = [];

  try {
    // Step 1: Fetch all open Kalshi events
    const events = await fetchKalshiEvents();
    if (events.length === 0) return opps;

    // Step 2: Classify events into actionable trading signals
    const signals = classifyEvents(events);
    if (signals.length === 0) {
      logger.info({ events: events.length }, '[X1] No actionable prediction market signals');
      return opps;
    }

    // Step 3: For each signal, generate trades with optional trend confirmation
    for (const signal of signals) {
      for (const trade of signal.config.trades) {
        // Check if current price trend aligns with the predicted direction
        let trendBoost = 0;
        try {
          const trend = await getTrendConfirmation(trade.ticker);

          // Boost confidence when trend confirms the trade
          if (trade.action === 'buy' && trend.aligned && trend.momentum20d > 0) {
            trendBoost = 8;
          } else if ((trade.action === 'short' || trade.action === 'sell') && !trend.aligned && trend.momentum20d < 0) {
            trendBoost = 8;
          }

          // Reduce confidence when trend contradicts
          if (trade.action === 'buy' && trend.momentum20d < -0.03) {
            trendBoost = -5;
          } else if ((trade.action === 'short' || trade.action === 'sell') && trend.momentum20d > 0.03) {
            trendBoost = -5;
          }
        } catch { /* Trend confirmation is optional enhancement */ }

        const signalBoost = signal.matchStrength * 15;
        const confidence = Math.min(80, trade.baseConfidence + signalBoost + trendBoost);

        // Skip signals that drop below minimum confidence
        if (confidence < 45) continue;

        opps.push({
          id: randomUUID(),
          engine: 'X1',
          domain: 'cross',
          ticker: trade.ticker,
          action: trade.action === 'short' ? 'short' : trade.action,
          price: 0, // Filled at execution by orchestrator
          suggestedSize: 0,
          maxSize: trade.maxSize,
          confidence,
          reasoning: `Prediction Bridge [${signal.config.label}]: Kalshi "${signal.event.title}" → ${trade.action.toUpperCase()} ${trade.ticker}. ${trade.thesis}. Signal strength: ${(signal.matchStrength * 100).toFixed(0)}%.`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    logger.info(
      { kalshiEvents: events.length, signals: signals.length, trades: opps.length },
      '[X1] Prediction bridge scan complete',
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[X1] Prediction bridge scan failed');
  }

  // Step 4: Pull arb intelligence T9 ETF spread signals
  try {
    const { getRecentOpportunities } = await import('../../arb-intelligence/orchestrator.js');
    const arbOpps = getRecentOpportunities();
    const t9Opps = arbOpps.filter(o => o.arbType === 'type9_stock_crypto_spread');

    for (const t9 of t9Opps) {
      // Only process ETF tickers (skip cross-exchange crypto pairs)
      const ticker = t9.ticker_a;
      if (ticker.includes('-CB') || ticker.includes('-CG')) continue;

      // Determine trade direction: premium → sell ETF, discount → buy ETF
      const isPremium = t9.reasoning.includes('PREMIUM');
      const action = isPremium ? 'sell' : 'buy';
      const spreadPct = t9.grossProfitPerContract * 100; // Convert back to %
      const confidence = Math.min(72, 48 + spreadPct * 6);

      if (confidence < 45) continue;

      opps.push({
        id: randomUUID(),
        engine: 'X1',
        domain: 'cross',
        ticker,
        action: action as 'buy' | 'sell',
        price: 0, // Filled at execution
        suggestedSize: 0,
        maxSize: 3000,
        confidence,
        reasoning: `Arb Bridge [T9 ETF Spread]: ${ticker} ${isPremium ? 'premium' : 'discount'} ${spreadPct.toFixed(2)}% vs crypto spot. ${isPremium ? 'Sell' : 'Buy'} ETF. ${t9.reasoning}`,
        detectedAt: new Date().toISOString(),
      });
    }

    if (t9Opps.length > 0) {
      logger.info({ t9Count: t9Opps.length, newOpps: opps.length }, '[X1] Added arb T9 ETF spread signals');
    }
  } catch {
    // Arb engine not available — non-fatal
  }

  return opps;
}
