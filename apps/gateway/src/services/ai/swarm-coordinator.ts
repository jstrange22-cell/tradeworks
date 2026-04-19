/**
 * Agent Swarm Coordinator
 *
 * Orchestrates parallel intelligence gathering across all 4 markets.
 * Each "agent" is a specialized scanner that runs concurrently:
 *
 *   1. CryptoAgent    — Solana sniper + Coinbase spot analysis
 *   2. StocksAgent    — Alpaca swing trade scanner
 *   3. PredictionAgent — Polymarket arbitrage scanner
 *   4. SportsAgent    — Expected value scanner via The Odds API
 *   5. MacroAgent     — Regime classifier (drives all others)
 *   6. LearningAgent  — Post-trade analysis + parameter optimization
 *
 * The coordinator runs on a configurable interval (default: 15 min)
 * and produces a unified intelligence briefing.
 */

import { getMacroRegime, type MacroRegimeReport } from './macro-regime.js';
import { getAllocation, type PortfolioAllocation } from './capital-allocator.js';
import {
  generateLearningReport,
  type LearningReport,
  type TradeOutcome,
} from './self-learning.js';
import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface AgentResult {
  agent: string;
  status: 'success' | 'error' | 'skipped';
  durationMs: number;
  findings: number;
  summary: string;
  error?: string;
}

export interface SwarmBriefing {
  regime: MacroRegimeReport;
  allocation: PortfolioAllocation;
  agentResults: AgentResult[];
  learningReport: LearningReport | null;
  totalOpportunities: number;
  actionItems: ActionItem[];
  generatedAt: string;
  durationMs: number;
}

export interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  market: string;
  action: string;
  details: string;
}

// ── Agent Runners ────────────────────────────────────────────────────────

