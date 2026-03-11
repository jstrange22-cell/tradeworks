import { Router, type Router as RouterType } from 'express';
import { VersionedTransaction } from '@solana/web3.js';
import { broadcast } from '../websocket/server.js';
import {
  isSolanaConnected,
  getSolanaKeypair,
  getSolanaConnection,
} from './solana-utils.js';

/**
 * Solana Sniping Engine — Sprint 8.4 (Template System)
 *
 * Multi-template autonomous token sniping engine. Each template represents
 * an independent strategy with its own config, stats, positions, and budget.
 *
 * Template Routes:
 *   GET    /api/v1/solana/sniper/templates             — List all templates
 *   POST   /api/v1/solana/sniper/templates             — Create template
 *   PUT    /api/v1/solana/sniper/templates/:id         — Update template
 *   DELETE /api/v1/solana/sniper/templates/:id         — Delete template
 *   POST   /api/v1/solana/sniper/templates/:id/start   — Start template
 *   POST   /api/v1/solana/sniper/templates/:id/stop    — Stop template
 *
 * Legacy Routes (backwards-compatible, operate on default template):
 *   GET    /api/v1/solana/sniper/config       — Get default template config
 *   PUT    /api/v1/solana/sniper/config       — Update default template config
 *   POST   /api/v1/solana/sniper/start        — Start default template
 *   POST   /api/v1/solana/sniper/stop         — Stop default template
 *   GET    /api/v1/solana/sniper/status       — All templates status + positions
 *   POST   /api/v1/solana/sniper/execute      — Manual snipe (default template)
 *   GET    /api/v1/solana/sniper/history      — Execution history
 */

export const sniperRouter: RouterType = Router();

// ── Types ──────────────────────────────────────────────────────────────

interface SniperConfigFields {
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

/** Backwards-compatible config shape (config fields + enabled flag) */
interface SniperConfig extends SniperConfigFields {
  enabled: boolean;
}

interface TemplateStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  createdAt: string;
}

interface SniperTemplate extends SniperConfigFields {
  id: string;
  name: string;
  enabled: boolean;
  stats: TemplateStats;
}

interface TemplateRuntimeState {
  running: boolean;
  startedAt: Date | null;
  dailySpentSol: number;
  dailyResetDate: string;
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
  templateId: string;
  templateName: string;
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
  templateId: string;
  templateName: string;
}

// ── State ──────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE_ID = 'default';

const DEFAULT_CONFIG_FIELDS: SniperConfigFields = {
  buyAmountSol: 0.1,        // Moderate — research-backed profile
  dailyBudgetSol: 1.0,
  slippageBps: 200,          // 2% — tighter for better fills
  priorityFee: 25000,        // 25k micro-lamports — moderate speed
  takeProfitPercent: 100,    // 2x
  stopLossPercent: -20,      // -20% — tighter stop loss protects capital
  minLiquidityUsd: 5000,
  maxMarketCapUsd: 100000,   // $100K cap — avoid overpriced entries
  requireMintRevoked: true,  // NON-NEGOTIABLE safety — prevents rug pulls
  requireFreezeRevoked: true, // NON-NEGOTIABLE safety — prevents rug pulls
  maxOpenPositions: 5,
  autoBuyPumpFun: true,      // Enable auto-buy from pump.fun monitor
  autoBuyTrending: true,     // Enable auto-buy from trending scanner
};

/** All registered sniper templates keyed by template ID */
const sniperTemplates: Map<string, SniperTemplate> = new Map();

/** Runtime state per template (running, daily spend, etc.) */
const templateRuntime: Map<string, TemplateRuntimeState> = new Map();

/** Positions per template: templateId -> (mint -> position) */
const positionsMap: Map<string, Map<string, ActivePosition>> = new Map();

/**
 * Flat view of all active positions across all templates.
 * Exported for backwards compatibility with external consumers.
 */
export const activePositions: Map<string, ActivePosition> = new Map();

/** Global execution history across all templates */
const executionHistory: SnipeExecution[] = [];
const MAX_HISTORY = 500;

/** Global position-check interval handle */
let positionCheckInterval: ReturnType<typeof setInterval> | null = null;

// ── Seed default template ──────────────────────────────────────────────

function seedDefaultTemplate(): void {
  if (sniperTemplates.has(DEFAULT_TEMPLATE_ID)) return;

  const defaultTemplate: SniperTemplate = {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Default Sniper',
    enabled: false,
    ...DEFAULT_CONFIG_FIELDS,
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      createdAt: new Date().toISOString(),
    },
  };

  sniperTemplates.set(DEFAULT_TEMPLATE_ID, defaultTemplate);
  templateRuntime.set(DEFAULT_TEMPLATE_ID, {
    running: false,
    startedAt: null,
    dailySpentSol: 0,
    dailyResetDate: new Date().toDateString(),
  });
  positionsMap.set(DEFAULT_TEMPLATE_ID, new Map());
}

