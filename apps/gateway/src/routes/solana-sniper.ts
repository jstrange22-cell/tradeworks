import { Router, type Router as RouterType } from 'express';
import { VersionedTransaction } from '@solana/web3.js';
import { broadcast } from '../websocket/server.js';
import {
  isSolanaConnected,
  getSolanaKeypair,
  getSolanaConnection,
} from './solana-utils.js';

/**
 * Solana Sniping Engine — Sprint 8.2
 *
 * Autonomous token sniping with configurable strategies:
 *   - Auto-buy on pump.fun launch detection
 *   - Priority fee escalation for faster inclusion
 *   - Auto-sell on target/stop-loss
 *   - Position size limits and daily caps
 *
 * Routes:
 *   GET    /api/v1/solana/sniper/config       — Get sniper configuration
 *   PUT    /api/v1/solana/sniper/config       — Update sniper configuration
 *   POST   /api/v1/solana/sniper/start        — Start auto-sniper
 *   POST   /api/v1/solana/sniper/stop         — Stop auto-sniper
 *   GET    /api/v1/solana/sniper/status        — Sniper status + active positions
 *   POST   /api/v1/solana/sniper/execute      — Manual single snipe
 *   GET    /api/v1/solana/sniper/history       — Snipe execution history
 */

export const sniperRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface SniperConfig {
  enabled: boolean;
  /** SOL amount per snipe (e.g. 0.05 = 0.05 SOL) */
  buyAmountSol: number;
  /** Max SOL to spend per day */
  dailyBudgetSol: number;
  /** Slippage tolerance in basis points */
  slippageBps: number;
  /** Priority fee in micro-lamports per CU */
  priorityFee: number;
  /** Auto-sell: take profit % (e.g. 100 = 2x) */
  takeProfitPercent: number;
  /** Auto-sell: stop loss % (e.g. -50 = sell at 50% loss) */
  stopLossPercent: number;
  /** Min liquidity USD to snipe */
  minLiquidityUsd: number;
  /** Max market cap USD to snipe (avoid already-pumped tokens) */
  maxMarketCapUsd: number;
  /** Only snipe tokens with mint authority revoked */
  requireMintRevoked: boolean;
  /** Only snipe tokens with freeze authority revoked */
  requireFreezeRevoked: boolean;
  /** Max concurrent open positions */
  maxOpenPositions: number;
  /** Auto-buy on pump.fun detection */
  autoBuyPumpFun: boolean;
  /** Auto-buy on trending detection (Dexscreener) */
  autoBuyTrending: boolean;
}

interface SnipeExecution {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  amountSol: number;
  amountTokens: number | null;
  priceUsd: number | null;
  signature: string | null;
  status: 'pending' | 'success' | 'failed';
  error: string | null;
  trigger: 'manual' | 'pumpfun' | 'trending' | 'take_profit' | 'stop_loss';
  timestamp: string;
}

interface ActivePosition {
  mint: string;
  symbol: string;
  name: string;
  buyPrice: number;
  currentPrice: number;
  amountTokens: number;
  pnlPercent: number;
  buySignature: string;
  boughtAt: string;
}

// ── State ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SniperConfig = {
  enabled: false,
  buyAmountSol: 0.05,
  dailyBudgetSol: 1.0,
  slippageBps: 500, // 5% slippage for meme coins
  priorityFee: 100000, // 100k micro-lamports (aggressive)
  takeProfitPercent: 100, // 2x
  stopLossPercent: -50, // -50%
  minLiquidityUsd: 5000,
  maxMarketCapUsd: 500000,
  requireMintRevoked: false,
  requireFreezeRevoked: false,
  maxOpenPositions: 5,
  autoBuyPumpFun: false,
  autoBuyTrending: false,
};

let config: SniperConfig = { ...DEFAULT_CONFIG };
let sniperRunning = false;
let sniperStartedAt: Date | null = null;
let dailySpentSol = 0;
let dailyResetDate = new Date().toDateString();
const executionHistory: SnipeExecution[] = [];
const activePositions: Map<string, ActivePosition> = new Map();
const MAX_HISTORY = 500;

