/**
 * TradingView Agent — APEX Swarm Agent #8
 *
 * Collects ALL TradingView webhook signals and packages them for distribution
 * to all trading bots via APEX Bridge. Makes Tradevisor the primary signal source.
 */

import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface TVSignal {
  symbol: string;
  action: 'buy' | 'sell';
  price: number;
  timeframe: string;
  confidence: number;
  receivedAt: string;
}

// ── State ────────────────────────────────────────────────────────────────

const signalBuffer: TVSignal[] = [];
const MAX_BUFFER = 200;
const SIGNAL_STALE_MS = 15 * 60_000; // 15 min staleness

// ── Ingest from Webhook ─────────────────────────────────────────────────

export function ingestWebhookSignal(signal: {
  symbol: string;
  action: string;
  price: number;
  timeframe?: string;
}): void {
  const normalized: TVSignal = {
    symbol: signal.symbol.replace('USDT', '-USD').replace('USD', '-USD').replace('--USD', '-USD'),
    action: signal.action.toLowerCase().includes('sell') ? 'sell' : 'buy',
    price: signal.price,
    timeframe: signal.timeframe ?? '5',
    confidence: 80, // Tradevisor signals are high confidence by default
    receivedAt: new Date().toISOString(),
  };

  signalBuffer.push(normalized);
  if (signalBuffer.length > MAX_BUFFER) signalBuffer.shift();

  logger.info(
    { symbol: normalized.symbol, action: normalized.action, price: normalized.price, timeframe: normalized.timeframe },
    `[TVAgent] Signal ingested: ${normalized.action.toUpperCase()} ${normalized.symbol} @ $${normalized.price}`,
  );
}

// ── Query Signals ───────────────────────────────────────────────────────

/** Get all fresh (non-stale) signals */
export function getFreshSignals(): TVSignal[] {
  const cutoff = Date.now() - SIGNAL_STALE_MS;
  return signalBuffer.filter(s => new Date(s.receivedAt).getTime() > cutoff);
}

/** Get the latest signal for a specific instrument (e.g., 'BTC-USD') */
export function getLatestSignal(symbol: string): TVSignal | null {
  const fresh = getFreshSignals().filter(s => s.symbol === symbol);
  return fresh.length > 0 ? fresh[fresh.length - 1] : null;
}

/** Get all BUY signals currently active */
export function getActiveBuySignals(): TVSignal[] {
  return getFreshSignals().filter(s => s.action === 'buy');
}

/** Get all SELL signals currently active */
export function getActiveSellSignals(): TVSignal[] {
  return getFreshSignals().filter(s => s.action === 'sell');
}

/** Get symbols with active buy signals */
export function getBuySymbols(): string[] {
  return [...new Set(getActiveBuySignals().map(s => s.symbol))];
}

/** Get symbols with active sell signals */
export function getSellSymbols(): string[] {
  return [...new Set(getActiveSellSignals().map(s => s.symbol))];
}

// ── Swarm Agent Runner ──────────────────────────────────────────────────

export async function tradingViewAgentRunner(): Promise<{ findings: number; summary: string }> {
  const fresh = getFreshSignals();
  const buys = fresh.filter(s => s.action === 'buy');
  const sells = fresh.filter(s => s.action === 'sell');
  const buySymbols = [...new Set(buys.map(s => s.symbol))];
  const sellSymbols = [...new Set(sells.map(s => s.symbol))];

  const findings = fresh.length;

  if (findings === 0) {
    return { findings: 0, summary: 'TradingView: No active signals (waiting for Tradevisor alerts)' };
  }

  const summary = [
    `TradingView: ${fresh.length} active signals`,
    buys.length > 0 ? `BUY: ${buySymbols.join(', ')}` : null,
    sells.length > 0 ? `SELL: ${sellSymbols.join(', ')}` : null,
  ].filter(Boolean).join(' | ');

  return { findings, summary };
}

// ── Status ──────────────────────────────────────────────────────────────

export function getTVAgentStatus() {
  const fresh = getFreshSignals();
  return {
    totalSignals: signalBuffer.length,
    freshSignals: fresh.length,
    activeBuys: getActiveBuySignals().length,
    activeSells: getActiveSellSignals().length,
    buySymbols: getBuySymbols(),
    sellSymbols: getSellSymbols(),
    recentSignals: signalBuffer.slice(-10),
  };
}