seedDefaultTemplate();

// ── Helpers ────────────────────────────────────────────────────────────

function generateTemplateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `tpl_${timestamp}_${random}`;
}

function getTemplatePositions(templateId: string): Map<string, ActivePosition> {
  let positions = positionsMap.get(templateId);
  if (!positions) {
    positions = new Map();
    positionsMap.set(templateId, positions);
  }
  return positions;
}

function getRuntime(templateId: string): TemplateRuntimeState {
  let runtime = templateRuntime.get(templateId);
  if (!runtime) {
    runtime = {
      running: false,
      startedAt: null,
      dailySpentSol: 0,
      dailyResetDate: new Date().toDateString(),
    };
    templateRuntime.set(templateId, runtime);
  }
  return runtime;
}

function resetDailyBudgetIfNeeded(runtime: TemplateRuntimeState): void {
  const today = new Date().toDateString();
  if (today !== runtime.dailyResetDate) {
    runtime.dailySpentSol = 0;
    runtime.dailyResetDate = today;
  }
}

/** Check if any template is currently running (used for the global interval) */
function isAnyTemplateRunning(): boolean {
  for (const runtime of templateRuntime.values()) {
    if (runtime.running) return true;
  }
  return false;
}

/** Sync the flat activePositions map from all template positions */
function syncActivePositionsMap(): void {
  activePositions.clear();
  for (const positions of positionsMap.values()) {
    for (const [mint, position] of positions) {
      activePositions.set(mint, position);
    }
  }
}

/** Extract SniperConfig (legacy shape) from a template */
function templateToLegacyConfig(template: SniperTemplate): SniperConfig {
  return {
    enabled: template.enabled,
    buyAmountSol: template.buyAmountSol,
    dailyBudgetSol: template.dailyBudgetSol,
    slippageBps: template.slippageBps,
    priorityFee: template.priorityFee,
    takeProfitPercent: template.takeProfitPercent,
    stopLossPercent: template.stopLossPercent,
    minLiquidityUsd: template.minLiquidityUsd,
    maxMarketCapUsd: template.maxMarketCapUsd,
    requireMintRevoked: template.requireMintRevoked,
    requireFreezeRevoked: template.requireFreezeRevoked,
    maxOpenPositions: template.maxOpenPositions,
    autoBuyPumpFun: template.autoBuyPumpFun,
    autoBuyTrending: template.autoBuyTrending,
  };
}

/** Collect all active positions across all templates into a flat array */
function getAllActivePositions(): ActivePosition[] {
  const all: ActivePosition[] = [];
  for (const positions of positionsMap.values()) {
    for (const position of positions.values()) {
      all.push(position);
    }
  }
  return all;
}

/** Start the global position-check interval if not already running */
function ensurePositionCheckRunning(): void {
  if (positionCheckInterval) return;
  positionCheckInterval = setInterval(() => {
    checkPositions().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Sniper] Position check error:', message);
    });
  }, 30_000);
}

/** Stop the global position-check interval if no templates are running */
function stopPositionCheckIfIdle(): void {
  if (!isAnyTemplateRunning() && positionCheckInterval) {
    clearInterval(positionCheckInterval);
    positionCheckInterval = null;
  }
}

// ── Validation helpers ────────────────────────────────────────────────

const SNIPER_CONFIG_KEYS: ReadonlyArray<keyof SniperConfigFields> = [
  'buyAmountSol', 'dailyBudgetSol', 'slippageBps', 'priorityFee',
  'takeProfitPercent', 'stopLossPercent', 'minLiquidityUsd', 'maxMarketCapUsd',
  'requireMintRevoked', 'requireFreezeRevoked', 'maxOpenPositions',
  'autoBuyPumpFun', 'autoBuyTrending',
] as const;

function validateConfigUpdates(
  updates: Partial<SniperConfigFields>,
): string | null {
  if (updates.buyAmountSol !== undefined
    && (updates.buyAmountSol <= 0 || updates.buyAmountSol > 10)) {
    return 'buyAmountSol must be between 0 and 10 SOL';
  }
  if (updates.dailyBudgetSol !== undefined
    && (updates.dailyBudgetSol <= 0 || updates.dailyBudgetSol > 100)) {
    return 'dailyBudgetSol must be between 0 and 100 SOL';
  }
  if (updates.slippageBps !== undefined
    && (updates.slippageBps < 0 || updates.slippageBps > 5000)) {
    return 'slippageBps must be between 0 and 5000';
  }
  if (updates.maxOpenPositions !== undefined
    && (updates.maxOpenPositions < 1 || updates.maxOpenPositions > 100)) {
    return 'maxOpenPositions must be between 1 and 100';
  }
  return null;
}

