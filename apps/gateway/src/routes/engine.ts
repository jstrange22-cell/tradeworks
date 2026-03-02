import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getMemoryKeysByService } from './api-keys.js';
import { decryptApiKey } from '@tradeworks/db';

/**
 * Engine control routes.
 * GET    /api/v1/engine/status  - Read engine status
 * POST   /api/v1/engine/start   - Start the trading engine
 * POST   /api/v1/engine/stop    - Stop the trading engine
 * PATCH  /api/v1/engine/config  - Update engine configuration
 * GET    /api/v1/engine/cycles  - Get cycle history with agent outputs
 */

export const engineRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CycleAgentOutput {
  quantBias: 'bullish' | 'bearish' | 'neutral';
  quantConfidence: number;
  quantSignals: Array<{
    instrument: string;
    direction: 'long' | 'short';
    indicator: string;
    confidence: number;
  }>;
  sentimentScore: number;
  sentimentLabel: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  macroRegime: 'risk-on' | 'risk-off' | 'transition' | 'neutral';
  macroRiskLevel: 'low' | 'normal' | 'elevated' | 'extreme';
}

interface CycleDecision {
  instrument: string;
  direction: 'long' | 'short';
  confidence: number;
  approved: boolean;
  rejectionReason?: string;
}

interface CycleExecution {
  instrument: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: 'filled' | 'simulated' | 'cancelled' | 'failed';
  slippage?: number;
}

interface CycleResult {
  id: string;
  cycleNumber: number;
  timestamp: string;
  status: 'completed' | 'no_signals' | 'circuit_breaker' | 'error';
  durationMs: number;
  agents: CycleAgentOutput;
  decisions: CycleDecision[];
  riskAssessment: {
    portfolioHeat: number;
    drawdownPercent: number;
    approved: number;
    rejected: number;
  };
  executions: CycleExecution[];
  summary: string;
}

// ---------------------------------------------------------------------------
// In-memory engine state
// ---------------------------------------------------------------------------

let engineState: {
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  startedAt: string | null;
  cycleCount: number;
  lastCycleAt: string | null;
  config: {
    cycleIntervalMs: number;
    markets: string[];
    paperMode: boolean;
  };
  coinbaseConnected: boolean;
  coinbaseAccounts: number;

} = {
  status: 'stopped',
  startedAt: null,
  cycleCount: 0,
  lastCycleAt: null,
  config: {
    cycleIntervalMs: 300000,
    markets: ['crypto'],
    paperMode: true,
  },
  coinbaseConnected: false,
  coinbaseAccounts: 0,
};

const cycleHistory: CycleResult[] = [];
const MAX_CYCLE_HISTORY = 100;
let cycleTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Coinbase Advanced Trade API — HMAC Auth + Execution
// ---------------------------------------------------------------------------

function getCoinbaseKeyEnvironment(): string {
  const keys = getMemoryKeysByService('coinbase');
  if (keys.length === 0) return 'none';
  return (keys[0] as unknown as { environment?: string }).environment ?? 'unknown';
}

function getCoinbaseKeys(): { apiKey: string; apiSecret: string } | null {
  const keys = getMemoryKeysByService('coinbase');
  if (keys.length === 0) return null;
  const k = keys[0];
  try {
    const apiKey = decryptApiKey(k.encryptedKey as Buffer);
    const apiSecret = k.encryptedSecret
      ? decryptApiKey(k.encryptedSecret as Buffer)
      : '';
    // Debug logging — masked values for troubleshooting
    console.log(`[Engine] Coinbase key decrypted: ${apiKey.slice(0, 8)}..., length: ${apiKey.length}`);
    console.log(`[Engine] Coinbase secret decrypted: length: ${apiSecret.length}`);
    if (!apiKey || !apiSecret) return null;
    return { apiKey, apiSecret };
  } catch (err) {
    console.error('[Engine] Failed to decrypt Coinbase keys:', err);
    return null;
  }
}

async function coinbaseSignedRequest(
  method: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  body?: string,
): Promise<Response> {
  const { createHmac } = await import('node:crypto');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Coinbase HMAC: signature = HMAC(timestamp + method + requestPath + body)
  // requestPath is the path WITHOUT query params
  const signPath = path.split('?')[0];
  const message = timestamp + method + signPath + (body ?? '');

  // Advanced Trade Legacy Keys: use secret as-is (UTF-8 string), hex signature
  const signature = createHmac('sha256', apiSecret).update(message).digest('hex');

  return fetch(`https://api.coinbase.com${path}`, {
    method,
    headers: {
      'CB-ACCESS-KEY': apiKey,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    },
    ...(body ? { body } : {}),
  });
}

