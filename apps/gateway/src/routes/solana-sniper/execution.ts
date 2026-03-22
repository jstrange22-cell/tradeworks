/**
 * Solana Sniper Engine — Swap Execution Layer
 *
 * Extracted from the monolithic solana-sniper.ts. Contains all swap execution
 * logic: Raydium, PumpPortal, Jito bundles, buy/sell execution, and position
 * helpers (reconciliation, auto-close, token account cleanup).
 */

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { broadcast } from '../../websocket/server.js';
import {
  getSolanaKeypair,
  getSolanaConnection,
  withRpcRetry,
  hasEnoughSolForSwap,
  getAllTokenAccounts,
  closeTokenAccount,
} from '../solana-utils.js';
import {
  subscribeTokenTrades,
  unsubscribeTokenTrades,
} from '../solana-pumpfun.js';
import { clearAntiRugWindow } from './monitoring.js';
import type {
  SnipeExecution,
  ActivePosition,
  SwapResult,
  RaydiumQuoteResponse,
  RaydiumSwapResponse,
} from './types.js';
import {
  sniperTemplates,
  positionsMap,
  executionHistory,
  MAX_HISTORY,
  pendingBuys,
  pendingSells,
  failedSellQueue,
  permanentlyFailedSells,
  MAX_POSITION_SELL_ATTEMPTS,
  getRuntime,
  getTemplatePositions,
  syncActivePositionsMap,
  persistPositions,
  persistExecutions,
  persistTemplateStats,
  persistDailySpend,
  getCachedSolBalance,
  refreshCachedSolBalance,
  resetDailyBudgetIfNeeded,
  setLastBuyTimestamp,
  DEFAULT_TEMPLATE_ID,
} from './state.js';

// ── Raydium swap helper (replaced dead Jupiter API) ──────────────────

const RAYDIUM_QUOTE_URL = 'https://transaction-v1.raydium.io/compute/swap-base-in';
const RAYDIUM_SWAP_URL = 'https://transaction-v1.raydium.io/transaction/swap-base-in';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const LAMPORTS_PER_SOL = 1_000_000_000;