function pickConfigFields(
  body: Record<string, unknown>,
): Partial<SniperConfigFields> {
  const result: Partial<SniperConfigFields> = {};
  for (const key of SNIPER_CONFIG_KEYS) {
    if (key in body) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic key assignment from validated keys
      (result as Record<keyof SniperConfigFields, unknown>)[key] = body[key];
    }
  }
  return result;
}

/** Type-safe application of partial config fields onto a SniperTemplate */
function applyConfigToTemplate(
  template: SniperTemplate,
  fields: Partial<SniperConfigFields>,
): void {
  if (fields.buyAmountSol !== undefined) template.buyAmountSol = fields.buyAmountSol;
  if (fields.dailyBudgetSol !== undefined) template.dailyBudgetSol = fields.dailyBudgetSol;
  if (fields.slippageBps !== undefined) template.slippageBps = fields.slippageBps;
  if (fields.priorityFee !== undefined) template.priorityFee = fields.priorityFee;
  if (fields.takeProfitPercent !== undefined) template.takeProfitPercent = fields.takeProfitPercent;
  if (fields.stopLossPercent !== undefined) template.stopLossPercent = fields.stopLossPercent;
  if (fields.minLiquidityUsd !== undefined) template.minLiquidityUsd = fields.minLiquidityUsd;
  if (fields.maxMarketCapUsd !== undefined) template.maxMarketCapUsd = fields.maxMarketCapUsd;
  if (fields.requireMintRevoked !== undefined) template.requireMintRevoked = fields.requireMintRevoked;
  if (fields.requireFreezeRevoked !== undefined) template.requireFreezeRevoked = fields.requireFreezeRevoked;
  if (fields.maxOpenPositions !== undefined) template.maxOpenPositions = fields.maxOpenPositions;
  if (fields.autoBuyPumpFun !== undefined) template.autoBuyPumpFun = fields.autoBuyPumpFun;
  if (fields.autoBuyTrending !== undefined) template.autoBuyTrending = fields.autoBuyTrending;
}

// ── Jupiter swap helper ────────────────────────────────────────────────

const JUPITER_QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_URL = 'https://quote-api.jup.ag/v6/swap';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

interface SwapResult {
  signature: string;
  success: boolean;
  outAmount: string | null;
}

interface JupiterQuoteResponse {
  outAmount: string;
  [key: string]: unknown;
}

interface JupiterSwapResponse {
  swapTransaction: string;
}

async function executeSwap(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps: number;
  priorityFee: number;
}): Promise<SwapResult> {
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
  const quoteResponse = (await quoteRes.json()) as JupiterQuoteResponse;

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
  const swapData = (await swapRes.json()) as JupiterSwapResponse;

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
    outAmount: quoteResponse.outAmount ?? null,
  };
}

// ── Snipe execution ────────────────────────────────────────────────────

/**
 * Execute a buy snipe using a specific template's configuration.
 * Falls back to the default template if no templateId is provided.
 *
 * Exported for use by solana-pumpfun.ts and solana-whales.ts.
 */