async function testCoinbaseConnection(): Promise<{
  connected: boolean;
  status?: number;
  accounts?: number;
  error?: string;
  keyPrefix?: string;
  environment?: string;
}> {
  const environment = getCoinbaseKeyEnvironment();
  const keys = getCoinbaseKeys();

  if (!keys) {
    engineState.coinbaseConnected = false;
    engineState.coinbaseAccounts = 0;
    console.log('[Engine] Coinbase NOT connected — no API keys found');
    return { connected: false, error: 'No API keys found', environment };
  }

  try {
    const res = await coinbaseSignedRequest(
      'GET',
      '/api/v3/brokerage/accounts',
      keys.apiKey,
      keys.apiSecret,
    );

    const bodyText = await res.text();
    let data: { accounts?: unknown[] } = {};
    try { data = JSON.parse(bodyText); } catch { /* non-JSON response */ }

    if (res.ok) {
      engineState.coinbaseConnected = true;
      engineState.coinbaseAccounts = data.accounts?.length ?? 0;
      console.log(`[Engine] Coinbase CONNECTED — ${engineState.coinbaseAccounts} account(s) found`);
      return {
        connected: true,
        status: res.status,
        accounts: engineState.coinbaseAccounts,
        keyPrefix: keys.apiKey.slice(0, 8) + '...',
        environment,
      };
    } else {
      engineState.coinbaseConnected = false;
      const errMsg = bodyText.slice(0, 300);
      console.warn(`[Engine] Coinbase connection failed: ${res.status} ${res.statusText} — ${errMsg}`);
      return {
        connected: false,
        status: res.status,
        error: `${res.status} ${res.statusText}: ${errMsg}`,
        keyPrefix: keys.apiKey.slice(0, 8) + '...',
        environment,
      };
    }
  } catch (err) {
    engineState.coinbaseConnected = false;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Engine] Coinbase connection test error:', errMsg);
    return {
      connected: false,
      error: errMsg,
      keyPrefix: keys.apiKey.slice(0, 8) + '...',
      environment,
    };
  }
}

/** Map our instrument names to Coinbase product IDs */
const COINBASE_PRODUCT_MAP: Record<string, string> = {
  'BTC-USD': 'BTC-USD',
  'ETH-USD': 'ETH-USD',
  'SOL-USD': 'SOL-USD',
  'AVAX-USD': 'AVAX-USD',
  'LINK-USD': 'LINK-USD',
};

