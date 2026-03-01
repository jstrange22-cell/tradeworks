import 'dotenv/config';

import {
  db,
  pool,
  portfolios,
  strategies,
  positions,
  orders,
  agentLogs,
  tradingCycles,
  riskSnapshots,
  guardrails,
  type NewPortfolio,
  type NewStrategy,
  type NewPosition,
  type NewOrder,
  type NewAgentLog,
  type NewTradingCycle,
  type NewRiskSnapshot,
  type NewGuardrail,
} from '@tradeworks/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

function randomSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('--- TradeWorks Seed Script ---\n');

  // =========================================================================
  // 1. Clear existing data (reverse-dependency order)
  // =========================================================================
  console.log('Clearing existing data...');
  await db.delete(agentLogs);
  await db.delete(tradingCycles);
  await db.delete(riskSnapshots);
  await db.delete(orders);
  await db.delete(positions);
  await db.delete(guardrails);
  await db.delete(strategies);
  await db.delete(portfolios);
  console.log('Clearing existing data... done\n');

  // =========================================================================
  // 2. Portfolios
  // =========================================================================
  console.log('Seeding portfolios...');

  const portfolioData: NewPortfolio[] = [
    {
      name: 'TradeWorks Paper',
      initialCapital: '100000.00',
      currentCapital: '103250.00',
      currency: 'USD',
      paperTrading: true,
    },
  ];

  const [portfolio] = await db
    .insert(portfolios)
    .values(portfolioData)
    .returning();

  console.log('Seeding portfolios... done');

  // =========================================================================
  // 3. Strategies
  // =========================================================================
  console.log('Seeding strategies...');

  const strategyData: NewStrategy[] = [
    {
      name: 'BTC Trend Following',
      market: 'crypto',
      strategyType: 'trend_following',
      enabled: true,
      maxAllocation: '30000.00',
      riskPerTrade: '0.020000',
      minRiskReward: '2.00',
      params: {
        lookback: 20,
        entryThreshold: 0.02,
        exitThreshold: 0.01,
        timeframe: '4h',
      },
    },
    {
      name: 'ETH Mean Reversion',
      market: 'crypto',
      strategyType: 'mean_reversion',
      enabled: true,
      maxAllocation: '20000.00',
      riskPerTrade: '0.015000',
      minRiskReward: '1.50',
      params: {
        lookback: 14,
        zScoreEntry: 2.0,
        zScoreExit: 0.5,
        timeframe: '1h',
      },
    },
    {
      name: 'SPY Momentum',
      market: 'equities',
      strategyType: 'momentum',
      enabled: true,
      maxAllocation: '35000.00',
      riskPerTrade: '0.010000',
      minRiskReward: '2.50',
      params: {
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        timeframe: '1d',
      },
    },
    {
      name: 'Crypto Arb',
      market: 'crypto',
      strategyType: 'arbitrage',
      enabled: false,
      maxAllocation: '15000.00',
      riskPerTrade: '0.005000',
      minRiskReward: '1.00',
      params: {
        minSpread: 0.003,
        exchanges: ['binance', 'coinbase'],
        instruments: ['BTC-USD', 'ETH-USD'],
      },
    },
    {
      name: 'ML Signal Alpha',
      market: 'crypto',
      strategyType: 'ml_signal',
      enabled: false,
      maxAllocation: '25000.00',
      riskPerTrade: '0.025000',
      minRiskReward: '2.00',
      params: {
        modelVersion: 'v0.3.1',
        confidenceThreshold: 0.72,
        features: ['price', 'volume', 'sentiment', 'orderflow'],
      },
    },
  ];

  const insertedStrategies = await db
    .insert(strategies)
    .values(strategyData)
    .returning();

  const strategyMap = Object.fromEntries(
    insertedStrategies.map((s) => [s.name, s.id]),
  );

  console.log('Seeding strategies... done');

  // =========================================================================
  // 4. Positions
  // =========================================================================
  console.log('Seeding positions...');

  const positionData: NewPosition[] = [
    {
      portfolioId: portfolio.id,
      instrument: 'BTC-USD',
      market: 'crypto',
      side: 'long',
      quantity: '0.50000000',
      averageEntry: '94500.00000000',
      currentPrice: '95200.00000000',
      unrealizedPnl: '350.00',
      realizedPnl: '0.00',
      stopLoss: '91000.00000000',
      takeProfit: '102000.00000000',
      status: 'open',
      strategyId: strategyMap['BTC Trend Following'],
      openedAt: daysAgo(5),
      metadata: { signal: 'breakout_above_20d_high' },
    },
    {
      portfolioId: portfolio.id,
      instrument: 'ETH-USD',
      market: 'crypto',
      side: 'long',
      quantity: '5.00000000',
      averageEntry: '3200.00000000',
      currentPrice: '3280.00000000',
      unrealizedPnl: '400.00',
      realizedPnl: '0.00',
      stopLoss: '3050.00000000',
      takeProfit: '3600.00000000',
      status: 'open',
      strategyId: strategyMap['ETH Mean Reversion'],
      openedAt: daysAgo(3),
      metadata: { signal: 'zscore_below_neg2' },
    },
    {
      portfolioId: portfolio.id,
      instrument: 'SPY',
      market: 'equities',
      side: 'long',
      quantity: '50.00000000',
      averageEntry: '580.00000000',
      currentPrice: '584.50000000',
      unrealizedPnl: '225.00',
      realizedPnl: '0.00',
      stopLoss: '572.00000000',
      takeProfit: '600.00000000',
      status: 'open',
      strategyId: strategyMap['SPY Momentum'],
      openedAt: daysAgo(4),
      metadata: { signal: 'rsi_momentum_bullish' },
    },
    {
      portfolioId: portfolio.id,
      instrument: 'SOL-USD',
      market: 'crypto',
      side: 'long',
      quantity: '100.00000000',
      averageEntry: '155.00000000',
      currentPrice: '158.30000000',
      unrealizedPnl: '330.00',
      realizedPnl: '0.00',
      stopLoss: '148.00000000',
      takeProfit: '175.00000000',
      status: 'open',
      strategyId: strategyMap['BTC Trend Following'],
      openedAt: daysAgo(2),
      metadata: { signal: 'trend_continuation' },
    },
  ];

  const insertedPositions = await db
    .insert(positions)
    .values(positionData)
    .returning();

  const positionMap = Object.fromEntries(
    insertedPositions.map((p) => [p.instrument, p.id]),
  );

  console.log('Seeding positions... done');

  // =========================================================================
  // 5. Orders
  // =========================================================================
  console.log('Seeding orders...');

  const orderData: NewOrder[] = [
    // BTC buy to open position
    {
      portfolioId: portfolio.id,
      positionId: positionMap['BTC-USD'],
      instrument: 'BTC-USD',
      market: 'crypto',
      side: 'buy',
      orderType: 'market',
      quantity: '0.50000000',
      filledQuantity: '0.50000000',
      averageFill: '94500.00000000',
      status: 'filled',
      strategyId: strategyMap['BTC Trend Following'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(5),
      filledAt: daysAgo(5),
      fees: '0.00472500',
      slippage: '0.00012000',
    },
    // ETH buy to open position
    {
      portfolioId: portfolio.id,
      positionId: positionMap['ETH-USD'],
      instrument: 'ETH-USD',
      market: 'crypto',
      side: 'buy',
      orderType: 'limit',
      quantity: '5.00000000',
      price: '3200.00000000',
      filledQuantity: '5.00000000',
      averageFill: '3200.00000000',
      status: 'filled',
      strategyId: strategyMap['ETH Mean Reversion'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(3),
      filledAt: daysAgo(3),
      fees: '0.01600000',
      slippage: '0.00000000',
    },
    // SPY buy to open position
    {
      portfolioId: portfolio.id,
      positionId: positionMap['SPY'],
      instrument: 'SPY',
      market: 'equities',
      side: 'buy',
      orderType: 'market',
      quantity: '50.00000000',
      filledQuantity: '50.00000000',
      averageFill: '580.00000000',
      status: 'filled',
      strategyId: strategyMap['SPY Momentum'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(4),
      filledAt: daysAgo(4),
      fees: '0.29000000',
      slippage: '0.05000000',
    },
    // SOL buy to open position
    {
      portfolioId: portfolio.id,
      positionId: positionMap['SOL-USD'],
      instrument: 'SOL-USD',
      market: 'crypto',
      side: 'buy',
      orderType: 'market',
      quantity: '100.00000000',
      filledQuantity: '100.00000000',
      averageFill: '155.00000000',
      status: 'filled',
      strategyId: strategyMap['BTC Trend Following'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(2),
      filledAt: daysAgo(2),
      fees: '0.01550000',
      slippage: '0.00800000',
    },
    // Previous BTC partial sell (take profit)
    {
      portfolioId: portfolio.id,
      instrument: 'BTC-USD',
      market: 'crypto',
      side: 'sell',
      orderType: 'limit',
      quantity: '0.10000000',
      price: '96000.00000000',
      filledQuantity: '0.10000000',
      averageFill: '95980.00000000',
      status: 'filled',
      strategyId: strategyMap['BTC Trend Following'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(6),
      filledAt: daysAgo(6),
      fees: '0.00959800',
      slippage: '0.00020000',
    },
    // Previous ETH sell (mean reversion exit)
    {
      portfolioId: portfolio.id,
      instrument: 'ETH-USD',
      market: 'crypto',
      side: 'sell',
      orderType: 'limit',
      quantity: '3.00000000',
      price: '3350.00000000',
      filledQuantity: '3.00000000',
      averageFill: '3348.50000000',
      status: 'filled',
      strategyId: strategyMap['ETH Mean Reversion'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(5),
      filledAt: daysAgo(5),
      fees: '0.01004550',
      slippage: '0.00150000',
    },
    // SOL scale-in buy
    {
      portfolioId: portfolio.id,
      positionId: positionMap['SOL-USD'],
      instrument: 'SOL-USD',
      market: 'crypto',
      side: 'buy',
      orderType: 'limit',
      quantity: '25.00000000',
      price: '152.00000000',
      filledQuantity: '25.00000000',
      averageFill: '152.10000000',
      status: 'filled',
      strategyId: strategyMap['BTC Trend Following'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(1),
      filledAt: daysAgo(1),
      fees: '0.00380250',
      slippage: '0.00100000',
    },
    // SPY rebalance sell
    {
      portfolioId: portfolio.id,
      instrument: 'SPY',
      market: 'equities',
      side: 'sell',
      orderType: 'market',
      quantity: '10.00000000',
      filledQuantity: '10.00000000',
      averageFill: '583.20000000',
      status: 'filled',
      strategyId: strategyMap['SPY Momentum'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(1),
      filledAt: daysAgo(1),
      fees: '0.05832000',
      slippage: '0.08000000',
    },
    // BTC trailing stop order (filled yesterday)
    {
      portfolioId: portfolio.id,
      instrument: 'BTC-USD',
      market: 'crypto',
      side: 'sell',
      orderType: 'trailing_stop',
      quantity: '0.05000000',
      stopPrice: '93000.00000000',
      filledQuantity: '0.05000000',
      averageFill: '94800.00000000',
      status: 'filled',
      strategyId: strategyMap['BTC Trend Following'],
      agentId: 'execution-agent',
      submittedAt: daysAgo(2),
      filledAt: daysAgo(1),
      fees: '0.00474000',
      slippage: '0.00050000',
    },
    // ETH recent buy (add to position)
    {
      portfolioId: portfolio.id,
      positionId: positionMap['ETH-USD'],
      instrument: 'ETH-USD',
      market: 'crypto',
      side: 'buy',
      orderType: 'limit',
      quantity: '2.00000000',
      price: '3180.00000000',
      filledQuantity: '2.00000000',
      averageFill: '3182.00000000',
      status: 'filled',
      strategyId: strategyMap['ETH Mean Reversion'],
      agentId: 'execution-agent',
      submittedAt: hoursAgo(8),
      filledAt: hoursAgo(7),
      fees: '0.00636400',
      slippage: '0.00200000',
    },
  ];

  await db.insert(orders).values(orderData);

  console.log('Seeding orders... done');

  // =========================================================================
  // 6. Guardrails
  // =========================================================================
  console.log('Seeding guardrails...');

  const guardrailData: NewGuardrail[] = [
    {
      guardrailType: 'max_position_size',
      value: {
        maxPercent: 30,
        description: 'No single position may exceed 30% of total equity',
      },
      enabled: true,
    },
    {
      guardrailType: 'max_portfolio_heat',
      value: {
        maxPercent: 6,
        description: 'Total portfolio risk (capital at risk) must stay under 6%',
      },
      enabled: true,
    },
    {
      guardrailType: 'max_drawdown',
      value: {
        maxPercent: 15,
        description: 'Halt trading if drawdown exceeds 15% from equity peak',
      },
      enabled: true,
    },
    {
      guardrailType: 'max_daily_loss',
      value: {
        maxUsd: 2000,
        maxPercent: 2,
        description: 'Stop all new entries if daily loss exceeds $2000 or 2%',
      },
      enabled: true,
    },
    {
      guardrailType: 'circuit_breaker',
      value: {
        consecutiveLosses: 5,
        cooldownMinutes: 60,
        description: 'Pause trading for 60 min after 5 consecutive losing trades',
      },
      enabled: true,
    },
  ];

  await db.insert(guardrails).values(guardrailData);

  console.log('Seeding guardrails... done');

  // =========================================================================
  // 7. Risk Snapshots
  // =========================================================================
  console.log('Seeding risk snapshots...');

  const riskSnapshotData: NewRiskSnapshot[] = [
    // 3 days ago -- worst day
    {
      portfolioId: portfolio.id,
      timestamp: daysAgo(3),
      totalEquity: '101200.00',
      cashBalance: '48500.00',
      grossExposure: '64200.00',
      netExposure: '52700.00',
      var95: '3100.00',
      var99: '4800.00',
      maxDrawdown: '0.028000',
      dailyPnl: '-820.00',
      sharpe30d: '0.950000',
      portfolioHeat: '0.048000',
      positionsCount: 3,
      circuitBreaker: false,
      metadata: { note: 'ETH dip caused temporary drawdown' },
    },
    // 2 days ago -- recovering
    {
      portfolioId: portfolio.id,
      timestamp: daysAgo(2),
      totalEquity: '102100.00',
      cashBalance: '46800.00',
      grossExposure: '68300.00',
      netExposure: '55300.00',
      var95: '2900.00',
      var99: '4500.00',
      maxDrawdown: '0.022000',
      dailyPnl: '900.00',
      sharpe30d: '1.120000',
      portfolioHeat: '0.042000',
      positionsCount: 4,
      circuitBreaker: false,
      metadata: { note: 'Added SOL position, portfolio recovering' },
    },
    // 1 day ago -- best recent day
    {
      portfolioId: portfolio.id,
      timestamp: daysAgo(1),
      totalEquity: '103250.00',
      cashBalance: '45200.00',
      grossExposure: '72500.00',
      netExposure: '58050.00',
      var95: '2750.00',
      var99: '4200.00',
      maxDrawdown: '0.018000',
      dailyPnl: '1150.00',
      sharpe30d: '1.340000',
      portfolioHeat: '0.038000',
      positionsCount: 4,
      circuitBreaker: false,
      metadata: { note: 'Broad rally across holdings' },
    },
  ];

  await db.insert(riskSnapshots).values(riskSnapshotData);

  console.log('Seeding risk snapshots... done');

  // =========================================================================
  // 8. Trading Cycles
  // =========================================================================
  console.log('Seeding trading cycles...');

  const cycleSession = randomSessionId();

  const tradingCycleData: NewTradingCycle[] = [
    {
      cycleNumber: 1001,
      startedAt: hoursAgo(48),
      completedAt: new Date(hoursAgo(48).getTime() + 12_400),
      status: 'completed',
      ordersPlaced: 2,
      totalCostUsd: '0.004200',
      marketSnapshot: {
        btc: 94100,
        eth: 3180,
        spy: 579,
        vix: 14.2,
      },
      decisions: {
        summary: 'Open BTC trend position, increase ETH exposure',
        agents: ['quant', 'risk', 'execution'],
      },
    },
    {
      cycleNumber: 1002,
      startedAt: hoursAgo(36),
      completedAt: new Date(hoursAgo(36).getTime() + 9_800),
      status: 'completed',
      ordersPlaced: 1,
      totalCostUsd: '0.003100',
      marketSnapshot: {
        btc: 94800,
        eth: 3210,
        spy: 581,
        vix: 13.8,
      },
      decisions: {
        summary: 'Add SPY momentum position',
        agents: ['quant', 'macro', 'execution'],
      },
    },
    {
      cycleNumber: 1003,
      startedAt: hoursAgo(24),
      completedAt: new Date(hoursAgo(24).getTime() + 15_200),
      status: 'completed',
      ordersPlaced: 3,
      totalCostUsd: '0.005800',
      marketSnapshot: {
        btc: 95000,
        eth: 3240,
        spy: 583,
        vix: 13.5,
      },
      decisions: {
        summary: 'Scale into SOL, partial BTC take profit, rebalance SPY',
        agents: ['quant', 'risk', 'sentiment', 'execution'],
      },
    },
    {
      cycleNumber: 1004,
      startedAt: hoursAgo(12),
      completedAt: new Date(hoursAgo(12).getTime() + 11_300),
      status: 'completed',
      ordersPlaced: 1,
      totalCostUsd: '0.002900',
      marketSnapshot: {
        btc: 95100,
        eth: 3260,
        spy: 584,
        vix: 13.2,
      },
      decisions: {
        summary: 'Add ETH on dip, tighten stop on BTC',
        agents: ['quant', 'risk', 'execution'],
      },
    },
    {
      cycleNumber: 1005,
      startedAt: hoursAgo(4),
      completedAt: new Date(hoursAgo(4).getTime() + 8_600),
      status: 'completed',
      ordersPlaced: 0,
      totalCostUsd: '0.001800',
      marketSnapshot: {
        btc: 95200,
        eth: 3280,
        spy: 584.5,
        vix: 13.1,
      },
      decisions: {
        summary: 'No action - all positions within targets, low volatility',
        agents: ['quant', 'risk'],
      },
    },
  ];

  const insertedCycles = await db
    .insert(tradingCycles)
    .values(tradingCycleData)
    .returning();

  console.log('Seeding trading cycles... done');

  // =========================================================================
  // 9. Agent Logs
  // =========================================================================
  console.log('Seeding agent logs...');

  const agentLogData: NewAgentLog[] = [
    {
      agentType: 'quant',
      sessionId: cycleSession,
      action: 'analyze_signals',
      inputSummary: 'BTC 4h candles, volume profile, RSI, MACD for trend analysis',
      outputSummary: 'BTC showing strong uptrend, RSI 62, MACD bullish crossover. Recommend long entry.',
      decision: { signal: 'buy', confidence: 0.82, instrument: 'BTC-USD' },
      tokensUsed: 1850,
      costUsd: '0.001480',
      durationMs: 2340,
      parentCycleId: insertedCycles[0].id,
      createdAt: hoursAgo(48),
    },
    {
      agentType: 'sentiment',
      sessionId: cycleSession,
      action: 'scan_sentiment',
      inputSummary: 'Twitter/X mentions, Reddit crypto sentiment, Fear & Greed Index',
      outputSummary: 'Neutral-to-bullish sentiment. Fear & Greed at 62 (Greed). No extreme readings.',
      decision: { sentiment: 'neutral_bullish', fearGreed: 62, socialVolume: 'normal' },
      tokensUsed: 1200,
      costUsd: '0.000960',
      durationMs: 1800,
      parentCycleId: insertedCycles[0].id,
      createdAt: hoursAgo(47),
    },
    {
      agentType: 'macro',
      sessionId: cycleSession,
      action: 'evaluate_macro',
      inputSummary: 'Fed rate decision, CPI data, DXY, 10Y yield, VIX current levels',
      outputSummary: 'VIX at 14.2 indicates low vol. DXY weakening supports risk assets. No imminent macro risk.',
      decision: { riskEnvironment: 'favorable', vix: 14.2, dxy: 'weakening' },
      tokensUsed: 2100,
      costUsd: '0.001680',
      durationMs: 3100,
      parentCycleId: insertedCycles[1].id,
      createdAt: hoursAgo(36),
    },
    {
      agentType: 'risk',
      sessionId: cycleSession,
      action: 'check_guardrails',
      inputSummary: 'Current positions, portfolio heat, correlation matrix, drawdown status',
      outputSummary: 'Portfolio heat 4.2%, well under 6% limit. No guardrail violations. Max drawdown 2.2%.',
      decision: { approved: true, portfolioHeat: 0.042, violations: [] },
      tokensUsed: 980,
      costUsd: '0.000784',
      durationMs: 1200,
      parentCycleId: insertedCycles[2].id,
      createdAt: hoursAgo(24),
    },
    {
      agentType: 'execution',
      sessionId: cycleSession,
      action: 'place_order',
      inputSummary: 'Buy 100 SOL-USD at market, execution quality parameters',
      outputSummary: 'Market order filled: 100 SOL @ 155.00, slippage 0.008, fees 0.01550',
      decision: { action: 'filled', instrument: 'SOL-USD', qty: 100, avgFill: 155.0 },
      tokensUsed: 650,
      costUsd: '0.000520',
      durationMs: 850,
      parentCycleId: insertedCycles[2].id,
      createdAt: hoursAgo(23),
    },
    {
      agentType: 'quant',
      sessionId: cycleSession,
      action: 'analyze_signals',
      inputSummary: 'ETH 1h candles, Bollinger Bands, Z-score for mean reversion check',
      outputSummary: 'ETH z-score at -1.8, approaching entry zone. Monitor for -2.0 level.',
      decision: { signal: 'watch', confidence: 0.65, instrument: 'ETH-USD' },
      tokensUsed: 1650,
      costUsd: '0.001320',
      durationMs: 2100,
      parentCycleId: insertedCycles[3].id,
      createdAt: hoursAgo(12),
    },
    {
      agentType: 'risk',
      sessionId: cycleSession,
      action: 'check_guardrails',
      inputSummary: 'Updated positions with SOL, recalculate portfolio metrics',
      outputSummary: 'Portfolio heat increased to 4.8% after SOL add. Still within limits. Correlation check passed.',
      decision: { approved: true, portfolioHeat: 0.048, violations: [] },
      tokensUsed: 1020,
      costUsd: '0.000816',
      durationMs: 1350,
      parentCycleId: insertedCycles[3].id,
      createdAt: hoursAgo(11),
    },
    {
      agentType: 'sentiment',
      sessionId: cycleSession,
      action: 'scan_sentiment',
      inputSummary: 'SOL ecosystem news, Solana developer activity, on-chain metrics',
      outputSummary: 'Positive developer momentum on Solana. TVL growing. Bullish sentiment supports position.',
      decision: { sentiment: 'bullish', tvlTrend: 'increasing', devActivity: 'high' },
      tokensUsed: 1400,
      costUsd: '0.001120',
      durationMs: 2000,
      parentCycleId: insertedCycles[4].id,
      createdAt: hoursAgo(4),
    },
    {
      agentType: 'execution',
      sessionId: cycleSession,
      action: 'evaluate_liquidity',
      inputSummary: 'Order book depth analysis for BTC-USD, ETH-USD, SOL-USD',
      outputSummary: 'Sufficient liquidity across all positions. BTC top-of-book spread 0.01%. No execution concerns.',
      decision: { action: 'no_trade', reason: 'all positions within targets' },
      tokensUsed: 750,
      costUsd: '0.000600',
      durationMs: 950,
      parentCycleId: insertedCycles[4].id,
      createdAt: hoursAgo(3),
    },
    {
      agentType: 'macro',
      sessionId: cycleSession,
      action: 'evaluate_macro',
      inputSummary: 'End-of-day macro review: rates, currencies, commodities, equity indices',
      outputSummary: 'VIX declined to 13.1. Risk-on environment persists. No scheduled events until next FOMC.',
      decision: { riskEnvironment: 'favorable', vix: 13.1, nextEvent: 'FOMC in 12 days' },
      tokensUsed: 1900,
      costUsd: '0.001520',
      durationMs: 2800,
      parentCycleId: insertedCycles[4].id,
      createdAt: hoursAgo(2),
    },
  ];

  await db.insert(agentLogs).values(agentLogData);

  console.log('Seeding agent logs... done');

  // =========================================================================
  // Done
  // =========================================================================
  console.log('\n--- Seed complete ---');
  console.log(`  Portfolio:      ${portfolio.id}`);
  console.log(`  Strategies:     ${insertedStrategies.length}`);
  console.log(`  Positions:      ${insertedPositions.length}`);
  console.log(`  Orders:         ${orderData.length}`);
  console.log(`  Guardrails:     ${guardrailData.length}`);
  console.log(`  Risk Snapshots: ${riskSnapshotData.length}`);
  console.log(`  Trading Cycles: ${insertedCycles.length}`);
  console.log(`  Agent Logs:     ${agentLogData.length}`);

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