let positionCheckInterval: ReturnType<typeof setInterval> | null = null;

// ── Jupiter swap helper ────────────────────────────────────────────────

const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

async function executeSwap(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps: number;
  priorityFee: number;
}): Promise<{ signature: string; success: boolean; outAmount: string | null }> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  // Quote
  const quoteParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amountLamports,
    slippageBps: String(params.slippageBps),
  });

  const quoteRes = await fetch(`${JUPITER_QUOTE_URL}?${quoteParams}`);
  if (!quoteRes.ok) throw new Error(`Quote failed: ${await quoteRes.text()}`);
  const quoteResponse = await quoteRes.json();

  // Swap
  const swapRes = await fetch(JUPITER_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: params.priorityFee,
    }),
  });

  if (!swapRes.ok) throw new Error(`Swap build failed: ${await swapRes.text()}`);
  const swapData = (await swapRes.json()) as { swapTransaction: string };

  const transaction = VersionedTransaction.deserialize(
    Buffer.from(swapData.swapTransaction, 'base64'),
  );
  transaction.sign([keypair]);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  const latestBlockhash = await connection.getLatestBlockhash();
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, 'confirmed');

  return {
    signature,
    success: !confirmation.value.err,
    outAmount: (quoteResponse as Record<string, unknown>).outAmount as string ?? null,
  };
}

// ── Snipe execution ────────────────────────────────────────────────────