async function placeCoinbaseOrder(
  productId: string,
  side: 'BUY' | 'SELL',
  quoteSize: string,
  apiKey: string,
  apiSecret: string,
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const clientOrderId = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orderBody = JSON.stringify({
    client_order_id: clientOrderId,
    product_id: productId,
    side,
    order_configuration: {
      market_market_ioc: { quote_size: quoteSize },
    },
  });

  try {
    const res = await coinbaseSignedRequest(
      'POST',
      '/api/v3/brokerage/orders',
      apiKey,
      apiSecret,
      orderBody,
    );

    const data = (await res.json()) as {
      success?: boolean;
      order_id?: string;
      error_response?: { error?: string; message?: string };
    };

    if (res.ok && data.success !== false) {
      console.log(`[Engine] Coinbase order placed: ${side} ${productId} $${quoteSize} — orderId: ${data.order_id ?? clientOrderId}`);
      return { success: true, orderId: data.order_id ?? clientOrderId };
    } else {
      const errMsg = data.error_response?.message ?? data.error_response?.error ?? `HTTP ${res.status}`;
      console.error(`[Engine] Coinbase order FAILED: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Engine] Coinbase order error: ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// Real Market Data — Crypto.com Public API
// ---------------------------------------------------------------------------

const CRYPTO_API_BASE = 'https://api.crypto.com/exchange/v1/public';

const INSTRUMENT_MAP: Record<string, string> = {
  'BTC-USD': 'BTC_USDT',
  'ETH-USD': 'ETH_USDT',
  'SOL-USD': 'SOL_USDT',
  'AVAX-USD': 'AVAX_USDT',
  'LINK-USD': 'LINK_USDT',
};

const TRACKED_INSTRUMENTS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

interface TickerData {
  instrument: string;
  last: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume: number;
}

// Inline SMA — average of last N values
function calcSma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Inline RSI — relative strength index
function calcRsi(values: number[], period: number): number {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function fetchTicker(instrument: string): Promise<TickerData | null> {
  const apiName = INSTRUMENT_MAP[instrument];
  if (!apiName) return null;
  try {
    const res = await fetch(`${CRYPTO_API_BASE}/get-tickers?instrument_name=${apiName}`);
    const json = await res.json() as {
      code: number;
      result?: { data?: Array<{ a: string; c: string; h: string; l: string; vv: string }> };
    };
    if (json.code !== 0 || !json.result?.data?.length) return null;
    const d = json.result.data[0];
    return {
      instrument,
      last: parseFloat(d.a),
      change24h: parseFloat(d.c),
      high24h: parseFloat(d.h),
      low24h: parseFloat(d.l),
      volume: parseFloat(d.vv),
    };
  } catch (err) {
    console.warn(`[Engine] Ticker fetch failed for ${instrument}:`, err);
    return null;
  }
}

async function fetchCandles(instrument: string): Promise<number[]> {
  const apiName = INSTRUMENT_MAP[instrument];
  if (!apiName) return [];
  try {
    const res = await fetch(`${CRYPTO_API_BASE}/get-candlestick?instrument_name=${apiName}&timeframe=1h`);
    const json = await res.json() as {
      code: number;
      result?: { data?: Array<{ c: string; t: number }> };
    };
    if (json.code !== 0 || !json.result?.data?.length) return [];
    // API returns newest first; reverse for indicator calculation
    return json.result.data
      .slice(0, 50)
      .reverse()
      .map((c) => parseFloat(c.c));
  } catch (err) {
    console.warn(`[Engine] Candle fetch failed for ${instrument}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Instrument Analysis
// ---------------------------------------------------------------------------

interface InstrumentAnalysis {
  instrument: string;
  price: number;
  change24h: number;
  sma20: number;
  rsiValue: number;
  priceAboveSma: boolean;
  signals: Array<{ indicator: string; direction: 'long' | 'short'; confidence: number }>;
}

async function analyzeInstrument(instrument: string): Promise<InstrumentAnalysis | null> {
  const [ticker, closes] = await Promise.all([
    fetchTicker(instrument),
    fetchCandles(instrument),
  ]);

  if (!ticker || closes.length < 25) return null;

  const currentPrice = ticker.last;
  const sma20 = calcSma(closes, 20);
  const rsiValue = calcRsi(closes, 14);
  const priceAboveSma = currentPrice > sma20;

  const signals: InstrumentAnalysis['signals'] = [];

  // SMA 20 Trend signal
  const smaDistance = (currentPrice - sma20) / sma20;
  if (Math.abs(smaDistance) > 0.005) {
    signals.push({
      indicator: 'SMA 20 Trend',
      direction: smaDistance > 0 ? 'long' : 'short',
      confidence: Math.round(Math.min(0.5 + Math.abs(smaDistance) * 8, 0.9) * 100) / 100,
    });
  }

  // RSI signal
  if (rsiValue < 30) {
    signals.push({
      indicator: 'RSI Oversold',
      direction: 'long',
      confidence: Math.round(Math.min(0.6 + (30 - rsiValue) / 80, 0.85) * 100) / 100,
    });
  } else if (rsiValue > 70) {
    signals.push({
      indicator: 'RSI Overbought',
      direction: 'short',
      confidence: Math.round(Math.min(0.6 + (rsiValue - 70) / 80, 0.85) * 100) / 100,
    });
  }

  // 24h Momentum signal
  if (Math.abs(ticker.change24h) > 0.02) {
    signals.push({
      indicator: '24h Momentum',
      direction: ticker.change24h > 0 ? 'long' : 'short',
      confidence: Math.round(Math.min(0.5 + Math.abs(ticker.change24h) * 3, 0.85) * 100) / 100,
    });
  }

  return { instrument, price: currentPrice, change24h: ticker.change24h, sma20, rsiValue, priceAboveSma, signals };
}

// ---------------------------------------------------------------------------
// Run Analysis Cycle (fetches real data from Crypto.com)
// ---------------------------------------------------------------------------

function pushCycle(cycle: CycleResult): void {
  cycleHistory.unshift(cycle);
  if (cycleHistory.length > MAX_CYCLE_HISTORY) cycleHistory.pop();
  engineState.lastCycleAt = cycle.timestamp;
}

async function runAnalysisCycle(): Promise<CycleResult> {
  const startTime = Date.now();
  engineState.cycleCount += 1;
  const cycleNum = engineState.cycleCount;

  try {
    // ── Phase 1: Quant Analysis ──
    const analyses = await Promise.all(TRACKED_INSTRUMENTS.map(analyzeInstrument));
    const valid = analyses.filter((a): a is InstrumentAnalysis => a !== null);

    if (valid.length === 0) {
      const cycle: CycleResult = {
        id: `cycle-${cycleNum}-${Date.now()}`, cycleNumber: cycleNum,
        timestamp: new Date().toISOString(), status: 'error',
        durationMs: Date.now() - startTime,
        agents: { quantBias: 'neutral', quantConfidence: 0, quantSignals: [], sentimentScore: 0, sentimentLabel: 'neutral', macroRegime: 'neutral', macroRiskLevel: 'normal' },
        decisions: [], riskAssessment: { portfolioHeat: 0, drawdownPercent: 0, approved: 0, rejected: 0 },
        executions: [], summary: 'Failed to fetch market data — retrying next cycle.',
      };
      pushCycle(cycle);
      return cycle;
    }

    // Overall bias from SMA position
    const bullishCount = valid.filter(a => a.priceAboveSma).length;
    const quantBias: CycleAgentOutput['quantBias'] =
      bullishCount > valid.length / 2 ? 'bullish' :
      bullishCount < valid.length / 2 ? 'bearish' : 'neutral';

    // Aggregate signals
    const allSignals = valid.flatMap(a =>
      a.signals.map(s => ({ instrument: a.instrument, direction: s.direction, indicator: s.indicator, confidence: s.confidence }))
    );
    const avgConfidence = allSignals.length > 0
      ? allSignals.reduce((sum, s) => sum + s.confidence, 0) / allSignals.length
      : 0;

    // ── Phase 2: Sentiment (24h change proxy) ──
    const avgChange = valid.reduce((sum, a) => sum + a.change24h, 0) / valid.length;
    const sentimentScore = Math.round(Math.max(-1, Math.min(1, avgChange * 5)) * 100) / 100;
    const sentimentLabel: CycleAgentOutput['sentimentLabel'] =
      sentimentScore > 0.2 ? 'bullish' : sentimentScore < -0.2 ? 'bearish' : 'neutral';

    // ── Phase 3: Macro Regime ──
    const avgRsi = valid.reduce((sum, a) => sum + a.rsiValue, 0) / valid.length;
    let macroRegime: CycleAgentOutput['macroRegime'] = 'neutral';
    let macroRiskLevel: CycleAgentOutput['macroRiskLevel'] = 'normal';

    if (avgRsi > 65 && avgChange > 0.02) {
      macroRegime = 'risk-on'; macroRiskLevel = 'low';
    } else if (avgRsi < 25 && avgChange < -0.05) {
      macroRegime = 'risk-off'; macroRiskLevel = 'extreme';
    } else if (avgRsi < 35 && avgChange < -0.02) {
      macroRegime = 'risk-off'; macroRiskLevel = 'elevated';
    } else if (Math.abs(avgChange) > 0.01) {
      macroRegime = 'transition'; macroRiskLevel = 'normal';
    }

    // ── Phase 4: Risk Assessment & Decisions ──
    const maxRisk = 1.0; // 1% per trade
    const maxHeat = 6.0;
    let heat = 0;
    const decisions: CycleDecision[] = [];

    for (const sig of allSignals) {
      if (sig.confidence < 0.6) continue;
      let approved = true;
      let rejectionReason: string | undefined;

      if (macroRiskLevel === 'extreme') {
        approved = false;
        rejectionReason = 'Macro risk extreme — all trades halted';
      } else if (heat + maxRisk > maxHeat) {
        approved = false;
        rejectionReason = `Portfolio heat would exceed ${maxHeat}% limit`;
      }

      decisions.push({ instrument: sig.instrument, direction: sig.direction, confidence: sig.confidence, approved, rejectionReason });
      if (approved) heat += maxRisk;
    }

    const approvedD = decisions.filter(d => d.approved);
    const rejectedD = decisions.filter(d => !d.approved);

    // ── Phase 5: Execution (Coinbase live or paper) ──
    const coinbaseKeys = getCoinbaseKeys();
    const useLiveExecution = coinbaseKeys !== null
      && engineState.coinbaseConnected
      && engineState.config.paperMode === false;

    const executions: CycleExecution[] = [];

    for (const d of approvedD) {
      const analysis = valid.find(a => a.instrument === d.instrument);
      const price = analysis?.price ?? 0;
      const side = d.direction === 'long' ? 'buy' : 'sell';
      const quoteSize = '100'; // $100 per trade
      const quantity = Math.round((100 / Math.max(price, 1)) * 1000) / 1000;

      if (useLiveExecution && coinbaseKeys) {
        const productId = COINBASE_PRODUCT_MAP[d.instrument];
        if (productId) {
          const result = await placeCoinbaseOrder(
            productId,
            side.toUpperCase() as 'BUY' | 'SELL',
            quoteSize,
            coinbaseKeys.apiKey,
            coinbaseKeys.apiSecret,
          );
          executions.push({
            instrument: d.instrument,
            side: side as 'buy' | 'sell',
            quantity,
            price: Math.round(price * 100) / 100,
            status: result.success ? 'filled' : 'failed',
            slippage: result.success ? Math.round(Math.random() * 1.5 * 10) / 10 : 0,
          });
        } else {
          // No Coinbase product mapping — simulate
          executions.push({
            instrument: d.instrument,
            side: side as 'buy' | 'sell',
            quantity,
            price: Math.round(price * 100) / 100,
            status: 'simulated' as const,
            slippage: Math.round(Math.random() * 3 * 10) / 10,
          });
        }
      } else {
        // Paper mode or no Coinbase keys
        executions.push({
          instrument: d.instrument,
          side: side as 'buy' | 'sell',
          quantity,
          price: Math.round(price * 100) / 100,
          status: 'simulated' as const,
          slippage: Math.round(Math.random() * 3 * 10) / 10,
        });
      }
    }

    if (executions.length > 0 && coinbaseKeys && engineState.config.paperMode) {
      console.log(`[Engine] Paper mode — ${executions.length} trade(s) simulated. Set paperMode=false for live Coinbase execution.`);
    }

    // ── Build Result ──
    const durationMs = Date.now() - startTime;
    const status: CycleResult['status'] =
      macroRiskLevel === 'extreme' ? 'circuit_breaker' :
      allSignals.length === 0 ? 'no_signals' : 'completed';

    let summary = '';
    const prices = valid.map(a => `${a.instrument} $${a.price.toLocaleString()}`).join(', ');

    if (status === 'circuit_breaker') {
      summary = `Circuit breaker — extreme risk (RSI avg ${avgRsi.toFixed(0)}, 24h ${(avgChange * 100).toFixed(1)}%). ${prices}.`;
    } else if (status === 'no_signals') {
      summary = `No signals. ${prices}. RSI avg ${avgRsi.toFixed(0)}, ${macroRegime}.`;
    } else if (executions.length > 0) {
      const e = executions[0];
      const more = executions.length > 1 ? ` (+${executions.length - 1} more)` : '';
      summary = `${e.side.toUpperCase()} ${e.quantity} ${e.instrument} @ $${e.price.toLocaleString()}${more} — ${quantBias}, RSI ${avgRsi.toFixed(0)}, ${macroRegime}`;
    } else {
      summary = `${rejectedD.length} signal(s) risk-rejected. ${quantBias} bias, ${prices}.`;
    }

    const cycle: CycleResult = {
      id: `cycle-${cycleNum}-${Date.now()}`,
      cycleNumber: cycleNum,
      timestamp: new Date().toISOString(),
      status,
      durationMs,
      agents: {
        quantBias,
        quantConfidence: Math.round(avgConfidence * 100) / 100,
        quantSignals: allSignals,
        sentimentScore,
        sentimentLabel,
        macroRegime,
        macroRiskLevel,
      },
      decisions,
      riskAssessment: {
        portfolioHeat: Math.round(heat * 100) / 100,
        drawdownPercent: 0,
        approved: approvedD.length,
        rejected: rejectedD.length,
      },
      executions,
      summary,
    };

    pushCycle(cycle);
    console.log(`[Engine] Cycle #${cycleNum}: ${status} — ${summary}`);
    return cycle;
  } catch (err) {
    const cycle: CycleResult = {
      id: `cycle-${cycleNum}-${Date.now()}`, cycleNumber: cycleNum,
      timestamp: new Date().toISOString(), status: 'error',
      durationMs: Date.now() - startTime,
      agents: { quantBias: 'neutral', quantConfidence: 0, quantSignals: [], sentimentScore: 0, sentimentLabel: 'neutral', macroRegime: 'neutral', macroRiskLevel: 'normal' },
      decisions: [], riskAssessment: { portfolioHeat: 0, drawdownPercent: 0, approved: 0, rejected: 0 },
      executions: [], summary: `Error: ${(err as Error).message}`,
    };
    pushCycle(cycle);
    console.error(`[Engine] Cycle #${cycleNum} error:`, err);
    return cycle;
  }
}

// ---------------------------------------------------------------------------
// Cycle Loop
// ---------------------------------------------------------------------------

function startCycleLoop(): void {
  if (cycleTimer) return;
  // Test Coinbase connection, then run first cycle
  testCoinbaseConnection()
    .then(() => runAnalysisCycle())
    .catch(err => console.error('[Engine] First cycle error:', err));
  cycleTimer = setInterval(() => {
    if (engineState.status === 'running') {
      runAnalysisCycle().catch(err => console.error('[Engine] Cycle error:', err));
    }
  }, engineState.config.cycleIntervalMs);
}

function stopCycleLoop(): void {
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ConfigSchema = z.object({
  cycleIntervalMs: z.number().min(10000).max(3600000).optional(),
  markets: z.array(z.enum(['crypto', 'equities', 'prediction'])).optional(),
  paperMode: z.boolean().optional(),
});

engineRouter.get('/status', (_req, res) => {
  res.json({
    data: {
      ...engineState,
      uptime: engineState.startedAt
        ? Date.now() - new Date(engineState.startedAt).getTime()
        : 0,
      coinbaseConnected: engineState.coinbaseConnected,
      coinbaseAccounts: engineState.coinbaseAccounts,
    },
  });
});

engineRouter.get('/cycles', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
  res.json({
    data: cycleHistory.slice(0, limit),
    total: cycleHistory.length,
  });
});

engineRouter.get('/test-coinbase', async (_req, res) => {
  console.log('[Engine] Manual Coinbase connection test triggered');
  const result = await testCoinbaseConnection();
  res.json({ data: result });
});

engineRouter.post('/start', (_req, res) => {
  if (engineState.status === 'running') {
    res.status(400).json({ error: 'Engine is already running' });
    return;
  }

  engineState.status = 'running';
  engineState.startedAt = new Date().toISOString();
  startCycleLoop();

  res.json({ data: engineState, message: 'Engine started' });
});

engineRouter.post('/stop', (_req, res) => {
  if (engineState.status === 'stopped') {
    res.status(400).json({ error: 'Engine is already stopped' });
    return;
  }

  engineState.status = 'stopped';
  engineState.startedAt = null;
  stopCycleLoop();

  res.json({ data: engineState, message: 'Engine stopped' });
});

engineRouter.patch('/config', (req, res) => {
  try {
    const updates = ConfigSchema.parse(req.body);

    if (updates.cycleIntervalMs !== undefined) {
      engineState.config.cycleIntervalMs = updates.cycleIntervalMs;
      if (engineState.status === 'running') { stopCycleLoop(); startCycleLoop(); }
    }
    if (updates.markets !== undefined) {
      engineState.config.markets = updates.markets;
    }
    if (updates.paperMode !== undefined) {
      engineState.config.paperMode = updates.paperMode;
    }

    res.json({ data: engineState.config, message: 'Engine configuration updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid config', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// ---------------------------------------------------------------------------
// Auto-Start — engine runs automatically when gateway boots
// ---------------------------------------------------------------------------

/**
 * Initialize and auto-start the trading engine.
 * Called from index.ts after the server starts listening.
 */
export function initEngine(): void {
  console.log('[Engine] Auto-starting trading engine...');
  console.log(`[Engine] Config: cycle every ${engineState.config.cycleIntervalMs / 1000}s, markets: ${engineState.config.markets.join(', ')}, paper: ${engineState.config.paperMode}`);
  engineState.status = 'running';
  engineState.startedAt = new Date().toISOString();
  startCycleLoop();
  console.log('[Engine] Auto-started — running cycles autonomously 24/7');
}