export async function executeBuySnipe(params: {
  mint: string;
  symbol: string;
  name: string;
  trigger: SnipeExecution['trigger'];
  priceUsd?: number;
  templateId?: string;
}): Promise<SnipeExecution> {
  const templateId = params.templateId ?? DEFAULT_TEMPLATE_ID;
  const template = sniperTemplates.get(templateId);

  if (!template) {
    const execution = buildFailedExecution(
      params,
      templateId,
      'Unknown',
      `Template not found: ${templateId}`,
    );
    storeAndBroadcastExecution(execution);
    return execution;
  }

  const runtime = getRuntime(templateId);
  const positions = getTemplatePositions(templateId);

  const id = `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const execution: SnipeExecution = {
    id,
    mint: params.mint,
    symbol: params.symbol,
    name: params.name,
    action: 'buy',
    amountSol: template.buyAmountSol,
    amountTokens: null,
    priceUsd: params.priceUsd ?? null,
    signature: null,
    status: 'pending',
    error: null,
    trigger: params.trigger,
    templateId,
    templateName: template.name,
    timestamp: new Date().toISOString(),
  };

  try {
    // Budget checks
    resetDailyBudgetIfNeeded(runtime);
    if (runtime.dailySpentSol + template.buyAmountSol > template.dailyBudgetSol) {
      throw new Error(
        `Daily budget exceeded for "${template.name}": spent ${runtime.dailySpentSol.toFixed(4)} / ${template.dailyBudgetSol} SOL`,
      );
    }
    if (positions.size >= template.maxOpenPositions) {
      throw new Error(
        `Max open positions reached for "${template.name}": ${positions.size}/${template.maxOpenPositions}`,
      );
    }

    const amountLamports = String(Math.floor(template.buyAmountSol * LAMPORTS_PER_SOL));

    const result = await executeSwap({
      inputMint: SOL_MINT,
      outputMint: params.mint,
      amountLamports,
      slippageBps: template.slippageBps,
      priorityFee: template.priorityFee,
    });

    execution.signature = result.signature;
    execution.status = result.success ? 'success' : 'failed';

    if (result.success) {
      runtime.dailySpentSol += template.buyAmountSol;
      execution.amountTokens = result.outAmount ? parseFloat(result.outAmount) : null;

      // Track position under this template
      const newPosition: ActivePosition = {
        mint: params.mint,
        symbol: params.symbol,
        name: params.name,
        buyPrice: params.priceUsd ?? 0,
        currentPrice: params.priceUsd ?? 0,
        amountTokens: execution.amountTokens ?? 0,
        pnlPercent: 0,
        buySignature: result.signature,
        boughtAt: new Date().toISOString(),
        templateId,
        templateName: template.name,
      };

      positions.set(params.mint, newPosition);
      syncActivePositionsMap();

      // Stats: increment totalTrades on successful buy
      template.stats.totalTrades++;
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';
  }

  storeAndBroadcastExecution(execution);

  console.log(
    `[Sniper][${template.name}] ${execution.status.toUpperCase()} -- ${execution.action} ${execution.symbol} (${execution.trigger}): ${execution.signature ?? execution.error}`,
  );

  return execution;
}

export async function executeSellSnipe(
  mint: string,
  trigger: SnipeExecution['trigger'],
  templateId?: string,
): Promise<SnipeExecution | null> {
  // Resolve templateId: if not provided, find which template owns this position
  const resolvedTemplateId = templateId ?? findTemplateForPosition(mint);
  if (!resolvedTemplateId) return null;

  const template = sniperTemplates.get(resolvedTemplateId);
  if (!template) return null;

  const positions = getTemplatePositions(resolvedTemplateId);
  const position = positions.get(mint);
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
    templateId: resolvedTemplateId,
    templateName: template.name,
    timestamp: new Date().toISOString(),
  };

  try {
    // Sell all tokens back to SOL
    const result = await executeSwap({
      inputMint: mint,
      outputMint: SOL_MINT,
      amountLamports: String(Math.floor(position.amountTokens)),
      slippageBps: template.slippageBps,
      priorityFee: template.priorityFee,
    });

    execution.signature = result.signature;
    execution.status = result.success ? 'success' : 'failed';

    if (result.success) {
      execution.amountSol = result.outAmount
        ? parseFloat(result.outAmount) / LAMPORTS_PER_SOL
        : 0;

      // Stats tracking on sell
      const buyAmountSol = template.buyAmountSol;
      const sellAmountSol = execution.amountSol;
      const pnlSol = sellAmountSol - buyAmountSol;

      if (trigger === 'take_profit') {
        template.stats.wins++;
        template.stats.totalPnlSol += pnlSol;
      } else if (trigger === 'stop_loss') {
        template.stats.losses++;
        template.stats.totalPnlSol += pnlSol;
      } else {
        // Manual or other sells still track PnL
        if (pnlSol >= 0) {
          template.stats.wins++;
        } else {
          template.stats.losses++;
        }
        template.stats.totalPnlSol += pnlSol;
      }

      positions.delete(mint);
      syncActivePositionsMap();
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';
  }

  storeAndBroadcastExecution(execution);

  console.log(
    `[Sniper][${template.name}] ${execution.status.toUpperCase()} -- ${execution.action} ${position.symbol} (${trigger}): ${execution.signature ?? execution.error}`,
  );

  return execution;
}

/** Find which template owns a given mint position */
function findTemplateForPosition(mint: string): string | null {
  for (const [templateId, positions] of positionsMap) {
    if (positions.has(mint)) return templateId;
  }
  return null;
}

function buildFailedExecution(
  params: { mint: string; symbol: string; name: string; trigger: SnipeExecution['trigger'] },
  templateId: string,
  templateName: string,
  errorMessage: string,
): SnipeExecution {
  return {
    id: `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mint: params.mint,
    symbol: params.symbol,
    name: params.name,
    action: 'buy',
    amountSol: 0,
    amountTokens: null,
    priceUsd: null,
    signature: null,
    status: 'failed',
    error: errorMessage,
    trigger: params.trigger,
    templateId,
    templateName,
    timestamp: new Date().toISOString(),
  };
}

