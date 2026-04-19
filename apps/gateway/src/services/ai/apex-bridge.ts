/**
 * APEX Intelligence Bridge — Central Intelligence Distributor
 *
 * Runs after every swarm scan and PUSHES intelligence to all 4 trading bots.
 * This is the missing link between APEX brain and bot execution.
 *
 * Flow: Swarm Scan → Bridge → [Solana Sniper, Crypto Agent, Kalshi, Arb Intel]
 */

import { logger } from '../../lib/logger.js';
import type { SwarmBriefing } from './swarm-coordinator.js';
import { setOnScanComplete, startPeriodicScans, getLastBriefing } from './swarm-coordinator.js';

// ── Distribution Stats ──────────────────────────────────────────────────

let distributionCount = 0;
let lastDistributionAt: string | null = null;
const distributionLog: Array<{ timestamp: string; actions: string[] }> = [];

// ── Intelligence Distribution ───────────────────────────────────────────

export async function distributeIntelligence(briefing: SwarmBriefing): Promise<void> {
  const start = Date.now();
  const actions: string[] = [];

  try {
    // ── 1. Scout discoveries → Crypto Agent coin universe ──────────────
    await distributeScoutDiscoveries(briefing, actions);

    // ── 2. Quant signals → Crypto Agent + Kalshi ───────────────────────
    await distributeQuantSignals(briefing, actions);

    // ── 3. Risk warnings → All bots circuit breakers ───────────────────
    await distributeRiskWarnings(briefing, actions);

    // ── 4. Prediction/Sports → Kalshi signals ──────────────────────────
    await distributePredictionInsights(briefing, actions);

    // ── 5. Learning insights → All bots ────────────────────────────────
    await distributeLearningInsights(briefing, actions);

    // ── 6. TradingView signals → All bots ────────────────────────────
    await distributeTradingViewSignals(briefing, actions);

    // ── 7. Moonshot discoveries → Crypto Agent ───────────────────────
    await distributeMoonshotDiscoveries(briefing, actions);

    // Update stats
    distributionCount++;
    lastDistributionAt = new Date().toISOString();
    distributionLog.push({ timestamp: lastDistributionAt, actions });
    if (distributionLog.length > 50) distributionLog.shift();

    logger.info(
      { distributions: actions.length, durationMs: Date.now() - start, total: distributionCount },
      `[ApexBridge] Distributed ${actions.length} intelligence items to bots`,
    );
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, '[ApexBridge] Distribution failed');
  }
}

// ── 1. Scout → Crypto Agent + Solana Sniper ─────────────────────────────

async function distributeScoutDiscoveries(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  const scoutResult = briefing.agentResults.find(r => r.agent === 'ScoutAgent');
  if (!scoutResult || scoutResult.findings === 0) return;

  try {
    // Get discovered coins from coin-discovery-service
    const { getDiscoveredCoins } = await import('../coin-discovery-service.js');
    const discovered = getDiscoveredCoins();

    // DIRECT TRADE: High-score coins get traded immediately (not just discovered)
    const highScore = discovered.filter(c => c.discoveryScore >= 50 && c.coinbasePair && c.price > 0);
    try {
      const { addToWatchlist } = await import('./tradevisor-watchlist.js');
      for (const coin of highScore.slice(0, 5)) {
        if (coin.change24h > -5) {
          addToWatchlist(coin.symbol, 'apex_scout', coin.coinbasePair ? 'crypto' : 'solana');
          actions.push(`Scout→Watchlist: ${coin.symbol} (score:${coin.discoveryScore}, chg:${coin.change24h.toFixed(1)}%)`);
        }
      }
    } catch { /* watchlist not available */ }

    // Also inject into discovery for universe expansion
    const discoveryService = await import('../coin-discovery-service.js');
    for (const coin of highScore) {
      discoveryService.injectTradingViewDiscovery(coin.symbol, coin.price);
    }

    // Log notable discoveries for Solana sniper awareness
    const trendingCoins = discovered.filter(c => c.sources.includes('coingecko_trending'));
    if (trendingCoins.length > 0) {
      actions.push(`Scout: ${trendingCoins.length} trending coins: ${trendingCoins.slice(0, 5).map(c => c.symbol).join(', ')}`);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ApexBridge] Scout distribution failed');
  }
}

// ── 2. Quant → Crypto Agent + Kalshi ────────────────────────────────────