export async function executeSwap(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps: number;
  priorityFee: number;
}): Promise<SwapResult> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  // Pre-flight balance check (only for SOL input swaps)
  if (params.inputMint === SOL_MINT) {
    const check = await hasEnoughSolForSwap(parseInt(params.amountLamports, 10));
    if (!check.sufficient) {
      throw new Error(
        `Insufficient SOL: have ${(check.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
        `need ${(check.requiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (including fees)`,
      );
    }
  }

  // Raydium Quote
  const quoteParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amountLamports,
    slippageBps: String(params.slippageBps),
    txVersion: 'V0',
  });

  console.log(`[Sniper] Raydium quote: ${params.inputMint.slice(0, 8)}... -> ${params.outputMint.slice(0, 8)}... amount=${params.amountLamports}`);
  const quoteRes = await fetch(`${RAYDIUM_QUOTE_URL}?${quoteParams}`);
  if (!quoteRes.ok) {
    const errorBody = await quoteRes.text();
    console.error(`[Sniper] Raydium quote error (${quoteRes.status}):`, errorBody);
    throw new Error(`Raydium quote failed (${quoteRes.status}): ${errorBody.slice(0, 200)}`);
  }
  const quoteResponse = (await quoteRes.json()) as RaydiumQuoteResponse;
  if (!quoteResponse.success || !quoteResponse.data) {
    throw new Error(`Raydium quote failed: ${quoteResponse.msg ?? 'no data'}`);
  }

  const outputAmount = quoteResponse.data.outputAmount;
  console.log(`[Sniper] Raydium quote OK: output=${outputAmount}`);

  // Raydium Swap Transaction
  const swapRes = await fetch(RAYDIUM_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      computeUnitPriceMicroLamports: String(Math.max(params.priorityFee, 100000)),
      swapResponse: quoteResponse,
      txVersion: 'V0',
      wallet: keypair.publicKey.toBase58(),
      wrapSol: params.inputMint === SOL_MINT,
      unwrapSol: params.outputMint === SOL_MINT,
    }),
  });

  if (!swapRes.ok) {
    const errorBody = await swapRes.text();
    console.error(`[Sniper] Raydium swap build error (${swapRes.status}):`, errorBody);
    throw new Error(`Raydium swap build failed (${swapRes.status}): ${errorBody.slice(0, 200)}`);
  }
  const swapData = (await swapRes.json()) as RaydiumSwapResponse;
  if (!swapData.success || !swapData.data?.transaction?.length) {
    throw new Error(`Raydium swap build failed: ${swapData.msg ?? 'no transaction data'}`);
  }

  // Raydium may return multiple transactions; use the first (main swap)
  const txBase64 = swapData.data.transaction[0];
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(txBase64, 'base64'),
  );

  const { blockhash, lastValidBlockHeight } = await withRpcRetry(
    () => connection.getLatestBlockhash('confirmed'),
  );

  transaction.sign([keypair]);

  const signature = await withRpcRetry(
    () => connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    }),
    2,
  );

  console.log(`[Sniper] Raydium tx sent: ${signature}`);

  // Confirm with timeout fallback
  let success = false;
  try {
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    success = !confirmation.value.err;
    if (confirmation.value.err) {
      console.error(`[Sniper] Raydium tx failed on-chain:`, confirmation.value.err);
    }
  } catch {
    console.warn(`[Sniper] Raydium confirmation timed out for ${signature}, checking status...`);
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      if (status.value?.confirmationStatus === 'confirmed' ||
          status.value?.confirmationStatus === 'finalized') {
        success = !status.value.err;
        console.log(`[Sniper] Raydium fallback status: ${success ? 'SUCCESS' : 'FAILED on-chain'}`);
      }
    } catch {
      console.error(`[Sniper] Raydium fallback status check failed for ${signature}`);
    }
  }

  return {
    signature,
    success,
    outAmount: outputAmount ?? null,
  };
}

// ── PumpPortal Local API (bonding curve + graduated tokens) ───────────

const PUMPPORTAL_TRADE_URL = 'https://pumpportal.fun/api/trade-local';

/**
 * Execute a swap via PumpPortal's Local Transaction API.
 * Returns a serialized VersionedTransaction that we sign and send ourselves.
 *
 * Works for: bonding curve (pump), PumpSwap (pump-amm), Raydium, auto-detect.
 * Fee: 0.5% per trade (deducted on-chain by PumpPortal).
 *
 * @see https://pumpportal.fun/local-trading-api/trading-api/
 */
export async function executePumpPortalSwap(params: {
  action: 'buy' | 'sell';
  mint: string;
  amount: number;
  denominatedInSol: boolean;
  slippageBps: number;
  priorityFeeLamports: number;
}): Promise<SwapResult> {
  const keypair = getSolanaKeypair();
  const connection = getSolanaConnection();

  // Pre-flight balance check for buys
  if (params.action === 'buy' && params.denominatedInSol) {
    const amountLamports = Math.floor(params.amount * LAMPORTS_PER_SOL);
    const check = await hasEnoughSolForSwap(amountLamports);
    if (!check.sufficient) {
      throw new Error(
        `Insufficient SOL: have ${(check.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
        `need ${(check.requiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL (including fees)`,
      );
    }
  }

  // PumpPortal slippage is a percentage (25 = 25%), not bps
  const slippagePercent = Math.max(params.slippageBps / 100, 1);
  // Convert priority fee from lamports to SOL
  const priorityFeeSol = params.priorityFeeLamports / LAMPORTS_PER_SOL;

  const body = {
    publicKey: keypair.publicKey.toBase58(),
    action: params.action,
    mint: params.mint,
    amount: params.amount,
    denominatedInSol: String(params.denominatedInSol),
    slippage: slippagePercent,
    priorityFee: priorityFeeSol,
    pool: 'auto',
  };

  console.log(`[Sniper] PumpPortal ${params.action}:`, {
    mint: params.mint,
    amount: params.amount,
    slippage: `${slippagePercent}%`,
    priorityFee: `${priorityFeeSol} SOL`,
    pool: 'auto',
  });

  const response = await fetch(PUMPPORTAL_TRADE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status !== 200) {
    const errorText = await response.text();
    console.error(`[Sniper] PumpPortal error (${response.status}):`, errorText);
    throw new Error(`PumpPortal ${params.action} failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  // Response is raw bytes of a serialized VersionedTransaction
  const txBuffer = Buffer.from(await response.arrayBuffer());
  const transaction = VersionedTransaction.deserialize(txBuffer);

  // Fetch blockhash BEFORE sending (Sprint 14 critical fix)
  const { blockhash, lastValidBlockHeight } = await withRpcRetry(
    () => connection.getLatestBlockhash('confirmed'),
  );

  transaction.sign([keypair]);

  const signature = await withRpcRetry(
    () => connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    }),
    2,
  );

  console.log(`[Sniper] PumpPortal tx sent: ${signature}`);

  // Confirm with timeout fallback
  let success = false;
  try {
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    success = !confirmation.value.err;
    if (confirmation.value.err) {
      console.error(`[Sniper] PumpPortal tx failed on-chain:`, confirmation.value.err);
    }
  } catch {
    console.warn(`[Sniper] PumpPortal confirmation timed out for ${signature}, checking status...`);
    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      if (status.value?.confirmationStatus === 'confirmed' ||
          status.value?.confirmationStatus === 'finalized') {
        success = !status.value.err;
        console.log(`[Sniper] PumpPortal fallback status: ${success ? 'SUCCESS' : 'FAILED on-chain'}`);
      }
    } catch {
      console.error(`[Sniper] PumpPortal fallback status check failed for ${signature}`);
    }
  }

  return {
    signature,
    success,
    outAmount: null, // PumpPortal Local API doesn't return output amount
  };
}

// ── Phase 6: Jito Bundle Execution ──────────────────────────────────────

const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

// TODO: Wire Jito into executeBuySnipe/executeSellSnipe when PumpPortal returns raw transactions
// Currently PumpPortal handles tx construction + submission internally

/** Submit a transaction via Jito bundle for MEV protection (Phase 6) */
/** @internal Exported for future use when PumpPortal supports raw tx return */
export async function submitViaJito(
  serializedTx: Buffer | Uint8Array,
  tipLamports: number,
): Promise<{ success: boolean; bundleId: string | null }> {
  try {
    const keypair = getSolanaKeypair();
    const connection = getSolanaConnection();

    // Create tip transaction to Jito
    const { SystemProgram, Transaction, PublicKey: PubKey } = await import('@solana/web3.js');
    // Jito tip accounts (pick random one)
    const jitoTipAccounts = [
      '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
      'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiYHn37n',
      'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
      'ADaUMid9yfUytqMBgopwjb2o2J3AY5VPgENJKd3XZPVL',
      'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
      'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
      'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
      '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    ];
    const tipAccount = jitoTipAccounts[Math.floor(Math.random() * jitoTipAccounts.length)];

    const tipTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PubKey(tipAccount),
        lamports: tipLamports,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tipTx.recentBlockhash = blockhash;
    tipTx.feePayer = keypair.publicKey;
    tipTx.sign(keypair);

    // Bundle: [main tx, tip tx]
    const mainTxBase64 = Buffer.from(serializedTx).toString('base64');
    const tipTxBase64 = tipTx.serialize().toString('base64');

    const res = await fetch(JITO_BUNDLE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[mainTxBase64, tipTxBase64]],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[Jito] Bundle submission failed: ${res.status}`);
      return { success: false, bundleId: null };
    }

    const data = await res.json() as { result?: string };
    console.log(`[Jito] Bundle submitted: ${data.result ?? 'unknown'}`);
    return { success: true, bundleId: data.result ?? null };
  } catch (err) {
    console.warn(`[Jito] Bundle error:`, err instanceof Error ? err.message : err);
    return { success: false, bundleId: null };
  }
}

// ── Snipe execution ────────────────────────────────────────────────────

/**
 * Execute a buy snipe using a specific template's configuration.
 * Falls back to the default template if no templateId is provided.
 *
 * Strategy: PumpPortal first (works for bonding curve + graduated),
 * then Jupiter V6 fallback (works for graduated DEX tokens).
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
  description?: string;
  /** Override buy amount from dynamic position sizing (Kelly Criterion) */
  buyAmountOverride?: number;
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

  // Effective buy amount: use override from dynamic sizing if provided
  const effectiveBuyAmountSol = params.buyAmountOverride ?? template.buyAmountSol;

  // ── EARLY SOL BALANCE CHECK (silent skip — no log spam, no execution record) ──
  // Uses cached balance to avoid an RPC call per buy attempt
  // Paper mode skips real balance check — uses virtual paperBalanceSol instead
  if (params.trigger !== 'manual' && !template.paperMode) {
    const minRequiredLamports = Math.floor((effectiveBuyAmountSol + 0.005) * LAMPORTS_PER_SOL);
    const currentBalance = await getCachedSolBalance();
    if (currentBalance < minRequiredLamports) {
      // Silently skip — don't log, don't create execution record, don't spam
      return buildFailedExecution(params, templateId, template.name, 'Insufficient SOL (silent skip)');
    }
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
    amountSol: effectiveBuyAmountSol,
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
    if (runtime.dailySpentSol + effectiveBuyAmountSol > template.dailyBudgetSol) {
      if (params.trigger !== 'manual') {
        return execution; // Silent skip — don't spam execution history
      }
      throw new Error(
        `Daily budget exceeded for "${template.name}": spent ${runtime.dailySpentSol.toFixed(4)} / ${template.dailyBudgetSol} SOL`,
      );
    }
    // Count pending buys for this template to avoid exceeding max positions
    const pendingPrefix = templateId + ':';
    let pendingForTemplate = 0;
    for (const key of pendingBuys) {
      if (key.startsWith(pendingPrefix)) pendingForTemplate++;
    }
    if (positions.size + pendingForTemplate >= template.maxOpenPositions) {
      // Silent skip for auto-triggers — don't spam execution history with failures
      if (params.trigger !== 'manual') {
        return execution;
      }
      throw new Error(
        `Max open positions reached for "${template.name}": ${positions.size} active + ${pendingForTemplate} pending >= ${template.maxOpenPositions}`,
      );
    }

    // ── PAPER MODE BUY ──────────────────────────────────────────────────
    if (template.paperMode) {
      // Check virtual SOL balance — silently skip (don't record as failed)
      if (runtime.paperBalanceSol < effectiveBuyAmountSol) {
        console.log(
          `[Sniper][${template.name}] ⏸️ Paper balance low (${runtime.paperBalanceSol.toFixed(4)} SOL < ${effectiveBuyAmountSol} SOL) — waiting for sells to recover`,
        );
        return execution;
      }

      // Get realistic token amount via Jupiter quote (no execution)
      let estimatedTokens = 0;
      try {
        const amountLamports = Math.floor(effectiveBuyAmountSol * LAMPORTS_PER_SOL);
        const quoteUrl = `https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=${SOL_MINT}&outputMint=${params.mint}&amount=${amountLamports}&slippageBps=${template.slippageBps}&txVersion=V0`;
        const quoteResp = await fetch(quoteUrl);
        if (quoteResp.ok) {
          const quoteData = await quoteResp.json() as { success?: boolean; data?: { outputAmount?: string } };
          if (quoteData.success && quoteData.data?.outputAmount) {
            estimatedTokens = parseFloat(quoteData.data.outputAmount);
          }
        }
      } catch (quoteErr) {
        console.warn(`[Sniper][${template.name}] Paper buy Raydium quote failed, using price estimate`);
      }

      // Fallback: estimate from current price if quote failed
      if (estimatedTokens <= 0 && params.priceUsd && params.priceUsd > 0) {
        // Rough estimate: (buyAmountSol * ~150 USD/SOL) / priceUsd
        const solPriceUsd = 150; // approximate, good enough for paper mode
        estimatedTokens = (effectiveBuyAmountSol * solPriceUsd) / params.priceUsd;
      }
      if (estimatedTokens <= 0) {
        estimatedTokens = 1000000; // fallback placeholder
      }

      // Deduct from virtual balance
      runtime.paperBalanceSol -= effectiveBuyAmountSol;
      runtime.dailySpentSol += effectiveBuyAmountSol;

      execution.signature = `paper_${Date.now()}`;
      execution.status = 'success';
      execution.amountTokens = estimatedTokens;
      execution.paperMode = true;

      // Create paper position
      const now = new Date().toISOString();
      const newPosition: ActivePosition = {
        mint: params.mint,
        symbol: params.symbol,
        name: params.name,
        buyPrice: params.priceUsd ?? 0,
        currentPrice: params.priceUsd ?? 0,
        amountTokens: estimatedTokens,
        pnlPercent: 0,
        buySignature: execution.signature,
        boughtAt: now,
        templateId,
        templateName: template.name,
        priceFetchFailCount: 0,
        lastPriceChangeAt: now,
        highWaterMarkPrice: params.priceUsd ?? 0,
        buyCostSol: effectiveBuyAmountSol,
        paperMode: true,
        description: params.description,
      };

      positions.set(params.mint, newPosition);
      syncActivePositionsMap();

      // Subscribe to REAL trade events for price updates
      subscribeTokenTrades([params.mint]);

      template.stats.totalTrades++;
      setLastBuyTimestamp(Date.now());

      persistPositions();
      persistDailySpend();
      persistTemplateStats();

      console.log(
        `[Sniper][${template.name}] PAPER BUY ${params.symbol}: ~${estimatedTokens.toFixed(0)} tokens for ${effectiveBuyAmountSol} SOL (virtual balance: ${runtime.paperBalanceSol.toFixed(4)} SOL)`,
      );
    } else {
      // ── REAL MODE BUY ──────────────────────────────────────────────────
      // Strategy: PumpPortal first (bonding curve + graduated), Jupiter fallback

      // Capture pre-buy SOL balance to measure ACTUAL cost (swap + fees + rent)
      const connection = getSolanaConnection();
      const walletPubkey = getSolanaKeypair().publicKey;
      const preBuyLamports = await connection.getBalance(walletPubkey);

      let result: SwapResult;

      try {
        console.log(`[Sniper][${template.name}] Trying PumpPortal buy for ${params.symbol}...`);
        result = await executePumpPortalSwap({
          action: 'buy',
          mint: params.mint,
          amount: effectiveBuyAmountSol,
          denominatedInSol: true,
          slippageBps: template.slippageBps,
          priorityFeeLamports: template.priorityFee,
        });
      } catch (ppErr) {
        console.warn(
          `[Sniper][${template.name}] PumpPortal failed, falling back to Jupiter:`,
          ppErr instanceof Error ? ppErr.message : ppErr,
        );
        const amountLamports = String(Math.floor(effectiveBuyAmountSol * LAMPORTS_PER_SOL));
        result = await executeSwap({
          inputMint: SOL_MINT,
          outputMint: params.mint,
          amountLamports,
          slippageBps: template.slippageBps,
          priorityFee: template.priorityFee,
        });
      }

      execution.signature = result.signature;
      execution.status = result.success ? 'success' : 'failed';

      if (result.success) {
        runtime.dailySpentSol += effectiveBuyAmountSol;
        execution.amountTokens = result.outAmount ? parseFloat(result.outAmount) : null;

        // PumpPortal doesn't return output amount — fetch actual balance from wallet
        if (!execution.amountTokens || execution.amountTokens <= 0) {
          // Small delay to let the transaction finalize on-chain
          await new Promise(resolve => setTimeout(resolve, 2000));
          const walletBalance = await fetchTokenBalance(params.mint);
          if (walletBalance > 0) {
            execution.amountTokens = walletBalance;
            console.log(`[Sniper][${template.name}] Got token balance from wallet: ${walletBalance.toFixed(2)} ${params.symbol}`);
          }
        }

        // Measure ACTUAL SOL spent from wallet delta — includes swap cost + tx fees + ATA rent
        // IMPORTANT: Exclude ATA rent (~0.00203 SOL) from buyCostSol because rent is
        // recovered when the token account is closed after sell. If we count rent as
        // buy cost AND the sell wallet delta includes rent recovery, P&L double-counts it.
        const ATA_RENT_SOL = 0.00203;
        const postBuyLamports = await connection.getBalance(walletPubkey);
        const actualSolSpent = Math.max(0, (preBuyLamports - postBuyLamports) / LAMPORTS_PER_SOL);
        // Subtract ATA rent from cost — it's a recoverable deposit, not a trading cost
        const swapCostExRent = actualSolSpent > ATA_RENT_SOL
          ? actualSolSpent - ATA_RENT_SOL
          : actualSolSpent;
        const realBuyCost = swapCostExRent > 0 ? swapCostExRent : effectiveBuyAmountSol;

        if (actualSolSpent > 0) {
          const feesDelta = actualSolSpent - effectiveBuyAmountSol - ATA_RENT_SOL;
          console.log(
            `[Sniper][${template.name}] Buy cost for ${params.symbol}: swap ${effectiveBuyAmountSol} SOL + fees ${Math.max(0, feesDelta).toFixed(6)} SOL + rent ${ATA_RENT_SOL} SOL (recoverable) = ${actualSolSpent.toFixed(6)} SOL total, buyCostSol=${realBuyCost.toFixed(6)} SOL`,
          );
        }

        // Use swap+fees cost for P&L tracking (excludes recoverable rent)
        execution.amountSol = realBuyCost;

        // Track position under this template
        const now = new Date().toISOString();
        const newPosition: ActivePosition = {
          mint: params.mint,
          symbol: params.symbol,
          name: params.name,
          buyPrice: params.priceUsd ?? 0,
          currentPrice: params.priceUsd ?? 0,
          amountTokens: execution.amountTokens ?? 0,
          pnlPercent: 0,
          buySignature: result.signature,
          boughtAt: now,
          templateId,
          templateName: template.name,
          priceFetchFailCount: 0,
          lastPriceChangeAt: now,
          highWaterMarkPrice: params.priceUsd ?? 0,
          buyCostSol: realBuyCost,
          description: params.description,
        };

        positions.set(params.mint, newPosition);
        syncActivePositionsMap();

        // Subscribe to real-time trade events for this token (instant price updates)
        subscribeTokenTrades([params.mint]);

        // Stats: increment totalTrades on successful buy
        template.stats.totalTrades++;

        // Update buy cooldown
        setLastBuyTimestamp(Date.now());

        // Persist state
        persistPositions();
        persistDailySpend();
        persistTemplateStats();
      }
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

/**
 * Fetch the actual token balance for a specific mint from the wallet.
 * Used when position.amountTokens is 0 (PumpPortal doesn't return output amount).
 */
export async function fetchTokenBalance(mintAddress: string): Promise<number> {
  try {
    const connection = getSolanaConnection();
    const keypair = getSolanaKeypair();
    if (!keypair) return 0;

    const mintPubkey = new PublicKey(mintAddress);
    const tokenAccounts = await withRpcRetry(
      () => connection.getParsedTokenAccountsByOwner(keypair.publicKey, { mint: mintPubkey }),
      3, // up to 3 retries for 429s
    );

    for (const { account } of tokenAccounts.value) {
      const parsed = account.data.parsed?.info as Record<string, unknown> | undefined;
      if (!parsed) continue;
      const tokenAmount = parsed.tokenAmount as { uiAmount: number } | undefined;
      if (tokenAmount && tokenAmount.uiAmount > 0) return tokenAmount.uiAmount;
    }
  } catch (err) {
    console.warn(`[Sniper] fetchTokenBalance failed for ${mintAddress.slice(0, 8)}:`, err instanceof Error ? err.message : err);
  }
  return 0;
}

export async function executeSellSnipe(
  mint: string,
  trigger: SnipeExecution['trigger'],
  templateId?: string,
  /** When true, skip enqueuing to failedSellQueue (caller handles retry) */
  skipRetryEnqueue = false,
  /** Fraction of position to sell (0-1). Default 1.0 = sell all */
  sellPct = 1.0,
): Promise<SnipeExecution | null> {
  // Resolve templateId: if not provided, find which template owns this position
  const resolvedTemplateId = templateId ?? findTemplateForPosition(mint);
  if (!resolvedTemplateId) return null;

  const template = sniperTemplates.get(resolvedTemplateId);
  if (!template) return null;

  const positions = getTemplatePositions(resolvedTemplateId);
  const position = positions.get(mint);
  if (!position) return null;

  // If amountTokens is 0 (PumpPortal buy doesn't return output), fetch from wallet
  // Paper positions skip wallet fetch — they have no real tokens
  let sellAmount = position.amountTokens;
  if (sellAmount <= 0 && !position.paperMode) {
    console.log(`[Sniper][${template.name}] Position amount is 0, fetching wallet balance for ${position.symbol}...`);
    sellAmount = await fetchTokenBalance(mint);
    if (sellAmount > 0) {
      position.amountTokens = sellAmount;
      console.log(`[Sniper][${template.name}] Wallet balance: ${sellAmount.toFixed(2)} ${position.symbol}`);
    } else {
      console.warn(`[Sniper][${template.name}] No tokens found in wallet for ${position.symbol} — removing ghost position`);
      positions.delete(mint);
      clearAntiRugWindow(mint);
      syncActivePositionsMap();
      unsubscribeTokenTrades([mint]);
      return null;
    }
  }

  // Partial sell support (tiered exits)
  if (sellPct < 1.0 && sellPct > 0) {
    sellAmount = Math.floor(sellAmount * sellPct);
    if (sellAmount <= 0) {
      // Rounding killed the amount — clean up
      positions.delete(mint);
      clearAntiRugWindow(mint);
      syncActivePositionsMap();
      return null;
    }
  }

  const id = `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const execution: SnipeExecution = {
    id,
    mint,
    symbol: position.symbol,
    name: position.name,
    action: 'sell',
    amountSol: 0,
    amountTokens: sellAmount,
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
    // ── PAPER MODE SELL ────────────────────────────────────────────────
    if (template.paperMode || position.paperMode) {
      // Calculate sell value via Jupiter quote (no execution)
      let estimatedSolReturn = 0;
      try {
        const sellAmountRawForQuote = Math.floor(sellAmount * 1_000_000); // 6 decimals for pump.fun
        const quoteUrl = `https://transaction-v1.raydium.io/compute/swap-base-in?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${sellAmountRawForQuote}&slippageBps=${template.slippageBps}&txVersion=V0`;
        const quoteResp = await fetch(quoteUrl);
        if (quoteResp.ok) {
          const quoteData = await quoteResp.json() as { success?: boolean; data?: { outputAmount?: string } };
          if (quoteData.success && quoteData.data?.outputAmount) {
            estimatedSolReturn = parseFloat(quoteData.data.outputAmount) / LAMPORTS_PER_SOL;
          }
        }
      } catch (quoteErr) {
        console.warn(`[Sniper][${template.name}] Paper sell Raydium quote failed, using price estimate`);
      }

      // Fallback: estimate from current price and buy cost
      if (estimatedSolReturn <= 0 && position.currentPrice > 0 && position.buyPrice > 0) {
        const priceRatio = position.currentPrice / position.buyPrice;
        const buyCostSol = position.buyCostSol ?? template.buyAmountSol;
        estimatedSolReturn = buyCostSol * priceRatio;
      }

      // Add returned SOL to virtual balance
      const runtime = getRuntime(resolvedTemplateId);
      runtime.paperBalanceSol += estimatedSolReturn;

      execution.signature = `paper_sell_${Date.now()}`;
      execution.status = 'success';
      execution.amountSol = estimatedSolReturn;
      execution.paperMode = true;

      // Stats tracking
      const buyCostSol = position.buyCostSol ?? template.buyAmountSol;
      const pnlSol = estimatedSolReturn - buyCostSol;

      // Accumulate sell proceeds across partial tier sells for accurate per-position win/loss
      position.accumulatedSellSol = (position.accumulatedSellSol ?? 0) + estimatedSolReturn;

      // Always update total PnL (reflects every partial sell)
      template.stats.totalPnlSol += pnlSol;

      const isPaperFullyClosing = sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01;
      const paperCountsForCircuitBreaker = trigger !== 'max_age' && trigger !== 'stale_price';

      if (isPaperFullyClosing) {
        const totalCost = position.buyCostSol ?? template.buyAmountSol;
        const netPnl = position.accumulatedSellSol - totalCost;
        const runtimeCb = getRuntime(resolvedTemplateId);

        if (netPnl >= 0) {
          template.stats.wins++;
          if (paperCountsForCircuitBreaker) runtimeCb.consecutiveLosses = 0;
        } else {
          template.stats.losses++;
          if (paperCountsForCircuitBreaker) {
            runtimeCb.consecutiveLosses++;
            if (netPnl < 0) runtimeCb.dailyRealizedLossSol += Math.abs(netPnl);
            if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
              const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
                ? template.consecutiveLossPauseMs * 3
                : template.consecutiveLossPauseMs;
              runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
              console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
            }
          }
        }
      }

      // Only fully remove position if this was a full sell
      if (sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01) {
        positions.delete(mint);
        syncActivePositionsMap();
        unsubscribeTokenTrades([mint]);
      } else {
        // Partial sell — update remaining tokens
        position.amountTokens -= sellAmount;
        syncActivePositionsMap();
      }

      // Persist (no real wallet ops needed)
      persistPositions();
      persistTemplateStats();

      console.log(
        `[Sniper][${template.name}] PAPER SELL ${position.symbol} (${trigger}): ~${estimatedSolReturn.toFixed(4)} SOL returned, PnL: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (virtual balance: ${runtime.paperBalanceSol.toFixed(4)} SOL)`,
      );
    } else {
      // ── REAL MODE SELL ───────────────────────────────────────────────
      // Always verify on-chain balance before sell — catches stale/ghost positions
      // loaded from disk where tokens no longer exist in the wallet.
      const actualOnChainBalance = await fetchTokenBalance(mint);
      if (actualOnChainBalance <= 0) {
        console.warn(
          `[Sniper][${template.name}] Ghost position detected — ${position.symbol} has 0 tokens on-chain. Removing stale position.`,
        );
        positions.delete(mint);
        syncActivePositionsMap();
        unsubscribeTokenTrades([mint]);
        persistPositions();
        return null;
      }
      // Correct tracked amount if it drifted from real wallet (partial fills, dust, etc.)
      if (Math.abs(actualOnChainBalance - sellAmount) > 1) {
        console.log(
          `[Sniper][${template.name}] Balance drift for ${position.symbol}: tracked=${sellAmount.toFixed(2)}, on-chain=${actualOnChainBalance.toFixed(2)}. Using on-chain balance.`,
        );
        // Recalculate sellAmount based on corrected balance
        sellAmount = sellPct < 1.0
          ? Math.max(1, Math.floor(actualOnChainBalance * sellPct))
          : actualOnChainBalance;
        position.amountTokens = actualOnChainBalance;
      }

      // Capture pre-sell SOL balance for on-chain verification
      const connection = getSolanaConnection();
      const walletPubkey = getSolanaKeypair().publicKey;
      const preSellLamports = await connection.getBalance(walletPubkey);

      // Sell all tokens back to SOL — PumpPortal first, Jupiter fallback
      let result: SwapResult;

      try {
        console.log(`[Sniper][${template.name}] Trying PumpPortal sell for ${position.symbol} (${sellAmount.toFixed(2)} tokens)...`);
        result = await executePumpPortalSwap({
          action: 'sell',
          mint,
          amount: sellAmount, // PumpPortal expects UI token amount when denominatedInSol=false
          denominatedInSol: false,
          slippageBps: template.slippageBps,
          priorityFeeLamports: template.priorityFee,
        });
      } catch (ppErr) {
        console.warn(
          `[Sniper][${template.name}] PumpPortal sell failed, falling back to Jupiter:`,
          ppErr instanceof Error ? ppErr.message : ppErr,
        );
        result = await executeSwap({
          inputMint: mint,
          outputMint: SOL_MINT,
          amountLamports: String(Math.floor(sellAmount * 1_000_000)), // pump.fun tokens = 6 decimals
          slippageBps: Math.max(template.slippageBps, 2500), // min 25% slippage for Jupiter sells
          priorityFee: template.priorityFee,
        });
      }

      execution.signature = result.signature;

      if (result.success) {
        // Wait for transaction to settle
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check actual SOL received
        const postSellLamports = await connection.getBalance(walletPubkey);
        const actualSolReceived = Math.max(0, (postSellLamports - preSellLamports) / LAMPORTS_PER_SOL);

        // Check if tokens actually left the wallet
        let tokensRemaining = 0;
        try {
          const allAccounts = await getAllTokenAccounts();
          const tokenAccount = allAccounts.find(a => a.mint === mint);
          tokensRemaining = tokenAccount?.balance ?? 0;
        } catch (err) {
          console.warn(`[Sniper] Failed to verify token balance after sell: ${err}`);
        }

        // Determine if the sell verified correctly.
        // Full sell   (sellPct >= 1.0): wallet should be empty (≤10 dust).
        // Partial sell (sellPct < 1.0): wallet should have ~(preBalance - soldAmount) tokens.
        //   Allow 5% tolerance for slippage/rounding — don't flag partial exits as failed.
        const expectedRemaining = sellPct < 1.0 ? position.amountTokens - sellAmount : 0;
        const tolerance = sellPct < 1.0
          ? Math.max(50, sellAmount * 0.05) // 5% of what we sold
          : 10;                               // dust threshold for full sell
        const sellVerified = Math.abs(tokensRemaining - expectedRemaining) <= tolerance;

        if (!sellVerified && tokensRemaining > tolerance) {
          // Sell verification failed — tokens did not leave the wallet as expected
          console.warn(
            `[Sniper][${template.name}] SELL VERIFICATION FAILED for ${position.symbol} — ` +
            `expected ~${expectedRemaining.toFixed(0)} remaining, got ${tokensRemaining.toFixed(0)}`,
          );
          execution.status = 'failed';
          execution.error = `Sell unconfirmed — expected ${expectedRemaining.toFixed(0)} remaining, got ${tokensRemaining.toFixed(0)}`;
          // Don't delete position, don't update stats — let retry handle it
        } else {
          // Sell confirmed on-chain
          execution.status = 'success';

          // Use actual SOL received from on-chain wallet delta (most accurate)
          // Only fall back to estimates if on-chain measurement fails
          if (actualSolReceived > 0) {
            execution.amountSol = actualSolReceived;
          } else {
            // On-chain measurement failed — log warning and use best estimate
            let estimatedSol = 0;
            if (result.outAmount) {
              estimatedSol = parseFloat(result.outAmount) / LAMPORTS_PER_SOL;
            } else if (position.currentPrice > 0 && position.buyPrice > 0) {
              const priceRatio = position.currentPrice / position.buyPrice;
              const buyCost = position.buyCostSol ?? template.buyAmountSol;
              estimatedSol = buyCost * priceRatio * sellPct;
            } else {
              const buyCost = position.buyCostSol ?? template.buyAmountSol;
              const pnlPct = position.pnlPercent ?? 0;
              estimatedSol = buyCost * (1 + pnlPct / 100) * sellPct;
            }
            execution.amountSol = estimatedSol;
            console.warn(
              `[Sniper][${template.name}] ⚠️ Sell P&L for ${position.symbol} using ESTIMATE (${estimatedSol.toFixed(6)} SOL) — on-chain balance delta was 0. P&L may be inaccurate.`,
            );
          }

          // Stats tracking on sell
          const buyAmountSol = (position.buyCostSol ?? template.buyAmountSol) * sellPct;
          const sellAmountSol = execution.amountSol;
          const pnlSol = sellAmountSol - buyAmountSol;

          // Accumulate sell proceeds across partial tier sells for accurate per-position win/loss
          position.accumulatedSellSol = (position.accumulatedSellSol ?? 0) + sellAmountSol;

          // Always update total PnL (reflects every partial sell)
          template.stats.totalPnlSol += pnlSol;

          const isPositionFullyClosing = sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01;

          // Forced time-based exits (max_age, stale_price) don't count toward circuit breaker —
          // the bot made no bad decision, the market just didn't move in time.
          const countsForCircuitBreaker = trigger !== 'max_age' && trigger !== 'stale_price';

          if (isPositionFullyClosing) {
            // Determine win/loss using total accumulated proceeds vs original buy cost
            const totalCost = position.buyCostSol ?? template.buyAmountSol;
            const netPnl = position.accumulatedSellSol - totalCost;
            const runtimeCb = getRuntime(resolvedTemplateId);

            if (netPnl >= 0) {
              template.stats.wins++;
              if (countsForCircuitBreaker) runtimeCb.consecutiveLosses = 0;
            } else {
              template.stats.losses++;
              if (countsForCircuitBreaker) {
                runtimeCb.consecutiveLosses++;
                runtimeCb.dailyRealizedLossSol += Math.abs(netPnl);
                if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
                  const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
                    ? template.consecutiveLossPauseMs * 3
                    : template.consecutiveLossPauseMs;
                  runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
                  console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
                }
              }
            }
          }

          // Only fully remove position if this was a full sell
          if (sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01) {
            positions.delete(mint);
            syncActivePositionsMap();
            unsubscribeTokenTrades([mint]);
          } else {
            // Partial sell — update remaining tokens
            position.amountTokens -= sellAmount;
            syncActivePositionsMap();
          }

          // Refresh cached SOL balance after sell (so auto-buy can resume faster)
          void refreshCachedSolBalance();

          // Close the token account to recover rent (~0.002 SOL) — only on full sell
          if (sellPct >= 1.0 || (position.remainingPct ?? 1.0) <= 0.01) {
            void closeTokenAccountForMint(mint).then(closeResult => {
              if (closeResult) {
                console.log(
                  `[Sniper] Closed token account for ${position.symbol}, recovered ~0.002 SOL`,
                );
                // Refresh balance again after rent recovery
                void refreshCachedSolBalance();
              }
            });
          }

          // Attach realized P&L to the execution record for analytics
          execution.pnlSol = pnlSol;
          execution.pnlPercent = buyAmountSol > 0 ? (pnlSol / buyAmountSol) * 100 : 0;

          // Persist state
          persistPositions();
          persistTemplateStats();
        }
      } else {
        execution.status = 'failed';
      }
    }
  } catch (err) {
    execution.status = 'failed';
    execution.error = err instanceof Error ? err.message : 'Unknown error';

    // Paper positions don't need sell retries — just close them
    if (position.paperMode) {
      console.warn(`[Sniper][${template.name}] Paper sell failed for ${position.symbol}, auto-closing`);
      void autoClosePosition(mint, resolvedTemplateId, 'Paper sell failed');
    } else if (!skipRetryEnqueue
        && trigger !== 'manual'
        && !permanentlyFailedSells.has(mint)
        && !failedSellQueue.some(e => e.mint === mint)) {
      // Queue for retry if this was an automated exit (not manual)
      position.sellFailCount = (position.sellFailCount ?? 0) + 1;

      // Persist sellFailCount immediately — without this, a gateway restart resets
      // the counter to 0 and positions can never reach MAX_POSITION_SELL_ATTEMPTS.
      persistPositions();

      if (position.sellFailCount >= MAX_POSITION_SELL_ATTEMPTS) {
        console.warn(
          `[Sniper] 🗑️ AUTO-CLOSING ${position.symbol} (${mint.slice(0, 8)}...) — ${position.sellFailCount} sell attempts failed, writing off as loss`,
        );
        permanentlyFailedSells.add(mint);
        void autoClosePosition(mint, resolvedTemplateId, 'Unsellable — all sell attempts failed');
      } else {
        failedSellQueue.push({
          mint,
          trigger,
          templateId: resolvedTemplateId,
          failedAt: Date.now(),
          retryCount: 0,
        });
        console.log(`[Sniper] Queued failed sell for retry: ${position.symbol} (${trigger}) [attempt ${position.sellFailCount}/${MAX_POSITION_SELL_ATTEMPTS}]`);
      }
    }
  }

  storeAndBroadcastExecution(execution);

  console.log(
    `[Sniper][${template.name}] ${execution.status.toUpperCase()} -- ${execution.action} ${position.symbol} (${trigger}): ${execution.signature ?? execution.error}`,
  );

  return execution;
}