function storeAndBroadcastExecution(execution: SnipeExecution): void {
  executionHistory.unshift(execution);
  if (executionHistory.length > MAX_HISTORY) executionHistory.pop();

  broadcast('solana:sniper', {
    event: 'snipe:executed',
    execution,
  });
}

// ── Position monitoring (take-profit / stop-loss) ──────────────────────

interface DexscreenerPair {
  chainId: string;
  priceUsd?: string;
  [key: string]: unknown;
}

interface DexscreenerTokenResponse {
  pairs?: DexscreenerPair[];
}

async function checkPositions(): Promise<void> {
  for (const [templateId, positions] of positionsMap) {
    if (positions.size === 0) continue;

    const template = sniperTemplates.get(templateId);
    if (!template) continue;

    const runtime = getRuntime(templateId);
    if (!runtime.running) continue;

    for (const [mint, position] of positions) {
      try {
        // Fetch current price from Dexscreener
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        if (!res.ok) continue;

        const data = (await res.json()) as DexscreenerTokenResponse;
        const pair = (data.pairs ?? []).find(
          (p: DexscreenerPair) => p.chainId === 'solana',
        );
        if (!pair) continue;

        const currentPrice = parseFloat(pair.priceUsd ?? '0');
        if (currentPrice === 0 || position.buyPrice === 0) continue;

        position.currentPrice = currentPrice;
        position.pnlPercent = ((currentPrice - position.buyPrice) / position.buyPrice) * 100;

        // Broadcast live P&L to dashboard via WebSocket
        broadcast('solana:sniper', {
          event: 'position:pnl_update',
          templateId,
          templateName: template.name,
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
        if (template.takeProfitPercent > 0 && position.pnlPercent >= template.takeProfitPercent) {
          console.log(
            `[Sniper][${template.name}] Take profit triggered for ${position.symbol}: +${position.pnlPercent.toFixed(1)}%`,
          );
          await executeSellSnipe(mint, 'take_profit', templateId);
          continue;
        }

        // Check stop-loss
        if (template.stopLossPercent < 0 && position.pnlPercent <= template.stopLossPercent) {
          console.log(
            `[Sniper][${template.name}] Stop loss triggered for ${position.symbol}: ${position.pnlPercent.toFixed(1)}%`,
          );
          await executeSellSnipe(mint, 'stop_loss', templateId);
          continue;
        }
      } catch {
        // Skip on error
      }
    }
  }
}

// ── Auto-snipe hook (called from pumpfun and whale monitors) ────────────

/**
 * Called when a new token is detected by pump.fun monitor or trending scanner.
 * Checks ALL enabled templates and executes buys for matching ones.
 *
 * Exported for use by solana-pumpfun.ts and solana-whales.ts.
 */
export function onNewTokenDetected(token: {
  mint: string;
  symbol: string;
  name: string;
  usdMarketCap: number;
  source: 'pumpfun' | 'trending';
}): void {
  if (!isSolanaConnected()) return;

  for (const [templateId, template] of sniperTemplates) {
    const runtime = getRuntime(templateId);
    if (!runtime.running || !template.enabled) continue;

    // Source check
    if (token.source === 'pumpfun' && !template.autoBuyPumpFun) continue;
    if (token.source === 'trending' && !template.autoBuyTrending) continue;

    // Market cap filter
    if (token.usdMarketCap > template.maxMarketCapUsd) continue;

    // Don't double-buy within the same template
    const positions = getTemplatePositions(templateId);
    if (positions.has(token.mint)) continue;

    // Execute async (fire and forget)
    executeBuySnipe({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      trigger: token.source === 'pumpfun' ? 'pumpfun' : 'trending',
      priceUsd: token.usdMarketCap > 0 ? token.usdMarketCap / 1e9 : undefined,
      templateId,
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Sniper][${template.name}] Auto-snipe error:`, message);
    });
  }
}

// ── Template CRUD helpers ──────────────────────────────────────────────

function createTemplate(
  name: string,
  configOverrides: Partial<SniperConfigFields>,
): SniperTemplate {
  const id = generateTemplateId();
  const template: SniperTemplate = {
    id,
    name,
    enabled: false,
    ...DEFAULT_CONFIG_FIELDS,
    ...configOverrides,
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      createdAt: new Date().toISOString(),
    },
  };

  sniperTemplates.set(id, template);
  templateRuntime.set(id, {
    running: false,
    startedAt: null,
    dailySpentSol: 0,
    dailyResetDate: new Date().toDateString(),
  });
  positionsMap.set(id, new Map());

  return template;
}

function deleteTemplate(id: string): boolean {
  if (id === DEFAULT_TEMPLATE_ID) return false;

  sniperTemplates.delete(id);
  templateRuntime.delete(id);
  positionsMap.delete(id);
  syncActivePositionsMap();
  return true;
}

// ── Routes: Template Management ─────────────────────────────────────────

// GET /sniper/templates -- List all templates with stats
sniperRouter.get('/sniper/templates', (_req, res) => {
  const templates = [...sniperTemplates.values()].map(template => {
    const runtime = getRuntime(template.id);
    const positions = getTemplatePositions(template.id);
    resetDailyBudgetIfNeeded(runtime);

    return {
      ...template,
      running: runtime.running,
      startedAt: runtime.startedAt?.toISOString() ?? null,
      dailySpentSol: runtime.dailySpentSol,
      dailyRemainingSol: Math.max(0, template.dailyBudgetSol - runtime.dailySpentSol),
      openPositions: positions.size,
    };
  });

  res.json({
    data: templates,
    total: templates.length,
    defaultTemplateId: DEFAULT_TEMPLATE_ID,
  });
});

// POST /sniper/templates -- Create a new template
sniperRouter.post('/sniper/templates', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = body.name as string | undefined;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({
      error: { code: 'INVALID_NAME', message: 'Template name is required' },
    });
    return;
  }

  const configFields = pickConfigFields(body);
  const validationError = validateConfigUpdates(configFields);
  if (validationError) {
    res.status(400).json({
      error: { code: 'INVALID_CONFIG', message: validationError },
    });
    return;
  }

  const template = createTemplate(name.trim(), configFields);

  res.status(201).json({
    data: template,
    message: `Template "${template.name}" created`,
  });
});

// PUT /sniper/templates/:id -- Update a template
sniperRouter.put('/sniper/templates/:id', (req, res) => {
  const { id } = req.params;
  const template = sniperTemplates.get(id);

  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const configFields = pickConfigFields(body);
  const validationError = validateConfigUpdates(configFields);
  if (validationError) {
    res.status(400).json({
      error: { code: 'INVALID_CONFIG', message: validationError },
    });
    return;
  }

  // Apply name update if provided
  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    template.name = body.name.trim();
  }

  // Apply config field updates
  applyConfigToTemplate(template, configFields);

  res.json({
    data: template,
    message: `Template "${template.name}" updated`,
  });
});

// DELETE /sniper/templates/:id -- Delete a template
sniperRouter.delete('/sniper/templates/:id', (req, res) => {
  const { id } = req.params;

  if (id === DEFAULT_TEMPLATE_ID) {
    res.status(400).json({
      error: { code: 'CANNOT_DELETE_DEFAULT', message: 'Cannot delete the default template' },
    });
    return;
  }

  const template = sniperTemplates.get(id);
  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const runtime = getRuntime(id);
  if (runtime.running) {
    res.status(409).json({
      error: { code: 'TEMPLATE_RUNNING', message: 'Stop the template before deleting it' },
    });
    return;
  }

  const positions = getTemplatePositions(id);
  if (positions.size > 0) {
    res.status(409).json({
      error: {
        code: 'HAS_OPEN_POSITIONS',
        message: `Template has ${positions.size} open position(s). Close them before deleting.`,
      },
    });
    return;
  }

  deleteTemplate(id);

  res.json({ message: `Template "${template.name}" deleted` });
});

// POST /sniper/templates/:id/start -- Start a specific template
sniperRouter.post('/sniper/templates/:id/start', (req, res) => {
  const { id } = req.params;

  if (!isSolanaConnected()) {
    res.status(400).json({
      error: { code: 'NO_WALLET', message: 'No Solana wallet configured' },
    });
    return;
  }

  const template = sniperTemplates.get(id);
  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const runtime = getRuntime(id);
  runtime.running = true;
  runtime.startedAt = new Date();
  template.enabled = true;

  ensurePositionCheckRunning();

  res.json({
    message: `Template "${template.name}" started`,
    status: 'running',
    template,
  });
});

// POST /sniper/templates/:id/stop -- Stop a specific template
sniperRouter.post('/sniper/templates/:id/stop', (req, res) => {
  const { id } = req.params;
  const template = sniperTemplates.get(id);

  if (!template) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Template not found: ${id}` },
    });
    return;
  }

  const runtime = getRuntime(id);
  runtime.running = false;
  template.enabled = false;

  stopPositionCheckIfIdle();

  const positions = getTemplatePositions(id);

  res.json({
    message: `Template "${template.name}" stopped`,
    status: 'stopped',
    openPositions: positions.size,
  });
});