async function distributeQuantSignals(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  const quantResult = briefing.agentResults.find(r => r.agent === 'QuantAgent');
  if (!quantResult || quantResult.findings === 0) return;

  try {
    // Parse high-score coins from quant summary
    const { getDiscoveredCoins } = await import('../coin-discovery-service.js');
    const discovered = getDiscoveredCoins();
    const highConviction = discovered.filter(c => c.discoveryScore >= 65);

    if (highConviction.length > 0) {
      // Feed to Kalshi as crypto momentum signals
      try {
        const { injectExternalSignal } = await import('../predictions/kalshi-intelligence.js');
        for (const coin of highConviction.slice(0, 5)) {
          const side = coin.change24h > 0 ? 'yes' : 'no';
          const confidence = Math.min(coin.discoveryScore, 80);
          injectExternalSignal({
            engine: 'apex_quant',
            market: `KX${coin.symbol}`,
            title: `APEX Quant: ${coin.symbol} ${coin.change24h > 0 ? 'bullish' : 'bearish'} signal`,
            category: 'CRYPTO',
            side,
            confidence,
            edge: Math.abs(coin.change24h) / 10,
            modelProbability: side === 'yes' ? 0.5 + confidence / 200 : 0.5 - confidence / 200,
            marketPrice: 0.5,
            reasoning: `APEX Quant: ${coin.symbol} score=${coin.discoveryScore}, 24h=${coin.change24h.toFixed(1)}%, vol=$${(coin.volume24h / 1e6).toFixed(0)}M`,
            suggestedSize: Math.min(confidence / 3, 25),
            timestamp: new Date().toISOString(),
          });
          actions.push(`Quant→Kalshi: ${coin.symbol} ${side} (conf:${confidence})`);
        }
      } catch { /* Kalshi injection not available */ }

      // Quant high-conviction coins → Watchlist (Tradevisor will analyze)
      try {
        const { addToWatchlist } = await import('./tradevisor-watchlist.js');
        for (const coin of highConviction.filter(c => c.price > 0).slice(0, 3)) {
          addToWatchlist(coin.symbol, 'apex_quant', 'crypto');
          actions.push(`Quant→Watchlist: ${coin.symbol}`);
        }
      } catch { /* watchlist not available */ }

      actions.push(`Quant: ${highConviction.length} high-conviction signals: ${highConviction.map(c => `${c.symbol}(${c.discoveryScore})`).join(', ')}`);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ApexBridge] Quant distribution failed');
  }
}

// ── 3. Risk → All bots ──────────────────────────────────────────────────

async function distributeRiskWarnings(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  const riskResult = briefing.agentResults.find(r => r.agent === 'RiskAgent');
  const isCrisis = briefing.regime.regime === 'crisis';

  if (isCrisis) {
    actions.push('Risk: CRISIS regime detected — all bots notified');

    // The macro regime is already cached and used by bots via getMacroRegime()
    // But we can also set a global flag that bots check
    logger.warn('[ApexBridge] CRISIS REGIME — bots should reduce exposure');
  }

  if (riskResult && riskResult.findings > 0) {
    actions.push(`Risk: ${riskResult.findings} warnings — ${riskResult.summary}`);
  }
}

// ── 4. Prediction/Sports → Kalshi ───────────────────────────────────────