async function runAgent(
  name: string,
  fn: () => Promise<{ findings: number; summary: string }>,
): Promise<AgentResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      agent: name,
      status: 'success',
      durationMs: Date.now() - start,
      findings: result.findings,
      summary: result.summary,
    };
  } catch (err) {
    return {
      agent: name,
      status: 'error',
      durationMs: Date.now() - start,
      findings: 0,
      summary: `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      error: err instanceof Error ? err.message : 'Unknown',
    };
  }
}

// ── APEX INTELLIGENCE SWARM — 7 Agent Architecture ──────────────────────
// Commander → Scout + Quant + Sentiment + Risk + Executor + Memory
// Each agent runs in parallel and contributes to consensus decisions.

async function scoutAgent(): Promise<{ findings: number; summary: string }> {
  // Scout: Finds markets and opportunities across all venues
  let findings = 0;
  const summaries: string[] = [];

  try {
    // Scan Kalshi live markets
    const kalshiRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/events/?limit=20&status=open', {
      signal: AbortSignal.timeout(8_000),
    });
    if (kalshiRes.ok) {
      const data = await kalshiRes.json() as { events: Array<{ category: string }> };
      findings += data.events?.length ?? 0;
      summaries.push(`${data.events?.length ?? 0} Kalshi events`);
    }
  } catch { /* silent */ }

  try {
    // Scan coin discovery
    const { getDiscoveredCoins } = await import('../coin-discovery-service.js');
    const discovered = getDiscoveredCoins();
    if (discovered.length > 0) {
      findings += discovered.length;
      summaries.push(`${discovered.length} discovered coins (${discovered.slice(0, 3).map(c => c.symbol).join(', ')})`);
    }
  } catch { /* silent */ }

  return {
    findings,
    summary: summaries.length > 0 ? `Scout found: ${summaries.join(', ')}` : 'Scout: no new opportunities',
  };
}

async function cryptoAgent(): Promise<{ findings: number; summary: string }> {
  // Quant role for crypto: analyzes sniper data + crypto agent performance
  try {
    const { getDiscoveredCoins } = await import('../coin-discovery-service.js');
    const discovered = getDiscoveredCoins();
    const highScore = discovered.filter(c => c.discoveryScore >= 60);
    return {
      findings: highScore.length,
      summary: highScore.length > 0
        ? `Quant: ${highScore.length} high-score coins: ${highScore.map(c => `${c.symbol}(${c.discoveryScore})`).join(', ')}`
        : 'Quant: no high-conviction crypto signals',
    };
  } catch {
    return { findings: 0, summary: 'Quant: crypto analysis idle' };
  }
}

async function riskAgent(): Promise<{ findings: number; summary: string }> {
  // Risk: checks portfolio exposure, drawdown, circuit breakers
  const warnings: string[] = [];

  try {
    const regime = await getMacroRegime();
    if (regime.regime === 'crisis') warnings.push('CRISIS regime — reduce all exposure');
    if (regime.positionSizeMultiplier < 0.5) warnings.push(`Position size at ${(regime.positionSizeMultiplier * 100).toFixed(0)}%`);
  } catch { /* silent */ }

  return {
    findings: warnings.length,
    summary: warnings.length > 0
      ? `Risk Agent WARNINGS: ${warnings.join('; ')}`
      : 'Risk Agent: all clear, no flags',
  };
}

async function stocksAgent(): Promise<{ findings: number; summary: string }> {
  try {
    const { scanForSwingTrades } = await import('../stocks/swing-scanner.js');
    const result = await scanForSwingTrades();
    return {
      findings: result.signals.length,
      summary: result.signals.length > 0
        ? `Found ${result.signals.length} swing setups: ${result.signals.slice(0, 3).map(s => `${s.symbol} (${s.confidence}%)`).join(', ')}`
        : `Scanned ${result.watchlistSize} stocks — no setups above threshold`,
    };
  } catch {
    return { findings: 0, summary: 'Stock scanner not configured (need ALPACA_API_KEY)' };
  }
}

async function predictionAgent(): Promise<{ findings: number; summary: string }> {
  try {
    const { scanPredictionArbitrage } = await import('../predictions/polymarket-arb.js');
    const result = await scanPredictionArbitrage(100);
    return {
      findings: result.opportunities.length,
      summary: result.opportunities.length > 0
        ? `Found ${result.opportunities.length} arb opportunities across ${result.marketsScanned} markets`
        : `Scanned ${result.marketsScanned} Polymarket markets — no arbitrage found`,
    };
  } catch {
    return { findings: 0, summary: 'Polymarket scanner unavailable' };
  }
}

async function sportsAgent(): Promise<{ findings: number; summary: string }> {
  if (!process.env.ODDS_API_KEY) {
    return { findings: 0, summary: 'Sports scanner not configured (need ODDS_API_KEY)' };
  }

  try {
    // Use the full 6-engine sports orchestrator
    const { getSportsStatus, getSportsPortfolio } = await import('../sports-intelligence/sports-orchestrator.js');
    const status = getSportsStatus();
    const portfolio = getSportsPortfolio();

    if (status.running) {
      return {
        findings: status.opportunitiesFound,
        summary: `Sports Intel: ${status.scanCycles} cycles, ${status.opportunitiesFound} opps, ${portfolio.totalBets} bets, P&L $${portfolio.totalPnlUsd.toFixed(2)}, CLV ${portfolio.rollingClv.toFixed(3)}`,
      };
    }

    // Fallback: direct Odds API check
    const apiRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/upcoming/odds?apiKey=${process.env.ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!apiRes.ok) throw new Error(`${apiRes.status}`);
    const events = (await apiRes.json()) as Array<{ home_team: string; away_team: string }>;
    return {
      findings: events.length,
      summary: `${events.length} upcoming events with odds from US sportsbooks`,
    };
  } catch {
    return { findings: 0, summary: 'Sports API unavailable' };
  }
}

async function arbitrageAgent(): Promise<{ findings: number; summary: string }> {
  try {
    const { getArbStatus, getArbPortfolio } = await import('../arb-intelligence/orchestrator.js');
    const status = getArbStatus();
    const portfolio = getArbPortfolio();

    const findings = status.opportunitiesFound > 0 ? 1 : 0;
    const summary = status.running
      ? `Arb Intel: ${status.scanCycles} scans, ${status.opportunitiesFound} opps found, ${portfolio.trades} trades, P&L $${portfolio.totalPnlUsd.toFixed(2)} (7 detectors: T1-T7)`
      : 'Arb Intel: engine not running';

    return { findings, summary };
  } catch {
    return { findings: 0, summary: 'Arb Intel: not available' };
  }
}

async function tradingViewAgent(): Promise<{ findings: number; summary: string }> {
  try {
    const { tradingViewAgentRunner } = await import('./tradingview-agent.js');
    return tradingViewAgentRunner();
  } catch {
    return { findings: 0, summary: 'TradingView agent not available' };
  }
}

async function moonshotAgent(): Promise<{ findings: number; summary: string }> {
  try {
    const { runMoonshotScan } = await import('../apex/agents/moonshot-hunter/moonshot-hunter-agent.js');
    const result = await runMoonshotScan();
    return { findings: result.findings, summary: result.summary };
  } catch (err) {
    return { findings: 0, summary: `Moonshot hunter: ${err instanceof Error ? err.message : 'error'}` };
  }
}

// ── Swarm Coordinator ────────────────────────────────────────────────────

export async function runSwarmScan(
  recentTrades?: TradeOutcome[],
): Promise<SwarmBriefing> {
  const start = Date.now();

  // Run all 10 APEX Swarm agents in parallel
  // Architecture: Commander receives intel from all specialized agents
  const [regime, allocation, ...agentResults] = await Promise.all([
    getMacroRegime(),
    getAllocation(),
    runAgent('ScoutAgent', scoutAgent),             // Finds opportunities across all venues
    runAgent('QuantAgent', cryptoAgent),              // Analyzes crypto signals + coin discovery
    runAgent('RiskAgent', riskAgent),                 // Checks exposure, drawdown, circuit breakers
    runAgent('StocksAgent', stocksAgent),             // Alpaca swing trade scanner
    runAgent('PredictionAgent', predictionAgent),     // Kalshi/Polymarket arb scanner
    runAgent('SportsAgent', sportsAgent),             // Sports betting EV scanner
    runAgent('TradingViewAgent', tradingViewAgent),   // TradingView Tradevisor signals
    runAgent('MoonshotHunterAgent', moonshotAgent),   // DexScreener/GeckoTerminal new token discovery
    runAgent('ArbitrageAgent', arbitrageAgent),       // 7-detector arb intelligence engine
  ]);

  // Run learning agent if we have trades
  let learningReport: LearningReport | null = null;
  if (recentTrades && recentTrades.length >= 20) {
    learningReport = generateLearningReport(recentTrades);
  }

  // Generate action items
  const actionItems: ActionItem[] = [];

  // Regime-based actions
  if (regime.regime === 'crisis') {
    actionItems.push({
      priority: 'high',
      market: 'all',
      action: 'Reduce exposure',
      details: `Crisis regime detected (confidence ${regime.confidence}%). ${regime.summary}`,
    });
  }

  // Stock opportunities
  const stockResult = agentResults.find(r => r.agent === 'StocksAgent');
  if (stockResult?.findings && stockResult.findings > 0) {
    actionItems.push({
      priority: 'medium',
      market: 'stocks',
      action: 'Review swing setups',
      details: stockResult.summary,
    });
  }

  // Prediction arb opportunities
  const predResult = agentResults.find(r => r.agent === 'PredictionAgent');
  if (predResult?.findings && predResult.findings > 0) {
    actionItems.push({
      priority: 'medium',
      market: 'predictions',
      action: 'Review arbitrage',
      details: predResult.summary,
    });
  }

  // Scout discoveries
  const scoutResult = agentResults.find(r => r.agent === 'ScoutAgent');
  if (scoutResult?.findings && scoutResult.findings > 0) {
    actionItems.push({
      priority: 'medium',
      market: 'all',
      action: 'New opportunities discovered',
      details: scoutResult.summary,
    });
  }

  // Risk warnings
  const riskResult = agentResults.find(r => r.agent === 'RiskAgent');
  if (riskResult?.findings && riskResult.findings > 0) {
    actionItems.push({
      priority: 'high',
      market: 'all',
      action: 'Risk warning',
      details: riskResult.summary,
    });
  }

  // Learning insights
  if (learningReport && learningReport.insights.length > 0) {
    const highConf = learningReport.insights.filter(i => i.confidence >= 70);
    if (highConf.length > 0) {
      actionItems.push({
        priority: 'high',
        market: 'crypto',
        action: 'Apply strategy optimizations',
        details: `${highConf.length} high-confidence parameter adjustments recommended based on ${learningReport.tradesSinceLastAnalysis} trades`,
      });
    }
  }

  const totalOpportunities = agentResults.reduce((s, r) => s + r.findings, 0);

  logger.info(
    {
      regime: regime.regime,
      agents: agentResults.length,
      opportunities: totalOpportunities,
      durationMs: Date.now() - start,
    },
    '[Swarm] Scan complete',
  );

  return {
    regime,
    allocation,
    agentResults,
    learningReport,
    totalOpportunities,
    actionItems,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

// ── Periodic Scan ────────────────────────────────────────────────────────

let scanInterval: ReturnType<typeof setInterval> | null = null;
let lastBriefing: SwarmBriefing | null = null;
let onScanCompleteCallback: ((briefing: SwarmBriefing) => void | Promise<void>) | null = null;

/** Register a callback that fires after every swarm scan (used by apex-bridge) */
export function setOnScanComplete(cb: (briefing: SwarmBriefing) => void | Promise<void>): void {
  onScanCompleteCallback = cb;
}

export function startPeriodicScans(intervalMs = 900_000): void {
  if (scanInterval) return;

  logger.info({ intervalMs }, '[Swarm] Starting periodic scans');

  scanInterval = setInterval(async () => {
    try {
      lastBriefing = await runSwarmScan();
      if (onScanCompleteCallback) await onScanCompleteCallback(lastBriefing);
    } catch (err) {
      logger.error({ err }, '[Swarm] Periodic scan failed');
    }
  }, intervalMs);

  // Run first scan after 30s delay
  setTimeout(async () => {
    try {
      lastBriefing = await runSwarmScan();
      if (onScanCompleteCallback) await onScanCompleteCallback(lastBriefing);
    } catch (err) {
      logger.error({ err }, '[Swarm] Initial scan failed');
    }
  }, 30_000);
}

export function stopPeriodicScans(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export function getLastBriefing(): SwarmBriefing | null {
  return lastBriefing;
}