// ── Position Helpers ───────────────────────────────────────────────────

/** Find which template owns a given mint position */
export function findTemplateForPosition(mint: string): string | null {
  for (const [templateId, positions] of positionsMap) {
    if (positions.has(mint)) return templateId;
  }
  return null;
}

/**
 * Find and close the SPL token account for a given mint address.
 * Searches all token accounts in the wallet for this mint and closes the first match.
 * Returns true if successful, false otherwise. Fire-and-forget safe.
 */
export async function closeTokenAccountForMint(mintAddress: string): Promise<boolean> {
  try {
    const allAccounts = await getAllTokenAccounts();
    const account = allAccounts.find(a => a.mint === mintAddress);
    if (!account) return false;

    const result = await closeTokenAccount(account.pubkey, account.programId);
    return result.success;
  } catch (err) {
    console.warn(
      `[Sniper] Failed to close token account for mint ${mintAddress.slice(0, 8)}...:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Auto-close a position that can't be sold (dead/rugged token).
 * Records it as a loss and removes from active positions.
 * Also attempts to close the on-chain token account to recover rent.
 */
export async function autoClosePosition(mint: string, templateId: string, reason: string): Promise<void> {
  const positions = positionsMap.get(templateId);
  const position = positions?.get(mint);
  if (!position) return;

  // Check if tokens are actually still in wallet — attempt final sell if so
  if (!position.paperMode) {
    let tokensRemaining = 0;
    try {
      const allAccounts = await getAllTokenAccounts();
      const tokenAccount = allAccounts.find(a => a.mint === mint);
      tokensRemaining = tokenAccount?.balance ?? 0;
    } catch { /* ignore */ }

    if (tokensRemaining > 10) {
      console.log(`[Sniper] autoClose ${mint}: ${tokensRemaining.toFixed(0)} tokens still in wallet — attempting final Jupiter sell`);
      try {
        const result = await executeSwap({
          inputMint: mint,
          outputMint: SOL_MINT,
          amountLamports: String(Math.floor(tokensRemaining * (10 ** 6))), // pump.fun tokens use 6 decimals
          slippageBps: 5000, // 50% slippage for desperate sells
          priorityFee: 100000,
        });
        if (result.success) {
          console.log(`[Sniper] autoClose final sell SUCCESS for ${mint}: sig=${result.signature}`);
        }
      } catch (err) {
        console.warn(`[Sniper] autoClose final sell FAILED for ${mint}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const template = sniperTemplates.get(templateId);
  const buyCostSol = position.buyCostSol ?? template?.buyAmountSol ?? 0.005;

  console.warn(
    `[Sniper] 🗑️ Writing off ${position.symbol} (${mint.slice(0, 8)}...) — ${reason}. Loss: ${buyCostSol.toFixed(4)} SOL`,
  );

  // Record as a loss (totalTrades was already counted at buy time — don't double-count)
  if (template) {
    template.stats.losses++;
    template.stats.totalPnlSol -= buyCostSol;
    const runtimeCb = getRuntime(templateId);
    runtimeCb.consecutiveLosses++;
    runtimeCb.dailyRealizedLossSol += buyCostSol;
    if (runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold) {
      const pauseMs = runtimeCb.consecutiveLosses >= template.consecutiveLossPauseThreshold * 2
        ? template.consecutiveLossPauseMs * 3
        : template.consecutiveLossPauseMs;
      runtimeCb.circuitBreakerPausedUntil = Date.now() + pauseMs;
      console.log(`[Sniper][${template.name}] CIRCUIT BREAKER: ${runtimeCb.consecutiveLosses} consecutive losses — pausing buys for ${pauseMs / 1000}s`);
    }
  }

  // Store a write-off execution for the log
  const execution: SnipeExecution = {
    id: `snipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mint,
    symbol: position.symbol,
    name: position.name,
    action: 'sell',
    amountSol: 0,
    amountTokens: position.amountTokens,
    priceUsd: 0,
    signature: null,
    status: 'failed',
    error: `Write-off: ${reason}`,
    trigger: 'max_age',
    templateId,
    templateName: template?.name ?? 'Unknown',
    timestamp: new Date().toISOString(),
  };
  storeAndBroadcastExecution(execution);

  // Remove position
  positions?.delete(mint);
  syncActivePositionsMap();
  unsubscribeTokenTrades([mint]);

  // Cleanup tracking
  pendingSells.delete(mint);
  const queueIdx = failedSellQueue.findIndex(e => e.mint === mint);
  if (queueIdx !== -1) failedSellQueue.splice(queueIdx, 1);

  // Persist
  persistPositions();
  persistTemplateStats();

  // Attempt to close the on-chain token account to recover rent (~0.002 SOL)
  // Skip for paper positions — no real token account exists
  if (!position.paperMode) {
    void closeTokenAccountForMint(mint).then(closed => {
      if (closed) {
        console.log(`[Sniper] Closed token account for write-off ${position.symbol}, recovered ~0.002 SOL`);
      }
    });
  }
}

/**
 * Reconcile wallet positions: sell untracked tokens and close empty accounts.
 * Finds tokens in the wallet that aren't tracked as active positions and
 * attempts to sell them, recovering SOL. Also closes empty token accounts
 * to recover rent.
 */
export async function reconcileWalletPositions(): Promise<{ recovered: number; closed: number; soldSol: number }> {
  console.log('[Sniper] Starting wallet reconciliation...');
  const allAccounts = await getAllTokenAccounts();
  let recovered = 0;
  let closed = 0;
  let soldSol = 0;

  // Get all currently tracked mints
  const trackedMints = new Set<string>();
  for (const [, positions] of positionsMap) {
    for (const [mint] of positions) {
      trackedMints.add(mint);
    }
  }

  for (const account of allAccounts) {
    if (account.balance <= 0) {
      // Close empty token accounts to recover rent
      try {
        await closeTokenAccount(account.pubkey, account.programId);
        closed++;
        console.log(`[Sniper] Closed empty token account for ${account.mint.slice(0, 8)}...`);
      } catch { /* ignore */ }
      continue;
    }

    // Skip if already tracked as open position
    if (trackedMints.has(account.mint)) continue;

    // Skip SOL-like tokens (WSOL etc)
    if (account.mint === SOL_MINT) continue;

    // Try to sell untracked tokens
    console.log(`[Sniper] Reconcile: Found untracked token ${account.mint.slice(0, 8)}... with ${account.balance.toFixed(2)} tokens — selling`);
    try {
      const amountRaw = Math.floor(account.balance * (10 ** account.decimals));
      const preBal = await getSolanaConnection().getBalance(getSolanaKeypair().publicKey);

      // Try PumpPortal first (most pump.fun tokens)
      let success = false;
      try {
        const ppResult = await executePumpPortalSwap({
          action: 'sell',
          mint: account.mint,
          amount: amountRaw,
          denominatedInSol: false,
          slippageBps: 5000,
          priorityFeeLamports: 100000,
        });
        success = ppResult.success;
      } catch {
        // Fallback to Jupiter
        try {
          const jupResult = await executeSwap({
            inputMint: account.mint,
            outputMint: SOL_MINT,
            amountLamports: String(amountRaw),
            slippageBps: 5000,
            priorityFee: 100000,
          });
          success = jupResult.success;
        } catch { /* ignore */ }
      }

      if (success) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const postBal = await getSolanaConnection().getBalance(getSolanaKeypair().publicKey);
        const solGained = (postBal - preBal) / LAMPORTS_PER_SOL;
        soldSol += Math.max(0, solGained);
        recovered++;
        console.log(`[Sniper] Reconcile: Sold ${account.mint.slice(0, 8)}... for ~${solGained.toFixed(4)} SOL`);
      }
    } catch (err) {
      console.warn(`[Sniper] Reconcile: Failed to sell ${account.mint.slice(0, 8)}...: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Refresh cached balance
  void refreshCachedSolBalance();
  console.log(`[Sniper] Reconciliation complete: ${recovered} tokens sold (~${soldSol.toFixed(4)} SOL recovered), ${closed} empty accounts closed`);
  return { recovered, closed, soldSol };
}

export function buildFailedExecution(
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

export function storeAndBroadcastExecution(execution: SnipeExecution): void {
  executionHistory.unshift(execution);
  if (executionHistory.length > MAX_HISTORY) executionHistory.pop();

  broadcast('solana:sniper', {
    event: 'snipe:executed',
    execution,
  });

  // Persist to disk
  persistExecutions();
}