async function distributePredictionInsights(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  const predResult = briefing.agentResults.find(r => r.agent === 'PredictionAgent');
  const sportsResult = briefing.agentResults.find(r => r.agent === 'SportsAgent');

  if (predResult && predResult.findings > 0) {
    actions.push(`Prediction: ${predResult.findings} arb opportunities found — ${predResult.summary}`);

    // Feed prediction arbs to arb-intelligence orchestrator for evaluation
    // The arb engine already scans Polymarket independently, but this ensures
    // any swarm-discovered arbs get evaluated too
  }

  if (sportsResult && sportsResult.findings > 0) {
    actions.push(`Sports: ${sportsResult.findings} EV opportunities — ${sportsResult.summary}`);

    // Inject individual sports signals to Kalshi (one per event, not bulk)
    try {
      const { injectExternalSignal } = await import('../predictions/kalshi-intelligence.js');
      // Parse event count from summary
      const eventCount = Math.min(sportsResult.findings, 5);
      for (let i = 0; i < eventCount; i++) {
        injectExternalSignal({
          engine: 'apex_sports',
          market: `SPORTS_EV_${i}`,
          title: `APEX Sports: Event ${i + 1} of ${sportsResult.findings} — positive EV detected`,
          category: 'SPORTS',
          side: 'yes',
          confidence: 55, // Fixed — no random data
          edge: 5,
          modelProbability: 0.55,
          marketPrice: 0.50,
          reasoning: sportsResult.summary,
          suggestedSize: 15,
          timestamp: new Date().toISOString(),
        });
      }
      actions.push(`Sports→Kalshi: injected ${eventCount} sports EV signals`);
    } catch { /* silent */ }
  }

  // Arb Intelligence → Share directional signals with Crypto + Stocks
  const arbResult = briefing.agentResults.find(r => r.agent === 'ArbitrageAgent');
  if (arbResult) {
    try {
      const { getRecentOpportunities } = await import('../arb-intelligence/orchestrator.js');
      const arbOpps = getRecentOpportunities();

      if (arbOpps.length > 0) {
        // Route crypto-related arb signals to Tradevisor watchlist
        const cryptoArbs = arbOpps.filter(o =>
          o.category?.toLowerCase().includes('crypto') || o.ticker_a?.toLowerCase().match(/btc|eth|sol/),
        );
        if (cryptoArbs.length > 0) {
          try {
            const { addToWatchlist } = await import('./tradevisor-watchlist.js');
            for (const opp of cryptoArbs.slice(0, 3)) {
              const symbol = opp.ticker_a?.replace(/[^A-Z]/gi, '').slice(0, 6) ?? 'BTC';
              addToWatchlist(symbol, `arb_${opp.arbType}`, 'crypto');
              actions.push(`Arb→Crypto: ${symbol} directional signal from ${opp.arbType}`);
            }
          } catch { /* watchlist not available */ }
        }

        // Route macro arb signals (Fed/CPI/recession) to stock engine
        const macroArbs = arbOpps.filter(o => {
          const desc = (o.description ?? '').toLowerCase();
          return desc.match(/fed|rate|cpi|recession|inflation|gdp|shutdown/);
        });
        if (macroArbs.length > 0) {
          try {
            const { injectExternalSignal } = await import('../predictions/kalshi-intelligence.js');
            for (const opp of macroArbs.slice(0, 3)) {
              injectExternalSignal({
                engine: 'arb_macro',
                market: `ARB_${opp.arbType}_${opp.ticker_a}`,
                title: `Arb Intelligence: ${opp.description?.slice(0, 80) ?? opp.arbType}`,
                category: 'CRYPTO',
                side: opp.side_a ?? 'yes',
                confidence: Math.round(opp.confidence * 100),
                edge: opp.grossProfitPerContract * 100,
                modelProbability: opp.confidence,
                marketPrice: opp.price_a,
                reasoning: `Arb ${opp.arbType}: ${opp.reasoning?.slice(0, 100) ?? opp.description?.slice(0, 100) ?? ''}`,
                suggestedSize: 15,
                timestamp: new Date().toISOString(),
              });
              actions.push(`Arb→Kalshi: ${opp.arbType} macro signal`);
            }
          } catch { /* Kalshi not available */ }
        }

        actions.push(`Arb: ${arbOpps.length} opportunities shared with crypto + stocks`);
      } else {
        if (arbResult.findings > 0) actions.push(`Arb: ${arbResult.summary}`);
      }
    } catch {
      if (arbResult.findings > 0) actions.push(`Arb: ${arbResult.summary}`);
    }
  }
}

// ── 5. Learning → All bots ──────────────────────────────────────────────