// ── Routes: Legacy (backwards-compatible) ───────────────────────────────

// GET /sniper/config -- returns default template as legacy SniperConfig
sniperRouter.get('/sniper/config', (_req, res) => {
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  res.json({ data: templateToLegacyConfig(defaultTemplate) });
});

// PUT /sniper/config -- updates default template
sniperRouter.put('/sniper/config', (req, res) => {
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const configFields = pickConfigFields(body);
  const validationError = validateConfigUpdates(configFields);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  // Apply config field updates
  applyConfigToTemplate(defaultTemplate, configFields);

  // Handle legacy 'enabled' field
  if (typeof body.enabled === 'boolean') {
    defaultTemplate.enabled = body.enabled;
  }

  res.json({
    data: templateToLegacyConfig(defaultTemplate),
    message: 'Sniper configuration updated',
  });
});

// POST /sniper/start -- starts default template
sniperRouter.post('/sniper/start', (_req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({ error: 'No Solana wallet configured' });
    return;
  }

  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  const runtime = getRuntime(DEFAULT_TEMPLATE_ID);
  runtime.running = true;
  runtime.startedAt = new Date();
  defaultTemplate.enabled = true;

  ensurePositionCheckRunning();

  res.json({
    message: 'Sniper engine started',
    status: 'running',
    config: templateToLegacyConfig(defaultTemplate),
  });
});