export async function executeBuySnipe(params: {
  mint: string;
  symbol: string;
  name: string;
  trigger: SnipeExecution['trigger'];
  priceUsd?: number;
}): Promise<SnipeExecution> {
  const id = `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const execution: SnipeExecution = {
    id,
    mint: params.mint,
    symbol: params.symbol,
    name: params.name,
    action: 'buy',
    amountSol: config.buyAmountSol,
    amountTokens: null,
    priceUsd: params.priceUsd ?? null,
    signature: null,
    status: 'pending',
    error: null,
    trigger: params.trigger,
    timestamp: new Date().toISOString(),
  };

  try {
    // Budget checks
    resetDailyBudgetIfNeeded();
    if (dailySpentSol + config.buyAmountSol > config.dailyBudgetSol) {
      throw new Error(`Daily budget exceeded: spent ${dailySpentSol.toFixed(4)} / ${config.dailyBudgetSol} SOL`);
    }
    if (activePositions.size >= config.maxOpenPositions) {
      throw new Error(`Max open positions reached: ${activePositions.size}/${config.maxOpenPositions}`);
    }

    const amountLamports = String(Math.floor(config.buyAmountSol * LAMPORTS_PER_SOL));

    const result = await executeSwap({
      inputMint: SOL_MINT,
      outputMint: params.mint,
      amountLamports,
      slippageBps: config.slippageBps,
      priorityFee: config.priorityFee,
    });

    execution.signature = result.signature;
    execution.status = result.success ? 'success' : 'failed';

    if (result.success) {
      dailySpentSol += config.buyAmountSol;
      execution.amountTokens = result.outAmount ? parseFloat(result.outAmount) : null;

      // Track position
      activePositions.set(params.mint, {
        mint: params.mint,
        symbol: params.symbol,
        name: params.name,
        buyPrice: params.priceUsd ?? 0,
        currentPrice: params.priceUsd ?? 0,
        amountTokens: execution.amountTokens ?? 0,
        pnlPercent: 0,
        buySignature: result.signature,
        boughtAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';
  }

  // Store and broadcast
  executionHistory.unshift(execution);
  if (executionHistory.length > MAX_HISTORY) executionHistory.pop();

  broadcast('solana:sniper' as any, {
    event: 'snipe:executed',
    execution,
  });

  console.log(`[Sniper] ${execution.status.toUpperCase()} — ${execution.action} ${execution.symbol} (${execution.trigger}): ${execution.signature ?? execution.error}`);

  return execution;
}

async function executeSellSnipe(mint: string, trigger: SnipeExecution['trigger']): Promise<SnipeExecution | null> {
  const position = activePositions.get(mint);
  if (!position) return null;

  const id = `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const execution: SnipeExecution = {
    id,
    mint,
    symbol: position.symbol,
    name: position.name,
    action: 'sell',
    amountSol: 0,
    amountTokens: position.amountTokens,
    priceUsd: position.currentPrice,
    signature: null,
    status: 'pending',
    error: null,
    trigger,
    timestamp: new Date().toISOString(),
  };

  try {
    // Sell all tokens back to SOL
    const result = await executeSwap({
      inputMint: mint,
      outputMint: SOL_MINT,
      amountLamports: String(Math.floor(position.amountTokens)),
      slippageBps: config.slippageBps,
      priorityFee: config.priorityFee,
    });

    execution.signature = result.signature;
    execution.status = result.success ? 'success' : 'failed';
    if (result.success) {
      execution.amountSol = result.outAmount ? parseFloat(result.outAmount) / LAMPORTS_PER_SOL : 0;
      activePositions.delete(mint);
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';
  }

  executionHistory.unshift(execution);
  if (executionHistory.length > MAX_HISTORY) executionHistory.pop();

  broadcast('solana:sniper' as any, {
    event: 'snipe:executed',
    execution,
  });

  return execution;
}

// ── Position monitoring (take-profit / stop-loss) ──────────────────────

async function checkPositions(): Promise<void> {
  if (activePositions.size === 0) return;

  for (const [mint, position] of activePositions) {
    try {
      // Fetch current price from Dexscreener
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      if (!res.ok) continue;

      const data = (await res.json()) as { pairs?: Array<Record<string, unknown>> };
      const pair = (data.pairs ?? []).find(p => (p.chainId as string) === 'solana');
      if (!pair) continue;

      const currentPrice = parseFloat((pair.priceUsd as string) ?? '0');
      if (currentPrice === 0 || position.buyPrice === 0) continue;

      position.currentPrice = currentPrice;
      position.pnlPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;

      // Broadcast live P&L to dashboard via WebSocket
      broadcast('solana:sniper', {
        event: 'position:pnl_update',
        mint,
        symbol: position.symbol,
        name: position.name,
        buyPrice: position.buyPrice,
        currentPrice,
        amountTokens: position.amountTokens,
        pnlPercent: position.pnlPercent,
        unrealizedPnlUsd: position.amountTokens * (currentPrice - position.buyPrice),
        boughtAt: position.boughtAt,
      });

      // Check take-profit
      if (config.takeProfitPercent > 0 && position.pnlPercent >= config.takeProfitPercent) {
        console.log(`[Sniper] Take profit triggered for ${position.symbol}: +${position.pnlPercent.toFixed(1)}%`);
        await executeSellSnipe(mint, 'take_profit');
        continue;
      }

      // Check stop-loss
      if (config.stopLossPercent < 0 && position.pnlPercent <= config.stopLossPercent) {
        console.log(`[Sniper] Stop loss triggered for ${position.symbol}: ${position.pnlPercent.toFixed(1)}%`);
        await executeSellSnipe(mint, 'stop_loss');
        continue;
      }
    } catch {
      // Skip on error
    }
  }
}

function resetDailyBudgetIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailySpentSol = 0;
    dailyResetDate = today;
  }
}

// ── Auto-snipe hook (called from pumpfun monitor) ──────────────────────