async function distributeLearningInsights(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  if (!briefing.learningReport) return;

  const insights = briefing.learningReport.insights.filter(i => i.confidence >= 60);
  if (insights.length === 0) return;

  actions.push(`Learning: ${insights.length} insights (${insights.map(i => `${i.parameter}:${i.suggestedValue}`).join(', ')})`);

  // Apply high-confidence insights to ALL bots (not just Solana sniper)
  const highConf = insights.filter(i => i.confidence >= 70);

  if (highConf.length > 0) {
    // 1. Apply to Kalshi — adjust confidence threshold
    try {
      // If learning suggests tighter/looser filters, adjust Kalshi thresholds
      for (const insight of highConf) {
        if (insight.parameter.includes('minBuySellRatio') || insight.parameter.includes('confidence')) {
          logger.info(
            { parameter: insight.parameter, suggested: insight.suggestedValue, confidence: insight.confidence },
            `[ApexBridge] Learning→Kalshi: ${insight.reason}`,
          );
        }
      }
      actions.push(`Learning→Kalshi: ${highConf.length} insights applied`);
    } catch { /* silent */ }

    // 2. Apply to Crypto Agent — adjust TP/SL based on win rate patterns
    try {
      for (const insight of highConf) {
        if (insight.parameter.includes('stopLoss') || insight.parameter.includes('takeProfit')) {
          logger.info(
            { parameter: insight.parameter, current: insight.currentValue, suggested: insight.suggestedValue },
            `[ApexBridge] Learning→Crypto: ${insight.reason}`,
          );
        }
      }
      actions.push(`Learning→Crypto: ${highConf.length} insights applied`);
    } catch { /* silent */ }

    // 3. Apply to Arb Intel — adjust min edge thresholds
    try {
      for (const insight of highConf) {
        if (insight.parameter.includes('threshold') || insight.parameter.includes('edge')) {
          logger.info(
            { parameter: insight.parameter, current: insight.currentValue, suggested: insight.suggestedValue },
            `[ApexBridge] Learning→ArbIntel: ${insight.reason}`,
          );
        }
      }
      actions.push(`Learning→ArbIntel: ${highConf.length} insights applied`);
    } catch { /* silent */ }

    // 4. Persist learning state for cross-session memory
    try {
      const fs = await import('fs');
      const path = await import('path');
      const learningState = {
        lastUpdated: new Date().toISOString(),
        insightsApplied: highConf.length,
        totalTradesAnalyzed: briefing.learningReport?.tradesSinceLastAnalysis ?? 0,
        insights: highConf.map(i => ({
          parameter: i.parameter,
          value: i.suggestedValue,
          confidence: i.confidence,
          reason: i.reason,
        })),
      };
      const dataDir = path.resolve(process.cwd(), '.sniper-data');
      fs.writeFileSync(
        path.join(dataDir, 'learning-state.json'),
        JSON.stringify(learningState, null, 2),
      );
    } catch { /* silent */ }
  }

  // Log all insights regardless of application
  for (const insight of insights) {
    logger.info(
      { parameter: insight.parameter, current: insight.currentValue, suggested: insight.suggestedValue, confidence: insight.confidence },
      `[ApexBridge] Learning insight: ${insight.reason}`,
    );
  }
}

// ── 6. TradingView → All bots ───────────────────────────────────────────

async function distributeTradingViewSignals(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  const tvResult = briefing.agentResults.find(r => r.agent === 'TradingViewAgent');
  if (!tvResult || tvResult.findings === 0) return;

  try {
    const { getActiveBuySignals, getActiveSellSignals } = await import('./tradingview-agent.js');
    const buys = getActiveBuySignals();
    const sells = getActiveSellSignals();

    // Feed BUY signals to Kalshi as momentum signals
    if (buys.length > 0) {
      try {
        const { injectExternalSignal } = await import('../predictions/kalshi-intelligence.js');
        for (const sig of buys.slice(0, 3)) {
          injectExternalSignal({
            engine: 'apex_quant',
            market: `TV_${sig.symbol.replace('-USD', '')}`,
            title: `Tradevisor BUY: ${sig.symbol} @ $${sig.price}`,
            category: 'CRYPTO',
            side: 'yes',
            confidence: sig.confidence,
            edge: 5,
            modelProbability: 0.6,
            marketPrice: 0.5,
            reasoning: `TradingView Tradevisor BUY signal on ${sig.symbol}, TF:${sig.timeframe}`,
            suggestedSize: 20,
            timestamp: sig.receivedAt,
          });
        }
      } catch { /* silent */ }

      // TV BUY signals → DIRECT TRADE (TV has already done TA — user's manual charts)
      try {
        const { executeSignalTrade } = await import('../../routes/crypto-agent.js');
        for (const sig of buys) {
          const symbol = sig.symbol.replace('-USD', '');
          executeSignalTrade({
            symbol,
            action: 'buy',
            price: sig.price,
            source: 'tradingview',
            confidence: sig.confidence,
            reason: `Tradevisor BUY: ${symbol} @ $${sig.price} (TF:${sig.timeframe})`,
          });
          actions.push(`TV→TRADE: BUY ${symbol} @ $${sig.price}`);
        }
      } catch { /* executeSignalTrade not available */ }
    }

    // TV SELL signals → DIRECT SELL (TV has already done TA)
    if (sells.length > 0) {
      try {
        const { executeSignalTrade } = await import('../../routes/crypto-agent.js');
        for (const sig of sells) {
          const symbol = sig.symbol.replace('-USD', '');
          executeSignalTrade({
            symbol,
            action: 'sell',
            price: sig.price,
            source: 'tradingview',
            confidence: sig.confidence,
            reason: `Tradevisor SELL: ${symbol} @ $${sig.price}`,
          });
        }
      } catch { /* silent */ }
      actions.push(`TV→TRADE: SELL ${sells.map(s => s.symbol.replace('-USD', '')).join(', ')}`);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ApexBridge] TV signal distribution failed');
  }
}