// POST /sniper/stop -- stops default template
sniperRouter.post('/sniper/stop', (_req, res) => {
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  if (!defaultTemplate) {
    res.status(500).json({ error: 'Default template not found' });
    return;
  }

  const runtime = getRuntime(DEFAULT_TEMPLATE_ID);
  runtime.running = false;
  defaultTemplate.enabled = false;

  stopPositionCheckIfIdle();

  const positions = getTemplatePositions(DEFAULT_TEMPLATE_ID);

  res.json({
    message: 'Sniper engine stopped',
    status: 'stopped',
    openPositions: positions.size,
  });
});

// GET /sniper/status -- returns status for all templates + combined positions
sniperRouter.get('/sniper/status', (_req, res) => {
  const defaultRuntime = getRuntime(DEFAULT_TEMPLATE_ID);
  const defaultTemplate = sniperTemplates.get(DEFAULT_TEMPLATE_ID);
  resetDailyBudgetIfNeeded(defaultRuntime);

  // Per-template status
  const templates = [...sniperTemplates.values()].map(template => {
    const runtime = getRuntime(template.id);
    const positions = getTemplatePositions(template.id);
    resetDailyBudgetIfNeeded(runtime);

    return {
      id: template.id,
      name: template.name,
      enabled: template.enabled,
      running: runtime.running,
      startedAt: runtime.startedAt?.toISOString() ?? null,
      dailySpentSol: runtime.dailySpentSol,
      dailyBudgetSol: template.dailyBudgetSol,
      dailyRemainingSol: Math.max(0, template.dailyBudgetSol - runtime.dailySpentSol),
      openPositions: positions.size,
      stats: template.stats,
    };
  });

  res.json({
    // Legacy fields (from default template)
    running: defaultRuntime.running,
    startedAt: defaultRuntime.startedAt?.toISOString() ?? null,
    dailySpentSol: defaultRuntime.dailySpentSol,
    dailyBudgetSol: defaultTemplate?.dailyBudgetSol ?? 0,
    dailyRemainingSol: Math.max(
      0,
      (defaultTemplate?.dailyBudgetSol ?? 0) - defaultRuntime.dailySpentSol,
    ),
    openPositions: getAllActivePositions(),
    totalExecutions: executionHistory.length,
    recentExecutions: executionHistory.slice(0, 10),
    // New template fields
    templates,
    anyRunning: isAnyTemplateRunning(),
  });
});