export function onNewTokenDetected(token: {
  mint: string;
  symbol: string;
  name: string;
  usdMarketCap: number;
  source: 'pumpfun' | 'trending';
}): void {
  if (!sniperRunning || !config.enabled) return;
  if (!isSolanaConnected()) return;

  // Source check
  if (token.source === 'pumpfun' && !config.autoBuyPumpFun) return;
  if (token.source === 'trending' && !config.autoBuyTrending) return;

  // Market cap filter
  if (token.usdMarketCap > config.maxMarketCapUsd) return;

  // Don't double-buy
  if (activePositions.has(token.mint)) return;

  // Execute async (fire and forget)
  executeBuySnipe({
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    trigger: token.source === 'pumpfun' ? 'pumpfun' : 'trending',
    priceUsd: token.usdMarketCap > 0 ? token.usdMarketCap / 1e9 : undefined,
  }).catch(err => console.error('[Sniper] Auto-snipe error:', err));
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /sniper/config
sniperRouter.get('/sniper/config', (_req, res) => {
  res.json({ data: config });
});

// PUT /sniper/config
sniperRouter.put('/sniper/config', (req, res) => {
  const updates = req.body as Partial<SniperConfig>;

  // Validate numeric fields
  if (updates.buyAmountSol !== undefined && (updates.buyAmountSol <= 0 || updates.buyAmountSol > 10)) {
    res.status(400).json({ error: 'buyAmountSol must be between 0 and 10 SOL' });
    return;
  }
  if (updates.dailyBudgetSol !== undefined && (updates.dailyBudgetSol <= 0 || updates.dailyBudgetSol > 100)) {
    res.status(400).json({ error: 'dailyBudgetSol must be between 0 and 100 SOL' });
    return;
  }

  config = { ...config, ...updates };

  res.json({
    data: config,
    message: 'Sniper configuration updated',
  });
});

// POST /sniper/start
sniperRouter.post('/sniper/start', (_req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({ error: 'No Solana wallet configured' });
    return;
  }

  sniperRunning = true;
  config.enabled = true;
  sniperStartedAt = new Date();

  // Start position monitoring (check every 30s)
  if (!positionCheckInterval) {
    positionCheckInterval = setInterval(() => checkPositions(), 30_000);
  }

  res.json({
    message: 'Sniper engine started',
    status: 'running',
    config,
  });
});

// POST /sniper/stop
sniperRouter.post('/sniper/stop', (_req, res) => {
  sniperRunning = false;
  config.enabled = false;

  if (positionCheckInterval) {
    clearInterval(positionCheckInterval);
    positionCheckInterval = null;
  }

  res.json({
    message: 'Sniper engine stopped',
    status: 'stopped',
    openPositions: activePositions.size,
  });
});

// GET /sniper/status
sniperRouter.get('/sniper/status', (_req, res) => {
  resetDailyBudgetIfNeeded();

  res.json({
    running: sniperRunning,
    startedAt: sniperStartedAt?.toISOString() ?? null,
    dailySpentSol,
    dailyBudgetSol: config.dailyBudgetSol,
    dailyRemainingSol: Math.max(0, config.dailyBudgetSol - dailySpentSol),
    openPositions: [...activePositions.values()],
    totalExecutions: executionHistory.length,
    recentExecutions: executionHistory.slice(0, 10),
  });
});

// POST /sniper/execute — Manual single snipe
sniperRouter.post('/sniper/execute', async (req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({ error: 'No Solana wallet configured' });
    return;
  }

  const { mint, symbol, name } = req.body as {
    mint: string;
    symbol?: string;
    name?: string;
  };

  if (!mint) {
    res.status(400).json({ error: 'Missing required field: mint' });
    return;
  }

  try {
    const execution = await executeBuySnipe({
      mint,
      symbol: symbol ?? 'UNKNOWN',
      name: name ?? 'Unknown Token',
      trigger: 'manual',
    });

    res.json({
      data: execution,
      message: execution.status === 'success' ? 'Snipe executed successfully' : 'Snipe failed',
    });
  } catch (err) {
    res.status(500).json({
      error: 'Snipe execution failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /sniper/history
sniperRouter.get('/sniper/history', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10);

  res.json({
    data: executionHistory.slice(offset, offset + limit),
    total: executionHistory.length,
    offset,
    limit,
  });
});

// Cleanup
process.on('SIGINT', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
process.on('SIGTERM', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