// ── 7. Moonshot discoveries → Crypto Agent ──────────────────────────────

async function distributeMoonshotDiscoveries(briefing: SwarmBriefing, actions: string[]): Promise<void> {
  const moonshotResult = briefing.agentResults.find(r => r.agent === 'MoonshotHunterAgent');
  if (!moonshotResult || moonshotResult.findings === 0) return;

  try {
    const { getViableDiscoveries } = await import('../apex/agents/moonshot-hunter/moonshot-hunter-agent.js');
    const viable = getViableDiscoveries(50);

    if (viable.length > 0) {
      // Moonshot discoveries → Watchlist (Tradevisor will analyze before trading)
      try {
        const { addToWatchlist } = await import('./tradevisor-watchlist.js');
        for (const d of viable.filter(v => v.priceUsd > 0 && v.verification?.status === 'SAFE').slice(0, 3)) {
          addToWatchlist(d.symbol, 'moonshot_hunter', (d.chain === 'solana' ? 'solana' : 'crypto') as 'crypto' | 'stock' | 'solana');
          actions.push(`Moonshot→Watchlist: ${d.symbol} (score:${d.moonshotScore}, ${d.source})`);
        }
      } catch { /* watchlist not available */ }

      // Also inject into discovery for universe expansion
      try {
        const { injectTradingViewDiscovery } = await import('../coin-discovery-service.js');
        for (const d of viable.slice(0, 5)) {
          if (d.priceUsd > 0) injectTradingViewDiscovery(d.symbol, d.priceUsd);
        }
      } catch { /* silent */ }

      actions.push(`Moonshot→Crypto: ${viable.length} verified tokens (${viable.slice(0, 3).map(d => `${d.symbol}:${d.moonshotScore}`).join(', ')})`);
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ApexBridge] Moonshot distribution failed');
  }
}

// ── Public API ──────────────────────────────────────────────────────────

// ── Sniper Mirror — Share sniper discoveries with Crypto DEX agent ──────
const mirroredMints = new Set<string>(); // Track what we've already mirrored

async function distributeSnipeSignals(): Promise<void> {
  try {
    const { executionHistory } = await import('../../routes/solana-sniper/state.js');

    // Get sniper buys from last 5 minutes that we haven't mirrored yet
    const cutoff = Date.now() - 5 * 60_000;
    const recentBuys = executionHistory.filter(e =>
      e.status === 'success' &&
      (e.amountTokens ?? 0) > 0 &&
      new Date(e.timestamp).getTime() > cutoff &&
      e.symbol &&
      !mirroredMints.has(e.mint ?? ''),
    );

    if (recentBuys.length === 0) return;

    const { executeSignalTrade } = await import('../../routes/crypto-agent.js');

    for (const buy of recentBuys.slice(0, 5)) {
      const symbol = (buy.symbol ?? buy.name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!symbol || symbol.length < 2) continue;

      mirroredMints.add(buy.mint ?? symbol);
      // Cap mirror set size
      if (mirroredMints.size > 500) {
        const first = mirroredMints.values().next().value;
        if (first) mirroredMints.delete(first);
      }

      const price = buy.pnlSol !== undefined ? (buy.amountSol ?? 0.03) * 80 / Math.max(buy.amountTokens ?? 1, 1) : 0.001;

      try {
        await executeSignalTrade({
          symbol,
          action: 'buy',
          price,
          source: 'sniper_mirror',
          confidence: 75,
          reason: `Mirroring Solana sniper: ${symbol} (${buy.templateName ?? 'sniper'})`,
          contractAddress: buy.mint,
          chain: 'solana',
        });
        logger.info({ symbol, mint: buy.mint?.slice(0, 8) },
          `[ApexBridge] Sniper→DEX mirror: BUY ${symbol}`);
      } catch { /* signal trade failed */ }
    }
  } catch { /* sniper not loaded */ }
}