// POST /sniper/execute -- Manual single snipe (supports optional templateId)
sniperRouter.post('/sniper/execute', async (req, res) => {
  if (!isSolanaConnected()) {
    res.status(400).json({ error: 'No Solana wallet configured' });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const mint = body.mint as string | undefined;
  const symbol = body.symbol as string | undefined;
  const name = body.name as string | undefined;
  const templateId = (body.templateId as string | undefined) ?? DEFAULT_TEMPLATE_ID;

  if (!mint) {
    res.status(400).json({ error: 'Missing required field: mint' });
    return;
  }

  if (!sniperTemplates.has(templateId)) {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  try {
    const execution = await executeBuySnipe({
      mint,
      symbol: symbol ?? 'UNKNOWN',
      name: name ?? 'Unknown Token',
      trigger: 'manual',
      templateId,
    });

    res.json({
      data: execution,
      message: execution.status === 'success'
        ? 'Snipe executed successfully'
        : 'Snipe failed',
    });
  } catch (err) {
    res.status(500).json({
      error: 'Snipe execution failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /sniper/history -- supports optional templateId filter
sniperRouter.get('/sniper/history', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10);
  const templateId = req.query.templateId as string | undefined;

  let filtered = executionHistory;
  if (templateId) {
    filtered = executionHistory.filter(
      execution => execution.templateId === templateId,
    );
  }

  res.json({
    data: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
  });
});

// ── Holdings P&L ──────────────────────────────────────────────────────

interface HoldingPnL {
  mint: string;
  symbol: string;
  name: string;
  totalBuySol: number;
  totalSellSol: number;
  totalBuyCount: number;
  totalSellCount: number;
  currentAmountTokens: number;
  currentPriceUsd: number;
  currentValueUsd: number;
  realizedPnlSol: number;
  unrealizedPnlPercent: number;
  avgBuyPrice: number;
  lastAction: string;
  lastActionAt: string;
  isOpen: boolean;
  templateName: string | null;
}

/** GET /sniper/holdings — Aggregated P&L per token from execution history + open positions */
sniperRouter.get('/sniper/holdings', (_req, res) => {
  const holdingsMap = new Map<string, HoldingPnL>();

  // Build from execution history (successful buys and sells only)
  for (const execution of executionHistory) {
    if (execution.status !== 'success') continue;

    let holding = holdingsMap.get(execution.mint);
    if (!holding) {
      holding = {
        mint: execution.mint,
        symbol: execution.symbol,
        name: execution.name,
        totalBuySol: 0,
        totalSellSol: 0,
        totalBuyCount: 0,
        totalSellCount: 0,
        currentAmountTokens: 0,
        currentPriceUsd: 0,
        currentValueUsd: 0,
        realizedPnlSol: 0,
        unrealizedPnlPercent: 0,
        avgBuyPrice: 0,
        lastAction: execution.action,
        lastActionAt: execution.timestamp,
        isOpen: false,
        templateName: execution.templateName,
      };
      holdingsMap.set(execution.mint, holding);
    }

    if (execution.action === 'buy') {
      holding.totalBuySol += execution.amountSol;
      holding.totalBuyCount++;
    } else if (execution.action === 'sell') {
      holding.totalSellSol += execution.amountSol;
      holding.totalSellCount++;
    }

    holding.lastAction = execution.action;
    holding.lastActionAt = execution.timestamp;
    holding.templateName = execution.templateName;
  }

  // Merge open positions for current values + unrealized P&L
  for (const position of getAllActivePositions()) {
    let holding = holdingsMap.get(position.mint);
    if (!holding) {
      holding = {
        mint: position.mint,
        symbol: position.symbol,
        name: position.name,
        totalBuySol: 0,
        totalSellSol: 0,
        totalBuyCount: 1,
        totalSellCount: 0,
        currentAmountTokens: position.amountTokens,
        currentPriceUsd: position.currentPrice,
        currentValueUsd: 0,
        realizedPnlSol: 0,
        unrealizedPnlPercent: position.pnlPercent,
        avgBuyPrice: position.buyPrice,
        lastAction: 'buy',
        lastActionAt: position.boughtAt,
        isOpen: true,
        templateName: position.templateName,
      };
      holdingsMap.set(position.mint, holding);
    } else {
      holding.currentAmountTokens = position.amountTokens;
      holding.currentPriceUsd = position.currentPrice;
      holding.avgBuyPrice = position.buyPrice;
      holding.unrealizedPnlPercent = position.pnlPercent;
      holding.isOpen = true;
    }
  }

  // Calculate realized P&L and current value for all holdings
  for (const holding of holdingsMap.values()) {
    holding.realizedPnlSol = holding.totalSellSol - holding.totalBuySol;
    if (holding.isOpen && holding.currentPriceUsd > 0 && holding.avgBuyPrice > 0) {
      holding.currentValueUsd = holding.currentAmountTokens * holding.currentPriceUsd;
    }
  }

  const holdings = [...holdingsMap.values()].sort(
    (a, b) => new Date(b.lastActionAt).getTime() - new Date(a.lastActionAt).getTime(),
  );

  const totalRealizedPnl = holdings.reduce((sum, h) => sum + h.realizedPnlSol, 0);
  const totalInvested = holdings.reduce((sum, h) => sum + h.totalBuySol, 0);
  const totalReturned = holdings.reduce((sum, h) => sum + h.totalSellSol, 0);
  const openCount = holdings.filter(h => h.isOpen).length;

  res.json({
    data: holdings,
    summary: {
      totalHoldings: holdings.length,
      openPositions: openCount,
      closedPositions: holdings.length - openCount,
      totalInvestedSol: totalInvested,
      totalReturnedSol: totalReturned,
      realizedPnlSol: totalRealizedPnl,
    },
  });
});

// Cleanup
process.on('SIGINT', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
process.on('SIGTERM', () => {
  if (positionCheckInterval) clearInterval(positionCheckInterval);
});