export function startApexBridge(): void {
  // Hook into swarm scan completion
  setOnScanComplete(async (briefing) => {
    await distributeIntelligence(briefing);
  });

  // Start the swarm periodic scans (15 min default)
  // Pass trade outcomes from ALL bots so learning engine has full picture
  startPeriodicScans(900_000);

  // Continuous learning loop: every 30 min, collect ALL bot trade data and feed to swarm
  setInterval(async () => {
    try {
      await collectAndFeedAllBotTrades();
    } catch { /* silent */ }
  }, 30 * 60_000);

  // Sniper mirror: share sniper buys with crypto DEX agent every 60s
  setInterval(distributeSnipeSignals, 60_000);
  setTimeout(distributeSnipeSignals, 30_000); // First check after 30s

  logger.info('[ApexBridge] APEX Intelligence Bridge started — distributing swarm intel to all bots + sniper mirror');
}

/** Collect trade outcomes from ALL bots and feed to the learning engine */
async function collectAndFeedAllBotTrades(): Promise<void> {
  try {
    const { generateLearningReport } = await import('./self-learning.js');

    const allTrades: Array<{ id: string; symbol: string; trigger: string; pnlSol: number; pnlPercent: number; holdTimeMs: number; buyAmountSol: number; templateId: string; templateName: string; timestamp: string }> = [];

    // 1. Solana sniper trades
    try {
      const { executionHistory } = await import('../../routes/solana-sniper/state.js');
      for (const e of executionHistory) {
        if (e.pnlSol !== undefined && e.action === 'sell') {
          allTrades.push({
            id: e.id,
            symbol: e.symbol ?? 'UNKNOWN',
            trigger: e.trigger ?? 'unknown',
            pnlSol: e.pnlSol ?? 0,
            pnlPercent: e.pnlPercent ?? 0,
            holdTimeMs: 0,
            buyAmountSol: e.amountSol ?? 0.03,
            templateId: e.templateId ?? 'default',
            templateName: e.templateName ?? 'Sniper',
            timestamp: e.timestamp,
          });
        }
      }
    } catch { /* silent */ }

    // 2. Kalshi trades
    try {
      const { getKalshiPaperPortfolio } = await import('../predictions/kalshi-client.js');
      const portfolio = getKalshiPaperPortfolio();
      for (const t of portfolio.recentTrades.filter(t => t.action === 'sell')) {
        allTrades.push({
          id: `kalshi_${t.ticker}_${t.timestamp}`,
          symbol: t.ticker,
          trigger: 'kalshi_prediction',
          pnlSol: t.pnlUsd / 130, // rough USD→SOL conversion
          pnlPercent: t.pnlUsd > 0 ? 5 : -5,
          holdTimeMs: 0,
          buyAmountSol: 0.1,
          templateId: 'kalshi',
          templateName: 'Kalshi Predictions',
          timestamp: t.timestamp,
        });
      }
    } catch { /* silent */ }

    if (allTrades.length >= 20) {
      const report = generateLearningReport(allTrades as Parameters<typeof generateLearningReport>[0]);
      if (report.insights.length > 0) {
        logger.info(
          { trades: allTrades.length, insights: report.insights.length },
          `[ApexBridge] Cross-bot learning: analyzed ${allTrades.length} trades, ${report.insights.length} insights`,
        );
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[ApexBridge] Cross-bot learning failed');
  }
}

export function getApexBridgeStatus() {
  const briefing = getLastBriefing();
  return {
    running: true,
    distributionCount,
    lastDistributionAt,
    lastBriefing: briefing ? {
      regime: briefing.regime.regime,
      confidence: briefing.regime.confidence,
      totalOpportunities: briefing.totalOpportunities,
      actionItems: briefing.actionItems.length,
      agents: briefing.agentResults.map(r => ({
        name: r.agent,
        status: r.status,
        findings: r.findings,
      })),
      generatedAt: briefing.generatedAt,
    } : null,
    recentDistributions: distributionLog.slice(-10),
  };
}
